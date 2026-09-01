---
type: security
title: Gatekeeper Framework
description: The gatekeeper RPC protocol every connector speaks — vendor/account/resource layering, OAuth connect contract, the approval queue with observations and asynchronous action simulation, hooks, and how the overseer records and applies actions.
tags: [gatekeepers, approval-queue, observations, hooks, capability-security, protocol]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Gatekeeper Framework

`packages/workshop-shared/src/gatekeeper.ts` defines the capability-based RPC protocol between
the Workshop and its adapters: object-oriented access to external resources so a gadget can be
granted *just* the resource the user intended (packages/workshop-shared/src/gatekeeper.ts#L1-L14).
Implementation walkthrough: [How to Add a Gatekeeper](../guides/adding-a-gatekeeper.md); the
invariants reviewers enforce: [Capability Security Model](./capability-security-model.md).

## Three layers of object

1. **`GatekeeperVendor extends WorkerEntrypoint`** — the service-level binding entrypoint
   (`describe`, `connectAccount`, `getSupportedResources`, `getTypeScriptTypes`, optional
   `createAccount`) (packages/workshop-shared/src/gatekeeper.ts#L445-L522).
2. **`GatekeeperUser extends WorkerEntrypoint`** — *the user's account*: "permission to access
   all of the user's data that is available through it, so needs to be guarded carefully —
   only the Workshop itself should ever have direct access" (packages/workshop-shared/src/gatekeeper.ts#L561-L594).
   It resolves URLs to resource facets via `getGatekeeperClassFor(url)`, which the overseer calls
   *before* the user grants anything (the class is imbued with credentials via `ctx.props`).
3. **`Gatekeeper<Session> extends DurableObject`** — the per-resource facet: `describe()` for
   pre-grant info, `startSession(approvalQueue)` for the gadget-facing capability,
   `getTypeScriptTypes()` narrowed to this facet, observer bookkeeping, optional
   `getAgentCatalog(authorizer)` (itself an observation that must be authorized) and slash
   commands (packages/workshop-shared/src/gatekeeper.ts#L698-L810).

## The connect contract

`connectAccount(callback, options)` returns an OAuth URL the client opens in a self-closing tab;
on completion the gatekeeper calls `callback.complete(userFetcher, expiresAt?)`, handing over the
account capability (packages/workshop-shared/src/gatekeeper.ts#L449-L481, L525-L541).
`expiresAt` must be the expiry of *refreshability*, not of a transparently-refreshable access
token, so the UI can pre-emptively mark expiry; otherwise the gatekeeper pushes
`credentialsExpired()` / `credentialsRestored()` notifications — once is enough
(packages/workshop-shared/src/gatekeeper.ts#L528-L560). Security requirements (nonce in the URL,
DO alarm cleanup) and the `"auth"` transient-scope semantics are covered on the guide page.

## The approval queue: observations and actions

`ApprovalQueue extends ObservationAuthorizer` is handed to `startSession` and is the only way a
session may do anything (packages/workshop-shared/src/gatekeeper.ts#L698-L745, L934-L1048):

- **Observations (reads).** The gatekeeper calls `authorizeObservation(description)` on *every*
  read and must await it before returning data; it may (often should) fetch first and describe
  the actual data, as long as nothing has been handed to the gadget yet. Throwing blocks the
  read, and the exception must propagate to the caller
  (packages/workshop-shared/src/gatekeeper.ts#L855-L873). Descriptions carry the policy surface:
  `excludeObservers` and `prohibitAllSharing` (see the capability-model page).
- **Actions (writes).** `submitAction(id, description)` is fully asynchronous — it resolves
  immediately while the action may sit unapproved for hours or days
  (packages/workshop-shared/src/gatekeeper.ts#L953-L972). The gatekeeper stores the pending
  effect, applies it in `applyAction(id)` only when the overseer reports approval, and supports
  `revertAction` where declared (the `implementsRevert` flag drives the UI)
  (packages/workshop-shared/src/gatekeeper.ts#L1129-L1160; overseer's call into the gatekeeper at
  packages/workshop-backend/src/overseer.ts#L4283).
- **Simulation.** The recommended pattern: the session reflects queued-but-unapproved actions
  (as if applied), so dependent work keeps flowing; the contract leaves simulation to author
  judgement, and `awaitDecision` on the action description tells the harness to pause the agent
  when the gatekeeper can't simulate (packages/workshop-shared/src/gatekeeper.ts#L734-L745,
  L1152-L1166; linear's provisional ids as an example,
  packages/gatekeeper-linear/src/linear.ts#L985-L993).
- **Auto-approval.** Per-action `autoApprovable` is the author's binding verdict; `actionKind.tag`
  is the stable key user rules match on, and `getAutoApprovableActions()` exposes the potential
  set so pre-approval UIs can list tags before any action exists
  (packages/workshop-shared/src/gatekeeper.ts#L713-L722, L1170-L1185, L1206-L1215). On the
  Workshop side, `AutoApprovalDrainer` applies eligible pending actions in id order with a
  per-gatekeeper single-flight guard so concurrent drains can't double-apply
  (packages/workshop-backend/src/auto-approval.ts#L1-L40).

Resolved actions land in the workspace's action log as `ActionLogEntry` records
(`pending|approved|rejected`, `resolvedBy`, appliedAt) that the UI and agent stream
(packages/workshop-shared/src/api.ts#L1480-L1510; conversion at
packages/workshop-backend/src/overseer.ts#L862-L868).

## Hooks (inbound events)

Resources may declare `hookTsType`; a gadget (usually the agent, in a one-off `executeCode`)
calls an `onSomeEvent(callback)` API, and the gatekeeper registers via `queue.bindHook(callback,
controller)` — the callback stub is session-bound so the gatekeeper must never store it itself,
and `controller.enable()` only ever runs if the user approves. On each event the gatekeeper calls
`HookInitiator.startHook()` (a `GatekeeperHookLoopback` in the overseer), re-authorizes the
delivery as an observation, then invokes the fresh callback
(packages/workshop-shared/src/gatekeeper.ts#L965-L1010, L1244-L1290;
packages/workshop-backend/src/overseer.ts#L8802-L8810).

## Types for the agent

Every vendor ships a `.d.ts` string via `getTypeScriptTypes()`; the Workshop parses it into the
agent's type database with progressive discovery, and facets narrow it to their own surface
(packages/workshop-shared/src/gatekeeper.ts#L495-L512, L706-L712; concrete example
packages/gatekeeper-linear/src/types.d.ts compiled into `types.txt`, linear.ts#L42).
`describeBinding` exists because these env objects are RPC interfaces an agent must not guess at
(packages/workshop-backend/src/agent.ts#L840-L844).
