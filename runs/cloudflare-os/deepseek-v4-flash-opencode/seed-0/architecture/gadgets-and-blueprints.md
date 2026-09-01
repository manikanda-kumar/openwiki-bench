---
type: subsystem
title: Gadgets, git storage, and blueprints
description: The gadget/workpiece model inside a workspace, the real git object store that backs gadget code, code-flow from proposed changes to commits, and the blueprint lifecycle from creation through propagation, .gadget archives, bundled format blueprints, and instantiation.
tags: [gadget, workspace, git, blueprints, storage, export]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-82fc262c6e105f27444f2f9b
    resource: repo://packages/workshop-backend/src/browser-export.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
  - id: openwiki-source-67f91299c1003f4ab21542ba
    resource: repo://packages/workshop-backend/src/gadget-export.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Gadgets, git storage, and blueprints

A *gadget* is a small application that a user (or agent) runs inside a workspace. This page covers
the workpiece model that names gadgets, the git object store that backs their code, how proposed
changes become committed code, and the blueprint system that lets a gadget's code be shared and
re-instantiated.

## The workpiece model

A workspace's Overseer Durable Object owns a registry of **workpieces** — numbered things the user
(or agent) is working on. Today a workpiece is a gadget or a gatekeeper binding. All workpiece types
share one **sequential per-workspace id namespace** (`allocateWorkpieceId`, `overseer.ts:1956`), so a
bare number unambiguously identifies a workpiece of any type and derived facet names can never
collide across types.

Derived names:

- **Facet names** are storage keys in the Overseer: the default gadget keeps the legacy name
  `gadget`, every other gadget gets `gadget<id>`, and gatekeepers get `gatekeeper<id>`
  (`gadgetFacetName`, `overseer.ts:1997`).
- **Legacy Yjs roots** (retired pre-git code log) used the unnamed root `""` for the default gadget
  and the decimal id for all others; only the git-storage migration still resolves them
  (`gadgetRootName`, `overseer.ts:1990`).

The workspace always has a *default* gadget when one has been created; `resolveGadgetId` /
`resolveWorkpieceRoot` resolve an absent reference to it (`overseer.ts:1964`, `2007`). A gadget is
**provisional** to a chat when created by the agent; its registry record carries `pending.chatId`
and it is invisible to other chats until its creation is recorded in the chat log. `createGadget`
(`overseer.ts:2041`) enforces a non-empty title and a valid, workspace-unique binding name.

## The git object store

Each workspace's Overseer holds a **real git object database**: SHA-1, zlib-deflated loose objects
that are byte-identical to what `git` would write, stored as records in the `gitObjects`
typed-storage collection (`git-store.ts:1-36`). Mainline gadget code is represented as commits in
this store, with each gadget record pointing at its head commit.

Deliberate properties:

- **Refless.** There are no branches, tags, or HEAD. The "refs" are the gadget records, blueprint
  records, and chats' pinned commits — all managed by the Overseer's own workflow. Unrelated
  histories coexist freely, and related histories (gadgets forked from each other or instantiated
  from the same blueprint) deduplicate at the blob/tree level by content addressing.
- **Real git formats**, so gadget code can later be exported to and imported from real git repos.
  The implementation uses isomorphic-git *plumbing only* (`writeBlob`/`writeTree`/`writeCommit`/
  `read*`/`log`) against a **virtual filesystem shim** (`makeGitObjectsFs`, `git-store.ts:116`) that
  maps loose-object paths onto the collection and rejects everything else. The porcelain
  (`git.commit`, `git.merge`) is off-limits.
- **No GC.** Dangling objects are only created by accepted merges, imports, and migration; the
  roots are enumerable if GC is ever added.

The store also owns the code-flow primitives the chat subsystem uses:

- `writeFilesAsCommit` / `readCommitFiles` / `commitFileOids` / `changedPaths` — the last two
  compare commits by tree oids without reading blob content (`git-store.ts:270-291`).
