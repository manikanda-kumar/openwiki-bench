---
type: subsystem
title: Workshop backend (kernel)
description: The workshop-backend kernel — the /api entrypoint, the UserDurableObject (accounts, sessions, models, connected accounts, blueprints, outputs), AdminSettings/AdminApi, the Overseer Durable Object and its storage schema, and typed-storage as the persistence layer.
tags: [backend, kernel, durable-object, storage, admin]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-2ff4e6e9c3b33db64168e2c8
    resource: repo://packages/typed-storage/src/index.ts
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Workshop backend (kernel)

`packages/workshop-backend` is the kernel: it owns all state and every security chokepoint. This page
covers the entry point, the Durable Object set, the persistence layer, the capability-minting
chokepoints, and the admin configuration model. The agent, gadgets/git, and sharing have their own
pages.

## Entry point and routing

The worker's fetch handler (`server.ts:794-872`) serves `/api` (HTTP batch or WebSocket Cap'n Web RPC
sessions — see the RPC layer page), `/api/client-errors`, the site logo path, and blueprint
screenshots. It verifies Cloudflare Access JWT claims when `CF_ACCESS_AUD` is set, and triggers the
bundled format-blueprint install on the first `/api` request. It re-exports every Durable Object and
entrypoint class so they can be bound in wrangler.

## The Durable Object set

- **`UserDurableObject`** (`user.ts`) — one per user, keyed by `idFromName(email|username)`. Holds
  the profile, login sessions, password hash, AI models, connected accounts, gadgets listing,
  blueprints, library, the Outputs index, the free-tier daily LLM counter, and Cloudflare billing
  state. It is the single place connected accounts live and the minting chokepoint for gatekeeper
  capabilities.
- **`OverseerDurableObject`** (`overseer.ts`) — one per workspace, addressed by id. Owns the
  workspace storage (see below), the gadget registry, the git object store, chats, the sharing graph,
  the action log, and hooks.
- **`AdminSettings`** (`admin-settings.ts`) — a singleton always addressed as `getByName("")`.
  Owns the authoritative `AdminConfig` and the featured-blueprint mirror.
- **`PendingLogin`** (`auth/login-flow.ts`) — transient rendezvous for gatekeeper sign-in, holding no
  durable storage; the in-flight `attempt.wait()` keeps it alive.

## Persistence: `typed-storage`

All DO state is stored through `@gadgets/typed-storage` (`packages/typed-storage`), a thin typed
layer over DO storage: **collections** (records keyed by primary key, with unique/non-unique indexes
maintained at write time and `rebuild()` for migrations) and **singletons** (single values). Keys are
namespaced per collection and integer keys are hex-encoded so they sort numerically. Collections
support synchronous `subscribe`/`unsubscribe` for change notifications (used by
`subscribeConnectedAccounts`).

The user DO's schema (`user.ts:157-226`): collections `aiModels`, `gadgets`, `connectedAccounts`,
`sessions`, `blueprints`, `libraryBlueprints`, `outputs` (with `byWorkspace` index); singletons
`cloudflareBilling`, `profile`, `quickModel`, `preferredModel`, `onboardingCompleted`,
`outputsBackfilled`/`outputsBackfillCursor`, `nextAccountId`, `pinnedBlueprints`, `dailyLlmCount`,
`passwordHashHash`, `created`.

The Overseer's schema (`overseer.ts:959-1290`) is the largest: singletons `ownerId`, `title`,
`defaultGadgetId`, `nextGatekeeperId` (the shared workpiece counter), `nextActionId`, `nextChatId`,
`nextHookId`, `prohibitAllSharing`, and a storage `version` gating lazy migrations; collections
`gitObjects` (the git store), `gadgets` (with a `byBindingName` unique index), `gatekeepers`,
`actions` (with `pendingByGatekeeper`, `byHistoryFilter`, `byLastChanged` indexes), `boundHooks`,
`autoApproveTags`, `chatMeta`, `chatContext`, `chatCompactions`, `activeAgents`, `chats`,
`chatChanges`, `collaborators`, `shareKeys`, `blueprints`, `chatAttachmentContent`, and `observers`
(with `byObserverId`). The `code`/`snapshots`/`chatDraftUpdates` collections are read-only legacy
from the pre-git era.

