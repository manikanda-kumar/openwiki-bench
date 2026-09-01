---
type: subsystem
title: Overseer — The Workspace Durable Object
description: What the OverseerDurableObject owns — versioned workspace storage, chat revision streams, gadget and gatekeeper facets, the approval-queue chokepoint, hooks, ambient chat bindings, outputs fan-out, and the loopback entrypoint family.
tags: [overseer, durable-objects, workspaces, chats, bindings, facets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-64b029899e771aec2fb6dfef
    resource: repo://packages/workshop-backend/src/external-message-gateway.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Overseer — The Workspace Durable Object

Every workspace ("gadget" in `openGadget()` terms) is its own `OverseerDurableObject`, and the Overseer is where nearly all mutable product state lives: chats, workpieces, gatekeeper facets, the action/approval queue, hooks, and sharing state. The exported DO class is a thin shell (packages/workshop-backend/src/overseer.ts:8204) around `OverseerImpl`, which itself implements the agent's `AgentHooks` contract (packages/workshop-backend/src/overseer.ts:1397) — the split is why `agent.ts` may import `overseer.ts` but never the other way around (packages/workshop-backend/src/agent.ts:36-40).

## Storage model and versioned migrations

`makeOverseerStorage` (packages/workshop-backend/src/overseer.ts:959-1330) declares the full typed-storage schema. A persisted `version` singleton gates *lazy* migrations documented in-place: 0 = pre-multi-gadget workspace, 1 = multi-gadget registry as source of truth, 2 = git-backed code (legacy `code`/`snapshots` collections become read-only migration input, dead data retained one release as rollback insurance), 3 = action-index backfill (packages/workshop-backend/src/overseer.ts:964-986, 1037-1053).

Notable invariants encoded in the schema:

- **`defaultGadgetId` is write-once.** It exists only for migrated/blueprint workspaces and "must NEVER be changed" even if the gadget is deleted, so old records stay interpretable; it's special-cased in Yjs root naming and facet naming (packages/workshop-backend/src/overseer.ts:994-1011).
- **`nextGatekeeperId` allocates *all* workpiece ids** despite its name — a historical artifact of the single-gadget era (packages/workshop-backend/src/overseer.ts:1021-1024).
- **The `gadgets` collection is the enumeration source of truth**, not the Yjs roots: content resurrected into a deleted gadget's root is inert because it has no registry entry; a unique index on `bindingName` makes even *provisional* gadgets reserve their chat-binding name from creation (packages/workshop-backend/src/overseer.ts:1067-1090).
- **`chatChanges`** keys rows by `chatId.generation.revision` so one generation's edits list in revision order under a prefix, with sibling collections for per-client submission dedupe (`chatChangeClients` + digest) and generation boundaries (packages/workshop-backend/src/overseer.ts:1197-1227).
- **`chatModelData`** stores the model-facing snapshot of each agent step separately from display messages so provider-opaque reasoning signatures survive replay *without ever shipping to clients*; same rationale for `agentCallbackArgs` (packages/workshop-backend/src/overseer.ts:1224-1249).
- **`actions`** carries three purpose-built indexes: `byLastChanged` for reconnect replay ("deliver only records changed during the gap"), sparse `pendingByGatekeeper` for the auto-approval drain, and `byHistoryFilter` mirroring the wire filter enum so `listActions()` is always one ranged read (packages/workshop-backend/src/overseer.ts:1093-1118).
- **`observers`** records non-owner collaborators who passed the gatekeeper `addObserver` checks, with an index supporting forward-exclusion mapping (packages/workshop-backend/src/overseer.ts:1276-1292; see [Sharing and Observer Enforcement](/openwiki/security/sharing-observers.md)).

## Opening a session: `open()`

`OverseerDurableObject.open(userId, profileId, notifyClosed, shareKey?, configureObservers?)` is the front door reached via `AuthenticatedApi.openGadget()`. On first touch the Overseer *confirms its own existence against the owner's User DO* before initializing itself — including the deleted-owner case, where a stale share-recipient reference must not resurrect a DO under the wrong owner (packages/workshop-backend/src/overseer.ts:8253-8285). It then caches the owner profile for permission-graph math, and runs `ensureAmbientCapsules()` — blocking on the very first open so the agent's first turn sees them, background thereafter to keep cross-DO latency off the hot path (packages/workshop-backend/src/overseer.ts:8287-8300). A `streamGeneration` timestamp lets chat subscribers detect a full DO restart (packages/workshop-backend/src/overseer.ts:1401-1404). Expected failure modes are coded errors (`OPEN_GADGET_ERROR_CODES`) rather than prose (packages/workshop-shared/src/api.ts:314-333).

## Chats

Per-chat durable state: `chatMeta` (with a `byLastActive` index for finding running agents), `chatContext` (the frozen seed bindings and spawner config), the `chats` message log keyed `chatId.sequence`, `nextChatSequences`, and `chatCompactions` — which keeps *every* published checkpoint, not just the newest, because reverting across a boundary may need the previous one (packages/workshop-backend/src/overseer.ts:1131-1158). `activeAgents` records in-progress turns so they can resume after a restart (packages/workshop-backend/src/overseer.ts:1152-1158). Turn execution itself is described in [Agent Runtime](/openwiki/architecture/agent-runtime.md).

## Workpieces, gadgets, and gatekeepers as facets

The Overseer hosts two kinds of facets in its own DO location:

- **Gadget servers**: `ctx.facets.get("gadget…" | "gadget")` over dynamically-loaded worker code (packages/workshop-backend/src/overseer.ts:4063-4082; full mechanism in [Gadget Runtime](/openwiki/architecture/gadget-runtime.md));
- **Gatekeeper sessions**: `getGatekeeperFacet(id)` installs the `DurableObjectClass` — minted by the *user's* connected `GatekeeperUser` account via the `UserDurableObject.getGatekeeperClassFor` chokepoint — as facet `gatekeeper<id>` (packages/workshop-backend/src/overseer.ts:4259-4269). Deleting access aborts the facet (`ctx.facets.abort` at :2801, :4971), which is what makes the in-memory `#connectedIndexes` fan-out state safe to keep unsynchronized (below).

Two in-core gatekeeper shapes exist besides external vendors: `LanguageModelGatekeeper` (AI models as resources, packages/workshop-backend/src/ai-models.ts:657) and `AgentSpawnerGatekeeper` — a resource whose session binding lets a gadget spawn agent chat threads with a frozen env, advertising itself with `suggestedBindingName: "AGENT_SPAWNER"` and treating observers as unrestricted because it reads no restricted data (packages/workshop-backend/src/overseer.ts:11248-11290).

## Named chat bindings and ambient resources

`prepareChatBindings` (packages/workshop-backend/src/overseer.ts:6397-6470) freezes each chat's binding seed on first use: spawned chats see only the spawner's configured env; normal chats start from `defaultBindingList()` (the workspace's gadgets and their bindings); ambient gatekeeper capsules — auto-provisioned singletons whose `creationSpec.type === "ambient"` — are then folded in, *named by the gatekeeper's own `suggestedBindingName`* with deterministic dedupe. The frozen ordering is by immutable gatekeeper id, and a since-disconnected ambient stays in the list but becomes inert. The same function is the **naming chokepoint**: it stamps chat-binding names onto persisted messages that lack them, scanning in log order so replay in `runAgent` reproduces identical names.

## The approval queue's single chokepoint

Actions transition to "approved" in exactly one place, `applyPendingAction`, which *requires* `resolvedBy`/`autoApproved` arguments so no apply path can omit how the gate was cleared — the audit record can't be written without its provenance (packages/workshop-backend/src/overseer.ts:4270-4289). `drainAutoApprovals` applies eligible pending actions in ascending id order and **stops at the first non-auto or failing action — never skipping ahead** — preserving the invariant that nothing is silently applied past a human gate; a single-flight drainer prevents the DO input-gate race from double-applying (packages/workshop-backend/src/overseer.ts:4291-4301). Auto-approval rules are per-(gatekeeper, action-kind) opt-in records in `autoApproveTags` (packages/workshop-backend/src/overseer.ts:1126-1131). Client views stream via `subscribeToActions` with the resume index above.

## Hooks

`bindHook` records a persistent callback (a forged restore stub, see the code-mode RestoreForger) paired with its own `actionId`, so *enablement itself* is an approval-queue item; hooks start disabled until the user enables them. Attribution of which gadget a hook wakes uses a documented heuristic when the caller is the agent (sole forged target during the current `executeCode` run), pending a runtime introspection API (packages/workshop-backend/src/overseer.ts:4711-4760). Delivery to the (possibly unloaded) gadget runs through the `GatekeeperHookLoopback` entrypoint (packages/workshop-backend/src/overseer.ts:8808-8822).

## Outputs fan-out

Each workspace pushes a *whole snapshot* of its non-provisional gadget list into each interested user's User-DO index (`syncOutputsTo` / `outputsSnapshot`), coalescing synchronous registry bursts onto one flush. The session table is deliberately in-memory only: revoking a collaborator aborts the DO, destroying the set, so it can only be rebuilt by an `open()` that re-checks the permission graph — and a failed push is staleness, never incorrectness (packages/workshop-backend/src/overseer.ts:4842-4912; user side at packages/workshop-backend/src/user.ts:183-191).

## External messages

`ExternalMessageGateway` is a `WorkerEntrypoint` a deployment binds for channel integrations (e.g. chat platforms): it namespaces caller-supplied gadget/chat/message keys with a binding-owned `source` prop before addressing the workspace DO by name, and `receiveExternalMessage` then resolves the caller's user, bootstraps a *new* workspace when none exists (claiming ownership before registering in the User DO, with `ownerRegistrationPending` making that registration retryable), and queues delivery through the idempotency-keyed `gadgetResponseDeliveries` collection (packages/workshop-backend/src/external-message-gateway.ts:1-38; packages/workshop-backend/src/overseer.ts:8402-8430; schema at :1156-1180).

## Loopback entrypoints

The backend worker exports a family of loopback `WorkerEntrypoint` classes so code running *outside* the Overseer (gadget facets, code-mode workers, gatekeeper facets) can call back *into* the same DO: `GatekeeperLoopback` (binding access with caller identity; :8766), `GatekeeperHookLoopback` (:8808), `CodeModeTailLoopback` (log traces), `GadgetTailLoopback`, `AgentSelfLoopback`, and `TransientStubLoopback` (proxying a live stub captured in callback args; :8872-8890). They all re-enter via `ctx.exports.OverseerDurableObject` and props — which is why they need no explicit bindings.

## Uncertainty

- Several TODOs in this file (hook-simulation in chat context, restoring real gadget `[restore]` targets, consolidating replay logic) mark intended-but-unimplemented behavior; treat them as such.
- The exact resumption semantics of `activeAgents` after a hard crash were not traced beyond the schema comment above.
