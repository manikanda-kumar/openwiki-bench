---
type: workflow
title: Actions, Approval Queue, and Auto-Approval
description: The human-in-the-loop pipeline — the ApprovalQueue contract, how side-effecting actions are submitted, simulated, logged, approved or rejected, resumed for awaiting agents, and how auto-approval rules apply pending actions without skipping past manual gates.
tags: [actions, approvals, audit-log, auto-approval, gatekeepers, human-in-the-loop]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# Actions, Approval Queue, and Auto-Approval

## The contract

Gatekeepers distinguish two kinds of operations (packages/workshop-shared/src/gatekeeper.ts:855-1046):

- **Observations** (read-only): the gatekeeper calls `authorizeObservation(description)` on every read and must wait for the response before returning anything to the gadget. Calling it after fetching (for strictly read-only operations) is acceptable, as long as no data has been returned yet. Observations are logged but never approved/rejected.
- **Actions** (side effects): the gatekeeper calls `submitAction(action, description)` on the `ApprovalQueue`. It resolves immediately; the action may sit pending for hours. The gatekeeper applies the action only when the overseer later calls `applyAction(action)` — "there is no mode in which it's OK to skip the check". Gatekeepers are encouraged to *simulate* unapproved actions: "the Session interface should reflect the state of the resource as if all actions had been applied", letting the gadget keep working and queue dependent actions while the user reviews later (README.md:73-79). `rejectAction` may return `{restart: true}` when simulation state can't be rolled back; `revertAction` is optional but expected of high-quality gatekeepers.

## The action log

Every observation and action lands in the Overseer's `actions` collection as an `ActionRecord` (src/overseer.ts:536-600):

- `id` (workspace-wide sequential), `gatekeeperId`, `caller` (agent chat vs gadget), denormalized `resourceTitle`/`resourceUrl` (so display survives gatekeeper deletion), `createdAt`, `appliedAt` (last state change), and `state`.
- Three record types: `"action"` (carries the gatekeeper-assigned `action` number passed back on apply/reject/revert, plus `resolvedBy` once resolved and `autoApproved` when applied by rule), `"observation"`, and `"bindHook"` (hook creation logged like an action but referencing the separate `boundHooks` table).
- Observations from *built-in agent tools* (e.g. webFetch) carry the sentinel `gatekeeperId: -1` (`BUILTIN_TOOL_GATEKEEPER_ID`) — observations never traverse the approve/reject paths that would dereference a gatekeeper (src/overseer.ts:536-542).

`authorizeObservation` also enforces the sharing policy before recording: a `prohibitAllSharing` observation throws if any share exists, else latches the flag; `excludeObservers` is enforced (see [Observers](/openwiki/sharing/observers.md)) (src/overseer.ts:4445-4465).

## Submission → approval lifecycle

1. **Submit** (`submitAction`, src/overseer.ts:4665-4709): under `prohibitAllSharing`, actions are refused outright. A pending `ActionRecord` is written and associated with the caller's chat. If the author marked it `autoApprovable` with an `actionKind` matching an enabled rule on this gatekeeper, a drain is scheduled (deferred, because applying calls back into the gatekeeper facet still awaiting `submitAction`). Only *agent* turns suspend on `awaitDecision` — when a manual decision is pending and the action won't auto-approve, the turn suspends instead of ending.
2. **Approve** (`approveAction`, src/overseer.ts:9476-9503): validates state, resolves the approver's identity *before* applying (so a failed profile fetch can't leave the action applied in the world but still "pending" in storage), then `applyPendingAction` calls the gatekeeper's `applyAction`, marks the record `approved` with `appliedAt`/`resolvedBy`, and persists. Afterward: awaited agent actions resume only once all awaited actions in the turn are decided; and a cascade drain unblocks later auto-eligible pending actions on the same gatekeeper, in order.
3. **Reject** (`rejectAction`): notifies the gatekeeper (`rejectAction(action)`), which may request a gadget restart when simulation state can't roll back (gatekeeper.ts:805-830).
4. **Revert**: `revertAction` is optional; unimplemented reverts instruct the user to undo manually from the action description.

## Auto-approval

Users opt in per gatekeeper per action kind: `setAutoApprovedActionKind(gatekeeperId, actionKind)` stores an `AutoApproveTagRecord` keyed `${gatekeeperId}:${tag}`, capturing who enabled it — "Auto-approvals run under this user's authority, so each auto-applied action is attributed to them in the audit log" (src/overseer.ts:714-738; api.ts:1810-1829).

The drainer (`AutoApprovalDrainer`, src/auto-approval.ts:1-99) applies eligible pending actions in ascending id order with a **per-gatekeeper single-flight guard**: a concurrent drain request sets a rerun flag instead of running twice, so the DO's input gate being open across the apply await can't double-apply an action. Eligibility requires **both** signals — the author's `autoApprovable` verdict on the action *and* a user-enabled rule for its tag. The drain **stops at the first non-eligible pending action (a manual gate) rather than skipping ahead**, preserving in-order application and the invariant that nothing is silently applied past a human gate; a fresh re-read of each record guards against a concurrent drain having already applied it; a failed apply leaves the action pending and stops the drain (logged at `error`).

## Reading the log

`listActions({beforeId, filter})` pages the log newest-first by id; `"all"` pages everything, a record type pages that type, and `"pending"` pages only currently-pending records — the query half of the query-for-state/subscribe-for-deltas contract (api.ts:1768-1780). Three indexes back it (src/overseer.ts:1082-1109): `byLastChanged` (unique; a reconnect replays only records changed during the gap), `pendingByGatekeeper` (sparse, non-unique — the auto-approval drain is O(pending on that gatekeeper) rather than a full-log scan), and `byHistoryFilter` (keys exactly the wire filter values so every `listActions` filter is one ranged read). All three are backfilled by the schema version 3 migration (src/overseer.ts:984-985).
