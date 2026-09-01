---
type: subsystem
title: Context Library gatekeeper
description: The Context Library is an auto-provisioned gatekeeper that gives every user a private-plus-public store of context documents agents can read as observations, exposing an agent singleton session and a management UI, with sharing-domain namespacing and collection-level observer tracking.
tags: [gatekeeper, context, singleton, collections, skills]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-b27801aedd153097a7879044
    resource: repo://packages/gatekeeper-context/src/agent-skill.ts
  - id: openwiki-source-5fe67c97a9e2d029871ded3d
    resource: repo://packages/gatekeeper-context/src/collection-kv.ts
  - id: openwiki-source-52ab503bbb8e3296d63507cc
    resource: repo://packages/gatekeeper-context/src/context-collection.ts
  - id: openwiki-source-b1629be8a1a0855428b18a7d
    resource: repo://packages/gatekeeper-context/src/context-observers.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-4f77f1b4388c32281959852d
    resource: repo://packages/gatekeeper-context/src/index.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-93a9f96a66238f442bc4688a
    resource: repo://packages/gatekeeper-context/src/library-read.ts
  - id: openwiki-source-bf24a2c39ef776522be209d3
    resource: repo://packages/gatekeeper-context/src/registry-do.ts
  - id: openwiki-source-4f6a059eb6a37b6662f5b07d
    resource: repo://packages/gatekeeper-context/src/user-library.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Context Library gatekeeper

`packages/gatekeeper-context` is the **Context Library**: an auto-provisioned gatekeeper that lets a
team author collections of context documents that agents consult. It declares an agent **singleton**
(the read session, auto-provided to every chat as an ambient capsule) and a **management UI** (a
single-file React SPA for authoring collections). It owns no URL-addressed resources and takes no
OAuth credentials.

## Auto-provisioning

`GatekeeperVendor.createAccount()` (`library-gatekeeper.ts:401`) mints a fresh `ContextAccount` with
no user identity and no OAuth flow — each account is a `WorkerEntrypoint` whose props are
`{ sharingDomain, accountId }` (the accountId is a fresh `crypto.randomUUID()`). `describe()` sets
`autoProvisionsAccount: true`, and the account's own `describe()` declares
`singleton: { tsType: "ContextLibrary" }` and `providesUi: { title: "Context & Skills" }`
(`library-gatekeeper.ts:131-138`). The Workshop auto-provisions one account per user, installs the
singleton gatekeeper into the owner's gadgets, and auto-provides its session as an unnamed capsule
(see the gatekeepers framework page). The account is the authority thereafter; `revoke()` deletes the
user's private collections.

## Sharing-domain namespacing

All data is namespaced by a **sharing domain** carried in the binding's props
(`domain.ts`), so multiple Workshops sharing one gatekeeper instance stay isolated. `domainName()`
joins `domain` and an id with a NUL separator, and that string is used as the Durable Object name
(`idFromName`) for domain-scoped entities and as a KV key prefix. The Workshop passes the deployment's
public origin as the sharing domain in the `GATEKEEPER_CONTEXT` service-binding props
(`run-dev-server.ts` uses `"dev"`; the release manifest templates `$PUBLIC_BASE_URL`).

## Durable Objects and KV layout

The worker owns three Durable Object classes plus a KV namespace:

- **`ContextCollectionDurableObject`** — one per collection, addressed by
  `idFromName(domainName(domain, collectionId))`. Stores the collection's metadata and documents
  (text as UTF-8, binary as raw bytes, in SQLite), validates document paths, supports full-text
  search/list/read, and maintains a skill index (`listAgentSkills`) built from `SKILL.md` manifests.
  Metadata changes update the private owner library or the public registry. Collections may be
  git-backed (`artifact-sync.ts`), refreshing from an external repo at most once a minute.
- **`UserLibraryDurableObject`** — one per account (`idFromName(domainName(domain, accountId))`),
  a per-account index of **owned private collections**. It also computes the **enabled set** for the
  agent read path: the user's own private collections plus every public collection in the domain
  (`getEnabledCollections`, `user-library.ts:84-91`), with private winning on overlap so private is
  never downgraded to public.
