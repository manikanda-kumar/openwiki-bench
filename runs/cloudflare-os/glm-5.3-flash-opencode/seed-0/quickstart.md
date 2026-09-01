---
type: quickstart
title: Quickstart
description: A practical first hour with this repository — prerequisites, the local-run and dev-mode commands, build/test/lint, where the important code lives, and which wiki pages to read next.
tags: [quickstart, dev, commands, onboarding]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Quickstart

Cloudflare OS is a pnpm **monorepo of Cloudflare Workers packages** (pnpm-workspace.yaml:1-2). Prerequisites: Node.js and [pnpm](https://pnpm.io/). Nothing else is needed to run locally — wrangler/workerd, the Workers dev tooling, comes from the workspace's dev dependencies.

## Run it

Two ways, from the repo root:

```sh
pnpm run-local        # single-command production-shaped run on workerd via wrangler
# then open http://localhost:8787
```

`run-local` serves the pre-built frontend as static assets from the backend — the quickest way to see the product, but not for development (README.md:22-28, scripts/run-dev-server.ts:44-46).

For development, two terminals (README.md:239-245):

```sh
pnpm dev-server       # wrangler dev with all workers + generated gatekeeper bindings + watchers
pnpm dev-client       # the Vite dev server for the frontend
# then open http://localhost:3000
```

The dev pre-flight builds every gatekeeper's configurator/app UI before watchers spawn; a gatekeeper without the matching task (`build:configurator`/`build:app:dev`) won't be built here (scripts/run-dev-server.ts:255-285). Dev auto-login exists for the frontend: `VITE_DEV_AUTO_LOGIN=true` (plus optional `VITE_DEV_USERNAME`/`VITE_DEV_PASSWORD`) creates or logs into a dev account before React renders (packages/workshop-frontend/src/main.tsx:17-45).

## Build, test, lint

```sh
pnpm build        # type-check (tsgo) + codegen across all packages, cached per package by vp
pnpm test         # root scripts suite (node --test) + per-package cached vitest tasks
pnpm lint         # vp lint (oxlint) + scripts type-check + the full build
```

Useful variations (package.json:7-27):

- `pnpm --filter <package> test:run` — plain vitest for one package while iterating (faster than the cached path on a just-edited package; use `pnpm test` to verify).
- `node scripts/release/build-release.ts --out release-out` — build a full release locally (see [Release Pipeline](/openwiki/operations/release.md)).
- `pnpm preview:deploy` / `preview:sweep` — ephemeral preview deployments (CONTRIBUTING.md:18-24).

Watchdog note: test commands run under `scripts/with-timeout.ts` (idle 60 s / total 600 s → exit 124). If a run dies that way, suspect an OOM-killed workerd child first (AGENTS.md §testing, scripts/with-timeout.ts:1-28).

## Configure external services

<!-- openwiki: broken internal link [packages/gatekeeper-github/README.md] file "packages/gatekeeper-github/README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [packages/gatekeeper-google/README.md] file "packages/gatekeeper-google/README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [packages/gatekeeper-cloudflare/README.md] file "packages/gatekeeper-cloudflare/README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [packages/gatekeeper-homeassistant/README.md] file "packages/gatekeeper-homeassistant/README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
Gatekeepers need per-service credentials (OAuth client ids/secrets, tokens). Each package's README has the steps — e.g. [GitHub](packages/gatekeeper-github/README.md), [Google](packages/gatekeeper-google/README.md), [Cloudflare](packages/gatekeeper-cloudflare/README.md), [Home Assistant](packages/gatekeeper-homeassistant/README.md) (README.md:202-216).

## First tour of the code

Read in this order (see [Platform Architecture Overview](/openwiki/architecture/overview.md) for the map):

1. `packages/workshop-shared/src/api.ts` — the RPC contract between frontend and backend; every interface is documented.
2. `packages/workshop-backend/src/server.ts` — the worker entrypoint: fetch handler, `PublicApiImpl`/`AuthenticatedApiImpl`.
3. `packages/workshop-backend/src/overseer.ts` — the workspace kernel (large; start at `OverseerImpl` and `OverseerDurableObject`).
4. `packages/workshop-frontend/src/main.tsx` — the SPA entry and WebSocket connection lifecycle.
5. `packages/router/src/index.ts` — the tiny public-origin router.

Contributions: the project is **not seeking outside contribution** at present beyond small, trivially-verifiable fixes; see CONTRIBUTING.md:1-16 before planning work.

## Where to go next

- [Platform Architecture Overview](/openwiki/architecture/overview.md)
- [Cap'n Web RPC Protocol and API Surface](/openwiki/architecture/rpc-protocol.md)
- [Build System and Dev Server](/openwiki/operations/build-and-dev.md)
- [Testing Strategy](/openwiki/operations/testing.md)
