---
type: subsystem
title: Blueprints and Output Formats
description: How blueprints capture gadget code and binding requirements, the Gadget DO -> User DO -> KV/R2 propagation with dirty-flag retry, .gadget archive export/import, instantiation, and the deployment-shipped bundled format-blueprints pipeline.
tags: [blueprints, sharing, r2, kv, codegen, yjs]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-71504481341c35a23cc7f4af
    resource: repo://packages/workshop-backend/scripts/build-format-blueprints.mjs
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Blueprints and Output Formats

A blueprint is a shareable snapshot of a gadget's source plus its binding *requirements* — the shape of each connection, never the credentials — so other users can stamp out their own private copy. `docs/blueprints.md` describes the product behavior; this page grounds the mechanism in code.

## What is captured

`createBlueprint` on a gadget (`GadgetImpl`) does four things (packages/workshop-backend/src/overseer.ts:10966-11040):

1. rejects provisional gadgets (a chat-proposed creation has no mainline code to snapshot) and refuses code-less heads — "no code" means an absent head or an empty tree, either of which would yield an archive instantiation refuses (packages/workshop-backend/src/overseer.ts:6851-6862, 10975-10981);
2. generates a **128-bit random hex blueprint id** server-side (packages/workshop-backend/src/overseer.ts:10984-10987; packages/workshop-backend/src/blueprint-archive.ts:143-147);
3. collects binding metadata via `collectBindingMetadata` (validating that annotations are configured) (packages/workshop-backend/src/overseer.ts:6689, 10989);
4. snapshots the gadget's **committed** code: `snapshotCode` reads the head commit's files from the git store and builds a *minimal* Yjs document — one insert per file, no edit history — encoded as a V2 state update and gzipped, always in the unnamed root so archives are portable across root layouts (packages/workshop-backend/src/overseer.ts:6863-6887).

What is *not* captured is equally deliberate: SQLite contents, chat history, and live connections never enter a blueprint; only each binding's type/shape is recorded (`docs/blueprints.md`; the record types in workshop-shared api.ts). A collaborator may publish on the owner's behalf — the in-source NOTE marks this intentional, pending finer permission levels (packages/workshop-backend/src/overseer.ts:10971-10973).

## Propagation: Gadget DO -> User DO -> KV, content in R2

`propagateBlueprint` is the single write path (packages/workshop-backend/src/overseer.ts:6889-6948):

- the gadget-DO record is marked `dirty = true` **before** propagation begins and cleared only after every write succeeds — a failure leaves the flag set so the UI can show a retry (the retry re-runs the same propagation);
- the code snapshot (when present) goes to R2 under `BLUEPRINT_CONTENT` at key `<blueprintId>/<version>`;
- the owner's User DO gets a `updateBlueprint` denormalized copy (so the user can audit/manage blueprints even after the gadget is deleted) — and if that blueprint is featured, the featured mirror in `AdminSettings` is synced;
- the public `BlueprintKvRecord` (metadata + `ownerId` + `gadgetId`) lands in `BLUEPRINTS` KV keyed by the blueprint id; that KV record is what unauthenticated `PublicApi.getBlueprint` reads (packages/workshop-backend/src/server.ts:773-787).

`updateBlueprint` bumps `metadata.version` only when code is re-exported, so old R2 versions persist (concurrent instantiation never reads a torn version), while metadata-only updates rewrite just the KV/DO copies (packages/workshop-backend/src/overseer.ts:10307-10352). Deletion stops public access by deleting the KV key **first**, then sweeps R2 versions `1..version`, the screenshot object, the User DO entry, the featured mirror, and the local record — and a mid-way failure re-marks the record dirty for retry (packages/workshop-backend/src/overseer.ts:6951-6971, 10353-10364).

Two reserved keys share the `BLUEPRINTS` namespace — `.featured` (featured-blueprint mirror) and `.adminConfig` (the deployment config) — and `isReservedBlueprintKey` makes every blueprint read treat them as unfetchable so a user id can never collide with deployment state (packages/workshop-backend/src/blueprint-archive.ts:10-17, 36-38, 96-110).

## Export, import, and instantiation

The `.gadget` archive format is a 24-byte prefix (8-byte magic, version, 4-byte metadata length, 8-byte content length), UTF-8 JSON metadata, and the gzip-compressed Yjs snapshot, with caps of 64 KiB metadata and 32 MiB content (packages/workshop-backend/src/blueprint-archive.ts:1-21, 149-190; `parseBlueprintArchive` at :256 enforces the same on read). `PublicApi.downloadBlueprint` streams one (packages/workshop-backend/src/server.ts:780-792).

