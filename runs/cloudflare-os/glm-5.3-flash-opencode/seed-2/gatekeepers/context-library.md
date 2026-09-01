---
type: integration
title: Context Library gatekeeper
description: The auto-provisioned Context Library gatekeeper — singleton accounts, sharing-domain namespacing, public/private collections across three Durable Objects, the read-only agent session with catalog and slash commands, strategy-C observers, and the management UI.
tags: [gatekeeper, context-library, singleton, observers, sharing-domain]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-5fe67c97a9e2d029871ded3d
    resource: repo://packages/gatekeeper-context/src/collection-kv.ts
  - id: openwiki-source-52ab503bbb8e3296d63507cc
    resource: repo://packages/gatekeeper-context/src/context-collection.ts
  - id: openwiki-source-b1629be8a1a0855428b18a7d
    resource: repo://packages/gatekeeper-context/src/context-observers.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-93a9f96a66238f442bc4688a
    resource: repo://packages/gatekeeper-context/src/library-read.ts
  - id: openwiki-source-bf24a2c39ef776522be209d3
    resource: repo://packages/gatekeeper-context/src/registry-do.ts
  - id: openwiki-source-4f6a059eb6a37b6662f5b07d
    resource: repo://packages/gatekeeper-context/src/user-library.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Context Library gatekeeper

`packages/gatekeeper-context` implements the Context Library: collections of context documents
(plus Agent Skills) that agents read as observations. Its vendor declares
`autoProvisionsAccount` — one account per user with no OAuth flow — and each account provides both
an **agent singleton** (`AccountDescription.singleton = { tsType: "ContextLibrary" }`) and a
**management UI** (`providesUi = { title: "Context & Skills" }`)
(`packages/gatekeeper-context/src/library-gatekeeper.ts:131-138`).

## Namespacing: the sharing domain

All data is namespaced by a `sharingDomain` carried in the **service binding's props**
(`domain.ts:1-13`). This lets multiple Workshop deployments share one gatekeeper instance without
mixing their collections; it is explicitly "not a boundary against malicious peer configs" — it
prevents accidental mixing between trusted deployments. DO names are `<domain>\0<id>` and the
public-collections KV key is `<domain>\0.public`. Dev binds a single domain (`sharingDomain:
"dev"`; `run-dev-server.ts:505-509`).

## Three Durable Objects and a KV snapshot

- **`ContextCollectionDurableObject`** — one collection's metadata and documents. A collection is
  created **private** (owner account id set) or **public** (owner `""`); metadata changes update
  the owning library or the domain registry accordingly
  (`context-collection.ts:1-2`, `113-186`, `667-709`).
- **`UserLibraryDurableObject`** — per-account index of owned private collections; the "enabled
  set" for the agent read path is own-private **plus every public collection in the domain**, with
  owned winning on overlap so a private collection is never downgraded to public
  (`user-library.ts:1`, `78-82`).
- **`LibraryRegistryDurableObject`** — the per-domain registry of public collections; it is the
  **only writer** of the KV snapshot that user sessions read when building their enabled set
  (`registry-do.ts:1-55`; `collection-kv.ts:1-33`).

## Account and singleton

`ContextAccount` (a `GatekeeperUser` on `ctx.props = {sharingDomain, accountId}`):

- `getSingletonGatekeeperClass()` returns `ContextGatekeeper` re-imbued with the same sharing
  domain + account id — this is what the Overseer installs as the ambient capsule facet
  (`library-gatekeeper.ts:140-145`).
- `startAppUi({isAdmin})` builds a `ContextApiImpl` capability (admin-gated features resolved
  per open) and returns the bundled single-file SPA as `iframeHtml`
  (`library-gatekeeper.ts:147-154`).
- It has **no URL-addressed resources**: `getSupportedResources()` returns `[]`,
  `getGatekeeperClassFor`/`startResourceConfigurator` throw, `ensureResources` is a no-op, and
  `connectAccount`/`reconnect` throw ("no connect flow"). `revoke()` deletes the account's private
  collections and clears the library index; public collections are domain-owned and survive
  (`library-gatekeeper.ts:156-185`).
