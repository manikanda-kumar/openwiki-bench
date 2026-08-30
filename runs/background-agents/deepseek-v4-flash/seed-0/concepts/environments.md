---
type: concept
title: Environments (Named Prebuildable Repository Sets)
description: Environments are named, curated, prebuildable repository sets with their own secrets, channel associations, and integration overrides; sessions launched from one snapshot its members and record the environment id as provenance.
tags: [environments, session-targets, prebuilds, secrets, repo-metadata, launch-resolution]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-5124cbd391fc0001c5939668
    resource: repo://packages/control-plane/src/automation/session-target.ts
  - id: openwiki-source-32d18a837745baf12ea82913
    resource: repo://packages/control-plane/src/db/environment-secrets.ts
  - id: openwiki-source-cf01e95fca84ae5a94b53e65
    resource: repo://packages/control-plane/src/db/environments.ts
  - id: openwiki-source-9b63d8f807d8e8c6a5ffc97c
    resource: repo://packages/control-plane/src/db/integration-settings.ts
  - id: openwiki-source-ad15a302aac7be1dd07e9481
    resource: repo://packages/control-plane/src/db/session-index.ts
  - id: openwiki-source-3f6e224b2e23c9dabfe00dba
    resource: repo://packages/control-plane/src/db/skills.ts
  - id: openwiki-source-c62c8bf45ebf44a989a34ca3
    resource: repo://packages/control-plane/src/image-builds/save-hooks.ts
  - id: openwiki-source-e4551796343e091f25083955
    resource: repo://packages/control-plane/src/image-builds/scope.ts
  - id: openwiki-source-daba99857a278725e8db415c
    resource: repo://packages/control-plane/src/repos/resolve.ts
  - id: openwiki-source-15ffbce2de0ef74eec69d739
    resource: repo://packages/control-plane/src/routes/environment-secrets.ts
  - id: openwiki-source-b262a893be1a349d16b2191c
    resource: repo://packages/control-plane/src/routes/environments.ts
  - id: openwiki-source-9246d18e19b8882678924a05
    resource: repo://packages/control-plane/src/routes/session-create.ts
  - id: openwiki-source-9cc7a4f784f6ae2ef2143c70
    resource: repo://packages/control-plane/src/routes/skills.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-be6f702918320d7f795e0f66
    resource: repo://packages/control-plane/src/session/session-target-secrets.ts
  - id: openwiki-source-589cd0d798879bdb23c4fe4a
    resource: repo://packages/github-bot/src/session-target.ts
  - id: openwiki-source-4c7ade2353252d234bb2d447
    resource: repo://packages/shared/src/types/environments.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
  - id: openwiki-source-45c29f882cfd46b728da060b
    resource: repo://packages/slack-bot/src/classifier/environments.ts
  - id: openwiki-source-c0e80fdc2a400914997b5eac
    resource: repo://packages/slack-bot/src/classifier/routing.ts
  - id: openwiki-source-db92ff3f1e8e943f605eb227
    resource: repo://packages/slack-bot/src/targets.ts
  - id: openwiki-source-795117f7067e2fd3a97e0a0d
    resource: repo://terraform/d1/migrations/0033_environments.sql
  - id: openwiki-source-5ae6709e20489f9d508fafca
    resource: repo://terraform/d1/migrations/0038_integration_environment_settings.sql
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Environments

An **environment** is the Phase-2 session launch unit: a named, curated bundle of
`1..MAX_TARGET_REPOSITORIES` member repositories in position order, its own
secrets, optional prebuilt images, Slack channel associations, and
environment-level integration overrides. A session launched from an environment
opens that environment's **full workspace** — all members cloned into one
sandbox — instead of a single-repo checkout. Environments are defined by the
control plane (`EnvironmentStore` over D1), consumed at launch time by the
session-create route, automations, and the GitHub/Slack/Linear bots, and
referenced by `repo_metadata.default_environment_id` for bot routing.

The stable identity is `env_<id>` (see `isEnvironmentId`); the human-editable
name is a display label unique case-insensitively. Slack and Linear target an
environment by its id, and routing rules validated against `isEnvironmentId`
use the same shape.

