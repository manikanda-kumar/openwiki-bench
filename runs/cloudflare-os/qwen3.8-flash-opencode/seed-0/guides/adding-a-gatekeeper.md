---
type: guide
title: "Change Guide: Adding a Gatekeeper"
description: Step-by-step walkthrough for shipping a new gatekeeper Worker — package skeleton, the Vendor/User/Instance trio, OAuth and resource configurators, optional auto-provisioning, router and backend wiring as pure binding changes, deploy inputs, and tests — grounded in the existing gatekeeper-github package.
tags: [guide, gatekeeper, oauth, workers, bindings]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-7ebd3fe59ef5e6c4ca3515db
    resource: repo://packages/gatekeeper-github/deploy-inputs.json
  - id: openwiki-source-72eae9e0de338dc23afbc739
    resource: repo://packages/gatekeeper-github/package.json
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-09a2095f5d673475622a5a25
    resource: repo://packages/gatekeeper-github/wrangler.jsonc
  - id: openwiki-source-87db9394464b0c1aaacbf04b
    resource: repo://packages/integration-tests/src/harness.ts
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Change Guide: Adding a Gatekeeper

A gatekeeper is a standalone Cloudflare Worker mediating all access between gadgets/agents and one external service. This repo ships a maintained skill for it — `.agents/skills/write-gatekeeper/SKILL.md` — which frames the work as a three-tier hierarchy (Vendor → User → per-binding Instance) with seven responsibilities: auth, capability-shaped API design, fine-grained resource granting, logging/approvals, caching, simulation, and observer verification. **It mandates designing the Session API first and pausing for human review before implementing the rest** (SKILL.md "Seven responsibilities" item 2). Read `packages/workshop-shared/src/gatekeeper.ts` alongside — the interfaces' JSDoc is the canonical contract (see [RPC Contract](/openwiki/architecture/rpc-contract.md)).

Everything below is what `packages/gatekeeper-github/` does today; use it as the template (or `gatekeeper-supabase` if your service needs no OAuth of its own).

## 1. Package skeleton

Copy the github package's shape:

- **`package.json`** — deps `@gadgets/backend-utils`, `@gadgets/configurator-ui`, `@gadgets/workshop-shared`, `capnweb`, `capnweb-validate` (catalog); `deploy` = `vp run --no-cache build:configurator && wrangler deploy`; `clean` removes `src/generated` (packages/gatekeeper-github/package.json:8-16).
- **`wrangler.jsonc`** — `main` points at the capnweb-validate output (`.wrangler/validate/src/<x>.ts`) with `build.command` = `pnpm exec capnweb-validate build --out .wrangler/validate`; `Text` rules for `**/*.txt`/`**/*.svg` (types and generated configurator HTML are bundled as text modules); DO migrations for your `UserAccount` and instance classes (packages/gatekeeper-github/wrangler.jsonc:3-19).
- **`vite.config.ts`** — re-export the shared task config: `withTests` from `scripts/gatekeeper-configurator-vite-config.ts` if you have tests (you get `build:configurator` + `test` tasks with the env declarations), or its default if you don't, because `vitest run` exits 1 with no test files.
- **`worker-configuration.d.ts`** via `pnpm types:generate`, never hand-edited.

## 2. The three-tier implementation (in `src/`)

1. **Vendor** — `export class GatekeeperVendor extends WorkerEntrypoint implements GatekeeperVendorIface` with `describe()` (VendorDescription), `getSupportedResources()` (URLPattern entries), `getTypeScriptTypes()` returning your `.d.ts`/`types.txt` source — the Workshop parses that into the agent's progressive type database (packages/gatekeeper-github/src/github.ts:1007-1045; contract docs at packages/workshop-shared/src/gatekeeper.ts:490-505).
2. **OAuth + account** — `connectAccount(callback, options)` starts the flow against a `UserAccount` Durable Object, which stores the callback and requested scopes and returns the authorize URL. Honor the contract's security rules: a **cryptographic nonce** in the URL ("see gatekeeper-google for a reference implementation", packages/workshop-shared/src/gatekeeper.ts:460-464), `"auth"`-scope mode requesting only email-verification scopes as a transient grant (github splits `AUTH_SCOPES`/`OAUTH_SCOPES` at packages/gatekeeper-github/src/github.ts:1026-1029), and `[]` vs omitted `resourceUrlPatterns` meaning none vs all. Tokens live only in the account DO; `getAuthenticatedEmail()` backs sign-in (packages/workshop-shared/src/gatekeeper.ts:567+).
3. **User** — a `GatekeeperUser` entrypoint per connected account whose `getGatekeeperClassFor(url)` parses the resource URL and returns `{class: this.ctx.exports.GitHubGatekeeperImpl({ props }), resource}` — a `DurableObjectClass` **with baked props**, which the core installs as an Overseer facet (packages/gatekeeper-github/src/github.ts:1232-1269; installation side at packages/workshop-backend/src/overseer.ts:4259-4269). The user also mints `GatekeeperUserVerifier`s (`getVerifier`) once you implement observer checks.
4. **Instance** — `Gatekeeper<Session>`: `describe()` the specific resource, `getTypeScriptTypes()` narrowed to this resource kind, `getAutoApprovableActions()`, and `startSession(approvalQueue)` returning your capability-shaped session: **every read calls `authorizeObservation()` before data returns; every side effect goes through `submitAction()` and performs nothing until `applyAction()`** (packages/workshop-shared/src/gatekeeper.ts:716-740, 855-880). Design the API per-resource (a repo object, not `callApi(repoId, ...)`), and simulate pending actions so agents can queue work ahead of approval (SKILL.md items 3, 4, 6).

