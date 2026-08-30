---
type: concept
title: Pre-Built Images (Image Build Subsystem)
description: How Open-Inspect pre-bakes sandbox image artifacts for repositories and environments — build scopes, fingerprints, the trigger/scheduler/rebuild policy, callback auth, the finalization queue, and spawn-time image selection.
tags: [image-builds, prebuilt-images, sandbox, builds, scheduling]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-72f328299068ced4bc03ba25
    resource: repo://docs/IMAGE_PREBUILD.md
  - id: openwiki-source-4cfc3d1c11ffb7fab939e818
    resource: repo://packages/control-plane/src/db/image-build-finalization.ts
  - id: openwiki-source-c1104e7eb4cef3024711d45d
    resource: repo://packages/control-plane/src/db/image-builds.ts
  - id: openwiki-source-b3029b07c424d498935e315e
    resource: repo://packages/control-plane/src/db/repo-metadata.ts
  - id: openwiki-source-ae36133dde52a5b02b299597
    resource: repo://packages/control-plane/src/image-builds/callback-auth.ts
  - id: openwiki-source-34b29fc5b4227eb81ac131df
    resource: repo://packages/control-plane/src/image-builds/e2b-adapter.ts
  - id: openwiki-source-39276305003b2453c9c6357a
    resource: repo://packages/control-plane/src/image-builds/finalization-error.ts
  - id: openwiki-source-c8e21f4ccfbf567f5639d58e
    resource: repo://packages/control-plane/src/image-builds/finalization-job.ts
  - id: openwiki-source-673ec691c62d90c8d2f67ec2
    resource: repo://packages/control-plane/src/image-builds/finalizer.ts
  - id: openwiki-source-17cca56c03251aa00ffdfb64
    resource: repo://packages/control-plane/src/image-builds/fingerprint.ts
  - id: openwiki-source-2791bf357719e763cd0c9de2
    resource: repo://packages/control-plane/src/image-builds/lookup.ts
  - id: openwiki-source-57015c95a31da54d996279ed
    resource: repo://packages/control-plane/src/image-builds/maintenance.ts
  - id: openwiki-source-3cff4d9d2d1a5cd8db21c7f1
    resource: repo://packages/control-plane/src/image-builds/modal-adapter.ts
  - id: openwiki-source-94054330f8ea4049a11657d1
    resource: repo://packages/control-plane/src/image-builds/model.ts
  - id: openwiki-source-74d3686d58d36c3b3f5bcd98
    resource: repo://packages/control-plane/src/image-builds/opencomputer-adapter.ts
  - id: openwiki-source-f2b4f69e7d61b7b238f26d81
    resource: repo://packages/control-plane/src/image-builds/planner.ts
  - id: openwiki-source-80aff97ff79271d718ef6339
    resource: repo://packages/control-plane/src/image-builds/provider-policy.ts
  - id: openwiki-source-0ae1cb16940e7c4e59a955ea
    resource: repo://packages/control-plane/src/image-builds/reaper.ts
  - id: openwiki-source-da40f2cb04518f6ceffd5c8c
    resource: repo://packages/control-plane/src/image-builds/rebuild-policy.ts
  - id: openwiki-source-c62c8bf45ebf44a989a34ca3
    resource: repo://packages/control-plane/src/image-builds/save-hooks.ts
  - id: openwiki-source-c17bbe00abbcf37cbd7991f3
    resource: repo://packages/control-plane/src/image-builds/scheduler.ts
  - id: openwiki-source-e4551796343e091f25083955
    resource: repo://packages/control-plane/src/image-builds/scope.ts
  - id: openwiki-source-7042647e965f3143b464eae4
    resource: repo://packages/control-plane/src/image-builds/session-cleanup.ts
  - id: openwiki-source-78d79c9c9f6ae2582d131b7d
    resource: repo://packages/control-plane/src/image-builds/timeouts.ts
  - id: openwiki-source-c16c5d7587694492f9e2b34e
    resource: repo://packages/control-plane/src/image-builds/types.ts
  - id: openwiki-source-bcc80e7ca506a1801f270b8d
    resource: repo://packages/control-plane/src/image-builds/vercel-adapter.ts
  - id: openwiki-source-d67978cdb180862cca3ffb24
    resource: repo://packages/control-plane/src/image-builds/workflow.ts
  - id: openwiki-source-15ffbce2de0ef74eec69d739
    resource: repo://packages/control-plane/src/routes/environment-secrets.ts
  - id: openwiki-source-66587463738be0ef3850ffd6
    resource: repo://packages/control-plane/src/routes/image-builds.ts
  - id: openwiki-source-12eddf76bf761158a1fb4559
    resource: repo://packages/control-plane/src/sandbox/lifecycle/image-selection.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-34e06057c714bce9a57f0b88
    resource: repo://packages/control-plane/src/sandbox/provider-name.ts
  - id: openwiki-source-41952f779c848b0196f22641
    resource: repo://packages/control-plane/src/sandbox/providers/e2b-provider.ts
  - id: openwiki-source-5951ad3abbae5840613b8cda
    resource: repo://packages/control-plane/src/sandbox/providers/modal-provider.ts
  - id: openwiki-source-5bd0ac0dcec22450aa912fbb
    resource: repo://packages/control-plane/src/sandbox/providers/vercel/provider.ts
  - id: openwiki-source-7d94c4842f675779386f1422
    resource: repo://packages/control-plane/src/sandbox/runtime-manifest.ts
  - id: openwiki-source-cb1f4cbbd3c482b410b546c2
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/modal_image_build_start.py
  - id: openwiki-source-fb68899d3462859b54764231
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repo_image_callback.py
  - id: openwiki-source-efad196f8337a5eed6f4693a
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repository_boot.py
  - id: openwiki-source-06e38d23b5f3fbd3e1fc1731
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repository_hooks.py
  - id: openwiki-source-b185b5840284429fac0e62d7
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/runtime_config.py
  - id: openwiki-source-c7eda8a4bda82770c95dbd6a
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/runtime_manifest.json
  - id: openwiki-source-1c00ceaa09c78a88ce71092a
    resource: repo://packages/shared/src/types/image-builds.ts
  - id: openwiki-source-4e3916f9d6e86e79ad62fdb3
    resource: repo://packages/shared/src/types/integrations.ts
  - id: openwiki-source-d5d330a58f189eecc7898dce
    resource: repo://packages/web/src/hooks/use-session-target-picker.ts
  - id: openwiki-source-5a210d639df2d2575b2b37c8
    resource: repo://packages/web/src/lib/sandbox-provider.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Pre-Built Images (Image Build Subsystem)

