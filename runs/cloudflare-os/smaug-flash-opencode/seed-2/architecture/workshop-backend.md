---
type: architecture
title: The Workshop Backend (Kernel)
description: Detailed walk-through of packages/workshop-backend, the kernel — its Durable Objects (User, Overseer, AdminSettings, PendingLogin), typed-storage collections, auth, the git object store, chat/agent loop, sharing, blueprints, and AI gateway.
tags: [backend, kernel, durable-objects, storage, auth]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# The Workshop Backend (Kernel)

`packages/workshop-backend` is the kernel of Cloudflare OS: a Cloudflare Worker that owns users,
workspaces, gadgets, the chat/agent loop, sharing and observer enforcement, blueprints, deployment
admin configuration, and AI-gateway billing. It is the architectural center of the system and is
held to a higher review bar than the UI — "every line" of it (and of API changes in
`workshop-shared`) matters, and diffs should stay small and elegant (`AGENTS.md`).

## Tiered structure

The worker exposes a set of Durable Objects and entrypoints (re-exported from `src/server.ts`), all
reached via `ctx.exports` with no explicit durable-object binding (`wrangler.jsonc` migrations):

- **`UserDurableObject`** — one per user, addressed by `idFromName(email)` (email-keyed identity).
  Owns profile, AI model config, connected accounts, gadgets listing, blueprints, sessions, and the
  Outputs index.
- **`OverseerDurableObject`** — one per workspace. The heart of the system: hosts the gadgets
  (workpieces), gatekeeper facets, the agent loop, chat, code, sharing, and observer enforcement.
- **`AdminSettings`** — deployment-wide admin settings singleton, always addressed as
  `getByName("")`.
- **`PendingLogin`** (and `LoginConnectCallbackImpl`) — the transient bridge for gatekeeper
  sign-in pop-ups.

## Server entrypoint (`src/server.ts`)

`server.ts` wires the RPC capabilities. `AuthenticatedApiImpl` (decorated with `@validateRpc()`)
implements the `AuthenticatedApi` surface and delegates most work to the user's `UserDurableObject`
via `this.#user` (a fresh stub per request so broken stubs are never reused). `#isAdmin()` reads
the `ADMINS` env binding (a JSON array of usernames, or a string that parses as one)
(`server.ts:100`). The `#openGadgetInternal` path resolves the `OverseerDurableObject` from the id,
detects connection loss to the DO via a disposal callback that aborts the session (forcing browser
reconnect), redeems share keys atomically, and records analytics; it uses `retryOnDoReset` for
pure-read delegations across DO resets (`server.ts:216`).

`PublicApi` / `getServerConfig` reads deployment config via `readAdminConfig(env)` — a single cheap
KV get.

## User Durable Object (`src/user.ts`)

`UserDurableObject` is the per-user DO. Its typed storage (`makeUserStorage`, `user.ts:157`) has
collections `aiModels`, `gadgets`, `connectedAccounts`, `sessions`, `blueprints`,
`libraryBlueprints`, and `outputs` (the mirror each workspace's Overseer pushes to so the Outputs
page is one cheap read of the user's own DO). Singletons include `cloudflareBilling` (AI Gateway
billing state), `created`, `profile`, and the free-tier daily LLM counter.

`ConnectedAccountRecord` (`user.ts:22`) holds each OAuth-connected account as a `Fetcher<GatekeeperUser>`,
plus `vendorId`, `credentialExpiresAt`/`credentialsExpired` (driven by the gatekeeper callback), and
`autoProvisioned` (minted by `createAccount`, protected from manual disconnect). `areCredentialsValid`
bounds both the flag and the timestamp.

`getGatekeeperClassFor()` (`user.ts:1136` per observers.md) is the **single core chokepoint** where
disabled gatekeepers/resources are enforced before a capability is minted — gadget/agent code can't
reach a disabled gatekeeper directly. It is what `GadgetClient.newGatekeeper` calls.

## Overseer Durable Object (`src/overseer.ts`)

`OverseerDurableObject` is the workspace. `OverseerImpl` holds a typed `OverseerStorage`
(`makeOverseerStorage`, `overseer.ts:959`) and a `GitStore` (`overseer.ts:1704`).

### Storage

Singletons include `ownerId`, a `version`-gated storage schema (versions 0–3: from pre-multi-gadget,
through multi-gadget, through git-backed code, to the actions index backfill), `prohibitAllSharing`,
and next-ID counters. Collections (documented inline at `overseer.ts:1033`) include:

- `gitObjects` (`gitObjectsCollection`) — the workspace's real **git object store** (see below).
- `gadgets` — the registry of gadget workpieces, the enumeration source of truth for which gadgets
  exist (the set of Y.Doc roots is not authoritative for deletion because Yjs roots can't be
  deleted); a unique index enforces workspace-wide binding-name uniqueness.
- `gatekeepers` — gatekeeper records, with `bindingName` index.
- `actions` — the approval-queue records, indexed by `pendingByGatekeeper`, `byHistoryFilter`, and
  `byLastChanged` (resume-replay).