## 3. Resource configurator UI (optional)

If users shouldn't hand-type URLs, ship one UI per resource kind: `src/configurator/<kind>-configurator-ui.tsx` + a colocated `types.d.ts`, and `startResourceConfigurator(urlPattern)` returning `{ iframeHtml, ui }` frames keyed by pattern (packages/gatekeeper-github/src/github.ts:1271-1300; frame types at packages/workshop-shared/src/gatekeeper.ts:348-430). `scripts/build-gatekeeper-configurator.ts` transpiles each file **per-file, stripping only `@gadgets/configurator-ui` and type-only imports** — so configurator files cannot import runtime helpers; duplicated logic (like GitHub's URL-pattern parsing in `src/github-configurators.ts`) must be kept in step by a dedicated test (github's `__tests__/configurator-url.test.ts`; root guidance in the kernel package notes).

## 4. Auto-provisioning (optional, no-OAuth singletons)

Set `VendorDescription.autoProvisionsAccount` and implement `createAccount()` — which must take **no arguments and no user identity** (packages/workshop-shared/src/gatekeeper.ts:505-524). The account then declares in `AccountDescription` whether it provides an agent `singleton` (a `tsType`) and/or a `providesUi` management page (hosted automatically at `/gatekeepers/<vendorId>` via `startAppUi`). The Workshop, not the gatekeeper, decides ambience: admins pick disabled/optional/enabled per vendor, default **optional**, resolved only through `packages/workshop-backend/src/provisioning-policy.ts:1-26` (see [Configuration and Admin Settings](/openwiki/operations/configuration-and-admin.md)). Don't implement this in a gatekeeper that also runs OAuth flows for user-chosen resources — look at `gatekeeper-context`/`gatekeeper-scheduler` instead (see [Context Library and Scheduler](/openwiki/integrations/context-library-scheduler.md)).

## 5. Wiring an instance: bindings, not code

- **Backend:** add a `GATEKEEPER_<NAME>` service binding; the vendor id is the suffix lowercased (`buildGatekeeperVendorMap`, packages/workshop-backend/src/auth/auth-vendors.ts:1-35). In local dev `scripts/run-dev-server.ts` synthesizes these bindings and seeds each gatekeeper's `CLIENT_ID`/`CLIENT_SECRET` from shared shell vars (scripts/run-dev-server.ts:320-412).
- **Router:** nothing. `/gatekeeper/<name>/*` is discovered from the router worker's own `GATEKEEPER_*` bindings (packages/router/src/index.ts:1-35), and the OAuth redirect therefore lands at `/gatekeeper/<name>/oauth` on your worker — set your vendor app's redirect URI accordingly.
- **Deploy wizard:** add `deploy-inputs.json` describing what the installer must provide. Github's is the canonical OAuth shape: a `CLIENT_ID` secret with `consoleUrl`, `setupSteps`, and `redirectUriTemplate: "{PUBLIC_BASE_URL}/gatekeeper/github/oauth"`, plus `CLIENT_SECRET` (packages/gatekeeper-github/deploy-inputs.json:1-19). If your connector takes *no* third-party OAuth credentials, add its package dir to `NO_DEFAULT_CRED_INPUTS` in scripts/release/manifest-lib.ts:258-262 — otherwise the wizard blocks Install on empty secret fields and your gatekeeper becomes uninstallable.
- **Sign-in (optional):** advertise `providesAuth` and return only provider-verified emails; deployments opt you in via `AUTH_GATEKEEPERS` (packages/workshop-backend/src/auth/config.ts:8-20; docs/oauth-signin.md).
- **Docs:** add `packages/<pkg>/README.md` (the root README enumerates one per connector) and record the storage schema the way github's `storage-schema.md` does.

## 6. Tests and gates

Unit tests live in `__tests__/` under the package's vitest config; anything touching `RpcTarget`/`RpcStub`/DO props should run in the workerd pool with `scripts/assert-workerd.ts` in `setupFiles` (pattern: gatekeeper-cloudflare's two configs — see [Testing Strategy](/openwiki/development/testing.md)). For end-to-end coverage, the integration toolkit is parameterised for exactly this: point `startTestGatekeeperHarness({gatekeepers})` at your package and add a handler module to the `NetworkInterceptor` — no forked harness (packages/integration-tests/src/harness.ts:1-10; docs/integration-testing.md:60-65). Before pushing: `vp run -F <pkg> build` and `pnpm lint`.

## Pitfalls checklist

- [ ] Session API reviewed by a human before implementation (SKILL.md item 2).
- [ ] OAuth URL carries a nonce; expired/denied states surface as thrown errors with distinguishing reason text (the overseer treats every failure as repairable).
- [ ] No action executes before `applyAction`; observations authorized before data returns; `getAgentCatalog`/slash-command expansions authorize too.
- [ ] Configurator UI files import nothing runtime from the package (build strips only types).
- [ ] `deploy-inputs.json` matches what the wizard needs; `NO_DEFAULT_CRED_INPUTS` set if no OAuth app.
- [ ] A gatekeeper never asserts its own ambience — provisioning stays the admin's per-deployment decision.
