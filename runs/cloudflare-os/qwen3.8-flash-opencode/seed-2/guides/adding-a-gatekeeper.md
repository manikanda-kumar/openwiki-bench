---
type: change-guide
title: How to Add a Gatekeeper
description: End-to-end checklist for implementing a new gatekeeper Worker — API design review, the three-tier object implementation, nonce-safe OAuth connect, sessions with approval queue and simulation, types for agents, configurator UI, bindings, and local testing.
tags: [gatekeeper, guide, oauth, capability-design, worker]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-b5299fd53e769aa10dc532e0
    resource: repo://packages/configurator-ui/src/index.ts
  - id: openwiki-source-8c9bf5a84c0258d85f369973
    resource: repo://packages/integration-tests/README.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# How to Add a Gatekeeper

This guide operationalizes [Gatekeeper Framework](../gatekeepers/framework.md). The repository maintains its own authoritative procedure at `.agents/skills/write-gatekeeper/SKILL.md` — including the **review gates that say STOP** (present the Session API for human review before implementing; ask the operator before the security phase) — and a map of which existing package best exemplifies each mechanism. Read it before writing code; this page is the tour with source pointers.

## Decide the shape before touching code

1. **Pick granularities.** The three tiers are fixed: Vendor (`GatekeeperVendor` WorkerEntrypoint) → User (`GatekeeperUser` entrypoint with `ctx.props`) → Instance (`Gatekeeper<Session>` DO *facet* of the Overseer, per resource per gadget). What you choose is *which* `SupportedResource` urlPatterns (whole service / project / issue-style nesting — the skill warns against silly-granularities like "a single field") and what the session interface looks like. SKILL.md#L6-L14, #L20-L22.
2. **Design the Session API around capabilities.** Object-oriented: a session for *one* document/repo/channel, not a coarse API taking ids — fine-grained granting should follow from the structure. SKILL.md#L18.
3. **API review gate.** Getting the API right is "the most important and delicate part"; the process stops for operator review before implementation continues. SKILL.md#L18, #L63.

The canonical contracts (and their JSDoc obligations, e.g. the security requirements on returned URLs) are `packages/workshop-shared/src/gatekeeper.ts#L445-L1283`.

## Implement (phase 1)

Scaffold a new `packages/gatekeeper-<name>/` Worker mirroring an exemplar (github/google are the densest examples; zoominfo/spotify the simplest full OAuth ones; packages/gatekeeper-github/src/github.ts, packages/gatekeeper-google/src/google.ts):

- **`UserAccount` Durable Object** for the connected account: token storage/refresh/revocation.
- **Connect flow**: `GatekeeperVendor.connectAccount(callback, options)` returns a popup URL that **must include a cryptographic nonce** (besides the DO id) — replay defense — stored and verified in the flow DO, which sets a self-delete alarm on abandonment; the popup closes itself with `window.close()` and calls `callback.complete(userFetcher, expiresAt?)`. Copy gatekeeper-google's shape, cited as the reference implementation right in the contract docs (packages/workshop-shared/src/gatekeeper.ts#L460-L475). Honor the options: `scopes: "auth"` means a *transient* sign-in grant, and `resourceUrlPatterns: []` means *no* resource authorization (gatekeeper.ts#L429-L443).
- **Resource facets**: `getGatekeeperClassFor(url)` matches the URL against your `SupportedResource` patterns and returns the facet class with credentials in `ctx.props` — remember the Overseer calls this *before* any permission is granted, with `describe()` informing the user's choice (gatekeeper.ts#L580-L592).
- **Session discipline**: every read awaits `authorizeObservation` before returning data; every side effect calls `submitAction` and *only* acts on `applyAction` — never skip submission even if you'd auto-approve (gatekeeper.ts#L698-L737, #L810-L818). Declare `actionKind` tags and implement `getAutoApprovableActions()` only for kinds you'd safely auto-apply (gatekeeper.ts#L711-L719).
- **Types for the agent**: one `.d.ts` (complete JSDoc — this is what the agent reads via progressive discovery) shipped as a text module through `getTypeScriptTypes()`; facets can return a resource-narrowed subset (packages/gatekeeper-github/src/github.ts#L1040-L1041; gatekeeper.ts#L500-L515).
- **Configurator UI** (per resource type): either custom `iframeHtml` + narrow `ui` capability (`startResourceConfigurator`, gatekeeper.ts#L598-L604) or the shared route — `src/configurator/*-ui.tsx` using `@gadgets/configurator-ui` (type-only; remember configurators cannot import runtime helpers and must duplicate URL builders locally), compiled by the `build:configurator` task wired through the shared Vite+ config — SKILL.md#L112-L145; scripts/build-gatekeeper-configurator.ts; [Toolchain, Tasks, and Build Cache](../development/toolchain-and-builds.md).
- **Observer stubs are mandatory**: `getVerifier`/`addObserver`/`removeObserver` must exist to type-check; ship minimal versions in phase 1 and choose the real strategy (throw-always / per-unit ACL via a verifier non-standard method / observation-set tracking) in phase 2 — the exemplar-per-strategy map is in SKILL.md#L195-L296, and the mechanism is described in [Sharing and Observers](../backend/sharing-and-observers.md).

## Register (zero-code where possible)

Dev: `scripts/run-dev-server.ts` **discovers every `packages/gatekeeper-*` directory** and binds it as `GATEKEEPER_<NAME>` automatically, watching its generated UIs (scripts/run-dev-server.ts#L82-L107). Production: bindings are generated (`generate-wrangler-prod.js`, per packages/workshop-backend/wrangler.jsonc#L39-L43), and the router mounts the new connector at `/gatekeeper/<name>/*` purely from its own binding scan — **the OAuth callback lands there, not in the backend** (packages/router/src/index.ts#L1-L48). The Workshop's connector list comes from the backend's binding scan (auth-vendors) plus the account's `describe()`; admin enable/disable and auto-provisioning modes are configuration, not code (packages/workshop-backend/src/provisioning-policy.ts; [Admin Settings and Configuration](../operations/admin-and-configuration.md)).

## Phase 2 and testing

Caching (`SKILL.md#L166`), simulation (overlay-at-read-time exemplar: [gatekeeper-homeassistant](../gatekeepers/reference-connectors.md)), and observer strategies come next — they're the security-relevant half.

- **Unit tests**: a `test` task in the package's `vite.config.ts` (re-export `withTests` from `gatekeeper-configurator-vite-config.ts` if you have a configurator, else the plain default); logic heavy in `RpcTarget`/DOs should run under workerd like gatekeeper-cloudflare's second project ([Testing Approach](../development/testing.md)).
- **End-to-end**: the integration-test toolkit boots your Worker under `createTestHarness` with a `NetworkInterceptor` handler module mocking your vendor's endpoints — "point the harness at the package", never fork it — and its escape-assertion convention means *every* vendor call in your paths must have a handler (packages/integration-tests/README.md#L9-L24; docs/integration-testing.md#L44-L63).
- **By hand**: `pnpm dev-server` (or `pnpm run-local`), then connect the account from the Connectors page, bind the resource into a gadget, and check the approval queue surfaces your actions with the right descriptions and simulation.
