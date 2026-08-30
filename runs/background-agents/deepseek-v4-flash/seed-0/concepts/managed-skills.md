---
type: "Reference"
title: "Managed Skills"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-3babc3950feb797c71f905ef
    resource: repo://docs/MANAGED_SKILLS.md
  - id: openwiki-source-ad15a302aac7be1dd07e9481
    resource: repo://packages/control-plane/src/db/session-index.ts
  - id: openwiki-source-4c554613c31bb1163b099988
    resource: repo://packages/control-plane/src/db/session-skills.ts
  - id: openwiki-source-36f3630666778fc90d24fba0
    resource: repo://packages/control-plane/src/db/skill-profiles.ts
  - id: openwiki-source-3f6e224b2e23c9dabfe00dba
    resource: repo://packages/control-plane/src/db/skills.ts
  - id: openwiki-source-e62321bf9fba07278ede2272
    resource: repo://packages/control-plane/src/routes/session-child-spawn.ts
  - id: openwiki-source-9246d18e19b8882678924a05
    resource: repo://packages/control-plane/src/routes/session-create.ts
  - id: openwiki-source-fe4f5c06e7fcaf034cd0592e
    resource: repo://packages/control-plane/src/routes/session-skills.ts
  - id: openwiki-source-9cc7a4f784f6ae2ef2143c70
    resource: repo://packages/control-plane/src/routes/skills.ts
  - id: openwiki-source-c4555138a5e7037195c9f18b
    resource: repo://packages/control-plane/src/scheduler/scheduler.ts
  - id: openwiki-source-5c3aae3f8b776193c21c4216
    resource: repo://packages/control-plane/src/session/initialize.ts
  - id: openwiki-source-70c52cb3ffacdc2d38e0b10b
    resource: repo://packages/control-plane/src/session/skill-resolution.ts
  - id: openwiki-source-1a3dd237a0cdbd1cd9b34394
    resource: repo://packages/control-plane/src/skills/content-addressing.ts
  - id: openwiki-source-ca39cd49a6dbd1036e6331eb
    resource: repo://packages/control-plane/src/skills/git-import.ts
  - id: openwiki-source-b5f0c29f69ff64079cdc20a4
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/entrypoint.py
  - id: openwiki-source-c559e81d571f588426903a18
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/managed_skills.py
  - id: openwiki-source-24a396617b4fd7056fc8dd39
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/opencode_server.py
  - id: openwiki-source-b185b5840284429fac0e62d7
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/runtime_config.py
  - id: openwiki-source-ba7b9750316811e45cbd444c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/supervisor.py
  - id: openwiki-source-317182980fba2c5774520396
    resource: repo://packages/shared/src/types/skills.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---


# Managed Skills

Managed skills are reusable instructions plus supporting files that the control plane stores in a
shared, installation-wide catalog and installs into every sandbox before the agent starts. They let
an instance standardize workflows — deployments, code reviews, incident response, project
conventions — without repeating guidance in every prompt. A skill can apply to every session
(global), to sessions containing a given repository, or to sessions launched from a given
environment; before starting, a user can take all applicable skills, none, or a personal profile.

> **Trust model.** Managed skills are *trusted content, not a permission boundary*. A skill is
> Markdown instructions plus optional text files and scripts that ship into the sandbox; it can
> direct the agent to use tools, credentials, and network access that the session already has.
> Nothing here restricts what installed content can do — the system only controls whether and how
> content reaches a session. Review instructions and scripts before enabling them.

The subsystem spans two packages. The control plane owns the mutable catalog (`SkillStore`),
user-owned profiles (`SkillProfileStore`), content-addressed revision and manifest hashing, the
git import/reimport flow, session-creation resolution, and the session-bound manifest endpoints.
The sandbox runtime (`managed_skills.py`) fetches the per-session installation DTO, re-validates
every byte independently of the control plane, and materializes the tree into OpenCode's global
config directory before OpenCode starts.

## Concepts and ownership

