---
type: security
title: Capability Security Model
description: How the system keeps agents and gadgets safe — capability-based introductions, observations and actions as the two authorization units, where each check is enforced (gatekeeper session, Overseer ledger, minting chokepoints), async approval with action simulation, and the prohibitAllSharing lockdown.
tags: [security, capabilities, approvals, observations, lockdown, audit]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Capability Security Model

The premise, from the product README: agents and gadgets "by default have access to nothing" — external accounts configured for the Workshop are *not* ambiently available; each resource must be explicitly **introduced**, and capability-based security (not ACLs) is how both human and agent accountability works (README.md "Capability-based access control"). This page is the enforcement map; the per-driver obligations live in [Gatekeeper Framework](/openwiki/integrations/gatekeeper-framework.md), the collaborator half in [Sharing and Observer Enforcement](/openwiki/security/sharing-observers.md).

## The two units: observations and actions

Every interaction between gadget/agent code and the outside world is one of:

- **Observation** — a read. The gatekeeper session calls `ObservationAuthorizer.authorizeObservation(description)` *before data returns to the caller* — a contract obligation on the session side (packages/workshop-shared/src/gatekeeper.ts:855-880) — and the Overseer turns it into an immutable `ActionRecord` (type `"observation"`) stamped with the caller (`GatekeeperCaller`: agent+chatId or gadget+gadgetId), the bound resource's title/url, and the human-readable description (packages/workshop-backend/src/overseer.ts:4445-4478). Built-in agent tool reads are recorded through `recordAgentObservation` against a sentinel id so audit is total but the approve/reject path is never touched (:4653-4663).
- **Action** — a side effect. The gatekeeper calls `ApprovalQueue.submitAction(id, description)`; the Overseer allocates a ledger id, persists `state: "pending"`, associates it with the caller's chat, and *returns immediately* — nothing external has happened, and per contract nothing will until `applyAction` (:4665-4695; packages/workshop-shared/src/gatekeeper.ts:955-962). The action's `actionKind {tag, label}`, `awaitDecision`, `autoApprovable`, and `implementsRevert` fields drive everything downstream.

## Three enforcement points

1. **The gatekeeper session** (driver side): every read authorized first; writes queued, not executed; pending actions optionally *simulated* so the caller sees a world as if applied (packages/workshop-shared/src/gatekeeper.ts:716-752).
2. **The Overseer** (kernel side): the ledger, the lockdown checks, the auto-approval drain, observer enforcement, and the sole approved-transition chokepoint `applyPendingAction` (in-order drain that stops at human gates; [Overseer](/openwiki/architecture/overseer-workspace.md)). The `GatekeeperLoopback` means gadget/agent code can only reach a session *through* these checks (packages/workshop-backend/src/overseer.ts:8766-8795).
3. **Minting chokepoints** (before anything runs): a `resourceUrl` becomes a capability only via `UserDurableObject.getGatekeeperClassFor`, where admin-disabled gatekeepers and resources are rejected and gadget/agent code can't reach it at all (:packages/workshop-backend/src/user.ts:1666-1692); a connection itself is refused for disabled vendors (:1142-1150); ambient accounts exist only because the *admin/user* provisioning policy says so — a gatekeeper never asserts its own ambience (packages/workshop-backend/src/provisioning-policy.ts:1-12); collaborator-facing RPC surfaces are default-deny classes the compiler forces you to fill (overseer.ts:10548-10552); some connectors narrow further at the source (MCP bindings are owner-only — `addObserver` refuses unconditionally, packages/mcp-shared/src/sharing-policy.ts:1-4).

