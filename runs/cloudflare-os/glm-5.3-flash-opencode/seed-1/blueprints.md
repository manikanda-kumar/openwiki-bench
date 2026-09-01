---
type: workflow
title: Blueprints and Output Formats
description: How gadget code is shared — blueprint creation and versioning, the three-store propagation with R2 content and a dirty-flag retry, the .gadget archive format, featured and bundled format blueprints, and the user- and agent-side instantiation paths.
tags: [blueprints, sharing, output-formats, kv, r2, instantiation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# Blueprints and Output Formats

A blueprint is a shareable snapshot of a gadget's *code* — not its chat history, SQLite storage, or credentials. Anyone with the link (`/blueprint/<id>`) can view its metadata unauthenticated and, once signed in, create an independent gadget instance from it with its own bindings and storage (docs/blueprints.md:1-15). A single gadget can have multiple blueprints, potentially at different code versions; each blueprint has a 128-bit random hex ID generated server-side, and updating one increments its version with old versions retained to avoid races during concurrent instantiation (docs/blueprints.md:9-14).

## What a blueprint captures

- **Source code**: a snapshot of the gadget's committed code — a minimal Yjs V2 encoding of final file contents only, no edit history.
- **Binding requirements**: the *shape* of each named binding (type: gatekeeper / AI model / agent spawner, gatekeeper name, URL pattern) plus optional user-authored annotations (friendly name, description, suggested value) stored on the binding edge. No credentials or live connections.
- **Metadata**: title, description, screenshot marker, author, version, timestamps.

It does **not** capture gadget SQLite storage, chat history, or live connections (docs/blueprints.md:17-29).

## Storage: three stores plus R2, one-way propagation

1. **Gadget/Overseer DO** (`blueprints` collection) — authoritative `BlueprintGadgetRecord`s with full metadata, exported commit, and a `dirty` flag (src/overseer.ts:457-479).
2. **User DO** (`blueprints` collection) — denormalized copies for listing, so a user can manage blueprints even after the source gadget is deleted (docs/blueprints.md:57).
3. **Workers KV (`BLUEPRINTS`)** — the public lookup store keyed by blueprint id: `BlueprintKvRecord {metadata, ownerId, gadgetId}` (src/blueprint-archive.ts:24-35). `PublicApi.getBlueprint()` reads only this (src/server.ts:773-778).
4. **R2 (`BLUEPRINT_CONTENT`)** — the code snapshots at `<blueprintId>/<version>` keys, plus screenshots under the screenshot prefix (src/server.ts:603-618).

The KV record's `ownerId` "owns the authoritative 'featured' bit"; `gadgetId` undefined means uploaded rather than published from a gadget on this instance (src/blueprint-archive.ts:24-35). Propagation is marked `dirty = true` before it starts and cleared only when all writes succeed; a failure leaves the flag set and the UI offers Retry via `retryBlueprintPublish` (src/overseer.ts:6892-6947, 10350-10380). Deletion failing partway also marks the record dirty for retry (src/overseer.ts:10360-10361).

A blueprint can outlive its gadget: orphaned blueprints remain accessible via KV/R2 and are managed through the User DO (`listOwnBlueprints`), with `deleteOrphanedBlueprint()` cleaning up KV, R2, and the User DO record directly, bypassing the now-deleted gadget (src/server.ts:552-554; docs/blueprints.md:175-177).

## The `.gadget` archive format

The archive is a streamed binary container: a 24-byte prefix (8-byte magic `0xec2e2d3a2300e317`, 4-byte format version 1, 4-byte metadata length, 8-byte content length), then UTF-8 JSON `BlueprintMetadata`, then the raw gzip-compressed Yjs snapshot copied straight from R2 (src/blueprint-archive.ts:10-14, 19-21; docs/blueprints.md:86-99). Imports are validated before publication with caps of 64 KiB metadata and 32 MiB content so a malformed archive cannot force unbounded allocation (src/blueprint-archive.ts:18-20; docs/blueprints.md:95). `importBlueprint` streams content into R2 via `FixedLengthStream`, then writes the KV record and User DO entry, deleting partial writes on failure (src/server.ts:394-431).

## Featured blueprints and the Explore page

Admins (the `ADMINS` array) can feature published blueprints for the `/explore` page. The authoritative `featured` bit lives in the owning user's User DO record; the `AdminSettings` DO mirrors public metadata for featured blueprints into a reserved KV key that `listFeaturedBlueprints()` reads (docs/blueprints.md:101-115). Only gadget-backed published blueprints are featureable; uploaded/imported library blueprints are excluded. Library entries come in two forms — *saved by reference* (`addBlueprintToLibrary`, removing deletes only your entry) and *uploaded* (`importBlueprint`, removing deletes the imported content) (docs/blueprints.md:77-80).

## Output formats and bundled blueprints

A **format** is an ordinary blueprint the deployment has promoted, so "New Doc"/"New Slides" appears in the composer and the agent is told to prefer it; promotion is admin curation (`AdminConfig.formats`), and nothing about the blueprint itself changes (docs/blueprints.md:117-121). A blueprint may declare `BlueprintMetadata.output` — a grouping `id`, `noun`/`plural`, and an `icon` from the closed `OUTPUT_ICONS` set — which the instantiated gadget inherits and the workspace tab, chat cards, and Outputs page draw. Declaring it is presentation only and grants nothing (docs/blueprints.md:121). Malformed output declarations are sanitized to "declares nothing" on read (src/blueprint-archive.ts:53-60).

A deployment can also **ship blueprints as data**: `packages/workshop-backend/format-blueprints/` holds one `<name>.gadget` archive plus a `<name>.json` sidecar per format, and the build globs that directory (overridable with `FORMAT_BLUEPRINTS_DIR` so a fork ships its own set) into a generated module (format-blueprints/README.md:1-6). These differ from published blueprints in three ways (docs/blueprints.md:125-127):

- Their IDs are **stable and readable** (`format.document`), because install and promotion are keyed on them — never edit a `blueprintId` after deploy; a rename orphans the old entry (REVIEW.md).
- They have **no owning User DO**; `AdminSettings` writes them straight into the featured mirror.
- Their `output` lives in the sidecar, whose values are written over whatever the archive carries, making the archive's own title/author inert (format-blueprints/README.md:12-16).

The first `/api` request a deployment serves installs any whose manifest fingerprint changed — the fingerprint covers title, description, author, revision, and output presentation, with `revision` representing archive-byte changes — and each bundled blueprint is promoted only once ever, so an upgrade never undoes an admin's later removal or override (docs/blueprints.md:129; src/server.ts:816-838).

## Instantiation paths

**User path** — the blueprint landing page fetches metadata via `PublicApi.getBlueprint()`, then configure mode assigns each binding: gatekeeper bindings pick a connected account + resource, AI-model bindings pick a model, agent-spawner bindings pick a model. `AuthenticatedApi.newGadgetFromBlueprint()` then: reads KV + R2, creates a new Overseer DO, initializes it from the blueprint code (`initializeFromBlueprint`), and creates gatekeepers from the assignments (docs/blueprints.md:146-161; src/server.ts:433-550).

Creation is **two-phase** in `newGadgetFromBlueprint`: phase one creates every non-spawner binding (binding `spawnerOnly` bindings' exclusion from the gadget noted), recording each id by binding name; phase two creates agent spawners, whose `AgentSpawnerConfig.env` references phase-one results symbolically (`SpawnerEnvTarget`: `gadget` → the new gadget's id, or a named binding's created id) (src/server.ts:466-537).

**Agent path** — the `listBlueprints` tool lists the owner's published blueprints, library, and the deployment's featured set (formats first, marked preferred; there is no search index). Passing a `blueprintId` to `createGadget` copies the blueprint's files into the chat's proposed changes as a chat-provisional gadget, so accepting or reverting the chat's changes covers files and creation together; bindings are *not* auto-assigned on this path — the agent wires them itself via `setGadgetBinding` or asks the user (docs/blueprints.md:165-171; src/agent.ts:792-802).