| Concept | Purpose | Owned by |
| --- | --- | --- |
| **Shared skill** | Reusable instructions and optional supporting files, identified by an immutable canonical name (lowercase letters, numbers, single hyphens, ≤64 chars) | Everyone using the instance; any signed-in user can create, edit, enable/disable, assign, or delete |
| **Assignment** | Declares which session targets a skill applies to: global, repository, or environment | Same catalog writable by any signed-in user |
| **Personal profile** | A user's saved subset of shared skills, used as a session-creation selection | Only the profile's owner; owner-scoped lookups and mutations |
| **Session manifest** | The immutable snapshot of selected skills and pinned revisions stored with each session | Resolution at session creation; never mutated afterward |

Profiles are filters, not overrides: resolution intersects a profile's membership with the set of
enabled skills assigned to the session target. A profile entry for a disabled or non-applicable
skill is ignored and reported as `ignoredProfileSkillIds`, never applied.

The five sandbox-visible names `agent-browser`, `record-video`, `upload-screenshot`,
`visual-verification`, and `customize-opencode` are reserved by the sandbox runtime and cannot be
claimed as skill names.

## Catalog stores

### SkillStore (mutable catalog, immutable revisions)

`/packages/control-plane/src/db/skills.ts` implements the catalog. A skill row carries only
mutable state (`name`, `current_revision_id`, `enabled`, soft-delete `deleted_at`, audit identity,
timestamps); every content change creates a new immutable revision row plus per-file rows, so
existing sessions are never repointed. Writes are batched single transactions: create, setEnabled,
replaceContentAndAssignments, applyImportedRevision, and delete all end with
`bumpGeneration()`, which increments a single `skills_catalog_state.generation` row.

Key invariants of the write path:

- **If-Match revision CAS.** `replaceContentAndAssignments` and `applyImportedRevision` require the
  caller's expected revision id; every statement in the batch is guarded so a stale editor cannot
  partially mutate scope, and a zero-change update result throws `SkillConflictError`.
- **Name uniqueness.** Names are unique case-insensitively and stay taken after soft delete;
  `nameAvailable` mirrors exactly what `create` enforces (reserved names included).
- **Duplicate content is a no-op.** A re-import whose bytes hash identically to the current
  revision adds no revision and no provenance row (`revisionCreated: false`); the recorded source
  keeps pointing at the commit that produced the stored bytes.
- **Content byte layout.** Frontmatter (name, description, license, compatibility, sorted
  metadata) is serialized deterministically with `JSON.stringify` values, then the body; the
  regenerated `SKILL.md` is a generated file, never user-supplied.
- **Assignments validated before write.** Duplicate assignment keys are rejected, and every
  environment id is checked to exist; both checks are chunked by `MAX_D1_QUERY_PARAMETERS` because
  unbounded request input must not be bound one parameter per row past the engine's SQL-variable
  ceiling.
- **Eligibility query.** `listApplicable` selects enabled, non-deleted skills that have at least
  one assignment matching the target: global always, environment only when the session target has
  that `environmentId`, and repository matches by case-insensitive owner/name. Only the matching
  assignments are carried into the resolution result, which is why a session shows *why* a skill
  matched (Global / Repository / Environment).

### SkillProfileStore (user-owned filters)

`/packages/control-plane/src/db/skill-profiles.ts` persists user-owned named profiles as
`skill_profiles` plus membership in `skill_profile_items`. Every read and mutation is
owner-scoped (`WHERE user_id = ?`). Profile writes also advance the shared catalog generation —
profile membership is part of what resolution snapshots, and a profile changing mid-resolution
must force a retry. Reads deliberately avoid a `json_group_array` aggregate, whose 2 MB engine cap
could split the read ceiling from the write ceiling and produce a profile that saves but never
loads. Membership rows are packed into multi-row INSERTs so one large profile does not exhaust an
invocation's query budget.

### SessionSkillStore (pinned snapshots)