- `boundHooks`, `autoApproveTags`, `chatMeta`, `chatContext`, `chatCompactions`,
  `activeAgents`, `gadgetResponseDeliveries`, `externalChats`, `chats` (the chat message stream),
  `chatChanges` / `chatChangeBoundaries` / `chatChangeClients` (the operational-transform change
  streams), `agentCallbackArgs`, `chatModelData`, `collaborators` / `shareKeys` (sharing graph;
  see [Sharing and Observers](/openwiki/concepts/sharing-and-observers.md)), `blueprints`
  (Gadget DO-side records), `chatAttachmentContent`, and `observers` (non-owner configured
  observers, with `byObserverId` index for forward exclusion).
- READ-ONLY legacy collections `code`, `snapshots`, and `chatDraftUpdates` retained only as git
  migration input.

### The git object store

Mainline gadget code is stored as **real git loose objects** (blobs, trees, commits — SHA-1,
zlib-deflated, byte-identical to `git`) in the `gitObjects` collection, with each `GadgetRecord.commitId`
pointing at its head (`git-store.ts:1`). There is deliberately **no ref layer**: no branches, tags,
or HEAD — the "refs" are the gadget/blueprint records and the chats' pinned commits, all managed by
the Overseer's own workflow. isomorphic-git provides the object codec (plumbing only), and a
`threeWayMerge` implements the merge the Overseer wants. Content addressing deduplicates shared
history; no GC, and loose objects only (see `git-store.ts:20`).

### Chat and agent loop

Each chat keeps a committed code base plus a revisioned stream of uncommitted `CodeChange`s
(`chatChanges`). The agent runs as a Code Mode agent — it performs tasks by writing and immediately
executing code snippets through `executeCode` (`README.md`). The loop lives in `src/agent.ts`
(importing `@earendil-works/pi-agent-core`), with compaction logic in `src/agent-compaction.ts`. The
overseer's `OverseerImpl` implements `AgentHooks`.

## Auth flows

Three auth modes are layered in `src/auth/` (`config.ts`, `auth-vendors.ts`, `login-flow.ts`):
- **Password** — the client computes an `argon2id` hash derived from `SERVICE_SALT + username`, and
  the server re-hashes before storing (see [Authentication and Sign-in](/openwiki/operations/auth.md));
  tokens are `"<email>:<secret>"` stored as a `LoginSessionRecord` keyed by the SHA-256 of the token.
- **Cloudflare Access** — `authenticateFromCfAccess` reads the CF Access JWT and verifies it via
  `access.ts` (`CF_ACCESS_ISS` / `CF_ACCESS_AUD`).
- **Gatekeeper OAuth** — `startGatekeeperLogin` spawns a `PendingLogin` DO and a
  `LoginConnectCallbackImpl`; the transient login grant is used only to read the verified email and
  is then discarded.

## Sharing and observers

The Overseer owns the interplay between the sharing permission graph (`collaborators`, `shareKeys`)
and the observer mechanism (`observers`), through `src/sharing.ts` (the `SharingManager`) and
`ensureObserver` in `overseer.ts`. See [Sharing and Observers](/openwiki/concepts/sharing-and-observers.md).

## Blueprint storage

Blueprint state flows one-way Gadget DO → User DO → KV (`BLUEPRINTS`), with code content in R2
(`BLUEPRINT_CONTENT`), marked by a `dirty` flag for propagation failures; see
[Blueprints](/openwiki/concepts/blueprints.md).

## Admin config ownership

`AdminSettings` DO owns the authoritative `AdminConfig` (a singleton `adminConfig`), plus the
featured-blueprints mirror and bundled-format install/promote stamps, and mirrors it to the single
reserved KV key `.adminConfig` so hot paths resolve it with one cheap KV get (`admin-settings.ts:19`,
`admin-config.ts`). See [Deployment Admin Configuration](/openwiki/operations/admin-config.md).

## AI gateway and billing

`ai-models.ts` routes model calls through `@earendil-works/pi-ai`; the optional
`ai-gateway-billing/` flow gives each user a free daily allowance and then bills their own
Cloudflare account via the Cloudflare gatekeeper; see [Cloudflare Gatekeeper](/openwiki/integrations/gatekeeper-cloudflare.md)
and `docs/ai-gateway-billing.md`.

## Observability

The backend uses a workspace observability module (`src/observability.ts`) that defines the
Workshop's field vocabulary (`WorkshopObservabilityFields`) and an ambient `obsContext`
(`createObservabilityContext`), and a logging convention documented in `AGENTS.md`. It also
implements a browser error-reporting endpoint (`client-errors.ts`) that dispatches to
`FRONTEND_ERROR_REPORTER` / `FRONTEND_ERROR_RATE_LIMITER` when bound, else is a no-op.

## Uncertainty

This doc describes the storage collections as they exist in source. Exact deployment provenance
for the auth `ADMINS` JSON-with-string fallback and the compatibility flags is as implemented in
source; if the runtime ergonomics of a particular Durable Object binding differ, treat the wrangler
config and `ctx.exports` wiring as authoritative.