- `GatekeeperVendor.createAccount()` mints `ContextAccount` with a fresh random `accountId` and
  the binding's sharing domain (defaulting to `"default"`) — no user identity is passed in
  (`library-gatekeeper.ts:395-406`).

## The read path

`ContextGatekeeper` is a **read-only** `Gatekeeper` (actions are never submitted;
`applyAction`/`rejectAction`/`revertAction` throw; `getAutoApprovableActions()` returns `[]`):

- `startSession(approvalQueue)` returns a `LibraryReadSession` that owns a **duplicate** of the
  approval-queue authorizer (the session uses it after `startSession` returns)
  (`library-gatekeeper.ts:270-286`).
- Every result the session returns is authorized as an observation and **attributed to the
  collections whose metadata or content it reveals**; a search or list that matches nothing records
  no observation, mirroring `read()` (`library-read.ts:1-33`, `117-135`).
- Whole-library search/list fans out over collections with a cap of 8 concurrent reads
  (`library-read.ts:23`); per-collection skills are loaded with the same fanout
  (`library-gatekeeper.ts:228-253`).
- `getAgentCatalog(authorizer)` builds the discovery catalog from the enabled collections plus
  their Agent Skills, then — before returning — runs the observer check for the collections the
  catalog reveals and calls `authorizeObservation` with any `excludeObservers`, committing the
  pending-set promotions only on success (`library-gatekeeper.ts:318-339`).
- `getSlashCommandProvider()` exposes one command per Agent Skill; invoking one reads the skill
  document through a fresh read session (authorized as an observation) and returns the expanded
  message (`library-gatekeeper.ts:288-316`).

## Observers: strategy C

The singleton is a *broad binding* over public and account-private collections, so it uses
observer strategy **C — data-set tracking** (`docs/observers.md:529`;
`context-observers.ts:16-21`):

- `ContextObserverTracker` keeps two KV-backed states per collection (`observedCollection:<id>`:
  `true | "pending" | "observed"`) and one verifier per observer (`observer:<id>`).
- Every data-revealing read routes through `prepareObservation(collectionIds)` rather than calling
  `authorizeObservation` directly: unknown sets are marked **pending synchronously before the
  first await**, all current observers are re-checked against each newly-touched set via the
  verifier's `hasCollectionAccess` (owner-or-public in the same domain), and the failing observers
  become `excludeObservers`. The pending sets are promoted to observed only after
  `authorizeObservation` succeeds (`library-gatekeeper.ts:330-337`; the tracker's two-state
  protocol closes admission races in either request ordering).
- `ContextVerifier.hasCollectionAccess` checks ownership in `UserLibraryDurableObject` or
  publicness in `LibraryRegistryDurableObject`, and returns `false` outright when the verifier's
  domain differs from the requested one (`library-gatekeeper.ts:200-215`).

## Wiring into the Workshop

The vendor's `describe()` sets `autoProvisionsAccount: true` and `providesAuth: false`
(`library-gatekeeper.ts:380-393`). Once the owner has a Context account, the Overseer's
`ensureAmbientCapsules()` installs `ContextGatekeeper` as an ambient capsule facet (see
[gatekeeper architecture](/openwiki/gatekeepers/architecture.md)), and each chat's env names it
`CONTEXT` (the `suggestedBindingName`) with its catalog cached per chat. The admin controls
whether the account is auto-provisioned for everyone (`enabled`), opt-in (`optional`, the
default), or off (`disabled`) via the per-vendor mode in `AdminConfig.ambientGatekeeperModes`
(see [admin config](/openwiki/operations/admin-config.md)).

Collections can also be synced from git repositories (`artifact-sync.ts` clones/fetches with
isomorphic-git against a bounded in-memory filesystem) — the management UI's authoring path uses
it to import documents.