Pre-built images make session startup fast: instead of cloning repositories and
installing dependencies on every session start, the image-build subsystem keeps
a ready-to-go provider artifact (Modal image, Vercel snapshot, OpenComputer
checkpoint, or E2B snapshot) that is refreshed automatically. New sessions boot
from that artifact and only pull the latest commits, cutting startup from
minutes to seconds.

One build subsystem serves two **build scopes**:

- **Repository scope** — a one-repository set built on that repository's
  default branch, enabled per-repo under **Settings > Images**.
- **Environment scope** — an ordered set of up to 10 repositories, enabled
  per-environment under **Settings > Environments** (the environment's
  `prebuild_enabled` flag).

Everything downstream of scope resolution treats the kind as data; only
`image-builds/scope.ts` switches on scope kind.

## Provider Support

Image builds exist only when the deployment's `SANDBOX_PROVIDER` is `modal`,
`vercel`, `opencomputer`, or `e2b` — the shared provider policy in
`provider-policy.ts` returns exactly those, and the settings/routes surface a
"not supported" message (HTTP 501) otherwise. Daytona deployments use
persistent sandboxes instead and have no image support — the one backend
excluded from the union. The artifact is provider-opaque: a Modal image id,
Vercel snapshot id, OpenComputer checkpoint id, or E2B snapshot template id.
Code outside the provider adapters treats those ids as opaque strings.

Each provider translates the same lifecycle contract differently. E2B's
snapshot path (`takePrebuiltImageSnapshot`) pauses the build sandbox with
memory disabled, reconnects cold, scrubs the supervisor log (which may hold
secrets printed by setup hooks), and creates a standalone snapshot template —
so E2B image builds use pause/resume as the *snapshot mechanism*, not as
persistent sandboxes.

## Image Identity: Fingerprint and Provenance

Every image records the identity of the exact repository set it was built for:

