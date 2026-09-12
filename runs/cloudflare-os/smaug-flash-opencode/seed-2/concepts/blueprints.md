---
type: concept
title: Blueprints
description: How blueprints share gadget source code as data — what they capture, the three-binding model, the three-tier storage architecture, the .gadget archive format, instantiation by user and by agent, and bundled/format blueprints.
tags: [blueprint, sharing, archive, format, r2, kv]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Blueprints

A **blueprint** lets a user share a gadget's *source code* so that others can create their own
independent gadget instances from it. It captures the code but not the chat history, SQLite
storage, or credentials; each gadget created from a blueprint gets its own bindings, storage, and
chat history (`docs/blueprints.md`). Blueprints are the "executables" in the OS analogy — like
mobile/PC apps, every user runs their own copy.

`docs/blueprints.md` is the primary narrative; the authoritative implementation lives in
`src/blueprint-archive.ts` (the archive codec), `src/format-blueprints.ts` (bundled install),
`src/format-blueprints.ts`/`scripts/build-format-blueprints.mjs` (build-time generation), and
`packages/workshop-backend/format-blueprints/README.md` (format curation).

## Key properties

- A single gadget can have **multiple blueprints**, potentially at different code versions (a
  "stable" and a "latest").
- Each blueprint has a **128-bit random hex ID** (server-generated), except bundled blueprints,
  which carry stable, readable IDs (`format.document`, …).
- Blueprints are shared via a link `https://<host>/blueprint/<id>`. **Anyone with the link can
  view** the metadata (unauthenticated — a blueprint is "just data"); **creating** a gadget from a
  blueprint requires authentication.
- A blueprint is owned by the gadget's owner regardless of which collaborator publishes it;
  bundled blueprints have no owning user.
- The author can **update** a blueprint to newer code, incrementing its version; old versions are
  retained to avoid race conditions during concurrent instantiation.

## What a blueprint captures and omits

Captures (`docs/blueprints.md` §"What a Blueprint Captures"):
- **Source code** — a snapshot of the gadget's committed Yjs document, stripped of edit history
  (one insert per file → minimal encoding).
- **Binding requirements** — a description of each named binding's *shape* (gatekeeper, AI model,
  or agent spawner) and how to configure it; no credentials or live connections.
- **Metadata** — title, description, optional screenshot, author, version, timestamps.

Omits: the gadget's SQLite storage, AI chat/edit history, and live connections/credentials.

## Binding types

1. **Gatekeeper** (`type: "gatekeeper"`) — an external resource connection. Records the gatekeeper
   adapter name and a URL pattern; on instantiation the user picks a connected account and
   configures a matching resource.
2. **AI Model** (`type: "aiModel"`) — a language model binding; may suggest a provider/model; the
   user picks from their own configured models.
3. **Agent Spawner** (`type: "agentSpawner"`) — carries over the spawner's configuration (prompt
   types, env restrictions); the user chooses which model the spawner should use.

The author can add **blueprint annotations** per binding (a friendly name, helper text, and an
optional suggested resource URL/model name, stored on the `GatekeeperRecord` as
`blueprintAnnotation`). Presence of a `GatekeeperCreationSpec` on each gatekeeper is what lets
`collectBindingMetadata` derive the `BlueprintBinding` records.

## Data model and storage

One-way propagation, Gadget DO → User DO → KV (`docs/blueprints.md` §"Storage Architecture"):

1. **Gadget DO** (`blueprints` collection) — the authoritative source, `BlueprintGadgetRecord`
   including a `dirty` flag for propagation failures.
2. **User DO** (`blueprints` collection) — a denormalized copy for efficient listing and audit even
   if the source gadget is later deleted; holds the authoritative deployment-wide `featured` bit.
3. **Workers KV** (`BLUEPRINTS` namespace) — the public lookup store (`BlueprintKvRecord`) that
   `PublicApi.getBlueprint()` reads.

**Code content** is stored separately in the **R2** bucket `BLUEPRINT_CONTENT`, keyed
`<blueprintId>/<version>`, as a Yjs V2-encoded full-state document. Old versions are retained on
update and cleaned up on delete.

The `dirty` flag is set `true` before propagation and cleared only after all writes succeed. If a
failure leaves it set, the UI shows a warning with a "Retry" button (`docs/blueprints.md`).

## The `.gadget` archive format

