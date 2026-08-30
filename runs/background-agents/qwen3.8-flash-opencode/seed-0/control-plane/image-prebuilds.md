---
type: subsystem
title: Image Prebuild System
description: Prebuilt sandbox images for repositories and environments — scheduled branch-drift builds, the dormant create-bind-launch build session flow, single-use HMAC callback tokens, queue-backed finalization, and fingerprint-matched spawn selection.
tags: [image-builds, prebuilds, queues, sandbox, modal]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-72f328299068ced4bc03ba25
    resource: repo://docs/IMAGE_PREBUILD.md
  - id: openwiki-source-ae36133dde52a5b02b299597
    resource: repo://packages/control-plane/src/image-builds/callback-auth.ts
  - id: openwiki-source-bb4971132a91d2f43607be8b
    resource: repo://packages/control-plane/src/image-builds/finalization-consumer.ts
  - id: openwiki-source-c8e21f4ccfbf567f5639d58e
    resource: repo://packages/control-plane/src/image-builds/finalization-job.ts
  - id: openwiki-source-17cca56c03251aa00ffdfb64
    resource: repo://packages/control-plane/src/image-builds/fingerprint.ts
  - id: openwiki-source-2791bf357719e763cd0c9de2
    resource: repo://packages/control-plane/src/image-builds/lookup.ts
  - id: openwiki-source-da40f2cb04518f6ceffd5c8c
    resource: repo://packages/control-plane/src/image-builds/rebuild-policy.ts
  - id: openwiki-source-c17bbe00abbcf37cbd7991f3
    resource: repo://packages/control-plane/src/image-builds/scheduler.ts
  - id: openwiki-source-d67978cdb180862cca3ffb24
    resource: repo://packages/control-plane/src/image-builds/workflow.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-12eddf76bf761158a1fb4559
    resource: repo://packages/control-plane/src/sandbox/lifecycle/image-selection.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-b4fcd225b1d428a7ab560a2d
    resource: repo://packages/control-plane/src/sandbox/sandbox-env.ts
  - id: openwiki-source-ca15e4453ec332452279c0d4
    resource: repo://packages/modal-infra/src/sandbox/build_session.py
  - id: openwiki-source-4f606005c64e373cdd655a89
    resource: repo://packages/modal-infra/src/web_api.py
  - id: openwiki-source-d65f58f0e337b900149d1fc5
    resource: repo://packages/modal-infra/tests/test_build_sandbox_lifecycle.py
  - id: openwiki-source-cb1f4cbbd3c482b410b546c2
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/modal_image_build_start.py
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Cold sessions pay clone + dependency install before the agent can work. The **prebuild system** (`packages/control-plane/src/image-builds/`, 34 files) builds that baseline ahead of time for a *scope* — a single repository (on its default branch) or a whole [environment](/openwiki/control-plane/d1-data-model.md) (all its repos plus setup scripts) — so sessions boot from a provider image artifact and only fetch recent commits. Provider support differs: Modal, Vercel, and OpenComputer store prebuilt images (and E2B via snapshot-templates); Daytona uses persistent sandboxes instead (`docs/IMAGE_PREBUILD.md:36–40`).

## Scheduled reconciliation

`runImageBuildScheduler` fires on cron `7,37 * * * *` (`IMAGE_BUILD_SCHEDULER_CRON`, `image-builds/scheduler.ts:22`, dispatched from `index.ts:53–61`). Each pass:

1. **Republish recoverable finalizations** back onto the Queue and mark stale builds failed (`staleMarked`),
2. **Clean up provider sessions** of completed builds and **reap failed/superseded image artifacts** (`reaper.ts`, `session-cleanup.ts`),
3. **Reconcile each enabled scope**: fetch the branch head(s) via the source-control provider and run `evaluateImageBuildRebuildPolicy` (`rebuild-policy.ts`) — a missing ready image, drifted `repository_shas`, or an out-of-minimum runtime version triggers `triggerBuildWithTarget`; in-flight builds no-op, so there is at most one active build per scope. Immediate triggers (enable, save with repo-set edit, secret rotation, manual "Rebuild now" from Settings › Images) enter through the same workflow (`routes/image-builds.ts`, `scope.ts`, `planner.ts`).

## Build flow: create → bind → launch → callback → snapshot

`image-builds/workflow.ts` is the orchestrator. Per provider there's an adapter (`modal-adapter.ts`, `e2b-adapter.ts`, `opencomputer-adapter.ts`, `vercel-adapter.ts` behind `provider-factory.ts`; backend→provider mapping in `provider-policy.ts`), sharing the create-bind-launch contract (`ImageBuildProviderTriggerConfig` in `sandbox/provider.ts:25–47`):