- **Repositories fingerprint** — a SHA-256 over the ordered `(owner, name,
  baseBranch)` triples of the scope's repositories. Order is significant:
  repositories are position-ordered and setup hooks run in that order, so a
  reordered environment is a different build. Owner/name are lowercased;
  branch names stay case-sensitive. The fingerprint is computed
  control-plane-side only — at build registration and at spawn matching —
  never by the data plane, so the algorithm has exactly one home. A repo scope
  is simply a one-element set whose branch is the repository's resolved
  **default branch**, which reproduces the old base-branch spawn filter.
- **Repository SHAs** — the per-repository commit SHA each repository was
  cloned at, reported by the sandbox runtime at build time via the build
  callback and stored in the `repository_shas` JSON column. The rebuild cron
  compares these against `git ls-remote`.
- **Runtime version** — the `SANDBOX_VERSION` the image was baked with,
  gating both spawn selection and rebuild decisions against compatibility
  floors (`MIN_COMPATIBLE_RUNTIME_VERSION` for spawning,
  `MIN_REBUILD_RUNTIME_VERSION` for rebuilds, both derived from the sandbox
  runtime manifest; currently generation 60).

Editing a scope (changing an environment's repositories, order, or a base
branch) changes the fingerprint, so the old image is automatically retired and
the next scheduler pass rebuilds.

## Triggering Builds

All trigger sources converge on `ImageBuildWorkflow.triggerBuild` so the
per-scope concurrency-1 rule is enforced in one place:

- **The scheduler cron** (`IMAGE_BUILD_SCHEDULER_CRON = "7,37 * * * *"` — every
  30 minutes at minutes 7 and 37) evaluates every prebuild-enabled scope via
  the rebuild policy and starts every required rebuild it finds.
- **Save-hooks** — saving a prebuild-enabled environment (create or update),
  toggling a repository's prebuild flag on, and changing an environment's
  secrets all schedule an immediate build via `scheduleImageBuildOnSave`
  (best-effort, detached: a trigger failure must never fail the CRUD
  operation).
- **Manual rebuild routes** — `POST /image-builds/trigger/environment/:id`
  and `POST /image-builds/trigger/repo/:owner/:name`.

A secret change additionally runs `supersedeImageBuildsForSecretsChange`
synchronously before the response: every live image for the scope — including
in-flight builds baking the outdated values — is flipped to `superseded` first,
because spawn matching sees repositories through the fingerprint but cannot
see secrets. Without write-side invalidation, a failed or in-flight rebuild
would leave revoked values baked into a still-selectable image. The supersede
is awaited and fail-visible: the secrets are already stored at that point, so a
failure returns a distinct error telling the caller to retry (a retried
mutation re-runs the supersede) instead of masquerading as a failed write; the
subsequent rebuild is detached and best-effort.

The per-scope concurrency rule is enforced atomically in D1: `registerBuild`
uses an `INSERT ... WHERE NOT EXISTS (building row for the same scope+provider)`
guard. A concurrent trigger that loses the race reports the winner's build as
`already_building`; `getActiveBuild` before registration is only a cheap
short-circuit. Only one build runs per scope at a time.

### The Planner: Register-Before-Secrets Ordering

`ImageBuildPlanner` sequences a trigger in phases:

1. `resolveTarget` (scope.ts) resolves the current repository set and computes
   its fingerprint — cheap D1 reads plus a source-control access check for repo
   scopes — *before* the build row is registered.
2. `createCallbackAuth` mints the single-use callback token (pure crypto).
3. `registerBuild` persists the `building` row with the token's hash.
4. `planBuild` runs *after* registration: it decrypts build-time secrets and
   resolves sandbox settings, so a concurrent secret change always sees a row
   to supersede, and the build's now-stale secrets can never reach a
   still-selectable image.

Build-time secrets are exactly the fold the scope's sessions get: for an
environment scope, global + environment secrets (repo-scoped secrets never
inherit); for a repo scope, global + that repository's secrets. The build
timeout is the scope's resolved `buildTimeoutSeconds` sandbox setting: global
defaults, overridden by the primary repository's settings, and — for
environments — the environment's own overrides, capped at
`MAX_BUILD_TIMEOUT_SECONDS` (3600 s; the default is 1800 s).