`src/blueprint-archive.ts` defines the binary container (`docs/blueprints.md` §"Export / Import
Format"):

- 8-byte magic `0xec2e2d3a2300e317`
- 4-byte format version (`1`)
- 4-byte JSON metadata byte length
- 8-byte raw content byte length
- JSON `BlueprintMetadata`
- raw content bytes (the gzip-compressed Yjs snapshot directly from R2)

Imports are validated before publication: metadata is capped at 64 KiB and the stored snapshot at
32 MiB, so a malformed archive cannot force unbounded allocation (`blueprint-archive.ts:20`).
Import/export streams the content directly to/from R2 via `pipeTo()` rather than buffering the whole
archive server-side. Only `BlueprintMetadata` travels — no `ownerId`, `gadgetId`, or screenshot
bytes. Imported archives have `uploaded: true` and count as the importing user's local blueprint on
that deployment.

## Instantiating a blueprint

Two paths:

- **User path**: the `/blueprint/<id>` landing page shows metadata; once authenticated the user goes
  into configure mode assigning each required binding (account+resource, model, or spawner model),
  then calls `newGadgetFromBlueprint(blueprintId, bindings)`, which reads KV+R2, creates a new
  Overseer DO initialized with the code (`initializeFromBlueprint`), and creates gatekeepers from the
  user's assignments (pipelined). The new gadget is fully independent.
- **Agent path**: the `listBlueprints` tool lists the blueprints available to the workspace owner
  (deployment formats first/marked preferred, then own published, library, and deployment featured),
  and passing a `blueprintId` to `createGadget` creates the new gadget from the blueprint's code.
  Bindings are **not** auto-assigned on this path — the agent wires them up itself under the same
  names (`setGadgetBinding`), or asks the user to add model/spawner bindings from Connections.

## Library and pinning

Home-page Blueprints tab lists published + library blueprints. Library entries come in two forms:
**saved by reference** (`addBlueprintToLibrary`, caches the public metadata snapshot; removing only
deletes the personal entry) and **uploaded** (`importBlueprint`; removing deletes the imported
blueprint content). Pinning a public blueprint not yet in your library saves it first.

## Admin features and featured blueprints

- Admins (via the `ADMINS` binding) get `isBlueprintFeatured`/`setBlueprintFeatured`. Only
  gadget-backed published blueprints are featureable.
- The authoritative `featured` bit lives in the owning user's DO `blueprints` record; `AdminSettings`
  mirrors the current public metadata for featured blueprints and writes a KV snapshot consumed by
  `listFeaturedBlueprints`.
- Explore (`/explore`) shows featured blueprints.

## Orphaned blueprints

A blueprint can outlive its source gadget (KV/R2 remain). Users manage them via
`listOwnBlueprints` (from User DO) and delete via `deleteOrphanedBlueprint`, which cleans up KV, R2,
and the User DO record directly, bypassing the deleted Gadget DO.

## Standard formats and bundled blueprints

A **format** is an ordinary blueprint the deployment has promoted, so it appears in the composer's
"+ / New …" menu and in the agent's preferred list. `BlueprintMetadata.output` (a grouping `id`, a
`noun`, `plural`, and an `icon` from the closed `OUTPUT_ICONS` set) is what a blueprint *declares*
it produces — presentation only, grants nothing; being *offered* as a standard format is the
separate, admin-curated decision (`AdminConfig.formats`, the Formats panel). An admin can override
any output field (`FormatCuration.overrides`), applied on every instantiation path.

A deployment can also **ship** formats as data. `packages/workshop-backend/format-blueprints/`
holds a `<name>.gadget` archive plus a `<name>.json` sidecar per bundled format
(`workspace-docs`, `workspace-slides`, `workspace-sheets`), compiled by
`scripts/build-format-blueprints.mjs` (overridable with `FORMAT_BLUEPRINTS_DIR`, so a fork can ship
its own set) into the generated module `src/generated/format-blueprints.ts`. Bundled blueprints
differ from published ones:

- Their ids are **stable and readable** (`format.document`), because both installation and
  promotion are keyed on them — **never change a bundled `blueprintId` after deploy** or the old
  entry is orphaned.
- They have **no owning User DO**; `AdminSettings` writes them straight into the featured mirror.
- Their `output` lives in the sidecar (single source of truth for presentation).

The first `/api` request a deployment serves installs bundled blueprints whose manifest fingerprint
changed; each is promoted only once ever (an upgrade never undoes an admin's removal or overrides)
(`src/format-blueprints.ts`). Install writes an ordinary blueprint — metadata to KV, content to R2 —
with nothing special afterward: "no reserved id prefix, no fallback branch in the read path"
(`src/format-blueprints.ts:1`). A corrupt bundled archive fails the same way an uploaded one would,
and one bad archive does not deny the deployment the others (`installFormatBlueprints`).

`formatBlueprintsManifestVersion()` is the fingerprint deciding reinstall: it covers the title,
description, author, and output (which land in installed metadata), while `revision` covers the one
input the fingerprint can't see — the archive bytes.

## Curation workflow (`format-blueprints/README.md`)

- **Change title/description/author**: edit the sidecar and rebuild — no archive rewrite, no
  revision bump.
- **Update code**: build it in a real Workshop, export it, then
  `pnpm import:format-blueprint ~/Downloads/Gadgets-Doc-v4.gadget format.document` — this rewrites
  the archive, bumps the sidecar `revision`, rebuilds the generated module, and reports the change.
  The `bindings` line flags when the export needs something the old copy didn't.
- **Add a new format**: `pnpm import:format-blueprint Brief.gadget --new acme-brief` writes a
  sidecar; edit fields (chiefly `output`, and make `output.id` *generic* like `document` so the
  Outputs page groups sensibly). `blueprintId` defaults to the name and is the load-bearing install
  key.
- **Ship your own set**: point `FORMAT_BLUEPRINTS_DIR` at your own `<name>.gadget` + `<name>.json`
  directory — it *replaces*, not adds, and touches nothing in this repo (important when this repo is
  a submodule). Two lighter options need no build change: simply promote your own published
  blueprints in the admin Formats panel, or ship none by pointing the var at an empty directory.
