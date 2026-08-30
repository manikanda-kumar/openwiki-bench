---
type: workflow
title: Image Prebuild
description: Repository and environment image builds using fingerprint identity, create-bind-launch, a 30-minute cron, queue finalization, and spawn-time selection that never blocks sessions.
tags: [image-builds, prebuild, fingerprint, modal, vercel, opencomputer, e2b]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-bb4971132a91d2f43607be8b
    resource: repo://packages/control-plane/src/image-builds/finalization-consumer.ts
  - id: openwiki-source-17cca56c03251aa00ffdfb64
    resource: repo://packages/control-plane/src/image-builds/fingerprint.ts
  - id: openwiki-source-94054330f8ea4049a11657d1
    resource: repo://packages/control-plane/src/image-builds/model.ts
  - id: openwiki-source-80aff97ff79271d718ef6339
    resource: repo://packages/control-plane/src/image-builds/provider-policy.ts
  - id: openwiki-source-c17bbe00abbcf37cbd7991f3
    resource: repo://packages/control-plane/src/image-builds/scheduler.ts
  - id: openwiki-source-d67978cdb180862cca3ffb24
    resource: repo://packages/control-plane/src/image-builds/workflow.ts
  - id: openwiki-source-66587463738be0ef3850ffd6
    resource: repo://packages/control-plane/src/routes/image-builds.ts
  - id: openwiki-source-12eddf76bf761158a1fb4559
    resource: repo://packages/control-plane/src/sandbox/lifecycle/image-selection.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Image Prebuild

Prebuilt images bake clone + `.openinspect/setup.sh` into a provider artifact so new sessions start from that snapshot and only git-sync recent commits. Operator UI and policy: `docs/IMAGE_PREBUILD.md`. This page is the control-plane contract.

Related: [Control Plane](/openwiki/architecture/control-plane.md), [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md), [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md), [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md).

## Who supports it

`ImageBuildProvider` is `modal` | `vercel` | `opencomputer` | `e2b`. **Daytona has no image-build support**; settings and routes return `getImageBuildsUnsupportedMessage`. E2B builds run in a throwaway sandbox and snapshot a reusable template (stop, not pause, on teardown).

Artifacts are opaque ids: Modal image, Vercel snapshot, OpenComputer checkpoint, E2B snapshot. Adapters own provider APIs; `ImageBuildWorkflow` sequences the lifecycle.

## Scopes

A build is for one **scope**:

| Kind | `scope.id` | What it bakes |
| --- | --- | --- |
| `repo` | lowercase `owner/name` (`repoImageBuildScope`) | One repository on its **default branch** |
| `environment` | environment id | Ordered set of up to 10 repos at each member's base branch |

Ad-hoc multi-repository sessions (the session picker "Multiple repositories" list) **never** use prebuilt images. Environment sessions can.

Fingerprint (`computeRepositoriesFingerprint`) is SHA-256 over ordered `[owner.lower, name.lower, baseBranch]` triples. Owner/name are case-insensitive; branch names are case-sensitive. Reordering an environment is a different image. Spawn matching uses the **session's own repository snapshot**, not the live environment row, so an edit after create cannot hand a session the wrong artifact.

## Create-bind-launch

All triggers (cron, save-hooks, manual rebuild) go through `ImageBuildWorkflow.triggerBuild`. One active build per scope: `registerBuild` is a NOT EXISTS insert; a concurrent trigger returns `already_building`.

1. Plan repositories, secrets (same scoping as a session of that kind), callback URLs, hashed callback token.
2. **Create** a dormant provider sandbox.
3. **Bind** its provider session id into D1 before the runtime starts (`bindProviderSession`). Binding failure tears the sandbox down.
4. **Launch** clone + setup in position order. A failing setup fails the whole build; environment errors name the repository.

The runtime POSTs build-complete or build-failed (`packages/control-plane/src/routes/image-builds.ts`). Complete bodies require `provider_session_id`, `repository_shas`, and `runtime_version` starting with `v<number>` — an unversioned image must never become ready. Auth is a callback token, not the session sandbox token.

Accepted completion/failure is published as a **secret-free** job on `IMAGE_BUILD_FINALIZATION_QUEUE`. The Worker `queue` handler that is not the Autofix prefix runs `consumeImageBuildFinalizations`. Invalid jobs ack and drop; `retry` delays redelivery; later messages in the batch still run.

The finalizer takes the provider snapshot/checkpoint, fences the artifact id in D1, marks the row ready (or superseded), and cleans up the build sandbox. A D1 lease prevents two consumers snapshotting the same session. Ambiguous snapshot outcomes fail the row rather than retrying create.

## Scheduler

`IMAGE_BUILD_SCHEDULER_CRON` is `7,37 * * * *` (every 30 minutes, offset from the abandoned-draft cron). The Worker `scheduled` handler dispatches that string to `runImageBuildScheduler`.

Each tick: republish stuck finalizations, mark stale building rows failed, clean provider sessions, **reconcile every enabled scope** (fingerprint mismatch, SHA drift, missing/failed image, runtime below floor → trigger), reap old artifacts.

Immediate triggers (outside cron): enable repo prebuild, save a prebuild-enabled environment, change environment secrets (also retires the ready image so rotated secrets cannot keep serving), manual rebuild. Save-hooks use `triggerBuildIfStale` so a matching ready image is not rebuilt; SHA/runtime drift stays the cron's job.

Changing `SANDBOX_PROVIDER` should keep the previous provider's credentials until that provider's cleanup backlog is empty; maintenance uses each row's **recorded** provider.

## Spawn selection

`evaluateImageBuildForSpawn` (`packages/control-plane/src/sandbox/lifecycle/image-selection.ts`):

1. Latest ready image for the scope on the **active** provider, enablement-gated.
2. Must have `provider_image_id`.
3. `runtime_version` must parse and meet `MIN_COMPATIBLE_RUNTIME_VERSION` (fail closed if unparseable).
4. Fingerprint must equal the session's snapshot.

Any miss → boot from the base image. Sessions are **never** blocked waiting for a build. A restore failure marks the image failed so the next cron rebuilds. Setup scripts do **not** re-run at spawn; git sync picks up commits since the baked SHAs.

A repo-scope image is default-branch only. Checking out another branch computes a different fingerprint and misses — the picker annotation does not change with the branch selector.

## Invariants

- Per-scope concurrency 1.
- Fingerprint is control-plane-only; the data plane does not compute it.
- Callbacks authenticate with the build token; complete payloads must include a runtime version.
- Finalization is durable via Queue, not only `waitUntil`.
- Spawn never waits on an in-flight build.

## Extension seams

- New provider: implement `ImageBuildAdapter`, add to `ImageBuildProvider`, `provider-factory`, and `IMAGE_BUILD_PROVIDERS`.
- New trigger: call `triggerBuild` / `triggerBuildIfStale` so the concurrency guard stays in one place.

## Focused tests

- Workflow bind/trigger races: `packages/control-plane/src/image-builds/workflow.test.ts`
- Fingerprint and spawn selection: `fingerprint` + `packages/control-plane/src/sandbox/lifecycle/` neighboring tests
- Finalization consumer: `finalization-consumer.test.ts`
- Provider adapters: `modal-adapter`, `vercel-adapter`, `opencomputer-adapter`, `e2b-adapter` tests
- Cron wiring: `packages/control-plane/test/integration/image-build-scheduler.test.ts`