### DO-reset handling

A DO incarnation can die mid-call (storage timeout, restart). `do-retry.ts` classifies the rejection
flags workerd attaches (`durableObjectReset`, `retryable`, `overloaded`), telemetries resets via
`wrapDoStubForTelemetry`, and `retryOnDoReset` replays a call **once** against a *fresh* stub — but
only for **pure reads** the caller asserts are replay-safe, because a reset cannot distinguish "never
applied" from "applied, response lost". Writes never retry.

## Capability-minting chokepoints

- **`UserDurableObject.getGatekeeperClassFor`** (`user.ts:1666-1691`) — the single core chokepoint
  where a resource URL becomes a gatekeeper capability: it resolves the class through the connected
  account and enforces the admin's disabled-gatekeeper/disabled-resource sets *before* minting. It is
  reached only via the user/UI-facing `Overseer.newGatekeeper` and blueprint instantiation — never
  from gadget or agent code.
- **`AuthenticatedApiImpl.#isAdmin` / `getAdminApi`** (`server.ts:100-117`, `592-600`) — admin
  status is checked once, when the `AdminApi` capability is minted; the returned stub's methods need
  no per-call checks.
- **Gatekeeper vendor discovery** — `buildGatekeeperVendorMap` scans the `GATEKEEPER_*` service
  bindings, so installing a gatekeeper is purely a binding change.
- **`getVerifier`** (`user.ts:1703-1715`) — resolves a chosen observer account to a verifier,
  throwing on a vendor mismatch.

## Admin configuration: AdminSettings and the KV mirror

`AdminConfig` (`admin-config.ts`) is the deployment's "soft" configuration: signups toggle, site
name/logo, agent instructions, announcement/banner/accent, which gatekeepers/resources are offered,
the three-state ambient-gatekeeper mode, and the promoted formats. Everything defaults to enabled; the
admin UI opts things *out*. `AdminSettings` owns the authoritative config and **mirrors it to one
reserved KV key** (`.adminConfig` in `BLUEPRINTS`, `isReservedBlueprintKey`), so hot paths
(connect/agent) read it with a single cheap KV get via `readAdminConfig(env)`. The DO is the only
writer (`updateAdminConfig`), serializing each read-modify-write so concurrent setters can't lose
updates, and reverting DO storage if the KV mirror write fails.

Authentication/authorization config (sign-in providers, password login) is deliberately **not** here —
it stays env-var driven so it can't be changed by a compromised admin session. The `AdminApi`
capability (minted only for admins) covers branding, instructions, signups, gatekeeper
availability, and format promotion/curation.

### Provisioning policy for ambient gatekeepers

Auto-provisioning gatekeepers (e.g. the Context Library) mint connected accounts with no OAuth flow.
The admin picks a per-vendor mode (`provisioning-policy.ts`): **disabled** (not offered; existing
accounts dormant), **optional** (users opt in from the Connectors page — the default), or **enabled**
(forced for every user, hidden from the Connectors list, not user-removable). The user DO mints the
account via `GatekeeperVendor.createAccount()`, persists it as an `autoProvisioned` connected-account
record (deduped across concurrent calls), and surfaces the singleton/management-UI capabilities from
its `AccountDescription`.

## The Overseer's role

The Overseer is the workspace DO that implements `AgentHooks` (see agent-and-chat), owns the sharing
graph (see sharing-and-observers), hosts gatekeeper facets, and coordinates everything else: gadget
loading, blueprint propagation, action recording, chat message ordering (`getChatTimestamp` ensures
monotonic sequence), and the external-message gateway. Its `open()` is the auth entry point that
initializes the workspace on first open, ensures ambient capsules, redeems share keys, and returns
the role-scoped capability. The storage schema above is what most kernel changes touch, and its
`version` singleton is what gates lazy migrations (`#migrateStorage`).
