---
type: subsystem
title: Code Storage, Git Objects, and Blueprints
description: How gadget source code persists (content-addressed git object DB in the Overseer DO), the code-change stream format, the blueprint archive and storage layout, bundled format blueprints, and the gadget export pipeline.
tags: [git, persistence, blueprints, export, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-82fc262c6e105f27444f2f9b
    resource: repo://packages/workshop-backend/src/browser-export.ts
  - id: openwiki-source-67f91299c1003f4ab21542ba
    resource: repo://packages/workshop-backend/src/gadget-export.ts
  - id: openwiki-source-94f667ebe4a7cf333afaa44e
    resource: repo://packages/workshop-backend/src/git-migration.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Code Storage, Git Objects, and Blueprints

## Mainline code: a real git object database in a Durable Object

Current-state authority for the storage model is the Overseer's schema version: version 2 ("git-backed code") synthesizes commits from the legacy workspace-wide Yjs code log into the `gitObjects` collection, gives every gadget record a `commitId` head, rewrites blueprint and merge-message references to commits, and converts live chats to the commit-pinned change stream; from that version on the `code`/`snapshots` Yjs collections are dead stored data whose only reader left is the migration itself (packages/workshop-backend/src/overseer.ts#L955-L1000; packages/workshop-backend/src/git-migration.ts#L1-L40). (The `git-store.ts` header still says mainline code "will be" commit-backed — read it as stale relative to the version-2 comment and the migration.)

The store itself is deliberately *byte-identical to git*: SHA-1 loose objects, zlib-deflated, one typed-storage record per object keyed by oid, written through only isomorphic-git's plumbing (writeBlob/writeTree/writeCommit/read*/log) against a virtual gitdir whose fs shim rejects any non-loose-object path (packages/workshop-backend/src/git-store.ts#L1-L33, #L73-L110). Design consequences documented at the module header (git-store.ts#L1-L33):

- **No ref layer.** "Refs" are the Overseer's own records: gadget heads, blueprint records, chats' pinned commits — so unrelated histories coexist in one collection and related ones (forks, blueprint instances) deduplicate at blob/tree level.
- **Every permanent gadget has a head** (`commitId` absent only while pending in a chat), an invariant the migration roots at version-0 empty-tree commits (overseer.ts#L346-L357; git-migration.ts#L20-L30).
- **No GC.** Dangling objects come only from accepted merges/imports/migration; a future GC must root itself on gadget/blueprint records, chats' pinned commits, pin declarations in chat logs and compaction checkpoints, and `observedCommit` stamps on readFile tool calls.
- Real git formats are used specifically so gadget code can later move to/from real repositories — a stated forward plan, not current behavior.

`threeWayMerge` (also in git-store.ts) implements the merge semantics the accept-changes flow needs, because isomorphic-git's porcelain `git.merge` cannot represent it (git-store.ts#L17-L20).

## The change wire format

Independent of storage, deltas are exchanged as `CodeChange`: a map from gadget id to `[path, FileChange][]`, where a `FileChange` is a Yjs-style text span edit (`TextChange`), a whole-file `set`, or a `remove` (packages/workshop-shared/src/code-change.ts#L65-L99). Shared helpers implement apply/compose/transform (for concurrent edits)/diff, with hard caps: 512 KiB text per file, 1024 chars per path, 2 MiB serialized per change — the same bounds the agent budgets measure against (code-change.ts#L126-L172, #L256-L489). Schema and content validation are separate steps so server-side validation catches structural attacks before semantic ones (code-change.ts#L508-L618).

## Blueprints: KV metadata + R2 content

A blueprint is code-only: a snapshot of the gadget's committed content (minimal encoding, one insert per file), its binding *requirements* (shape, never credentials), and metadata — explicitly not SQLite state, chat history, or live connections (docs/blueprints.md#L1-L30). Storage is split:

- **KV `BLUEPRINTS`**: key = blueprint id, value = `{metadata, ownerId?, gadgetId?}`. Two ids are reserved and must never collide with real blueprints: `.featured` (public featured list) and `.adminConfig` (the deployment's AdminConfig mirror owned by the AdminSettings DO) — enforced by `isReservedBlueprintKey()` (packages/workshop-backend/src/blueprint-archive.ts#L9-L41, #L26-L35).
- **R2 `BLUEPRINT_CONTENT`**: key = `<id>/<version>`, value = gzip-compressed code snapshot; old versions are retained so concurrent instantiation never races a rewrite (blueprint-archive.ts#L129-L141; docs/blueprints.md#L18-L20).

Ids are 128-bit random hex generated server-side (`randomBlueprintId`) — except bundled format blueprints, which carry stable readable ids like `format.document` (docs/blueprints.md#L12-L14; blueprint-archive.ts#L143-L147).

The `.gadget` export file is a streamed 24-byte prefix (8-byte magic, 4-byte version, 4-byte metadata byte length, 8-byte content length), then UTF-8 JSON metadata, then the gzip snapshot; parsing bounds metadata at 64 KiB and content at 32 MiB (blueprint-archive.ts#L1-L22, #L161, #L256). Import (`AuthenticatedApi.importBlueprint`) writes content and metadata, registers the blueprint on the user's DO, and best-effort deletes KV/R2 entries if any step fails (packages/workshop-backend/src/server.ts#L394-L431). Instantiation (`newGadgetFromBlueprint`) reads KV + R2, creates a fresh Overseer, initializes its default gadget from the snapshot, and two-phase-wires bindings — non-spawner gatekeepers/models first, then agent spawners whose env references phase-one results (packages/workshop-backend/src/server.ts#L433-L537). Anyone may view blueprint metadata and download the archive without authenticating — "knowing the ID is sufficient, since a blueprint is just data" — while creating a gadget from it requires login (packages/workshop-shared/src/api.ts#L119-L135).

## Bundled format blueprints

The deployment ships output-format blueprints as *data in the repository*: `format-blueprints/<name>.gadget` plus a `<name>.json` sidecar holding the `blueprintId`, curated prose, and `output` presentation — the sidecar's values overwrite whatever the archive claims (packages/workshop-backend/format-blueprints/README.md#L1-L24). `scripts/build-format-blueprints.mjs` globs that directory (overridable via `FORMAT_BLUEPRINTS_DIR`, which *replaces* the set so a fork stays pristine against its submodule) into the gitignored generated module `src/generated/format-blueprints.ts` (format-blueprints/README.md#L84-L100). Nothing wakes on deploy, so the **first `/api` request** fire-and-forget-triggers `AdminSettings.ensureFormatBlueprintsInstalled()`, keyed on a content fingerprint (`formatBlueprintsManifestVersion`); a partial install resets the module-local flag so the next request retries (packages/workshop-backend/src/server.ts#L35-L37, #L816-L838; packages/workshop-backend/src/admin-settings.ts#L89-L100).

The `blueprintId` is the load-bearing identifier: the install and admin promotion are keyed on it, so renaming it after deploy leaves the old entry installed and orphans it — files may be renamed freely, ids may not (format-blueprints/README.md#L76-L81). `pnpm import:format-blueprint` is the only sanctioned editor (rewrites the archive, bumps `revision` — the reinstall trigger for the one input the fingerprint can't see — and round-trip-verifies the bytes) (format-blueprints/README.md#L34-L61).

## Gadget export

Every gadget UI can be exported to HTML/PDF/PNG/JPEG through platform-owned controls. Two modes (packages/workshop-backend/src/gadget-export.ts#L7-L110):

- **browser**: the backend renders the gadget's client in a Cloudflare Browser Run session via `@cloudflare/puppeteer`, serving an interception-protected document at `https://gadget-export.invalid/` with `default-src 'none'` CSP (data: scripts only), waiting for the client module and DOM to settle before capturing; screenshot pixel, RPC-pending-size, and duration/byte caps bound the operation (`MAX_EXPORT_BYTES = 100 MiB`, `createExportDeadline`) (packages/workshop-backend/src/browser-export.ts#L20-L45; packages/workshop-backend/src/export-limits.ts#L5-L36).
- **server**: if the gadget exports an `ExportHandler` WorkerEntrypoint (constant `GADGET_EXPORT_ENTRYPOINT`), its `getExportFormats`/`export` produce arbitrary media types; a missing entrypoint is treated as "no custom formats", falling back to default HTML+PDF browser formats (gadget-export.ts#L96-L135).

Server-mode streams pass through platform export limits so gadget code cannot stream unbounded output (gadget-export.ts#L135-L149). A known, documented gap: CSP/interception do not cover WebRTC/STUN — the same gap the iframe sandbox has in the browser (browser-export.ts#L39-L42).
