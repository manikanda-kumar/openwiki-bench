---
type: guide
title: How to Add a Gatekeeper
description: Change guide for implementing a new gatekeeper worker — required RPC interfaces, OAuth connect flow with nonce, approval queue and simulation contract, typed API surface for agents, configurator UI constraints, bindings, deploy inputs, and tests.
tags: [guide, gatekeeper, oauth, approval-queue, capability-security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-7ebd3fe59ef5e6c4ca3515db
    resource: repo://packages/gatekeeper-github/deploy-inputs.json
  - id: openwiki-source-88243db28171e95373cbab1f
    resource: repo://packages/gatekeeper-linear/src/configurator/linear-issue-configurator-ui.tsx
  - id: openwiki-source-f98048dcc7d3d0a56b429f3c
    resource: repo://packages/gatekeeper-linear/src/linear.ts
  - id: openwiki-source-af335db21b74a83160e2452e
    resource: repo://packages/gatekeeper-linear/wrangler.jsonc
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# How to Add a Gatekeeper

A gatekeeper is an independent Cloudflare Worker (its own `packages/gatekeeper-<name>/` with
`wrangler.jsonc`) exposing the RPC contract in `@gadgets/workshop-shared/gatekeeper`. The repo's
`write-gatekeeper` skill (`.agents/skills/write-gatekeeper/SKILL.md`) prescribes seven
responsibilities and a review-gated phase order — design the session types and stop for API review
before implementing (SKILL.md#L16-L70). `packages/gatekeeper-linear` (~3.7k lines total) is the
smallest complete OAuth connector and a good template
(packages/gatekeeper-linear/src/linear.ts).

## The interfaces you must implement

1. **`GatekeeperVendor extends WorkerEntrypoint`** — the binding entrypoint named exactly
   `GatekeeperVendor` (packages/gatekeeper-linear/src/linear.ts#L480):
   `describe()` (display metadata), `connectAccount(callback, options)` → OAuth URL,
   `getSupportedResources()`, and `getTypeScriptTypes()` returning a `.d.ts` source string the
   Workshop parses for the agent's type database
   (packages/workshop-shared/src/gatekeeper.ts#L445-L522). Vendors that can mint accounts without
   OAuth add `createAccount()` (no arguments, no user identity) plus
   `VendorDescription.autoProvisionsAccount` (gatekeeper.ts#L514-L522).
2. **A `UserAccount` Durable Object** — owns the OAuth grant, refresh, and expiry
   (linear.ts#L514-L518).
3. **`GatekeeperUser`** — a `WorkerEntrypoint` viewing the account (e.g. `GatekeeperUserImpl`,
   linear.ts#L679), plus a `GatekeeperUserVerifier` for privileged account ops (linear.ts#L850).
4. **`Gatekeeper<Session> extends DurableObject`** — one resource facet per binding, whose
   `startSession(approvalQueue)` hands the gadget the session capability
   (packages/workshop-shared/src/gatekeeper.ts#L698-L745; example linear.ts#L951).

## Connect-flow security requirements

`connectAccount` must return a URL that includes a **cryptographic nonce** in addition to the DO id
(replay prevention; gatekeeper-google is the reference), store the callback in the DO, and set an
alarm to self-delete if the flow is abandoned (packages/workshop-shared/src/gatekeeper.ts#L458-L464).
The OAuth redirect lands on the gatekeeper worker itself at `/gatekeeper/<name>/oauth` — the
backend hosts no auth callbacks (packages/gatekeeper-github/deploy-inputs.json#L14,
packages/router/src/index.ts#L41-L43; linear's own `fetch` handles `/oauth` at
packages/gatekeeper-linear/src/linear.ts#L439).

Scope semantics are load-bearing: `options.scopes: "auth"` is a *transient* grant used only to
verify an email for sign-in and must be discarded after `complete()`;
`options.resourceUrlPatterns` treats **omitted** ("all types") as distinct from **`[]`** ("none") —
collapsing them silently over-requests access the user was never shown a reason for
(packages/workshop-shared/src/gatekeeper.ts#L464-L480).

## The session and approval contract

Every operation through the session must go through the `ApprovalQueue`: reads are observations
that must be authorized via `authorizeObservation()` before data returns; side effects are
`submitAction()`-ed and *not performed until approved*, which is fully asynchronous — approval may
come hours later (packages/workshop-shared/src/gatekeeper.ts#L953-L972).
The author's judgement is encoded per action: `autoApprovable` gates whether a matching user
auto-approval rule can ever apply, `actionKind.tag` is the stable policy key surfaced pre-approval
by `getAutoApprovableActions()`, `implementsRevert` tells the UI whether revert is offered, and
`awaitDecision` suspends the agent turn for actions whose effects are *not* simulated
(packages/workshop-shared/src/gatekeeper.ts#L1129-L1215, L713-L722).
Simulation — making reads reflect queued-but-unapproved actions — is recommended but explicitly
left to the author (packages/workshop-shared/src/gatekeeper.ts#L734-L741; linear uses provisional
ids like `~<n>` for simulated creates, linear.ts#L985-L993).

## Observer verification

`addObserver(id)` must re-verify that a newly-shared-with user could *directly* read everything
this gatekeeper has already observed through the binding, throwing otherwise; future
observations that such an observer must not see are blocked via
`ObservationDescription.excludeObservers`, and `prohibitAllSharing` triggers the overseer's
lockdown semantics (packages/workshop-shared/src/gatekeeper.ts#L756-L800, L1081-L1116;
strategy guidance in `.agents/skills/write-gatekeeper/SKILL.md` Phase 2).

## Configurator UI (resource selection)

Resource-selection forms live in `src/configurator/<x>-configurator-ui.tsx` modules exporting a
`ConfiguratorUISpec` (initial values, `isReady`, `initialValuesFromResourceUrl` for prefilling
from a known URL, and an autocomplete render)
(packages/gatekeeper-linear/src/configurator/linear-issue-configurator-ui.tsx#L1-L20).
They are compiled by `scripts/build-gatekeeper-configurator.ts` using the *standalone TypeScript
6.x transpiler API* — each file is transpiled per-file with only `@gadgets/configurator-ui` and
type-only imports stripped, so configurators cannot import runtime helpers from elsewhere in the
package (scripts/build-gatekeeper-configurator.ts#L1-L24; the type-only `@gadgets/configurator-ui`
package supplies the component helpers, e.g.
packages/gatekeeper-linear/src/configurator/linear-issue-configurator-ui.tsx#L1). Output lands in
`src/generated/*.txt` and is imported as strings (linear.ts#L64-L66). Packages with configurators
declare a `build:configurator` task so `pnpm build` and `pnpm dev-server` compile them
(scripts/run-dev-server.ts#L252-L257).

## Wiring into a deployment

- **Dev**: `scripts/run-dev-server.ts` *discovers* every `packages/gatekeeper-*` directory and
  generates `GATEKEEPER_<NAME>` service bindings into dev wrangler configs — creating the package
  is most of the wiring (scripts/run-dev-server.ts#L82-L104, L383-L404).
- **Production**: the same names are injected by the release generator
  (packages/workshop-backend/wrangler.jsonc#L41-L44), and the router routes
  `/gatekeeper/<name>/*` purely by scanning its own `GATEKEEPER_*` bindings — no per-gatekeeper
  code anywhere in the router (packages/router/src/index.ts#L1-L35).
- **Deploy wizard inputs**: an installable gatekeeper's user-supplied inputs default to OAuth
  `CLIENT_ID`/`CLIENT_SECRET` secrets; a per-package `deploy-inputs.json` overrides them with
  labels, setup steps, and a `redirectUriTemplate`
  (packages/gatekeeper-github/deploy-inputs.json#L1-L20). `NO_DEFAULT_CRED_INPUTS` lists the
  installable gatekeepers that take **no** third-party OAuth app credentials (context,
  homeassistant, scheduler, and the two MCP connectors) so they don't get a spurious
  `CLIENT_ID`/`CLIENT_SECRET` input pair; a wrong default would demand secrets the vendor can
  never use (scripts/release/manifest-lib.ts#L258-L266, L444-L446).
- **Auto-provisioning vendors** are governed by the three-state ambient mode (default
  **optional**, never forced without an admin decision) resolved in
  `packages/workshop-backend/src/provisioning-policy.ts#L1-L34`.

## Validation, logging, and tests

The worker's `main` is the `capnweb-validate build` output wrapping `src/<name>.ts`, so the
generated runtime validators run in front of every RPC method
(packages/gatekeeper-linear/wrangler.jsonc#L3-L5); mark genuinely opaque methods with
`@skipRpcValidation()`. Logging uses `createLogger<Fields>({ component: "gatekeeper.<name>",
vendorId: VENDOR_ID })` from `@gadgets/backend-utils/logger` with concrete event names
(packages/gatekeeper-linear/src/observability.ts; linear.ts#L79-L80). Credential-expiry is
*pushed* to the Workshop: on an auth-classified API error, report expiry through the account and
surface a reconnect hint (packages/gatekeeper-linear/src/linear.ts#L686-L703). Tests are per
package — e.g. pure-logic suites like `packages/gatekeeper-github/__tests__/github-api.test.ts` —
run through the shared cached `test` task; see
[Testing and Build Tooling](../testing/testing-and-tooling.md).

Related: [Gatekeeper Framework](../security/gatekeeper-framework.md),
[Capability Security Model](../security/capability-security-model.md),
[MCP Connectors](../integrations/mcp-connectors.md).
