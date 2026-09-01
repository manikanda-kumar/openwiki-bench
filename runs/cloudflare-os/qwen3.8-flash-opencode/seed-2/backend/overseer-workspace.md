---
type: subsystem
title: The Overseer Workspace Object
description: The workspace Durable Object that owns gadgets, chats, gatekeepers, actions, and hooks — its open/access flow, typed-storage schema, code-change state machine, action log, and loopback entrypoints.
tags: [durable-objects, workspace, state-machines, approvals, typed-storage]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# The Overseer Workspace Object

Every workspace (gadget) is one `OverseerDurableObject`, which composes a large internal `OverseerImpl` and hands each client an RPC facade: `OverseerClientInterface` for full-access sessions, `UseOverseerInterface` as the default-deny "use"-role view (packages/workshop-backend/src/overseer.ts#L8204, #L9053, #L10552). All workspace state lives in one `typed-storage` schema (createTypedStorage with indexed collections; packages/typed-storage/src/index.ts#L1-L40). This page covers ownership and the state machines; the code formats and blueprints live in [Code Storage, Git Objects, and Blueprints](code-storage-and-blueprints.md) and agent execution in [Agent Runtime and Tools](agent-runtime.md).

## The open() / access flow

`open(userId, profileId, notifyClosed, shareKey?, configureObservers?)` is the single entry, invoked by `AuthenticatedApi.openGadget()` (packages/workshop-backend/src/overseer.ts#L8253-L8257). For a never-initialized DO it bootstraps *cooperatively*: the Overseer asks the claiming user's DO whether the gadget exists, and treats a record marked as *shared-by-another-owner* as missing — preventing resurrection of a deleted workspace under the first opener's ownership (overseer.ts#L8259-L8276). Then, for non-owners in order: `prohibitAllSharing` short-circuits to access-denied; a share key is redeemed (creating a collaborator record); the effective role is computed live from the permission graph (`SharingManager.getEffectiveRole`); only *after* a role exists does the observer check run, so an unauthorized caller never learns gatekeeper/resource metadata (overseer.ts#L8317-L8360). Ambient singleton capsules are ensured idempotently and best-effort — blocking on first open so the agent's first turn sees them, backgrounded later (overseer.ts#L8285-L8299). The collaborator's listing is refreshed via a fire-and-forget `recordSharedGadgetOpen`, and `notifyClosed` is invoked when the returned stub is disposed so the *caller* can detect session loss (overseer.ts#L8246-L8251; packages/workshop-backend/src/server.ts#L229-L251).

A minute-granularity **alarm** holds the DO open while agents run (client browser gone), wakes it if it died mid-run (the constructor reschedules agents before `alarm()` runs), and retries on death-during-alarm; the same alarm drains ready external-message responses (overseer.ts#L8212-L8226).

## Storage schema

A singleton `version` gates lazy migrations; workspaces initialized by current code are born at version 3, and the version log records what each step changed (0 = single-gadget legacy, 1 = multi-gadget registry, 2 = git-backed code, 3 = action indexes) (overseer.ts#L975-L1000, #L8228-L8235). Load-bearing invariants:

- **`defaultGadgetId` never changes** once set (even if that gadget is deleted) so old records stay interpretable (overseer.ts#L1000-L1011).
- **The `gadgets` registry collection — not Yjs roots — is the source of truth** for which gadgets exist; content lingering in a deleted gadget's root is inert (overseer.ts#L1061-L1067). A unique index enforces workspace-wide binding-name uniqueness, and pending (chat-provisional) gadget records reserve their names immediately (overseer.ts#L1070-L1079).
- Workpiece ids (gadgets *and* gatekeepers) come from one counter, `nextGatekeeperId`, kept for historical reasons (overseer.ts#L1022-L1024).
- **`chats`** stores messages keyed `chatId.sequence` with a timestamp index; **`chatChanges`** keys per-generation revision-ordered rows; **`chatChangeClients`** holds the per-(user, client session) dedupe record; **`chatChangeBoundaries`** records each chat's last content-preserving generation close for the straggler bridge (overseer.ts#L1181-L1222; record docs at #L623-L716).
- **`agentCallbackArgs` and `chatModelData`** deliberately live *outside* the message log: callback arguments may embed Fetchers, and model-step snapshots are opaque multi-KB payloads — neither should ever be sent to clients (overseer.ts#L1225-L1246).
- **`gadgetResponseDeliveries`** gives external-channel delivery an idempotency-key primary record with ready/undelivered/delivered-by-age indexes (overseer.ts#L1158-L1176).
- `activeAgents` tracks in-progress turns for restart-resume, and a `chatMeta.byLastActive` index finds them (overseer.ts#L1131-L1156).
- `collaborators` and `shareKeys` back the permission graph (overseer.ts#L1247-L1258) — detailed in [Sharing and Observers](sharing-and-observers.md).

## The code-change stream (user edits)

`submitCodeChange(chatId, submission)` is the OT-style write path for client edits, specified exhaustively on the interface (packages/workshop-shared/src/api.ts#L1690-L1740):

- Submissions carry `(generation, revision)` ancestry plus `clientId`/`seq` for **idempotent retry**: the server remembers each session's last accepted seq independently of the changes, so recognition survives materialization and generation bumps; a same-seq retry returns the recorded result, a same-seq *different* payload is a rejected client bug, and skipping a seq means "discard local edits and rebuild" — because OT, unlike a CRDT, does not tolerate double-application.
- `pins` declare the head commit each touched permanent gadget derives from; the server checks head-or-parent and establishes the pin atomically with the change; conflicting first-pins throw.
- While an agent turn is active the call throws a retryable error (the UI locks editing during turns; this backstops races).
- Stragglers rooted in a generation closed by a *merge* are **transformed across the boundary** and land in the current generation ("typing straight through someone's accept"); rejections otherwise mean destructive invalidation (revert, draft discard, turn abort) and clients must rebuild.

Materialization — folding live rows into durable `changes` messages — happens automatically at turn start, at accept, and past size/age thresholds, plus explicitly via `finalizeChatDraft()`; the message's `watermark` tells clients which rows it absorbed, invalidating nothing (api.ts#L2021-L2028). `mergeChanges()` is always all-or-nothing and **fast-forward only**: every touched pin must equal current head, else a "stale" outcome (expected, not an exception) routes the client through `updateChatFromMainline()` — which three-way merges mainline into pinned gadgets, leaves conflict markers in-file for the user's agent to resolve, and records a `mainlineMerge` changes message even when only pins advanced (api.ts#L1977-L2020). A successful merge closes the chat's **epoch**: the change stream restarts at revision 0 under a new, content-preserving generation (api.ts#L1994-L2001). `revertChanges(revertFrom)` throws across still-proposed merges and bumps the generation *destructively* so all clients rebuild rather than corrupt state; `discardChatDraftChanges()` erases un-materialized rows with the same destructive bump while still recognizing late retries (api.ts#L2029-L2050).

## The action log, approvals, and hooks

Everything a gadget or agent does to the outside world is an `ActionRecord` of type `action` (gatekeeper side-effect awaiting/undergoing approval, with `resolvedBy` and `autoApproved` provenance), `observation` (read-only, auto-logged), or `bindHook` (creation of a long-lived hook, denormalized so the log stays coherent after the hook is deleted) (overseer.ts#L543-L593). Built-in agent tools log observations under the sentinel `gatekeeperId = -1`, safe because observations never dereference the gatekeeper (overseer.ts#L536-L541). `subscribeToActions(startAfter)` replays only records whose *last state change* falls in the gap, using the `byLastChanged` index; every mutation path stamps `appliedAt` or a resume would miss it (overseer.ts#L925-L939, #L9821, #L1094-L1118). User-enabled auto-approval rules live in `autoApproveTags` keyed `gatekeeperId:actionKind.tag`, drained per gatekeeper through the sparse `pendingByGatekeeper` index (overseer.ts#L1123-L1129; packages/workshop-backend/src/auto-approval.ts#L34-L61).

Bound hooks (`boundHooks`) store a persistent `callback` stub plus the gatekeeper's `HookController` fetcher; enablement flows through approval, and `startHook` reverses the direction (gatekeeper asks the Overseer for a fresh session before delivering) — see [Gatekeeper Framework](../gatekeepers/framework.md) (overseer.ts#L595-L617).

## Loopbacks and DO-reset tolerance

The same module exports the WorkerEntrypoints that give otherwise-unstorable things a fetcher shape: `GatekeeperLoopback` (binding-loopback for service stubs — a documented hack pending runtime support), `GatekeeperHookLoopback` (hook delivery), `AgentSelfLoopback` (the `self` object inside executeCode), `TransientStubLoopback` (storing transient RPC stubs across hibernation), `GadgetTailLoopback`/`CodeModeTailLoopback` (streaming console logs to the UI), `AgentSpawnerGatekeeper` (overseer.ts#L8757-L9050). Cross-DO reads funnel through `retryOnDoReset()`, which retries a pure read exactly once when the peer User DO reset under the stub (captured stubs go permanently broken), while writes never retry (packages/workshop-backend/src/do-retry.ts; usage e.g. overseer.ts#L8550-L8553; packages/workshop-backend/src/server.ts#L119-L121).

## Client-facing surface

The `Overseer` RPC interface (packages/workshop-shared/src/api.ts#L1594 onward) exposes metadata subscriptions, presence (`subscribeToPresence` — viewers live for the open session; use-role clients join presence in their facade constructor, overseer.ts#L10556-L10560), workpieces, chats, gadgets (`getGadget` returns a `GadgetClient` bound to the facet), gatekeeper creation (`newGatekeeper` creates a workspace-level workpiece *not* bound to any gadget until `GadgetClient.bind()` — capability introduction is explicit, api.ts#L1746-L1756), action history, and the outputs registry the owner folds into their index (pushes are best-effort, and opening as owner re-syncs, overseer.ts#L8311-L8314).
