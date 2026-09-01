---
type: "Reference"
title: "Approval queue: actions, observations, and auto-approval"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Approval queue: actions, observations, and auto-approval

Every gatekeeper session receives an `ApprovalQueue` (an `ObservationAuthorizer` plus
`submitAction` and `bindHook`). The contract: **observations must be authorized before data is
returned to the caller** (the gatekeeper may fetch first, but `authorizeObservation` must be
awaited before anything crosses back), and **every side-effecting action must be submitted and
must not actually be performed until `applyAction` is called** — there is no mode in which
skipping the check is acceptable. Gatekeepers are encouraged to *simulate* unapproved actions so
reads reflect them as if applied, letting the agent continue and the user batch-approve later
(`packages/workshop-shared/src/gatekeeper.ts:723-738`, `928-957`). The README calls this the
advancement over synchronous human-in-the-loop: the agent never stalls on the first approval
(`README.md:75-77`).

## The server side

`ApprovalQueueImpl` is a thin RpcTarget bound to one `(gatekeeperId, caller)` pair; the real logic
lives in `OverseerImpl` (`overseer.ts:11211-11230`).

**Observations** (`authorizeObservation`, `overseer.ts:4445-4486`): enforce `prohibitAllSharing`
(set the lockdown flag when a maximally-sensitive observation arrives at an unshared workspace;
block when shared), enforce forward exclusion via `excludeObservers` (block while any named
observer is still authorized), then record an `ActionRecord` of `type: "observation"` with state
`approved` — observations are audit entries, not approval gates.

**Actions** (`submitAction`, `overseer.ts:4678-4715`): refuse under `prohibitAllSharing` lockdown,
allocate the next action id, and persist a `pending` `ActionRecord` **returning immediately** —
the action may not be carried out until much later. The record is the audit log: denormalized
resource title/url, the caller (`agent`+chatId, `gadget`, or `hook`), the gatekeeper's
`ActionDescription` (title, markdown description, `implementsRevert`, `autoApprovable`,
`actionKind`, `awaitDecision`), and on resolution `resolvedBy` + `autoApproved`
(`overseer.ts:543-591`). Agent-performed actions are associated back into the chat log as `action`
messages at the step barrier (`overseer.ts:4403-4443`).

**awaitDecision**: an advisory hint on the `ActionDescription` for actions the gatekeeper does
*not* simulate — if the agent kept working, it would observe a world where its action "didn't
happen". When set on an agent action *and* the action will not be auto-approved, the turn
suspends after the step barrier and resumes after the user decides (`gatekeeper.ts:1153-1168`;
`overseer.ts:4696-4702`). `approveAction` resumes only after all awaited actions in the turn are
resolved (`overseer.ts:9476-9506`).

**Applying**: `applyPendingAction` is the single chokepoint where an action transitions to
approved — it requires `resolvedBy` and `autoApproved` so no apply path can omit how the gate was
cleared, guaranteeing the audit log always records the resolving user and whether it was automatic
(`overseer.ts:4271-4289`). Manual approval resolves the approver's profile *before* applying, so a
failed profile fetch can't leave an action applied-but-pending (`overseer.ts:9492-9495`).

## Auto-approval

Eligibility requires **both** signals: the gatekeeper author's per-action `autoApprovable` verdict
(only the author knows whether an edit is benign vs destructive) **and** a user-enabled rule for
that action's kind (`autoApproveTags` keyed `gatekeeperId:tag`). When `submitAction` sees both, it
defers a drain via `waitUntil` — deferred because applying calls back into the gatekeeper facet
still awaiting `submitAction` (`overseer.ts:4696-4713`).

The drain (`packages/workshop-backend/src/auto-approval.ts`) applies a gatekeeper's eligible
pending actions **in ascending id order**, stopping at the first pending action that is not
auto-eligible or that throws — never skipping ahead past a human gate. A per-gatekeeper
single-flight guard prevents two concurrent drains from double-applying (the DO's input gate is
open across the apply await), with a rerun flag folding work submitted mid-drain into the running
pass; eligibility is re-checked immediately before each apply to guard against a concurrent drain
having taken it. Auto-approvals run under the authority of the user who enabled the rule
(`auto-approval.ts:28-98`). Clearing a manual gate cascades a drain once the action lands
(`overseer.ts:9503-9505`).

## Hooks in the action log

Binding a hook is recorded as a `bindHook` action (display-denormalized so the log stays coherent
after deletion) plus a `BoundHookRecord` carrying the controller, the persistent callback, and the
enabled flag. Hooks are enabled/disabled, not approved/rejected — `approveAction` on one throws.
`startHook` re-checks the admin config so a disabled gatekeeper can't deliver
(`overseer.ts:4676-4715`, `8591-8611`, `593-609`). See
[gatekeeper architecture](/openwiki/gatekeepers/architecture.md) for the delivery contract.

## Built-in tool observations

Reads by built-in agent tools (e.g. `webFetch`) are recorded as observations attributed to a
sentinel `BUILTIN_TOOL_GATEKEEPER_ID` so the log shows everything the agent learned, while
observation records bypass approve/reject paths by construction
(`overseer.ts:4648-4676`). Under `prohibitAllSharing` lockdown, `webFetch` is refused entirely —
deliberately draconian until a trustworthy allowlist exists (`overseer.ts:4616-4628`).