`/packages/control-plane/src/db/session-skills.ts` reads back per-session snapshots from
`session_skill_manifests` and `session_skill_revisions`. It exposes two projections:

- `getSessionSkillsView` — the user-facing view with full provenance: selection, `resolvedAt`,
  and each pinned skill's revision number, digest, and `assignmentSources` (parsed from the
  per-revision JSON snapshot, so provenance survives later catalog edits).
- `getSandboxInstallation` — the narrow sandbox DTO (schemaVersion, `manifestSha256`, names +
  files only), optionally windowed by manifest position. It fails closed if a persisted revision's
  generated `SKILL.md` is missing. Paging returns one extra row to distinguish "page full" from
  "more remain"; every page carries the same whole-manifest digest. `SkillStore.filesForSessionRevisions`
  loads files by session and position rather than by a revision-id list so the manifest width never
  collides with the engine's parameter ceiling.

## Content addressing

`/packages/control-plane/src/skills/content-addressing.ts` defines every persisted digest over a
domain-separated, byte-ordered canonical serialization (length-prefixed strings, big-endian
lengths, explicit executable flags). Three domains exist: `REVISION_DOMAIN` (a skill revision
tree), `MANIFEST_DOMAIN` (a session manifest), and `IMPORT_DOMAIN` (bytes read upstream).
`SKILL_RESOLVER_VERSION` currently equals 1; the task instructions define that incompatible
serialization changes require new domains *and* a version bump.

- `buildSkillRevision` regenerates `SKILL.md` from structured fields, sorts all files by UTF-8
  path, and hashes the complete byte-ordered tree; it also returns per-file hashes and sizes.
- `buildValidatedSkillRevision` enforces the per-file (256 KiB), per-revision (1 MiB), and file
  count caps before anything is stored.
- `hashImportedSourceTree` deliberately hashes the raw bytes read upstream, which is *never*
  equal to the stored revision digest — the stored `SKILL.md` is regenerated from mapped fields, so
  the import digest answers "is upstream still what the importer reviewed?".
- `hashSessionSkillManifest` hashes the selection mode (all/none/profile with id and name), the
  resolver version, then skills sorted by name/id with their pinned revision id and 64-hex digest,
  then the assignment source list sorted by its canonical tuple form.

Because persisted IDs are derived from these serializations, they are deterministic and
recomputable; the same content always produces the same revision id, and the same selection over
the same catalog state produces the same `manifestSha256`.

## Git import and re-import

`/packages/control-plane/src/skills/git-import.ts` reads a portable skill directory from GitHub,
GitLab, or Bitbucket and maps it onto managed-skill fields. It is a pure read + map pipeline —
nothing is written; a reviewable preview plus provenances is returned and the caller decides
whether to store. Mapping is all-or-nothing: content that cannot become a valid managed skill fails
by name with the HTTP status attached, never arriving partially.

Flow: `checkRepositoryAccess` (404 if the installation cannot reach the repo) → `resolveCommit`
on the requested ref or the provider's default branch (a moving ref is always pinned to the commit
it resolves to) → `listTree` at that commit (truncated trees rejected) → locate `SKILL.md` (on
miss, the error suggests up to 20 subdirectories that do hold one) → reject symlinks/submodules and
oversized declared sizes before fetching → read blobs with bounded concurrency of 6, enforcing the
per-file and aggregate ceilings post-read for providers whose trees carry no sizes → strict UTF-8
decode → map frontmatter.

`mapFrontmatter` accepts only `name`, `description`, `license`, `compatibility`, and `metadata`;
any other frontmatter key becomes an `unmapped-frontmatter` warning surfaced in the preview rather
than being dropped silently. The canonical name resolves from an explicit override (with a
`name-overridden` warning), else the frontmatter `name`, else the last path segment of the source
(derived names emit `name-derived` warnings); invalid derived names fail with a message naming a
valid alternative. YAML parsing (`skill-markdown.ts`) rejects aliases, anchors, custom tags, and
non-string shapes, and validates Unicode well-formedness even for values the importer ignores.