1. **Create a *dormant* build session** on the provider — env-tagged (e.g. Modal tags `openinspect_kind=image-build`, `openinspect_build_id/...`), launched with `IMAGE_BUILD_MODE=true`, **no LLM API keys and no session-auth env** (`buildImageBuildEnvVars` scrubs reserved callback keys from user secrets; `sandbox-env.ts:401–426`). The sandbox runtime boots in BUILD mode: clone at base branches → run `setup.sh` → report → idle without starting the agent (`sandbox-runtime` supervisor; setup failure is fatal here, unlike normal boots).
2. **Bind**: the D1 `image_builds` row stores the provider session id *before* anything can launch it (`onProviderSessionCreated`), so later operations address only the exact tagged, bound session — mismatch reads as `BuildSessionNotFoundError` ("absent **or bound to another build**").
3. **Launch**: mint a single-use **callback token** (256-bit random; only its HMAC hash + expiry under `IMAGE_CALLBACK_TOKEN_PEPPER` are stored, with a frozen domain-separation prefix `repo-image-callback:` — `callback-auth.ts:12–36`; TTL 2 h), then deliver the token to the sandbox (Modal: written to the entrypoint's **stdin** as `token + "\n"` via the gated `--await-modal-image-build-token-stdin-v1` protocol, and popped from the child's env after use — `modal_image_build_start.py`).
4. **Callback**: the runtime POSTs `/image-builds/build-complete` (or `build-failed`) bearing the token (`Bearer`, 3 retries backoff, `repo_image_callback.py`); the store authorizes it against the hash and the bound provider session id, records the **exact `repository_shas` and `runtime_version`** the build ran with, and — critically — **only then** publishes a secret-free finalization job onto the Durable Queue (`finalization-job.ts`). Success *requires* a provider session id so the snapshot can't be forged or pointed elsewhere.
5. **Finalize** (`finalization-consumer.ts`, wired through `worker queue()` routing in `index.ts:82–89`): the queue consumer snapshots the still-live build sandbox into a provider image (`finalizer.ts`, with `IMAGE_BUILD_FINALIZATION_GRACE_SECONDS = 10 min` on top of the execution budget), registers the artifact, and terminates the session. Queue semantics are explicit: invalid payloads ack-discard, busy/failed messages retry with delay without aborting the batch, and the scheduler re-publishes any finalization the consumer never completed — the queue makes snapshotting survive worker crashes.

The callback-then-snapshot *order* is the security and consistency hinge: the image id never passes through the sandbox, and rows flip `building → ready|failed|superseded` only through paths that cannot leave a live-but-unaccounted provider session (the 0052/0053 lease columns exist for exactly that cleanup).

## Spawn-time selection

Sessions never block on builds. `createImageBuildLookup` (`lookup.ts`) binds the lifecycle manager's `ImageBuildLookup` port to a scope-enabled check plus the latest *ready* image **on the active provider**; `evaluateImageBuildForSpawn` (`packages/control-plane/src/sandbox/lifecycle/image-selection.ts:1–17`) then accepts it only if (a) the image's runtime version passes the compatibility floor and (b) its `repositories_fingerprint` equals the fingerprint of the **session's own repository snapshot** — not the scope's current repos, so an environment edited after session creation can never hand it a mismatched image. The fingerprint is an order-sensitive SHA-256 over (owner, name, base_branch) triples, computed **only control-plane-side at registration and at spawn matching** (`fingerprint.ts:1–29`). A miss boots the base image. Environment sessions get environment images; single-repo ad-hoc sessions get repo images; ad-hoc multi-repo sets have no scope and never use prebuilds (`sandbox/lifecycle/manager.ts:541–561`).

## Operations

- Enablement and triggering live in Settings › Images (`routes/image-builds.ts` toggle/trigger/list), with `supportsRepoImages()` gating the web tab by deployed provider.
- Provider-switch caution: keep old provider credentials until terminal-build cleanup drains (`docs/IMAGE_PREBUILD.md:109–112`).
- Cross-language contracts (timeout numbers, callback env names, reserved-key scrubs) are pinned by tests that read the other plane's source (`packages/modal-infra/tests/test_build_sandbox_lifecycle.py`, `image-builds/timeouts.ts`, `sandbox-runtime/.../image_build_callback_env.json`), so drift fails CI.
- Runtime bumps (`runtime_manifest.json` generation) age out old images via `rowsAged` reconciliation rather than deleting them mid-flight.
