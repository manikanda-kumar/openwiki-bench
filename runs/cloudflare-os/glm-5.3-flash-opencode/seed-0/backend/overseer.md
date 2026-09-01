---
type: overseer
title: "OverseerDurableObject: Workspaces and Chats"
description: The per-workspace Durable Object — the OverseerImpl core behind the DO wrapper, the open() authorization handshake, gadget facets, chat lifecycle, alarm-driven agent keep-alive, loopback entrypoints for gatekeeper calls, and the connection-loss detection that powers client reconnect.
tags: [durable-objects, workspaces, chats, facets, gatekeepers, overseer]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# OverseerDurableObject: Workspaces and Chats

Every workspace is its own Durable Object (`OverseerDurableObject`). The DO class is a thin wrapper around **`OverseerImpl`**, the class that implements both the `Overseer` RPC surface (via per-caller client interfaces) and the `AgentHooks` interface the agent loop consumes (packages/workshop-backend/src/overseer.ts:1397, 8204-8210, packages/workshop-backend/src/agent.ts:339-453).

## Lifecycle: alarm-driven agent keep-alive

The DO's alarm has a specific contract (packages/workshop-backend/src/overseer.ts:8212-8226):

- If the DO is still running but the browser closed (nobody holding the DO alive), the alarm takes over and holds the DO open until running agents finish.
- If the DO died since agents were scheduled, the alarm wakes it — and the constructor reschedules agents before `alarm()` runs.
- If the DO dies *while* the alarm runs, the retry re-runs it, resuming the agents.

`alarm()` awaits `waitForAllAgentsToComplete()` and then delivers any ready external-message responses (packages/workshop-backend/src/overseer.ts:8223-8226).

## Workspace initialization

A brand-new workspace's storage is initialized by `#initializeNewWorkspace()`: it writes `codeVersion = 1` and the current storage schema version (3). Workspaces born since git-backed code storage have **no legacy code log at all** — committed code exists only once a first commit lands in the git store (packages/workshop-backend/src/overseer.ts:8228-8237).

## The open() handshake

`open(userId, profileId, notifyClosed, shareKey?, configureObservers?)` is the authorization gateway (packages/workshop-backend/src/overseer.ts:8253-8391):

1. **First open initializes ownership under `blockConcurrencyWhile`**: it asks the *owner's user DO* whether it believes the gadget exists (`getGadget`); a missing record throws `WORKSPACE_NOT_FOUND`. If the user's record says the gadget was *shared to them* (`meta.owner` set), open also fails as not-found — a deleted shared gadget must not be resurrected under a new owner (packages/workshop-backend/src/overseer.ts:8257-8284).
2. **Ambient capsules** (`ensureAmbientCapsules`) run idempotently and best-effort: the very first open awaits them so the agent's first turn sees the singleton gatekeepers; later opens let the reconcile run in the background to keep cross-DO latency off the hot path (packages/workshop-backend/src/overseer.ts:8293-8304).
3. **Owner open** marks the outputs index dirty (best-effort pushes plus never-pushed pre-index workspaces are corrected by re-syncing on open) (packages/workshop-backend/src/overseer.ts:8311-8315).
4. **Non-owner path**: `prohibitAllSharing` short-circuits any non-owner unconditionally; a provided share key is redeemed through the SharingManager; the caller's **effective role** is computed from the permission graph — an unauthorized caller gets a distinct access-denied (without workspace metadata), which is also what a removed collaborator sees after their session is force-restarted (packages/workshop-backend/src/overseer.ts:8320-8350).
5. Only after a valid role is confirmed does `ensureObserver` run — verifying the caller may observe everything the gadget read through in-scope gatekeepers, configuring their connected accounts if needed. Running it after the role check guarantees gatekeeper/resource metadata is never revealed to unauthorized users (packages/workshop-backend/src/overseer.ts:8352-8360).
6. A fire-and-forget call records the shared-gadget open on the collaborator's home page and catches up outputs (packages/workshop-backend/src/overseer.ts:8362-8379).

