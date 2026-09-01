---
type: security
title: Capability Security Model
description: The repository's capability-based security invariants — single chokepoint for minting gatekeeper capabilities, the no-self-ambience rule, env-var/soft-config separation, sandbox isolation with no outbound network, and observer tracking enforcing read-through sharing permissions including lockdown mode.
tags: [security, capabilities, observers, sandbox, invariants, approval]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-fc70743079da2d3d1e2de35e
    resource: repo://packages/integration-tests/__tests__/observer-reverification.test.ts
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Capability Security Model

These are the invariants reviewers treat as the top priority after the kernel bar
(REVIEW.md#L7-L8). They are constraints, not suggestions.

## 1. Capabilities flow through one chokepoint

A gatekeeper capability is minted *only* through `UserDurableObject.getGatekeeperClassFor()` —
not the same-named vendor method — which enforces admin-disabled gatekeepers and resources at the
exact moment a resource URL becomes a capability, and is reachable only from the user/UI-facing
`Overseer.newGatekeeper` and blueprint instantiation paths, never from gadget or agent code
(packages/workshop-backend/src/user.ts#L1666-L1690). Any new path that mints a capability without
going through it is a review flag by rule (REVIEW.md#L29-L32).

## 2. Ambience is configured, never asserted

A resource becomes "ambient" (auto-injected into workspaces/chats) only by user or admin
configuration — a gatekeeper must never assert its own ambience (REVIEW.md#L27-L28). The
mechanics match: auto-provisioning happens only for `autoProvisionsAccount` vendors under the
admin's three-state mode defaulting to *optional*
(packages/workshop-backend/src/provisioning-policy.ts#L1-L34), the account capability (not an
asserted identity) is the authority thereafter, and auto-provisioned accounts are protected from
manual disconnect because deleting one destroys the user's gatekeeper-side data
(packages/workshop-backend/src/user.ts#L26-L32), and ambient bindings for collaborators select an
existing provided account rather than offering a choice
(packages/workshop-backend/src/overseer.ts#L7899-L7915).

## 3. Auth config is outside the admin surface

Sign-in providers and password login are env-var driven (`auth/config.ts`) and must **not** move
into `AdminConfig` — deliberately, "so it can't be changed by a compromised admin session"
(packages/workshop-backend/src/admin-config.ts#L5-L8; REVIEW.md#L33-L37;
packages/workshop-backend/src/auth/config.ts#L1-L6).

## 4. Sandboxes have no egress

Three layers, all verified in code: a gadget's browser iframe cannot reach the outside world at
all except `postMessage` to the parent, through which it gets only its RPC stub
(packages/workshop-shared/src/api.ts#L22-L25); the server-side gadget worker and the agent's
executeCode isolate are both loaded with `globalOutbound: null`
(packages/workshop-backend/src/overseer.ts#L4027, L7284); executeCode additionally runs with
`disallow_importable_env` so the code cannot reach back into the platform's export surface
(packages/workshop-backend/src/overseer.ts#L7266-L7269). Outbound HTTP that *is* allowed (gatekeepers,
`webFetch`) is re-checked per redirect hop against an SSRF blocklist
(packages/mcp-shared/src/endpoint.ts#L1-L3, `fetch.ts`).

## 5. Observations require prior authorization

Every read through a gatekeeper must `await authorizeObservation()` before data reaches the
caller, and denials propagate as exceptions (packages/workshop-shared/src/gatekeeper.ts#L855-L873);
side effects run only after approval, recorded in the workspace action log with `resolvedBy`
attribution (packages/workshop-shared/src/api.ts#L1480-L1510). For MCP servers specifically,
`tools.ts` is the sole reader of tool annotations and the auto-apply path requires the `vetted`
tier (see [MCP Connectors](../integrations/mcp-connectors.md); REVIEW.md#L38-L41).

## 6. Read-through sharing: observers

The observer mechanism enforces that sharing a gadget never grants access to data the recipient
couldn't read directly. When a user opens a shared gadget, they must designate one of *their own*
connected accounts per gatekeeper binding; each gatekeeper verifies the user could directly read
everything historically observed through it (`addObserver` throwing denies access), the user is
registered as an observer, and all *future* observations an observer couldn't make directly are
blocked — with re-verification on every open, so underlying revocations surface promptly
(docs/observers.md#L4-L16; packages/workshop-backend/src/overseer.ts#L7854-L7863). Verification
failures on lapsed credentials re-prompt through `ObserverConfigCallback` (bounded re-prompts)
rather than dead-ending (packages/workshop-backend/src/overseer.ts#L7889-L7897), and the persisted
account choice rolls back only registrations made in the failed call
(packages/workshop-backend/src/overseer.ts#L7876-L7882).

Forward exclusion: an observation may name `excludeObservers`; any still-reachable named observer
blocks the observation, and an observer that has already lost graph access is dropped from
`observers` (best-effort `removeObserver` back to the gatekeepers)
(packages/workshop-backend/src/overseer.ts#L4458-L4464, L4581-L4613).

**Lockdown mode**: once any authorized observation carried `prohibitAllSharing`, the flag is a
permanent singleton on the workspace, and *both* action submission and web fetches throw for the
workspace thereafter — deliberately "extra-careful" per the TODO at
packages/workshop-backend/src/overseer.ts#L1028-L1031, L4447-L4456, L4665-L4672 (fetch enforcement:
L4617-L4625).

## 7. Sharing graph changes propagate lazily but audibly

Collaborator revocation is lazy reachability (see
[Persistence and Blueprints](../data/persistence-and-blueprints.md#sharing-lazy-revocation-in-a-permission-graph)),
while affected collaborators' *workspace listings* are refreshed with a best-effort batched RPC
whose failures are logged, not swallowed (packages/workshop-backend/src/overseer.ts#L7835-L7849).

## Representative focused tests

`packages/integration-tests/__tests__/observer-reverification.test.ts` runs the real
workshop-backend and a real (fixture) gatekeeper under wrangler — "Nothing is stubbed but the
network" — covering the expired-credentials re-prompt path, the two failure shapes the overseer
cannot distinguish, and a bounded number of prompts
(packages/integration-tests/__tests__/observer-reverification.test.ts#L1-L36). Why the harness is
shaped that way: [Integration Test Harness](../testing/integration-harness.md).