- `threeWayMerge` — merges three file maps (base/ours/theirs) without ever throwing on conflict;
  conflicted files get inline diff3 markers and are reported in `conflictPaths`
  (`git-store.ts:484-521`). This deliberately replaces both Yjs CRDT merging and isomorphic-git's
  merge, since the common ancestor is always explicitly known (the chat's last merged commit).
- `commitIdentityForAuthor` — derives a git identity (name + email) from a chat author, using
  `<username>@localhost` for bare usernames.

## Code flow: proposed changes to commits

The agent's edits never land on mainline directly (see the agent-and-chat page): they are recorded
as proposed "changes" chat messages, and a human (or the merge flow) accepts them into mainline via
a three-way merge (`mergeChanges`, `overseer.ts:3491`) or reverts them (`revertChanges`). The
accepted merge writes a commit that becomes the gadget's new head. Blueprint creation snapshots a
gadget head into a minimal Yjs document — one insert per file, no history — gzip-compressed
(`snapshotCode`, `overseer.ts:6868`), which is exactly the format blueprints store in R2.

## Blueprints

A blueprint shares a snapshot of a gadget's *code* so others can create independent gadget
instances. It captures the code, the *shape* of each required binding, and metadata — never chat
history, storage, or credentials.

### What a blueprint captures

- **Source code**: the committed gadget files as a Yjs V2 state update, stripped of edit history.
- **Binding requirements**: `collectBindingMetadata` (`overseer.ts:6689`) walks the gadget's visible
  binding edges and records, per binding: its type (gatekeeper / aiModel / agentSpawner), the vendor
  url pattern (for gatekeepers), the suggested model (for AI models), and the spawner env. Ambient
  (auto-provisioned singleton) gatekeepers are excluded — they are re-added automatically on open.
  Agent spawner env references transfer **symbolically** (a target workpiece becomes the exporting
  binding's name, or a synthesized `spawnerOnly` binding), because workpiece ids are workspace-local.
  Optional user **annotations** (friendly name, description, "suggest value") refine how each
  required connection appears to the consumer.
- **Metadata**: title, description, optional screenshot, author, version, and timestamps.

### Storage: one-way propagation across three stores

Blueprint data is stored in three places with one-way propagation (Gadget DO -> User DO -> KV):

1. **Gadget DO** (`blueprints` collection) — the authoritative source (`BlueprintGadgetRecord`),
   including a `dirty` flag.
2. **User DO** (`blueprints` collection) — a denormalized copy for efficient listing, allowing a
   user to audit and manage blueprints even after the source gadget is deleted.
3. **Workers KV** (`BLUEPRINTS`) — the public-facing lookup store read by `PublicApi.getBlueprint()`.

Blueprint **code content** lives in an R2 bucket (`BLUEPRINT_CONTENT`), keyed
`<blueprintId>/<version>`. Old versions are retained so concurrent instantiation isn't raced by an
update. `propagateBlueprint` (`overseer.ts:6892`) marks the record dirty *before* any write and
clears it only after all three stores succeed; a failure leaves `dirty` set so the UI can offer
"Retry". `deleteBlueprintPropagation` deletes KV first (stopping public access), then all R2
versions, the User DO record, and the local record.

Public blueprint ids are 128-bit random hex (`randomBlueprintId`, `blueprint-archive.ts:143`),
except the deployment-bundled formats (below).

### The `.gadget` archive format

Blueprints download as `.gadget` files and import into other Workshop instances. The format is a
24-byte prefix — 8-byte magic `0xec2e2d3a2300e317`, 4-byte version `1`, 4-byte metadata length,
8-byte content length — followed by JSON `BlueprintMetadata` and the raw gzip-compressed Yjs
snapshot bytes (`blueprint-archive.ts:17-19`, `buildBlueprintArchiveStream`). Import validates the
archive before publication, capping metadata at 64 KiB and content at 32 MiB, and streams the
content to/from R2 with `pipeTo` rather than buffering the whole archive in memory. Only
`BlueprintMetadata` travels (no `ownerId`, `gadgetId`, or screenshot bytes).

### Instantiation paths

- **User flow**: the blueprint landing page calls `PublicApi.getBlueprint()` (unauthenticated —
  knowing the id is sufficient since a blueprint is "just data"), the user assigns each required
  binding, and `AuthenticatedApi.newGadgetFromBlueprint` (`server.ts:433`) reads metadata from KV and
  code from R2, creates a new Overseer DO, initializes it with the blueprint's code via
  `initializeFromBlueprint`, then creates gatekeepers from the assignments in two phases (all
  non-spawner bindings first, then agent spawners whose env references resolve against the phase-one
  ids).
- **Agent flow**: the agent's `createGadget` tool accepts a `blueprintId`, copying the blueprint's
  files into the chat's proposed changes and recording the creation in the same `changes` message.
  Bindings are *not* auto-assigned on this path — the tool result describes them and the agent wires
  them up itself (via `setGadgetBinding` / `requestConnection`).

### Output formats and the Outputs index

A blueprint may *declare* what it produces (`BlueprintMetadata.output`: an `id`, `noun`/`plural`,
and an `icon` from the closed `OUTPUT_ICONS` set). Declaring it is presentation only and grants
nothing; being **offered** as one of the deployment's standard formats is a separate admin-curated
decision (`AdminConfig.formats`). A gadget instantiated from the blueprint inherits the resolved
output (with the admin's overrides applied on every instantiation path).

Each workspace's Overseer mirrors its outputs into the owner's **Outputs index** on the user DO
(`syncWorkspaceOutputs` in `user.ts`, backfilled once for pre-existing workspaces via
`#backfillOutputs`), so the Outputs page is one cheap read of the user's own DO.

### Export formats

Gadgets can export their UI/document as HTML or PDF (the defaults, `defaultExportFormats`,
`gadget-export.ts:78`), or custom formats declared by an optional `ExportHandler` entrypoint on the
gadget worker (`GadgetExportEntrypoint`, `gadget-export.ts:13`). Custom format metadata is validated
(zod schemas bound the count, ids, labels, content types, and file extensions). "Browser" mode
exports render the gadget in a remote Puppeteer browser under a strict CSP (`browser-export.ts`),
with both a document CSP and a no-script static-HTML CSP; "server" mode streams bytes from the
gadget worker's handler. Both are bounded by `createExportDeadline` / `limitExportStream`
(`export-limits.ts`).

## Bundled format blueprints

A deployment can ship blueprints as data. `packages/workshop-backend/format-blueprints/` holds a
`<name>.gadget` archive plus a `<name>.json` sidecar (blueprintId, title, description, author,
`output` presentation, `revision`) for each, and `scripts/build-format-blueprints.mjs` bundles that
directory into the generated `src/generated/format-blueprints.ts`. `FORMAT_BLUEPRINTS_DIR` points
the build at a fork's own tree.

Bundled blueprints differ from published ones in three ways:

- **Stable, readable ids** (`format.document`, not random hex), because install and promotion are
  keyed on the id — never rename a deployed `blueprintId`.
- **No owning user DO**: `AdminSettings` writes them straight into the featured mirror; there is no
  publishing user whose `featured` bit could be authoritative.
- **Presentation lives in the sidecar**, which the installer writes over whatever the archive
  carries (`format-blueprints.ts:58-64`).

Installation happens on the **first `/api` request** a deployment serves (`server.ts:816-838`):
`AdminSettings.ensureFormatBlueprintsInstalled()` compares `formatBlueprintsManifestVersion()` (a
fingerprint of every installed-metadata field plus the archive `revision`) against what was
installed before, installs any that changed into ordinary KV/R2 blueprints, and promotes each bundled
blueprint **once ever** (`#promoteBundledFormats`, `admin-settings.ts:140`) so an upgrade never
undoes an admin's later removal or overrides. Failure is tolerable: a deployment with none installed
simply has no standard formats.

## Git-storage migration

The pre-git code log (a Yjs document per workspace) was migrated to the commit-backed store by
`git-migration.ts`; the overseer runs `#migrateToGitStorage` on startup. Legacy chats anchor their
history to a code version computed by `legacyChatBaseVersion` (`agent-compaction.ts:181`), and the
migration's conversion change carries pins that resolve at that anchor. The migration is mentioned
here for completeness — new workspaces are born commit-backed, and the legacy code path is read-only
once migrated.