The agent-side loop also suspends where the model could otherwise steamroll a human gate: a successful `requestConnection` and an action with `awaitDecision` (not auto-approved) both end the turn (packages/workshop-backend/src/agent.ts:3112-3127; overseer's `submitAction` sets the captured-actions flag at :4697-4701).

## Ambient vs bound access

Two distinct grants exist and stay orthogonal:

- **Chat bindings (agent):** the frozen seed — workspace gadgets + their bindings, plus auto-provisioned singletons folded in by name — replayed deterministically per chat; the agent sees `env.NAME` only for resources introduced into *that* chat (packages/workshop-backend/src/overseer.ts:6397-6460).
- **Gadget bindings (app):** `getEnvForLoader` materializes only the gadget's *visible* binding edges; edges provisional to another chat are invisible, and deleting access aborts the gadget facet (packages/workshop-backend/src/overseer.ts:2730-2745, 4035-4075).

Both are capability-based: the `env` entry is a loopback whose caller identity is fixed at materialization, so a gadget cannot address resources it wasn't introduced to even by crafting URLs — the Overseer resolves only what its records bind.

## Async approval: simulate now, approve later

The README's headline differentiator — synchronous human-in-the-loop stalls agents into "auto-approve" ergonomics, so gatekeepers *simulate* queued writes and the human batch-approves later (README.md "Gatekeepers" section). The kernel side keeps that safe:

- **Ordering is sacred:** `drainAutoApprovals` applies eligible pending actions in ascending id order and *never skips ahead* of a manual gate or a failed apply (packages/workshop-backend/src/overseer.ts:4291-4301; packages/workshop-backend/src/auto-approval.ts:50-60).
- **Auto-apply needs both signals:** the gatekeeper's per-action `autoApprovable` verdict **and** a user-enabled rule for that `actionKind.tag` on that gatekeeper (`autoApproveTags`), and a per-gatekeeper single-flight drain with a rerun flag so the DO input gate opening across the apply await can't double-apply (auto-approval.ts:1-5, 55-60; overseer.ts:4695-4703). Even then, the *potential* set is what `getAutoApprovableActions()` catalogs for pre-approval UIs; the per-action verdict remains the apply-time gate (packages/workshop-shared/src/gatekeeper.ts:717-725).
- **Provenance is unavoidable:** `applyPendingAction` requires `resolvedBy` and `autoApproved` at the single transition to approved — for auto-approvals `resolvedBy` is whoever enabled the rule (packages/workshop-backend/src/overseer.ts:4270-4289).
- MCP raises the bar once more for auto-*applying* writes: a `vetted` endpoint tier must exist, which only the portal with an explicit admin flag can produce ([MCP Connectors](/openwiki/integrations/mcp-connectors.md)).

## Lockdown: `prohibitAllSharing`

The blunt instrument, still the fallback when a gatekeeper can't express per-person sharing. On an observation flagged `prohibitAllSharing`:

- if the workspace has *any* shares, the observation is **refused** with an instructive error ("try again from an unshared workspace");
- otherwise the workspace's `prohibitAllSharing` singleton flips true — permanently narrowing the workspace: subsequent `submitAction` calls throw ("prohibited from performing actions"), `getWebFetchEnv` throws (no public web fetches; a TODO in-source calls the fetch ban "a bit draconian" pending a well-known-URL check), and share paths short-circuit (open-time checks log it as taking precedence) (packages/workshop-backend/src/overseer.ts:1028-1030, 4445-4456, 4653-4668, 4665-4672, 8321-8325).

Between blunt lockdown and full per-thread hiding sits **forward exclusion**: `ObservationDescription.excludeObservers` names observers who must never see the observation; the Overseer's `#enforceExcludeObservers` blocks the read if any named observer is *still authorized* in the sharing graph (v1 has no per-thread hiding), and otherwise tears down named observers who already lost access (packages/workshop-shared/src/gatekeeper.ts:1049-1115; overseer.ts:4458-4465, 4581-4614).

## Audit trail shape

The ledger *is* the audit product: per-resource `ActionRecord`s with caller identity, timestamps, state transitions (`pending → approved/rejected/failed` with `resolvedBy`/`autoApproved`/`appliedAt`), resource title/url denormalized at record time (so later renames don't rewrite history), and query indexes (see [Overseer](/openwiki/architecture/overseer-workspace.md)). Server-side logging carries the same correlation ids (`chatId`, `gadgetId`, `gatekeeperId`, `actionId` in `WorkshopObservabilityFields`, packages/workshop-backend/src/observability.ts:4-32) without ever logging secret-shaped values — the logger's type ban makes that structural ([Logging, Observability, and Error Reporting](/openwiki/operations/observability-and-error-reporting.md)). Gatekeeper-cloudflare's filter-value rule (only numeric codes in logs, filter values never) is the model for what "no secrets in the audit trail" means in practice.

## Where the model is deliberate, not accidental

- Reads are authorized *after* fetch is acceptable (read-only + nothing returned first) because vendor APIs rarely pre-prove access (gatekeeper.ts:862-879).
- The system accepts a mislabeled `readOnlyHint: true` BYO tool running unapproved as the price of usable MCP reads — but never an auto-applied write there (packages/mcp-shared/README.md:47-80).
- Failure indistinguishability is assumed: the overseer treats every gatekeeper error as repairable, which is why reason strings (not error classes) carry distinctions like denial-vs-expiry (packages/integration-tests/README.md).