**Capability selection by role**: a `"use"` collaborator gets `UseOverseerInterface` — a restricted capability exposing only the gadget UI; `"build"` collaborators (and the owner, always `"build"`) get the full `OverseerClientInterface` (packages/workshop-backend/src/overseer.ts:8382-8391, 9053, 10552).

## Connection-loss detection (the `notifyClosed` hack)

When `AuthenticatedApiImpl` opens a workspace it passes a `notifyClosed` callback the DO must call when the session stub is disposed; if instead the *callback itself* is disposed before being called, the RPC connection to the DO was lost, so the API aborts the whole I/O context — killing the WebSocket from the client and forcing its reconnect logic. An access-denied open also clears the user's stale listing via `forgetSharedGadget` (revocation pushes are best-effort, so stale entries must be cleaned on click) (packages/workshop-backend/src/server.ts:229-273).

## Gadget facets

Gadget code runs in **Dynamic Worker facets** of the overseer DO (packages/workshop-backend/src/overseer.ts:4034-4083):

- With a `chatId` whose chat has proposed changes, the facet runs the *chat-branch* code; otherwise it runs mainline. Switching what code is running aborts the old facet and restarts it (`#runningChatIds` tracks which chat's proposed changes are live per gadget).
- A missing map entry (e.g. after overseer restart while a facet kept running) triggers a **defensive reset** — aborting a non-running facet is a no-op.
- Facet stubs cannot currently be sent over RPC, so `getGadgetFacet` wraps the Fetcher in a Proxy presenting it as an `RpcTarget` (packages/workshop-backend/src/overseer.ts:4085-4103).

## Loopback entrypoints

Because gadget workers reach the outside world through service bindings, the overseer provides loopback entrypoints in place of real gatekeeper stubs (packages/workshop-backend/src/overseer.ts:8766-8839):

- `GatekeeperLoopback` — constructed per binding call; its constructor resolves the overseer DO and proxies `startGatekeeperSession(...)`, so the gadget's `env.<binding>` behaves like the gatekeeper session while every call routes through the overseer (for observations/actions logging).
- `GatekeeperHookLoopback` — handed to a gatekeeper when a hook connects; implements `HookInitiator`, whose `startHook()` returns both the hook's RPC stub and an `ApprovalQueue` for logging observations and actions.
- `GadgetTailLoopback` / `CodeModeTailLoopback` — tail entrypoints that report dynamic-worker outcomes (gadget loads and executeCode runs) back to the overseer, keyed by props (`overseerId`, execution id, etc.).
- `AgentSelfLoopback` — the `self` object of `executeCode` (packages/workshop-backend/src/overseer.ts:7291-7298).
- `TransientStubLoopback` — carries transient (non-storable) stubs into stored values.

## Outputs sync and external messages

The workspace pushes its outputs into the owner's user-DO index (`syncWorkspaceOutputs`); `getOutputsForOwnerBackfill` returns the snapshot **only to the owner** (any other caller gets null), and the user DO pages through catch-up in batches of 16 workspaces per call, with the client repeating until done (packages/workshop-backend/src/overseer.ts:8239-8247, packages/workshop-backend/src/user.ts:18-20).

Workspaces can also be created by **external messages** (e.g. email): `receiveExternalMessage` lazily creates the workspace (caller becomes owner with a pending registration completed on the next owner-DO interaction), and requires the caller to be the owner or a `"build"` collaborator (packages/workshop-backend/src/overseer.ts:8402-8452).

## Related pages

- [AI Agent System](/openwiki/backend/agent-system.md) — the AgentHooks this class implements.
- [Gadget Code Storage: Git Objects and Code Changes](/openwiki/backend/gadget-code-storage.md) — the store and merge workflow it drives.
- [Sharing and Collaboration](/openwiki/backend/sharing.md) — the roles and share keys the open() handshake consumes.