- **`LibraryRegistryDurableObject`** — one per domain, the authoritative registry of **public
  collections**. It serializes writes to a KV snapshot (`<domain>\u0000.public` in the
  `CONTEXT_COLLECTIONS` namespace) that user sessions read when building their enabled set
  (`collection-kv.ts`).
- **KV namespace `CONTEXT_COLLECTIONS`** — holds the per-domain public-collections snapshot; the
  registry DO is its only writer.

## The read session (agent singleton)

`ContextGatekeeper` is the gadget-side DO facet implementing `Gatekeeper<LibraryReadSession>`
(`library-gatekeeper.ts:219`). It is **read-only** — no actions are ever submitted, so
`applyAction`/`rejectAction`/`revertAction` throw and `getAutoApprovableActions` returns [].

`LibraryReadSession` (`library-read.ts:33`) exposes `search`, `list`, and `read` against the
**enabled set** (own private + domain public). Documents are addressed by encoded doc ids
(`encodeDocId(collectionId, path)`). Every result-revealing call is authorized as an observation
**after** fetching but **before** returning, and each observation is attributed to the collections
whose metadata or content it revealed (`#authorize`, `library-read.ts:67-76`). A call that returns
nothing records no observation.

The session interface is surfaced to the agent through `getTypeScriptTypes()` as `ContextLibrary`
(search/list/read), and `getAgentCatalog()` (`library-gatekeeper.ts:318`) returns a discovery
catalog: collections first, then up to `AGENT_SKILL_CATALOG_MAX_ENTRIES` (150) skills, passed through
`boundAgentCatalog`. Catalog access is itself authorized as an observation.

## Agent skills and slash commands

Collections can contain **Agent Skills** — documents with a `SKILL.md` manifest that the agent can
invoke. They appear three ways:

- as **slash commands** (`ContextSlashCommandProvider` via `getSlashCommandProvider`), where
  invoking one runs the skill's expansion — reading the document through a fresh read session and
  building a skill message from the manifest (`library-gatekeeper.ts:288-316`);
- as **catalog entries** so the agent can discover and `read()` them;
- via normal `search`/`list`.

## Observer tracking: strategy C over collections

Sharing uses observer strategy **C** with collections as the data sets. `ContextObserverTracker`
(`context-observers.ts`) lives in the gatekeeper facet's KV and tracks:

- **observed collections** — with a two-state protocol: unknown sets are marked `pending` before the
  first `await`, then promoted to `observed` only after `authorizeObservation` succeeds
  (`prepareObservation` / `commitObservation`), so a failed authorization leaves them pending and
  retryable;
- **observers** — each storing the verifier minted by the *observer's own* Context account.

`addObserver` verifies the prospective observer against **every** tracked collection, looping until
no unchecked sets remain (closing admission races), and throws if any fails. A later observation that
first touches a new collection re-checks all stored observers and sets `excludeObservers` for any who
fail (`prepareObservation`, `context-observers.ts:81-104`) — the overseer then blocks the observation
if a still-authorized observer is named. Access is decided by `ContextVerifier.hasCollectionAccess`
(`library-gatekeeper.ts:204-215`), which grants access when the observer's account *owns* the private
collection or the collection is *public* in the same sharing domain — an access check against the
observer's own identity, made safe by the overseer's same-vendor handoff guarantee.

## Management UI

`ContextAccount.startAppUi()` (`library-gatekeeper.ts:147-154`) returns the bundled single-file
React SPA (`app.txt`, built by `build-app.mjs`) as `iframeHtml` plus a `ui` capability implementing
`ContextApiImpl` (in `context-api.ts`), with `isAdmin` passed fresh per open so admin-gated features
reflect current status. The Workshop hosts it on its own page at `/gatekeepers/context`.
`loadEnabledContextCollections` is shared between the management UI and the read path so both see the
same enabled set.