The plan hands each provider adapter: the repository set and fingerprint, both
callback URLs (success and failure are sent explicitly so a renamed route never
silently points failures at a 404), the callback bearer token, the resolved
build-execution timeout, clone auth from the source-control credential-helper
auth, and user env vars built from the decrypted secrets via
`prepareLegacyManagedProviderEnv`.

## The Build Lifecycle

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: a semicolon inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    trigger[Build trigger] --> register[Register building row and callback token]
    register --> create[Create dormant provider session]
    create --> bind[Persist the provider session id]
    bind --> run[Start runtime: clone repositories and run setup]

    run -->|success callback| accept[Authenticate and persist completion metadata]
    run -->|failure callback| fail[Authenticate and persist failed state]
    accept --> publish[Publish secret-free Queue command]
    fail --> publish

    publish --> state{Accepted build state}
    state -->|success: building| lease{D1 finalization lease available?}
    state -->|failure: failed| cleanup[Terminate provider session]
    lease -->|no| retry[Retry after the active lease]
    retry --> lease
    lease -->|yes| artifact[Snapshot or checkpoint provider session]

    artifact --> fence[Fence provider artifact id in D1]
    fence --> ready[Mark image ready or superseded]
    ready --> cleanup
    cleanup --> done[Clear cleanup obligation]

    artifact -->|definitely no artifact created| retry
    artifact -->|outcome ambiguous| terminal[Mark failed; do not create again]
    terminal --> cleanup
