---
type: blueprints
title: "Blueprints: Templates, Archives, and Screenshots"
description: How blueprints — shareable gadget templates — are stored (KV metadata, R2 content, three-place propagation), the .gadget archive format, the bundled output-format blueprints and their install-on-first-request flow, screenshots, and the featured/library curation model.
tags: [blueprints, kv, r2, archive, formats, screenshots]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Blueprints: Templates, Archives, and Screenshots

A **blueprint** shares a gadget's source so others can instantiate their own copies: it captures the code snapshot and binding *requirements* (shape only — never credentials or live connections) plus metadata, but not chat history, SQLite storage, or credentials; each instantiated gadget gets its own bindings, storage, and chats (docs/blueprints.md:1-33). A single gadget can have multiple blueprints at different code versions, and updating a blueprint retains old versions to avoid races during concurrent instantiation (docs/blueprints.md:14-26).

## Storage architecture

Blueprint data lives in three places with one-way propagation — Gadget DO → User DO → Workers KV — and a `dirty` flag on the gadget record that survives propagation failures until a retry succeeds (docs/blueprints.md:69-83):

1. **Gadget DO** (`blueprints` collection) — authoritative record, including the exported code version and the dirty flag.
2. **User DO** (`blueprints` collection) — a denormalized copy so the user can audit/manage blueprints even after the source gadget is deleted (packages/workshop-backend/src/user.ts:94-99).
3. **Workers KV** (`BLUEPRINTS` namespace) — the public lookup store, holding `BlueprintKvRecord` keyed by the blueprint's **128-bit random hex id** (generated server-side; bundled formats are the exception with stable readable ids like `format.document`) (packages/workshop-backend/src/blueprint-archive.ts:26-35, 143-147; docs/blueprints.md:62-77).

**Code content** lives in the `BLUEPRINT_CONTENT` R2 bucket at key `<blueprintId>/<version>` — a gzip-compressed Yjs V2 state update of a doc whose root map is filename → Y.Text. Reads decompress on the fly; deletion cleans up all versions (packages/workshop-backend/src/blueprint-archive.ts:125-141).

Two KV keys are **reserved** for deployment state, guarded by `isReservedBlueprintKey()`: `.featured` (the serialized featured-blueprint list) and `.adminConfig` (the AdminSettings DO's mirrored admin config). Reads of a reserved id return null, so a crafted id can never collide with real blueprint data (packages/workshop-backend/src/blueprint-archive.ts:9-15, 37-39, 98-112).

## Public, unauthenticated endpoints

Knowing a blueprint id is sufficient to read it — "a blueprint is just data". `PublicApi.getBlueprint()` returns public metadata (with a derived screenshot URL) without authentication, and `PublicApi.downloadBlueprint()` streams the `.gadget` archive (metadata only, no full KV record) by reading R2 directly (packages/workshop-shared/src/api.ts:122-132, packages/workshop-backend/src/server.ts:773-791). Blueprint screenshots are likewise public: stored in R2 under the `screenshots/` prefix and served at `/blueprint-screenshot/<id>` with an immutable one-year cache header and a cache-busting `?v=<lastUpdated>` query (packages/workshop-shared/src/api.ts:3700-3705, packages/workshop-backend/src/server.ts:602-618, 802-805).

## The `.gadget` archive format

`.gadget` files are streamed archives with a **24-byte prefix**: an 8-byte magic constant (`0xec2e2d3a2300e317`), a 4-byte format version, a 4-byte metadata byte length, and an 8-byte content byte length — followed by UTF-8 JSON metadata and the gzip-compressed code snapshot (packages/workshop-backend/src/blueprint-archive.ts:1-5, 17-21). The parser validates everything before opening the content stream: magic, version, nonzero metadata within 64 KiB, and a safe content length within 32 MiB; the content tail is handed back as a lazily-pulled stream so large archives never buffer fully (packages/workshop-backend/src/blueprint-archive.ts:181-296). Uploads of blueprint output fields are also sanitized: an unknown icon or overlong noun degrades the blueprint to "no declared output" rather than reaching the UI (packages/workshop-backend/src/blueprint-archive.ts:58-72).

## Bundled format blueprints

`format-blueprints/` holds the output-format blueprints the deployment ships with (workspace-docs, workspace-sheets, workspace-slides), committed **as data**: a `<name>.gadget` archive plus a `<name>.json` sidecar giving `blueprintId`, title, description, author, revision, and the `output` presentation (packages/workshop-backend/format-blueprints/README.md:1-24).

- **Install on first request.** Nothing wakes on deploy; the backend's `/api` fetch handler triggers `AdminSettings.ensureFormatBlueprintsInstalled()` fire-and-forget on the first API request (a module-level flag skips repeats and resets on partial failure so the next request retries). Installation writes an **ordinary blueprint** — KV metadata plus R2 content — exactly as publishing does; there is no reserved id prefix or special read path (packages/workshop-backend/format-blueprints/README.md:8-11, packages/workshop-backend/src/server.ts:816-838, packages/workshop-backend/src/format-blueprints.ts:1-12).
- **The sidecar owns presentation.** The installer overwrites the archive's own title/description/author/output with the sidecar's values, so an archive's internal presentation fields are inert (packages/workshop-backend/format-blueprints/README.md:22-24, packages/workshop-backend/src/format-blueprints.ts:59-77).
- **`blueprintId` is the install key and must never change after a deployment has installed it.** Reimporting the same id updates in place; changing it promotes the new id as a *second* format while the old one stays in the New menu, updated by nothing (packages/workshop-backend/format-blueprints/README.md:78-81).
- **Reinstall fingerprint.** `formatBlueprintsManifestVersion()` fingerprints everything that ends up in installed metadata (title, description, author, output, revision); `revision` additionally covers the one input the fingerprint cannot see — the archive bytes — so forgetting to bump it would otherwise leave old code quietly installed (packages/workshop-backend/src/format-blueprints.ts:26-41, packages/workshop-backend/format-blueprints/README.md:28-30, 54-57).
- **Fork overrides.** `FORMAT_BLUEPRINTS_DIR` points the build at a different directory, which *replaces* the default set — designed for forks that vendor this repo as a submodule and never want to touch the shipped directory (packages/workshop-backend/format-blueprints/README.md:84-102, packages/workshop-backend/scripts/build-format-blueprints.mjs).

Featured/bundled blueprints surface on the Explore page and via `listFeaturedBlueprintsFromKv()`; admins feature blueprints through the admin panel, which owns the `.featured` KV record (packages/workshop-backend/src/blueprint-archive.ts:114-123, docs/blueprints.md:86-91).

## Library semantics

The user's blueprint library distinguishes two entry kinds: **saved by reference** (via `addBlueprintToLibrary()` — a cached metadata copy; the blueprint remains owned by its publisher, and removing the entry only removes the library row) and **uploaded** (via `importBlueprint()` from a `.gadget` archive — a new local id is minted on this deployment, content stored in this deployment's R2/KV, and removing the entry deletes the imported content too) (docs/blueprints.md:94-105, packages/workshop-backend/src/user.ts:94-99).

## Related pages

- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md) — the fetch handler that triggers the format install.
- [Build System and Dev Server](/openwiki/operations/build-and-dev.md) — the codegen task that embeds the bundles.
- [Gadget Sandbox and Client Integration](/openwiki/frontend/gadget-sandbox.md) — what instantiating a blueprint produces at runtime.