`importBlueprint` gives the importing user a **fresh local id**: it parses the archive, pipes the content into R2 at `<newId>/<version>` with a `FixedLengthStream` bound checked, writes the KV record owned by the importer, records the library entry, and best-effort-deletes KV/R2 objects if any step fails (packages/workshop-backend/src/server.ts:394-431). Library entries come in two forms — saved-by-reference (metadata cache, original stays owned by its publisher) and uploaded (this deployment mints the blueprint) (packages/workshop-backend/src/user.ts:169-177 and docs/blueprints.md).

`newGadgetFromBlueprint` (packages/workshop-backend/src/server.ts:433-550) reads KV + R2, creates a new workspace, and initializes it via `initializeFromBlueprint` with the *deployment-resolved* output format (`deploymentOutputForBlueprint` maps a bundled-format blueprint's declared output through current admin curation, sanitized). Bindings are then created in **two phases**: non-spawner bindings first (each `spawnerOnly` binding is created but deliberately not bound into the gadget — it exists to feed a spawner's env), then agent spawners whose env references resolve against phase one; unknown or type-mismatched binding names throw.

## Output presentation

A blueprint's `output` field (id/noun/plural/icon) drives how instances present on the Outputs page and New menu. `sanitizeBlueprintOutput` accepts the declaration only if *completely* well-formed (bounded strings, known icon) — uploaded metadata degrades to "generic app" rather than reaching the UI with junk (packages/workshop-backend/src/blueprint-archive.ts:48-74). Admin curation (`AdminConfig.formats`) decides which promoted blueprints are offered; `listFormatOffers`/`deploymentOutputForBlueprint` resolve offers and per-blueprint output (packages/workshop-backend/src/admin-config.ts:191-266).

## Bundled format blueprints

The deployment ships a set of output-format blueprints as **committed data**: `format-blueprints/<name>.gadget` plus a `<name>.json` sidecar holding `blueprintId`, presentation prose, `output`, author, and `revision` (packages/workshop-backend/format-blueprints/README.md). The sidecar owns presentation: the installer overwrites whatever the archive carries, so archive title/author fields are inert (format-blueprints/README.md "Who owns what"; packages/workshop-backend/src/format-blueprints.ts:54-62).

`scripts/build-format-blueprints.mjs` globs the directory (overridable with `FORMAT_BLUEPRINTS_DIR`, whose named directory *replaces* the repo default — the submodule-preservation story) and generates `src/generated/format-blueprints.ts` with base64-embedded archives. The sidecar schema is validated at build time (unknown keys rejected) rather than at runtime (packages/workshop-backend/scripts/build-format-blueprints.mjs:1-57). It **rewrites the module only when the generated content changed**, so repeated `build`/`test` invocations don't invalidate the downstream task cache (packages/workshop-backend/scripts/build-format-blueprints.mjs:153-168). Because the generated file's path is outside the fingerprintable workspace input when `FORMAT_BLUEPRINTS_DIR` points elsewhere, `workshop-backend`'s `build` task runs uncached (root `AGENTS.md`; see [Build System and Toolchain](/openwiki/development/build-tooling.md)).

Installation runs inside `AdminSettings.ensureFormatBlueprintsInstalled` — triggered by the first `/api` request because nothing wakes a DO on deploy (see [Backend Kernel](/openwiki/architecture/backend-kernel.md)) (packages/workshop-backend/src/admin-settings.ts:78-94). It is versioned by `formatBlueprintsManifestVersion`: a fingerprint of every entry's id, revision, and full installed metadata, so *any* visible change (even a description edit) triggers reinstall, with `revision` covering only the one input the fingerprint can't see — the archive bytes. Callers coalesce onto one in-flight install; the manifest stamp is recorded only when the *entire* set installed, so a partial failure retries on the next visitor. Promotions are a separate one-shot decision per blueprint, so reinstalling an updated archive refreshes content without undoing an admin's format choices — and conversely, a dropped or *renumbered* blueprintId leaves its record and promotion behind (packages/workshop-backend/src/format-blueprints.ts:24-38, 81; packages/workshop-backend/src/admin-settings.ts:96-150).

**The blueprintId stability constraint** follows from this design: install and promotion are keyed on `blueprintId`, so changing it after a deployment installed the old one promotes the new id as a *second* format while the old entry lingers updated by nothing. The README states it plainly: rename files freely; the id is load-bearing (packages/workshop-backend/format-blueprints/README.md "Adding a new format").

## Uncertainty

- Featured-blueprint curation and Explore-page behavior are visible in `AdminSettings`/`user.ts` but were not traced end-to-end here beyond the mirror/reconcile code cited.
- The blueprint screenshot pipeline (`validateBlueprintScreenshotUpload`, `/blueprint-screenshot/` serving) is covered only insofar as `propagateBlueprint` writes/deletes the R2 object with the `.screenshot` prefix (packages/workshop-backend/src/overseer.ts:6912-6924; packages/workshop-backend/src/server.ts:802-805).