```

### Provider-Session Contract

Every supported provider follows the same create-bind-launch lifecycle
(`ImageBuildAdapter.startBuild`): the provider creates a **dormant** sandbox,
the adapter calls `bindProviderSession` so the control plane persists the
provider session id (`provider_session_id`, with `provider_session_cleanup_pending`
set), and only then does the runtime launch. The sandbox runs the same setup
steps a normal session would: it clones every repository in the scope at its
base branch (for environments, **sequentially in position order**), then runs
each repository's `.openinspect/setup.sh` if present, in order. In `BUILD` boot
mode a failing setup script fails the whole build and, for environment builds,
the error names the repository. Build-time secrets are passed to the sandbox as
user env vars.

The control plane triggers builds through the Modal provider's
`triggerImageBuild` (create sandbox → `onProviderSessionCreated` → start with
the callback token fed over stdin via the `--await-modal-image-build-token-stdin-v1`
protocol), and through analogous Vercel/OpenComputer/E2B provider capabilities.
Build sandboxes receive the configured execution timeout plus a ten-minute
finalization grace (`IMAGE_BUILD_FINALIZATION_GRACE_MS`) so the callback can be
delivered and the artifact created. Because Vercel caps sandbox lifetime at 45
minutes, Vercel build execution is capped at 35 minutes
(`VERCEL_MAX_SANDBOX_TIMEOUT_MS - IMAGE_BUILD_FINALIZATION_GRACE_MS`); Modal and
OpenComputer honor the configured execution timeout up to the shared one-hour
limit.

### Callback Authentication

Every build authenticates its completion callbacks with the single-use bearer
token minted at trigger time. Only the token's HMAC hash is stored on the build
row; the hash is computed under the pepper
(`IMAGE_CALLBACK_TOKEN_PEPPER`) with the wire/storage-frozen domain-separation
prefix `"repo-image-callback:"`. The token is valid for
`IMAGE_BUILD_CALLBACK_TOKEN_TTL_MS` (2 hours), and the store additionally binds
every token to the exact provider session id (`authorizeCompletionCallback`
requires the presented session id to match the row's, compared with
`timingSafeEqual` on the hash).

The runtime reports success to `POST /image-builds/build-complete` and failure
to `POST /image-builds/build-failed` with `Authorization: Bearer <token>`,
retrying up to 3 times with exponential backoff. The routes validate the body
by schema before auth (a malformed body is a 400 that leaks nothing). Missing,
expired, or forged tokens map to 401; a deployment with no pepper bound is
"misconfigured" and fails closed (500). An accepted callback atomically
consumes the token (`callback_token_used_at`) and persists the completion
metadata; an exact duplicate is reported as a replay, and any conflicting or
stale callback is rejected without changing the row. The callback routes return
202 `{ok: true, snapshotPending: true}` / `{ok: true, cleanupPending: true}` so
the runtime knows delivery succeeded.

The completion hash binds the accepted callback payload (build id, provider
session id, outcome, repository SHAs canonicalized lowercase + sorted, runtime
version, and build duration) without placing secrets or tokens on the Queue.

### Finalization: Queue Consumer + D1 Lease

After a success callback is durably accepted, the workflow publishes a
secret-free Queue command (`{version: 1, buildId, completionHash}`) to
`IMAGE_BUILD_FINALIZATION_QUEUE`. The `ImageBuildFinalizer` consumer processes
one at-least-once delivery per command:

- It refuses to resume if the stored `completion_hash` differs from the
  command's (stale commands are dropped), and it requires the build to still be
  `building` with a bound provider session and consumed callback token.
- It claims a **finalization lease** in D1 (`finalization_lease_token`,
  expiring after 6 minutes) so overlapping creation attempts cannot run;
  competing deliveries retry after the active lease expires plus a 5-second
  headroom.
- If no artifact is recorded yet, it calls the adapter's
  `finalizeSuccessfulBuild` (snapshot/checkpoint) under a 5-minute hard
  deadline (`IMAGE_BUILD_PROVIDER_ATTEMPT_MS`). A `definitely_not_created`
  outcome (e.g., a 429 from Modal or E2B, where the request was rejected
  before any artifact could exist) clears the lease and retries; an `ambiguous`
  outcome — the provider may have created the artifact — marks the build failed
  without ever creating again, so a duplicate artifact cannot leak.
- A successfully created artifact is **fenced** to the exact build, completion,
  session, and lease in one conditional D1 update (`recordArtifact`). If that
  persistence fence fails, the finalizer re-reads D1 (strongly consistent in
  Worker) before compensating: it deletes the artifact and retries, or — if
  deletion also fails — quarantines the artifact on the row where maintenance
  can reap it later.
- `tryMarkImageBuildReady` then publishes the ready state: the row transitions
  `building → ready`, older ready rows for the same scope+provider become
  `superseded` (their artifacts are deleted inline by the reaper), and a build
  that finished after a newer ready row existed is itself marked `superseded`.
- Finally, terminal cleanup terminates the provider session and clears the
  cleanup obligation only after the provider call succeeds.

Failure callbacks take a shorter path: the accepted failure is persisted
immediately (`status = 'failed'` with `error_message`), a Queue command is
published, and the consumer's terminal cleanup tears down the provider session.
The failure body is deliberately tolerant — anything that is not a non-empty
string falls back to "Unknown error" — because a malformed error report must
never 400 the one callback that moves a wedged build out of `building`.

## Rebuild Scheduling and Policy

The provider-neutral scheduler (`runImageBuildScheduler`) runs on the cron and
performs, in order:

1. **Republish recoverable finalizations** — `building` rows whose callback
   token was consumed but whose finalization never completed (no lease or an
   expired one) are re-enqueued.
2. **Mark stale builds failed** — `building` rows older than
   `DEFAULT_STALE_BUILD_MAX_AGE_MS` (longest provider-session lifetime plus a
   5-minute dispatch grace, clock starting at row registration) with no
   callback and no artifact are failed with "build timed out (no callback
   received)". A misclassified long-but-live build's late callback is rejected
   by the `status = 'building'` guards, never recorded over the new build.
3. **Clean up provider sessions** — every terminal row with a
   `provider_session_cleanup_pending` obligation is torn down through the
   adapter for the provider recorded on that row (each row's own provider, not
   the currently active one), with at most 4 concurrent cleanup calls
   (`runMaintenanceTasks`).
4. **Reconcile scopes** (`reconcileScopes`) — for every prebuild-enabled scope
   (only when a provider and source control are configured), resolve the
   current target and run the rebuild policy, doing `git ls-remote` head
   lookups only when the static checks pass. Rebuilds triggered here reuse the
   already-resolved target through `triggerBuildWithTarget` (the save-hook
   variant `triggerBuildIfStale` skips when a ready image already matches the
   current fingerprint — the cron's trigger check evaluated eagerly).
5. **Reap artifacts** — the cleanup sweep over failed-with-artifact rows and
   superseded rows (see below).

### The Rebuild Decision

`evaluateImageBuildRebuildPolicy` filters rows to the active provider and
decides, cheapest-first:

- **skip** — any `building` row exists for the scope+provider (concurrency-1
  also protects the trigger).
- **rebuild**: `missing_image` — no ready row with the current fingerprint;
  `runtime_incompatible` — the ready image's runtime is below
  `MIN_REBUILD_RUNTIME_VERSION` (rebuild old images to the current toolchain
  without invalidating images that remain safe to boot during the rollout gap);
  `invalid_provenance` — missing/unparseable `repository_shas` or a repository
  missing from the provenance document.
- **check_branches** — otherwise, compare each repository's recorded base SHA
  against `git ls-remote` head; any drift means rebuild. Lookup failures
  (`branchUnknown`) count but never force a rebuild by themselves.

### Maintenance and the Reaper

`ImageBuildReaper.cleanupImages` reclaims provider artifacts through one
best-effort machinery:

- **Failed-with-artifact rows first** — a restore-failed spawn flips a ready
  row to failed while it still carries a live provider artifact; delete the
  artifact, then null the row's artifact columns while keeping it `failed` so
  its error message stays visible. Doing this before the age sweep lets a
  now-artifact-free old row be deleted in the same pass.
- **Old failed rows** — deleted only once artifact-free (the DELETE is scoped
  to `provider_image_id IS NULL`), after `DEFAULT_ARTIFACT_CLEANUP_MAX_AGE_MS`
  (24 hours).
- **Superseded rows** — delete the provider artifact when one was recorded,
  then the row itself. Covers inline supersedes whose deletion failed and
  out-of-band supersedes (entity delete, secret change).

Every provider delete degrades instead of throwing: a failed delete leaves the
artifact on its row for the next tick to retry. Cleanup calls are bounded at 4
concurrent. Because cleanup dispatches from each row's recorded provider,
switching `sandbox_provider` requires keeping the previous provider's
credentials configured until its terminal build-session cleanup backlog reaches
zero; removing them early leaves those rows pending until the provider's own
timeout or the credentials are restored.

### Lazy Wedge Recovery

A build whose sandbox died without a callback would hold the concurrency-1
guard forever (`getActiveBuild` has no age cutoff). Each trigger first runs
`failStaleScopeBuild` — a scoped, best-effort version of the global stale sweep
(`markScopeStaleBuildFailed`) — before registering a new build, sized with the
same `DEFAULT_STALE_BUILD_MAX_AGE_MS`. A hygiene failure never fails the
trigger.

## Spawn-Time Image Selection

At session spawn, the durable object consults `ImageBuildLookup` (bound via
`createImageBuildLookup`): the latest `ready` row for the session's scope on
the active provider is fetched only after `resolveScopeEnabled` confirms the
scope still exists and prebuilds are still enabled — a disabled scope's frozen
image never rebuilds, so serving it would drift unboundedly. `evaluateImageBuildForSpawn`
then checks, cheapest-first:

1. `no_ready_image` — no ready row.
2. `missing_artifact` — the row has no provider artifact id (defensive).
3. `runtime_below_floor` — the image's runtime is below
   `MIN_COMPATIBLE_RUNTIME_VERSION`; the floor fails closed on an unparseable
   runtime version (an unversioned image must never be registered either — the
   callback route rejects it as a 400).
4. `fingerprint_mismatch` — the image's fingerprint must equal the fingerprint
   of the **session's own repository snapshot** (same repositories, same
   order, same base branches), not the scope's current repositories, so an
   entity edited after the session was created can never hand the session a
   mismatched image. For a repository session this means the default branch: a
   session on any other branch computes a different fingerprint and misses.

An environment session matches its environment's image only; a single-repo
session matches its repo scope's image; ad-hoc multi-repository sessions never
use prebuilt images (a repo image bakes a single checkout). A miss on any
condition falls back to the base image — sessions are never blocked on builds.
Spawn uses the selected image's `providerImageId` and the primary repository's
baked SHA (`prebuiltImageSha`, informational).

If the provider restore itself fails after an image was selected, the spawn
marks the image failed via `markRestoreFailed` (`status='ready' →
'failed'` with "restore failed at spawn: …") and retries from the base image
with a fresh spawn identity — the cost of a false positive on an unrelated
create failure is one rebuild. The runtime boots in `SNAPSHOT_RESTORE` or
`REPO_IMAGE` mode (from `RESTORED_FROM_SNAPSHOT` / `FROM_REPO_IMAGE` env flags)
where setup scripts are **not** re-run and a fast git sync pulls commits pushed
since the image was built.

## State Machine

The `image_builds` D1 table (migration 0039) is the registry and state machine.
Statuses: `building` → `ready` (or `failed`, or `superseded` by a newer ready
or by an out-of-band supersede); `failed` ages out via the reaper;
`superseded` rows are reclaimed after their artifacts are deleted. The
supersede scope is `(scope_kind, scope_id, provider)` — the fingerprint covers
branches, so there is no branch dimension and at most one live image per
scope+provider. Public-status reads project exactly the wire columns; internal
columns (callback token hash, provider session/image ids, lease, completion
hash) never reach a client.

## Configuration

| Setting | Purpose |
| --- | --- |
| `SANDBOX_PROVIDER` | `modal`, `vercel`, `opencomputer`, or `e2b` enable image builds; anything else disables the settings surface. |
| `IMAGE_CALLBACK_TOKEN_PEPPER` | HMAC pepper for callback-token hashing; required for any callback to authenticate. |
| `WORKER_URL` | Base URL for the callback endpoints and build row registration (required to trigger). |
| `IMAGE_BUILD_FINALIZATION_QUEUE` | Cloudflare Queue binding carrying the secret-free finalization commands. |
| `REPO_SECRETS_ENCRYPTION_KEY` | Required to decrypt build-time secrets. |
| `OPENCOMPUTER_TEMPLATE` | Required to *start* OpenComputer builds (`requireOpenComputerTemplate` is only false for existing-session cleanup). |
| `buildTimeoutSeconds` (sandbox settings) | Build execution budget; default 1800 s, capped at 3600 s. |
| SCM provider env (GitHub/GitLab) | Branch-head lookups for the rebuild cron and repo resolution. |

## Operations Notes

- **Failed builds retry automatically** on the next scheduled run; transient
  failures (network, provider outages) resolve themselves.
- **Manual rebuild** (the refresh button in Settings, or the environment row)
  triggers immediately, out of schedule.
- **Vercel builds cap execution at 35 minutes** so the 10-minute finalization
  reserve is never lost inside the 45-minute sandbox lifetime.
- **Changing provider**: keep the old provider's credentials until its terminal
  build-session cleanup backlog reaches zero.
- **Session-target picker annotations**: prebuild-enabled repositories and
  environments show "prebuilt" (current-fingerprint ready image), "prebuild
  building", "prebuild failed", or "prebuilds on" (enabled, no completed
  build); disabled scopes are unannotated. A repository's annotation reflects
  its default-branch state and does not react to the picker's branch selector.

## Key Tests

- `image-builds/workflow.test.ts` — trigger paths (unconditional, stale,
  with-target), the register-before-secrets ordering, provider-session
  callbacks, auth rejection taxonomy, and the concurrency-1 race outcome.
- `image-builds/rebuild-policy.test.ts` and `scheduler.test.ts` — rebuild
  decisions (missing image, runtime floor, invalid provenance, branch drift)
  and the cron pipeline (finalization republish, stale marking, session
  cleanup, reaping).
- `image-builds/finalizer.test.ts` / `finalization-consumer.test.ts` /
  `finalization-job.test.ts` — lease serialization, artifact fencing,
  compensation and quarantine of unfenced artifacts, completion-hash replay
  rejection, Queue retry semantics.
- `image-builds/scope.test.ts` — per-kind resolution, fingerprint computation,
  secrets folding, and enablement-gated selection.
- `image-builds/reaper.test.ts` / `session-cleanup.test.ts` /
  `maintenance.test.ts` — artifact reclamation, idempotent session teardown,
  and per-row-provider cleanup.
- `image-builds/{modal,vercel,opencomputer,e2b}-adapter.test.ts` — adapter
  lifecycle translation and 429 → retry classification.
- `sandbox/lifecycle/image-selection.test.ts` — spawn selection miss matrix
  and fingerprint matching against the session's own snapshot.
- `callback-auth.test.ts` and `fingerprint.test.ts` — token hashing and the
  order-sensitive fingerprint.
