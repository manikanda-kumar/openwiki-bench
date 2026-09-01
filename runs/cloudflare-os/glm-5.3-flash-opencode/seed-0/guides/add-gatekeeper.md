---
type: change-guide
title: "Change Guide: Adding a Gatekeeper"
description: A step-by-step guide to adding a new gatekeeper package — vendor and account Durable Objects, the configurator UI, wrangler migrations and bindings, router/backend discovery by GATEKEEPER_* naming, deploy inputs, and the optional auto-provisioning and singleton/UI declarations.
tags: [guide, gatekeepers, wrangler, configurator, deploy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-7ebd3fe59ef5e6c4ca3515db
    resource: repo://packages/gatekeeper-github/deploy-inputs.json
  - id: openwiki-source-72eae9e0de338dc23afbc739
    resource: repo://packages/gatekeeper-github/package.json
  - id: openwiki-source-62efcf35f0a9b6853c00e45f
    resource: repo://packages/gatekeeper-github/vite.config.ts
  - id: openwiki-source-09a2095f5d673475622a5a25
    resource: repo://packages/gatekeeper-github/wrangler.jsonc
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-3ead0cf37cd6ff5300a12e93
    resource: repo://scripts/gatekeeper-configurator-vite-config.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Change Guide: Adding a Gatekeeper

This guide distills how the shipped gatekeepers are wired. Every gatekeeper is its own Worker package under `packages/gatekeeper-*`; the backend and router discover it purely from a `GATEKEEPER_<NAME>` service binding, whose suffix lowercased is the vendor id (`GATEKEEPER_GOOGLE` → `"google"`) (packages/workshop-backend/src/auth/auth-vendors.ts:1-18, packages/router/src/index.ts:1-45).

## 1. Create the package

Model it on an existing connector (e.g. `packages/gatekeeper-github`):

- `package.json` with `main` pointing at the vendor entrypoint source, and no `build` script — builds are **Vite+ tasks**, not scripts (packages/gatekeeper-github/package.json:1-24).
- `wrangler.jsonc` with:
  - `main: ".wrangler/validate/src/<entrypoint>.ts"` and a `build.command` of `pnpm exec capnweb-validate build --out .wrangler/validate` — the deployed module is the validated transform (packages/gatekeeper-github/wrangler.jsonc:2-7).
  - `compatibility_flags: ["allow_irrevocable_stub_storage", "nodejs_als"]` (stubs stored in DO props, and the observability context's async-hooks requirement).
  - `migrations` declaring your SQLite-backed Durable Object classes (e.g. `UserAccount`, the gatekeeper DO) (packages/gatekeeper-github/wrangler.jsonc:11-15).
  - A `rules` entry mapping `**/*.txt`/`**/*.svg` to Text modules (types files and logos are imported as strings) (packages/gatekeeper-github/wrangler.jsonc:8-10).

## 2. Implement the contract

In `workshop-shared/src/gatekeeper.ts` terms (see [Gatekeeper Contract](/openwiki/gatekeepers/contract.md)):

- **`GatekeeperVendor`** entrypoint: `describe()` (with `providesAuth`/`autoProvisionsAccount` as appropriate), `connectAccount()` (nonce-protected OAuth URL + a flow DO storing the callback), `getSupportedResources()`, `getTypeScriptTypes()` (the `.d.ts` the agent reads).
- **Account DO** (`GatekeeperUser`): holds credentials, serves `getGatekeeperClassFor(url)` (class imbued via `ctx.props` with credentials + resource), `startResourceConfigurator`, `revoke()`, `reconnect()`, and optionally `getAuthenticatedEmail()` (provider-verified email only).
- **Resource DOs** implementing `Gatekeeper<Session>`: `startSession(approvalQueue)` with observation/action semantics, `applyAction`/`rejectAction`/`revertAction`, and `addObserver`.

## 3. Configurator UI (optional but standard)

If the vendor offers resource granularities, add `src/configurator/` modules and re-export the shared Vite+ config from your `vite.config.ts` — `export { withTests as default } from '../../scripts/gatekeeper-configurator-vite-config.js'` (with tests) or its default (without) (packages/gatekeeper-github/vite.config.ts:1-3, scripts/gatekeeper-configurator-vite-config.ts:1-13). Key constraints:

- The configurator transpiler strips only `@gadgets/configurator-ui` and type-only imports, so configurator files **cannot import runtime helpers** — they must duplicate the resource-URL grammar rather than import it, and the copy is kept in step by a test (AGENTS.md, packages/gatekeeper-cloudflare `__tests__/configurator-url.test.ts`).
- `build:configurator` is a task (not a script) so `VITE_FRONTEND_ERROR_REPORTING` can be declared and fingerprinted; a cache hit restores archived outputs without deleting, so the `clean:error-reporting-artifacts` task runs uncached first (scripts/gatekeeper-configurator-vite-config.ts:7-40).

## 4. Declare auto-provisioning or UI (optional)

- An account that should exist for users with no OAuth flow: set `VendorDescription.autoProvisionsAccount` and implement `createAccount()` (no user identity argument; it only ever creates) (packages/workshop-shared/src/gatekeeper.ts:514-522). See `gatekeeper-context`/`gatekeeper-scheduler` as references (packages/gatekeeper-context/src/library-gatekeeper.ts:388-391).
- An agent singleton: `AccountDescription.singleton: { tsType }` and `getSingletonGatekeeperClass()`; a management app: `providesUi` and `startAppUi({isAdmin})`, hosted at `/gatekeepers/$appId` (packages/workshop-shared/src/gatekeeper.ts:644-668).
- Note the deployment admin then picks the per-vendor mode (`disabled`/`optional`/`enabled`) in the admin Gatekeepers panel; `optional` is the default (packages/workshop-backend/src/provisioning-policy.ts:8-20).

## 5. Binding name and discovery

Nothing in the router or backend changes to admit your gatekeeper: it is found by scanning `GATEKEEPER_*` env keys (router: `/gatekeeper/<kebab-name>/*`; backend: `buildGatekeeperVendorMap`) (packages/router/src/index.ts:28-36, packages/workshop-backend/src/auth/auth-vendors.ts:25-36). In dev, `run-dev-server.ts` generates the binding from the package name (`gatekeeper-github` → `GATEKEEPER_GITHUB`) (scripts/run-dev-server.ts:323+).

## 6. Deploy inputs

Create `deploy-inputs.json` only if your gatekeeper takes user-supplied inputs; each entry becomes a pass-through secret in the release manifest. Omitting the file defaults to `CLIENT_ID`/`CLIENT_SECRET` secret inputs — if your gatekeeper takes **no** third-party OAuth app credentials (auto-provisioned gatekeepers, LLAT-style connectors, dynamic-client-registration MCP), you must also add its package name to `NO_DEFAULT_CRED_INPUTS` in `scripts/release/manifest-lib.ts`, because the deploy wizard blocks Install on unfilled secret inputs and a spurious default would make your gatekeeper uninstallable (packages/gatekeeper-github/deploy-inputs.json:1-17, scripts/release/manifest-lib.ts:259-266, 443-447).

Also check `NOT_INSTALLABLE` in the same file if your gatekeeper cannot run on workers.dev-hosted customer instances (e.g. email needs a zone) (scripts/release/manifest-lib.ts:268-270).

## 7. Verify

- `pnpm build` (type-check + codegen across the workspace) and `pnpm test`.
- `pnpm dev-server` should list your connector in the Connectors page; its app/configurator builds must be produced by the dev pre-flight, which requires your package to declare the relevant task (`build:configurator` and/or `build:app`) (AGENTS.md, packages/gatekeeper-context/vite.config.ts:30-54).
- Add tests mirroring a sibling package's `vitest.config.ts`; packages with no test files re-export the no-test variant of the shared config so `vitest run` doesn't exit 1 on an empty suite (scripts/gatekeeper-configurator-vite-config.ts:1-13).

## Related pages

- [Gatekeeper Contract](/openwiki/gatekeepers/contract.md)
- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md)
- [Build System and Dev Server](/openwiki/operations/build-and-dev.md)