## Schema and ownership

Migration `0033_environments.sql` establishes the cascade model:

| Table / column | Role |
| --- | --- |
| `environments` | `id` (`env_<id>`), `name`, `description`, `prebuild_enabled`, `channel_associations` (added 0035), `created_at`, `updated_at` |
| `environment_repositories` | ordered members: `position`, `repo_owner`, `repo_name`, `repo_id` (nullable), `base_branch`; PK `(environment_id, repo_owner, repo_name)`, `ON DELETE CASCADE` |
| `environment_secrets` | per-environment secrets mirroring `repo_secrets`; PK `(environment_id, key)`, `ON DELETE CASCADE` |
| `integration_environment_settings` | environment-level integration overrides (0038); owned child, `ON DELETE CASCADE` |
| `image_builds` | prebuild rows keyed by `scope_kind='environment'`; deliberately **FK-less** — deleting the environment supersedes its rows so the reaper can still delete provider artifacts |
| `sessions.environment_id` | launch provenance; **FK-less** so a deleted environment leaves a benignly dangling id |
| `automations.environment_id` | reserved for the shared-workspace automation mode (0033); dropped by 0066, replaced by the `automation_environments` join (0037) |
| `repo_metadata.default_environment_id` | nullable opt-in (0036): the environment a GitHub-bot session triggered from this repo opens |

The unique index `idx_environments_name ON environments (lower(name))` makes
names unique case-insensitively. `environment_images` (0033) was generalized
into `image_builds` in 0039, copying rows verbatim and preserving environment
prebuild continuity.

`EnvironmentStore` (snake_case rows ↔ camelCase API types, `toEnvironment`)
performs all persistence as D1 batches: `create` inserts the environment plus
its repositories atomically; `update` merges scalar changes with a wholesale
repository-set replacement and always bumps `updated_at`; `delete` batches the
child `DELETE`s (repositories, secrets), supersedes live `building|ready`
environment images, and only then deletes the row, returning idempotently.

## CRUD API

Routes in `routes/environments.ts`, internal-HMAC authenticated (the web BFF
proxies them):

- `GET /environments` — list (repositories hydrated with one batched query), `POST /environments` — create, `GET/PUT/DELETE /environments/:id`.
- Create/update validate with `createEnvironmentInputSchema` /
  `updateEnvironmentInputSchema`: trimmed name ≤ 200 chars, description ≤ 2000,
  member list via the shared session list contract (non-empty, deduplicated by
  owner/name AND by `repoName` — checkout paths are `/workspace/{repoName}` —
  capped at `MAX_TARGET_REPOSITORIES`), up to 50 Slack channel associations
  (empty set collapses to NULL).
- Name conflicts return 409 via a case-insensitive pre-check before the unique
  index trips; a `repositories` update replaces the set wholesale
  (DELETE + INSERT in one batch), while `undefined` leaves it untouched.
- Every requested member is resolved through the SCM provider concurrently
  (`resolveEnvironmentRepositories`) so persisted rows carry the resolved
  `repo_id` and the request branch or freshly resolved default; the first
  failure in input order wins deterministically.
- `prebuildEnabled: true` on create/update fires the image-build save hook
  (detached, best-effort, gated on provider image support).

Environment secrets have their own routes
(`routes/environment-secrets.ts`): list, PUT (upsert set), DELETE per key, and
`POST /environments/:id/secrets/import` — copy secrets from a **current member
repo** ciphertext-verbatim (both scopes share one encryption key, so no
plaintext transits the plane). Non-members are rejected 403, and responses
carry key names only. Any secrets mutation synchronously supersedes every live
image whose baked secrets are now stale (fail-visible — a retried mutation
re-runs the supersede) and detaches a rebuild for prebuild-enabled
environments.

## Resolution paths into a session