Preview/confirm is a two-step contract. The preview returns the resolved commit, every file with
size and executable flag, total bytes, both digests, the generated `SKILL.md`, warnings, and
`nameAvailable`. Confirming (`importSkillInputSchema`/`reimportSkillInputSchema` carries the
expected commit sha, source digest, and revision digest) re-reads the source and refuses to store
unless all three still match — 409 with "Preview again" otherwise. This means nothing is ever
stored unreviewed, and a concurrent upstream change is caught.

Re-import reads the recorded repository and subdirectory; only the ref can move. An absent ref
means the recorded (requested) ref, so clearing the field never silently jumps back to the default
branch. Hand edits after an import are allowed and do not erase provenance —
`latestImportSource` reports the newest import row (not the current revision) so re-import always
knows where the skill came from. There is no syncing: upstream changes reach the catalog only when
someone re-imports, and existing sessions are never affected.

## Session resolution and immutable manifests

`/packages/control-plane/src/session/skill-resolution.ts` snapshots the mutable catalog into a
deterministic per-session manifest at session creation time. `resolveManagedSkills` loops with a
generation check — read `catalogGeneration()` before, list applicable skills, resolve the
selection, read the generation again, and retry (up to 3 attempts) if it changed — so the returned
`manifestSha256` never mixes rows from different catalog states. Exhausting the retries throws
`SkillResolutionError(..., 409)`.

Profile selection binds during resolution: `getOwned(profileId, canonicalUserId)` (403 without a
canonical user, 404 for another user's profile), and the profile snapshot's `profileId` and
`profileName` are captured into the manifest. The profile filters the already-applicable enabled
set — membership never bypasses disabled state or assignment scope. `ignoredProfileSkillIds` lists
profile members that did not apply, sorted, so the UI can show "N ignored".

The manifest size bound is *total content bytes* (`MAX_MANAGED_SKILL_MANIFEST_BYTES`, 5 MiB), not
skill count. A count cap would gate the whole installation on an additive, global scope and fail
every session create at once.

The resolved `SessionSkillManifestInput` — selection, resolver version, `manifestSha256`,
`resolvedAt`, the full `ResolvedSkill[]` (with assignment sources), and ignored profile ids — is
passed to `initializeSession` and persisted atomically with the session row by `SessionIndexStore.create`
via `bindManifestInserts` (multi-row bulk inserts keep one huge manifest from exhausting the query
budget). A session can *either* resolve (`skillManifest`) *or* copy its parent's exact manifest
(`skillManifestSourceSessionId`) — asserting both is a hard error. Child sessions spawned by an
agent copy the parent's pinned manifest (`bindManifestCopy` copies both tables' rows), which is why
child sessions inherit the parent's exact skill set regardless of what the catalog says later.

Callers of resolution:

- `handleCreateSession` (routes/session-create.ts) resolves `body.skillSelection ?? { mode: "all" }`
  over the session's scope members and environment, converting `SkillResolutionError` to HTTP.
- The scheduler's automation-run path resolves `{ mode: "all" }` — personal profiles are
  interactive-user choices and are not automation policy.
- `handleResolvePreview` (routes/skills.ts) validates the preview target (exactly one of
  repoOwner/repoName pair, repositories, or environmentId — the environment is expanded to its
  repository members after checking existence) and returns skills, total bytes, and ignored ids.

Sessions created before managed skills shipped have no pinned row; the sandbox installation
endpoint treats them as an empty legacy manifest so snapshot restores stay bootable.

## Session-facing endpoints

`/packages/control-plane/src/routes/session-skills.ts` exposes two GET routes:

- `GET /sessions/:id/skills` (user route) — the full `SessionSkillsView` with provenance,
  `Cache-Control: private, no-store`.
