---
type: "Reference"
title: "Blueprints: sharing gadget code as templates"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Blueprints: sharing gadget code as templates

A blueprint captures a gadget's **source code** (a snapshot of the committed code, stripped of edit
history), its **binding requirements** (the shape of each named binding — gatekeeper, AI model, or
agent spawner — with no credentials or live connections), and **metadata** (title, description,
screenshot, author, version, timestamps). It deliberately does *not* capture SQLite storage, chat
history, or edit history; every gadget instantiated from it gets its own
(`docs/blueprints.md:17-29`).

## Storage architecture: three tiers, one-way propagation

Blueprint data lives in three places, propagated Gadget DO → User DO → Workers KV
(`docs/blueprints.md:51-63`):

1. **Gadget DO** (`blueprints` collection) — the authoritative `BlueprintGadgetRecord`: full
   metadata, the exported code version, and a `dirty` flag.
2. **User DO** (`blueprints` collection) — a denormalized copy for listing, so a user can manage
   their blueprints even after the source gadget is deleted.
3. **KV** (`BLUEPRINTS` namespace) — the public lookup store, `BlueprintKvRecord` keyed by
   blueprint id; `PublicApi.getBlueprint()` reads it without authentication (knowing the ID is
   sufficient, since a blueprint is just data — `api.ts:122-126`).

Blueprint **code content** is stored separately in R2 (`BLUEPRINT_CONTENT`) under
`<blueprintId>/<version>` as a gzip-compressed Yjs V2 state snapshot; old versions are retained on
update to avoid races during concurrent instantiation, and deleted with the blueprint
(`blueprint-archive.ts:125-141`).

The `dirty` flag handles propagation failures: set to `true` before propagation begins, cleared
only after all writes succeed; a failure leaves the warning visible with a Retry button
(`docs/blueprints.md:63`). `retryBlueprintPublish` re-snapshots the code at the **originally
exported commit**, and refuses records that predate git-backed code storage
(`overseer.ts:10367-10381`).

## Creating and updating

`createBlueprint` (on `GadgetClient`) generates a 128-bit random hex id, collects binding metadata
from all annotated gatekeepers (`collectBindingMetadata` — which validates annotations), refuses
provisional gadgets and code-less gadgets (an empty archive would be useless), snapshots the
committed code at the gadget's head commit, and propagates to all three tiers. Collaborators may
publish on the owner's behalf — intentional, and the blueprint is always owned by the gadget's
owner (`overseer.ts:10966-11011`; `docs/blueprints.md:13`).

`updateBlueprint` can change title/description, re-snapshot code (bumping `metadata.version` and
the R2 object), or refresh binding metadata; deletion propagates (marking dirty on partial
failure) and cleans up all R2 versions (`overseer.ts:10307-10365`).

## Binding annotations

Before publishing, the author can annotate each named binding: a display **name** (the binding
name itself stays the stable key in code), optional **description** helper text, and an optional
**suggested value** (a concrete resource URL or model name — a suggestion, not a requirement). The
annotation is stored on the binding *edge* as `blueprintAnnotation` and carried into
`BlueprintMetadata.bindings` via `collectBindingMetadata` (`docs/blueprints.md:31-39`;
`plans/multi-gadget.md` on edge-owned annotations).

## The .gadget archive

Downloads stream a fixed layout (`blueprint-archive.ts:1-5`, `17-21`, `149-159`):

- 8-byte magic `0xec2e2d3a2300e317`, 4-byte format version (`1`), 4-byte JSON metadata length,
  8-byte content length — a 24-byte prefix;
- JSON `BlueprintMetadata`;
- the raw gzip-compressed Yjs snapshot copied straight from R2.

Imports are validated before publication: metadata ≤ 64 KiB, content ≤ 32 MiB, and the whole
archive streams via `pipeTo` rather than buffering (`docs/blueprints.md:92-99`). An import creates
a **new local** blueprint id on the target deployment (original author metadata preserved,
ownership transferred to the importing user) and clears any screenshot marker
(`docs/blueprints.md:173-177`). Two reserved KV keys (`​.featured`, `.adminConfig`) are excluded
from reads so a blueprint id can never shadow them (`blueprint-archive.ts:9-15`, `37-39`).

## Instantiation

**UI path** — `AuthenticatedApi.newGadgetFromBlueprint(blueprintId, bindings)`
(`server.ts:433-500`): reads KV + R2, creates a new Overseer DO, calls
`initializeFromBlueprint` (which decodes the archive, writes the gadget's initial parentless
commit **before** creating the gadget record — so a failure can't leave a headless record — and
refuses an empty archive), then creates gatekeepers from the user's binding assignments in two
phases (non-spawners first, recording created ids; then spawners whose env configs reference
phase-one targets symbolically) (`server.ts:465-472`; `overseer.ts:8518-8553`).

**Agent path** — the `createGadget` tool accepts a `blueprintId`; the gadget is provisional to the
chat like any agent creation, the blueprint's files are copied into the chat's proposed changes
(covered by the same accept/revert as the rest of the step), and bindings are *not* auto-assigned —
the tool result describes what the blueprint expects and the agent wires them up itself
(`docs/blueprints.md:165-171`).

The new gadget is fully independent: own storage, chat history, bindings; there is no
auto-update from blueprint to instances (`docs/blueprints.md:163`).

## Featured, library, and bundled format blueprints

- **Featured**: admins mark published blueprints featured (`adminIsBlueprintFeatured`/
  `adminSetBlueprintFeatured`); the authoritative bit lives in the owning user's DO, mirrored by
  the `AdminSettings` singleton into KV (`.featured`) for `listFeaturedBlueprints`
  (`docs/blueprints.md:101-115`; `blueprint-archive.ts:9`).
- **Library**: users save blueprints by reference (cached metadata) or by uploading an archive
  (which creates the local blueprint and full content on this deployment)
  (`docs/blueprints.md:75-80`).
- **Bundled formats**: `packages/workshop-backend/format-blueprints/` ships `<name>.gadget`
  archives plus `<name>.json` sidecars; the installer writes the sidecar's curated values over
  whatever the archive carries, uses **stable readable ids** (`format.document`) because install
  and promotion are keyed on them, has no owning User DO, and is promoted into `AdminConfig.formats`
  exactly once ever (an upgrade never undoes an admin's removal) (`format-blueprints/README.md`;
  `admin-settings.ts:78-124`). A blueprint's own `output` declaration (id/noun/plural/icon) is
  presentation only; being *offered* as a deployment format is the separate admin-curated
  `AdminConfig.formats` decision, with per-format `agentHint`s and presentation overrides applied
  on every instantiation path (`admin-config.ts:48-80`; `docs/blueprints.md:117-121`).

Orphaned blueprints outlive their gadget: they remain served from KV/R2 and are managed via
`listOwnBlueprints` / `deleteOrphanedBlueprint` (which bypasses the deleted Gadget DO)
(`docs/blueprints.md:175-177`).