`resolveEnvironmentTarget` (repos/resolve.ts) is the single control-plane
entrypoint: it loads the environment and snaps its members into
session-list-shaped inputs in position order, raising 404 for a missing
environment and 500 for an empty member set (a data-integrity fault — the
schema guarantees ≥1 member). Those inputs flow through `resolveSessionRepositories`,
the same all-or-nothing SCM check an ad-hoc list gets: one unresolvable member
(access revoked after the environment was created) fails the create with a 400
(naming every failing repo) or 500 (a provider threw), rather than booting a
partial workspace.

`session-create.ts` consumes it: `body.environmentId` and the repository list
are mutually exclusive by schema; the environment branch resolves the member
snapshot, records `environment_id` on the session (provenance), and the
snapshot is what the sandbox actually clones — later edits or deletion of the
environment never affect running sessions. The primary member (position 0) is
mirrored into the scalar `repoOwner/repoName/repoId/baseBranch` columns so
pre-list consumers keep working.

`automation/session-target.ts` is the automation counterpart: an environment
run (`run.environment_id`) resolves the same way at launch time so the session
snapshots the current member list, and a deleted environment fails through the
launch-failure path.

### Launch-surface routing

- **GitHub bot** (github-bot/session-target.ts, design §13.2): a repository's
  `repo_metadata.default_environment_id` opt-in routes PR review / @mention
  sessions to that environment's full workspace. Resolution **fails open to the
  repo-bound session** when the metadata lookup fails, the environment no
  longer exists, or it no longer contains the trigger repository. Before
  selecting the environment, `senderAuthorizedForEnvironment` extends caller
  gating across the whole set: an explicit `allowedTriggerUsers` allowlist
  vouches without GitHub checks; otherwise the sender needs write permission
  on **every** environment repository — an environment launch must not widen
  what the sender can reach.
- **Slack bot** (slack-bot): environments are first-class targets alongside
  repositories — routed by keyword rules (`targetType: "environment"`), channel
  associations (environments first, matching the web picker), or LLM-returned
  target ids (an `env_…` id is unambiguous; otherwise repositories match first,
  then environments by unique case-insensitive name). Select values are
  `env:<id>`; branch preferences don't apply since the environment defines its
  own branches. Environment lists are a cached resource that fails open to
  empty, so a fetch problem never blocks classification.
- **Linear bot** (linear-bot): team/project mappings and stored issue-session
  targets can name an environment; unknown (deleted/unfetchable) environments
  fall through to the next resolution stage.

## Secrets scoping

Environment sessions receive **global + environment secrets only** — member
repos' secrets never flow into an environment launch (an environment is
curated; design §7.4). `buildSessionTargetSecretSources`
(session-target-secrets.ts) owns this policy: when `environmentId` is set the
source list is `[global, environment]` and returns immediately; otherwise it
folds member repos in reverse position order so the primary wins collisions.
The same fold is mirrored at **build time** by `loadScopeBuildSecrets` in the
image-build subsystem (environment scopes fold global + environment, labels
identical to the session fold), so a prebuilt image bakes exactly what the
environment's sessions would receive. `UserEnvResolver` decrypts and merges
these sources into the sandbox env; the session's OAuth secret scope resolves
to `{ kind: "environment" }` when `session.environment_id` is set.

## Prebuilds and lifecycle

- `prebuild_enabled` gates the environment as an image-build scope; an
  environment's image bakes that environment's curated secrets and setup.
- `scheduleImageBuildOnSave` (save-hooks.ts) triggers a rebuild on
  create/update with prebuilds on; `supersedeImageBuildsForSecretsChange`
  invalidates live images synchronously before the secrets response returns.