- `GET /sessions/:id/sandbox-skills` (sandbox bearer route) — the narrow installation DTO.
  Optional `limit`/`cursor` query params (limit 1..`MAX_SANDBOX_SKILL_PAGE_SIZE` = 200, cursor is a
  positional integer) return one window; absent `limit` returns the whole installation with
  `nextCursor: null`, which is the contract older sandbox runtimes expect and is what keeps
  restored older sandboxes working. Only a whole-installation response is tagged with an ETag of
  the manifest digest (the digest covers the whole manifest, so a page tag would be misleading).

Catalog CRUD lives in `/packages/control-plane/src/routes/skills.ts`: read routes
(`GET /skills`, `POST /skills/preview`, `POST /skills/resolve-preview`, `GET /skills/:id`) are
user-or-service; administration routes (create, import preview/confirm, reimport preview/confirm,
replace content+assignments, set enabled, delete, profile CRUD) require a human user and a
canonical user id (403 otherwise). All write bodies pass zod schemas; revision-guarded writes
(`If-Match` header, 428 when missing) return 409 on mismatch. Every mutation emits a structured
audit log line (`managed_skills.audit`) naming the actor user id, skill/profile id, revision id,
and — for imports — the full source provenance.

## Sandbox-side materialization

`/packages/sandbox-runtime/src/sandbox_runtime/managed_skills.py` implements the consumer side.
The supervisor builds the materializer only when the runtime config carries a control-plane URL and
session id; `materialize` runs once during sandbox boot, after repository boot but before OpenCode
starts, so OpenCode process restarts reuse the installed tree and never depend on control-plane
availability.

### Client

`ManagedSkillsClient.fetch_installation` streams `GET /sessions/{session_id}/sandbox-skills`
(session id URL-quoted, `Bearer` sandbox token) with a 15 s timeout, a 32 MiB per-response ceiling,
and up to 3 attempts with exponential backoff for retryable errors (408/429/5xx, transport, OSError).
Requesting `limit=MANAGED_SKILLS_PAGE_SIZE` (50) keeps every response far below the response
ceiling regardless of manifest width: per-file JSON framing does not count against the manifest's
content aggregate, so a wide manifest can pass resolution and still overflow a single response.

### Validation

`validate_installation_page` re-validates untrusted bytes independently of the control plane
before any content reaches an OpenCode discovery path: JSON shape, `schemaVersion === 1`,
well-formed `manifestSha256`, skill names against the canonical pattern and total length, file
count per skill (1..100), path safety (no absolute, backslash, control characters, empty/`.`/`..`
segments, ≤10 segments, ≤240 UTF-8 bytes, no ancestor/descendant conflicts, no duplicates), file
size exactly equal to the declared (recomputed, not trusted) UTF-8 byte length and under 256 KiB,
SHA-256 hashes recomputed locally (`hash_mismatch` on failure), executable only under `scripts/`,
`SKILL.md` present, frontmatter `name:` matching the skill name, per-skill revision bytes ≤ 1 MiB,
and the whole-installation content aggregate ≤ 5 MiB. Names and content bytes carry forward across
pages (mutated in place); `expected_manifest_sha256` pins every page after the first, so pages from
different manifests abort. Additive contract fields are accepted and ignored. A page that promises
more (`next_cursor` set) must deliver at least one skill, which guarantees the paged traversal
terminates via the 5 MiB aggregate and duplicate-name checks rather than a page-count bound — the
loop deliberately has no page-count cap so the installation width is bounded by aggregate content,
never an invented skill count.

### Materialization

`ManagedSkillsMaterializer.materialize` installs by recoverable swap:

1. `_begin_staging` repairs any interrupted swap (journal-present recovery: keep an installed
   destination, else restore the backup), then opens a fresh `0o700` staging tree.
2. `_fetch_into_staging` streams pages into staging, so peak memory is a page, not the
   installation.
3. Before commit, collision detection scans `.opencode/skills`, `.claude/skills`, `.agents/skills`
   under the workspace, every repository, and the home directory, plus the bundled skills path
   (`/app/sandbox_runtime/skills`), reading each directory's `SKILL.md` frontmatter name. Any
   managed skill whose name matches a discovered skill is dropped from staging (with a
   `managed_skills.collisions_dropped` warning); the session still starts with the rest. This is
   deliberate: discovered skills win over managed ones.
