---
type: integration
title: Context Library Gatekeeper
description: The Context Library — auto-provisioned accounts, private vs public collections, sharing-domain scoping, the three Durable Objects plus KV, the agent read session, and the management UI.
tags: [gatekeeper, context, collections, kv, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-5fe67c97a9e2d029871ded3d
    resource: repo://packages/gatekeeper-context/src/collection-kv.ts
  - id: openwiki-source-c2d80b2a80732f9442157acc
    resource: repo://packages/gatekeeper-context/src/context-api.ts
  - id: openwiki-source-073412f690e4ccaf9b160619
    resource: repo://packages/gatekeeper-context/src/context-types.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-4f77f1b4388c32281959852d
    resource: repo://packages/gatekeeper-context/src/index.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Context Library Gatekeeper

The Context Library (`packages/gatekeeper-context`) is an auto-provisioned gatekeeper for authoring
collections of context documents that agents read as observations. Also known as the Context
Library: the deployment admin curates **public** collections (readable by everyone and auto-enabled
for all users), while each account keeps its own **private** collections. It provides an agent
singleton read session plus a management UI.

Its architecture is documented in `AGENTS.md` and in the source under `src/`.

## Auto-provisioning and the account model

The worker's `GatekeeperVendor` entrypoint (bound as `GATEKEEPER_CONTEXT`) declares
`autoProvisionsAccount` and mints a `ContextAccount` via `createAccount()` — **no user identity is
passed in**, and the account keys its private data by its own generated `accountId`
(`src/library-gatekeeper.ts:1`). The account exposes:

- the **agent read session** `getSession()`;
- the discovery metadata `getAgentCatalog()`;
- a **management UI** `startAppUi({ isAdmin })` — a single-file React SPA in `app/` (Vite +
  Tailwind + Kumo) bundled by `build-app.mjs` into `src/generated/app.txt`.

The per-vendor provisioning policy is the same three-state admin mode (`disabled`/`optional`/
`enabled`, resolved in `workshop-backend/src/provisioning-policy.ts`); auto-provisioning is how the
singleton becomes an **ambient gatekeeper record** folded into each chat's env as a named binding.

## Collections and visibility

`ContextCollectionVisibility = "public" | "private"` (`src/context-types.ts:94`):

- **Private** — owned by a single account, readable/writable only by that account.
- **Public** — created/edited only by deployment admins, readable by everyone and auto-enabled for
  all users.

`loadEnabledContextCollections` (`src/context-api.ts:20`) merges the account's own private
collections (`userLibrary.listOwnedCollections()`) with the domain's public set read from KV
(`listPublicCollectionsFromKv`), deduplicating by collection id nth. The enabled set is what the
account's agents can use.

## The agent read session

`ContextReadSession` (from `src/library-read.ts`) is the agent-facing capability returned by
`getSession()`. It wraps `search`, `list`, and `read` over the enabled collections, plus
entity-linking/metadata helpers. Value types live in `src/context-types.ts`:

- `ContextSearchResult` — a `docId` (opaque, "collectionId/path"), title, path, snippet, score.
- `ContextListingEntry` — discriminated by type: `collection` (drill in with `list`/`search`),
  `directory` (a path node), or `document` (a `docId` to `read()`). `contentType` distinguishes text
  from embeddable binaries (e.g. images).
- `ContextReadResult` — the full document; binary content is a `data:` URI.

`encodeDocId`/`docIdRoot` are the join/lookup helpers; invalid ids resolve to no document. Agent
access is via the bounded catalog (`getAgentCatalog`) and every read is authorized as an
observation.

The agent-facing API surface is exported to the agent through `getTypeScriptTypes()`, whose shapes
(`CONTEXT_LIBRARY_TYPES`) live in `src/library-gatekeeper.ts` and are kept in sync with
`context-types.ts` by convention. Agent **skills** are built from collection manifests via
`agent-skill.ts` (with a slash-command provider fan-out of 8 in `library-gatekeeper.ts:39`).

## Persistence: three Durable Objects + KV

The package owns its state in three Durable Objects plus a KV namespace:

- **`ContextCollectionDurableObject`** (`src/context-collection.ts`) — the content of one
  collection (documents, and the collection's metadata/description).
- **`UserLibraryDurableObject`** (`src/user-library.ts`) — each account's own private collections.
- **`LibraryRegistryDurableObject`** (`src/registry-do.ts`) — the domain's public set; it is the
  **only writer** of the KV snapshot.
- **KV** (`CONTEXT_COLLECTIONS` namespace) — `srct/collection-kv.ts` stores a per-domain
  public-collections snapshot keyed `` `${domain}\u0000.public` `` so user sessions can build their
  enabled set without touching a DO. `collection-kv.ts:1` names the registry DO as the only writer.

The gatekeeper also mints a **verifier** (`ContextVerifier` from `library-gatekeeper.ts`) and has
observer tracking (`context-observers.ts`): its observer strategy is **C** (data-set tracking) —
it tracks observed collections and verifies each is public in the sharing domain or privately owned
by the observer's Context account (`docs/observers.md` §9.2).

## Sharing-domain scoping

All data is namespaced by a **sharing domain** that comes from the binding's props (see
`src/domain.ts`). Durable Object names are domain-scoped via
`domainName(domain, id)` = `${domain}\u0000${id}`. This keeps multiple Workshops sharing one
gatekeeper instance isolated. `src/domain.ts` frames it as: namespacing prevents accidental mixing
between trusted deployments; it is not a boundary against malicious peer configs.

## The management UI

`startAppUi({ isAdmin })` returns the single-file React SPA (`app/`), which is how admins create
public collections and users manage their private ones. Portal-style errors, theming, docs search,
git-backed collection import, and document editing are handled through the `ContextApi` RPC exposed
to the iframe (`src/context-api.ts`); a per-account list of owned collections plus the domain's
public KV snapshot is `loadEnabledContextCollections`.

## Uncertainty

The exact bindings (the `CONTEXT_COLLECTIONS` KV namespace and the Durable Object classes) are as
declared in `src/env.d.ts`/`worker-configuration.d.ts` generated from the wrangler config; treat
those as authoritative. The SPA production bundle is embedded as `src/generated/app.txt` (generated
by `build-app.mjs`), not committed by hand.