- Spawn-time selection (sandbox/lifecycle/manager.ts, §7.3): an environment
  session matches the environment's image against the **session's own snapshot**
  fingerprint; environment sessions **never fall back to a repo image** (it
  would bake a different repo's setup/secrets) and multi-repo ad-hoc sessions
  never use prebuilt images — both miss straight to the base image.
- `resolveScopeEnabled` returns false when the environment is gone or its flag
  is off — a disabled scope's frozen image never serves, or it would drift
  unboundedly.
- Deleting an environment supersedes live `building|ready` images so the
  cleanup reaper reclaims provider artifacts; sessions keep their snapshots and
  a benignly dangling `environment_id`.

## Channel associations

`channel_associations` on environments mirrors `repo_metadata`'s: a JSON array
of Slack channel ids, with empty collapsing to NULL and `undefined` on update
leaving the column untouched (deduplicated). The Slack classifier's
channel-association stage routes a channel to its associated environments
first, then repositories, so a channel can target a workspace the same way it
targets a repo. Migration 0035 was additive/dark until the routes read/write
it; rollback = stop reading the column.

## Integration settings and skills

Environment-level integration settings (0038, §13.5) are the **top layer** of
the resolution chain: global defaults → per-repo overrides → environment
overrides, merged with later layers winning and `undefined` keys never
clobbering. Only the session-scoped integrations (`sandbox`, `code-server`,
`vnc`) accept this level (`supportsEnvironmentSettings`); the routes reject
others 400. Sessions resolve settings once at create time, so later edits don't
affect running sessions. The `enabledRepos` allowlist is still evaluated
against the repo, not the environment.

Managed skills resolve against the session target too: an environment id adds
only `scope_type = 'environment'` assignments for that environment to
`listApplicable` (global and repository assignments apply as usual), and the
skills preview route hydrates the member list from the environment store.

## Configuration and operations

- Ids: `env_` + generated suffix (`generateId`); `isEnvironmentId` is the
  single gate for "is this an environment id" — deliberately loose on the
  suffix alphabet.
- Secrets require `REPO_SECRETS_ENCRYPTION_KEY`; environment secrets share the
  repo secrets crypto, key-naming rules, and per-scope key cap
  (`assertScopeKeyCapacity`). The combined-value byte cap is enforced at the
  session/build fold, not write time.
- `default_environment_id` lives in `repo_metadata`, written by the standard
  metadata upsert and read by the GitHub bot through
  `GET /repos/:owner/:name/metadata`.
- The Slack and Linear bots cache the environment list (in-memory → control
  plane → KV, fail open to empty); malformed fresh data falls back to the KV
  last-known-good copy rather than overwriting it.

## Invariants and failure semantics

1. Environments always carry ≥1 member by construction; an empty set anywhere
   downstream is treated as a data-integrity fault (500), not a user mistake.
2. Environment sessions are a **snapshot**: members are resolved and frozen at
   create time; the environment can be edited or deleted without affecting
   running sessions; `environment_id` on the session is provenance only.
3. Environment launches scope secrets to global + environment — never member
   repo secrets — at both session time and build time.
4. GitHub-bot fallback fails **open** to the repo-bound session so the session
   can always check out the PR under review; sender authorization instead
   fails **closed** across environment members.
5. Deleting an environment is idempotent, cascades owned children, supersedes
   live images (FK-less) so the reaper can delete provider artifacts, and
   leaves sessions dangling-but-broken-nowhere.

## Focused tests

- `packages/control-plane/test/integration/environments-routes.test.ts` —
  internal-auth 401s, create-time validation short-circuiting before SCM
  resolution, 409 duplicate names, list/get/delete with secret-row cascade,
  and channel-association set/clear semantics.
- `packages/shared/src/types/environments.test.ts` — `isEnvironmentId` shape
  rules, name caps, empty/duplicate member rejection, channel-association
  hygiene.
- `packages/control-plane/src/automation/session-target.test.ts` —
  environment runs resolve the full workspace with primary mirrored to scalars
  and propagate resolution failures; non-environment runs never touch the
  environment path.
- `packages/control-plane/src/repos/resolve.test.ts` — per-entry branch
  defaulting, `main` fallback, all-or-nothing failures with per-repo reason
  naming, and re-checking uniqueness invariants on **resolved** identities.
- `packages/control-plane/src/routes/environment-secrets.test.ts` and
  `image-builds/scope.test.ts` — secret CRUD/import, and the build/session
  secrets-fold parity (environment scopes fold global + environment only).
- `packages/slack-bot/src/classifier/index.test.ts` — channel-association
  routing with environments first, including `mrkdwn`-unsafe names never
  becoming live mentions.