4. Files are written with `O_EXCL | O_NOFOLLOW`, mode `0o400` (or `0o500` when executable), fsynced,
   then hash-verified on disk before chmod.
5. `_commit_staging` writes a durable swap journal (fsynced temporary + rename), renames the
   current tree to backup, renames staging into place, fsyncs the directory, removes the backup,
   and unlinks the journal — recoverable at every step.

The destination is OpenCode's global config directory / `skills` (xdg-basedir rules, honoring
`OPENCODE_CONFIG_DIR` and `XDG_CONFIG_HOME`). A failed materialization raises `ManagedSkillsError`
with a stable code, which fails the sandbox-start path before OpenCode launches.

## Lifecycle and invariants

- **Pin at creation.** Skills are resolved once, at session creation (or child spawn). Restarting
  or restoring a session reuses the same pinned revisions; catalog edits, assignment changes, and
  re-enables affect *new* sessions only.
- **D1 before sandbox.** `initializeSession` writes the D1 index — session row, repository
  snapshot, manifest rows, provider auth — in one batch before DO init, so failures are caught
  before any sandbox is spawned.
- **Generation consistency.** Every catalog mutation bumps `skills_catalog_state.generation`;
  resolution compares it before and after reading, retrying on change so the digest never mixes
  rows from different catalog states.
- **Deterministic digests.** Revision and manifest hashes are recomputable from stored fields;
  identical content in equals identical content out, and resolution over the same catalog state
  yields the same `manifestSha256`.
- **Trusted, not sandboxed.** Everything installed is trusted content executed as the agent; the
  sandbox enforces content safety (paths, hashes, sizes, UTF-8) but no capability boundary on what
  installed instructions can ask the agent to do.

## Configuration and operations

- Limits live in `/packages/shared/src/types/skills.ts` and are mirrored by
  `managed_skills.py`: `MAX_SKILL_NAME_LENGTH` 64, `MAX_SKILL_FILES` 100 (99 supporting files +
  generated SKILL.md), `MAX_SKILL_FILE_BYTES` 256 KiB, `MAX_SKILL_REVISION_BYTES` 1 MiB,
  `MAX_SKILL_PATH_BYTES` 240, `MAX_SKILL_PATH_DEPTH` 10, `MAX_MANAGED_SKILL_MANIFEST_BYTES` 5 MiB.
  The comment in the shared types file requires keeping both runtimes aligned.
- Sandbox runtime constants: fetch timeout 15 s, 3 attempts, retry base 0.25 s, page size 50,
  response ceiling 32 MiB, bundle path `/app/sandbox_runtime/skills`.
- Sandbox-side reserved skill names (`RESERVED_SKILL_NAMES`) are enforced at catalog write time so
  the runtime's own `agent-browser`, `record-video`, `upload-screenshot`, `visual-verification`,
  and `customize-opencode` are never shadowed.
- The sandbox runtime materializes only when `MANAGED_SKILLS` config (control-plane URL +
  sandbox token + session id) is present; bundled skills (`_install_skills`) are copied into the
  workspace `.opencode/skills` separately and are what collisions fall back to.

## Failure semantics

- Resolution retries exceed 3 → 409 "catalog changed during resolution".
- Manifest over 5 MiB aggregate → 400 at resolution, and again `installation_too_large` at the
  runtime if it ever slipped through.
- Missing pinned row on a *known* session → empty legacy manifest (bootable); unknown session →
  404.
- Import confirmation mismatch → 409 "Preview again"; unreachable repo → 404; oversized/binary/
  symlink/executable-outside-scripts content → 400; upstream provider transient failures → 503.
- Runtime fetch failures retry, then fail boot with `fetch_failed`; invalid installation content
  fails with `installation_invalid`/`path_invalid`/`hash_mismatch`; interrupted swaps are repaired
  on the next boot from the journal.
