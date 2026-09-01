---
type: "Reference"
title: "Quickstart: running and developing Cloudflare OS"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-1747f35368fa9373cdf18ef2
    resource: repo://scripts/dev-server-config.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Quickstart: running and developing Cloudflare OS

## Prerequisites

[Install pnpm](https://pnpm.io/). The repo pins its toolchain through `packageManager` and the
Vite+ (`vp`) task runner, which resolves its own Node/pnpm versions — you do not need a separate
Node setup step beyond Corepack-compatible pnpm. The repo is a pnpm workspace; **always use pnpm,
never npm**.

## Try it in one command

```
pnpm run-local
```

Then visit **http://localhost:8787** (`README.md:20-28`). This:

1. installs dependencies (if needed),
2. builds only what's needed to *run* — `@gadgets/typed-storage` (the backend imports its built
   `dist`) and the frontend bundle (`vite build` → `packages/workshop-frontend/dist`),
3. launches `scripts/run-dev-server.ts --serve-frontend-assets`, which starts all workers under
   `wrangler dev` with the backend serving the pre-built SPA (`scripts/run-local.ts:1-57`).

Data is stored in the `.wrangler` subdirectory. This mode is for trying the product, not
production.

Things to try (from the README): make slides ("Make slides for my upcoming meeting" — uses a
bundled format blueprint), build a whiteboard or tic-tac-toe app, or attach external resources to
the agent once integrations are configured.

## Two-terminal development

```
pnpm dev-server     # terminal 1
pnpm dev-client     # terminal 2
```

Then visit **http://localhost:3000** (`README.md:220-227`). `dev-server` generates dev-only
`wrangler.dev.jsonc` configs (discovering every `packages/gatekeeper-*` and binding it to the
backend and router), runs the pre-flight builds, and starts one multi-config `wrangler dev`;
`dev-client` runs the Vite dev server on port 3000. In this mode the frontend talks to
`VITE_BACKEND_HOST` (default `localhost:8787`); an explicit `--port N` wins over the env var
(`scripts/dev-server-config.ts:32-60`). Note that Vite's HMR socket doesn't survive wrangler
restarts, which is why dev mode doesn't proxy the frontend through the backend.

Dev conveniences (all optional):

- A root `.dev.vars` file (gitignored, `KEY=VALUE` lines) is loaded automatically; shell env wins
  over it (`run-dev-server.ts:42-62`).
- `ADMINS=["admin"]` is set in dev, so an account named `admin` gets the admin panel.
- `VITE_DEV_AUTO_LOGIN=true` in the frontend auto-creates/logs into a dev account so the login page
  never appears (`main.tsx:33-58`).
- Optional features (gatekeeper sign-in, AI Gateway free tier/billing) are configured through env
  vars — see `docs/public-server.md` for the full list and `.dev.vars` example; OAuth client
  credentials for the gatekeepers are seeded from `GITHUB_*`/`GOOGLE_*`/`CLOUDFLARE_OAUTH_*` shell
  vars (`run-dev-server.ts:409-420`).
- `pnpm dev-server -- --use-workers-ai-binding` adds a `WORKERS_AI` binding (requires Cloudflare
  login) needed for webFetch's document conversion and the gateway binding transport.

## Build, test, lint

- `pnpm build` — codegen (format blueprints, configurator UIs, gatekeeper SPA bundles) plus the
  repo's **single type check** (recursive `tsc` under TypeScript 7). Almost every package is
  `noEmit`; wrangler and vite bundle from source. A re-run with nothing changed replays from the
  Vite+ task cache (`pnpm types:check` is an alias).
- `pnpm test` — the root `node --test` scripts suite, then per-package vitest suites (Node and
  workerd pools; see [test layout](/openwiki/testing/test-layout.md)).
- `pnpm lint` — `lint:check` (oxlint via `vp lint`), `types:scripts` (tsc for `scripts/`), and
  `types:check`. Run this before pushing; it's what CI enforces.

CI runs lint + build + test on every PR; **preview deployments are deliberately skipped on fork
PRs** because GitHub withholds secrets from `pull_request` runs whose head is a fork
(`CONTRIBUTING.md:13-23`).

## Configuration and deployments

- Local: root `.dev.vars` (gitignored). See `docs/public-server.md` for the multi-user/sign-in
  configuration matrix and `docs/ai-gateway-billing.md` for the optional usage-limit flow.
- Deploy to your Cloudflare account: https://os.cloudflare.app/deploy, or the deployment starter
  repo for customizations (`README.md:172-182`).
- The scripted path for customer-style deployments is the release pipeline in `scripts/release/`
  (manifest + R2 upload/promote) — see
  [build & release](/openwiki/operations/build-release.md).
- **Uncertain / coming soon**: running on your own server atop open-source `workerd` is documented
  in the README as "COMING SOON" — the README says `workerd` can host the system and that run-local
  uses it under the hood, but no supported tooling ships in this repo for standalone workerd
  deployment yet (`README.md:196-200`).

## Where to read next

- [System architecture](/openwiki/architecture/system-overview.md) — the kernel/shell/drivers map.
- [The RPC protocol](/openwiki/architecture/rpc-protocol.md) — conventions every change touches.
- [Change guides](/openwiki/change-guides/common-tasks.md) — adding a gatekeeper, an API method, a
  tool, an admin setting, or a format blueprint.
- [Security invariants](/openwiki/security/invariants.md) — what reviewers will reject.
