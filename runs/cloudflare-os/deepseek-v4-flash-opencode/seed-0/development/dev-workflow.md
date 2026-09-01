---
type: guide
title: Development workflow and build system
description: The development environment and build system — the Vite+ task runner and its caching, the dev server generation logic, the frontend dev client, lint/type-check commands, and the noEmit build model.
tags: [development, build, vite-plus, tasks, dev-server]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-30239eee070a503c224c24f6
    resource: repo://packages/workshop-backend/package.json
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-1747f35368fa9373cdf18ef2
    resource: repo://scripts/dev-server-config.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Development workflow and build system

This page covers how to run the repo locally and how the build system works. The verification loop is
`pnpm build` (type-check + codegen), `pnpm lint`, and `pnpm test`; see the testing page for the test
infrastructure.

## Two ways to run locally

- **`pnpm run-local`** (`scripts/run-local.ts`) — a single command that installs deps, builds only
  what's needed to *run* (`@gadgets/typed-storage` and the frontend bundle), then starts
  `run-dev-server.ts --serve-frontend-assets`, which serves the built frontend as static assets on the
  backend. Visit `http://localhost:8787`. Data persists under `.wrangler`.
- **`pnpm dev-server` + `pnpm dev-client`** — the two-runner development setup: `pnpm dev-server` runs
  `wrangler dev` with every worker (the dev router, the backend, and every gatekeeper package), and
  `pnpm dev-client` runs the Vite dev server on `:3000` (with proxies for `/api/client-errors`,
  `/blueprint-screenshot`, `/api/site-logo`). In normal dev mode there is no `ASSETS` binding on the
  dev router, so frontend requests fall through to the backend; you open `localhost:3000` directly.
  `VITE_BACKEND_HOST` (default `localhost:8787`) selects the backend; `--port` overrides it
  (`scripts/dev-server-config.ts`).

### What `pnpm dev-server` generates

`scripts/run-dev-server.ts`:

1. Loads a root `.dev.vars` file (`KEY=VALUE`, gitignored) into the environment, with existing shell
   values winning.
2. **Discovers gatekeeper packages** by scanning `packages/gatekeeper-*` for a `wrangler.jsonc`.
3. Runs a **pre-flight build** of the generated code wrangler needs: the backend's format-blueprint
   module, every gatekeeper's configurator UI (`vp run -r --cache build:configurator --dev`), and
   every gatekeeper's app UI (`build:app:dev`, unminified so it matches what the watchers will write).
4. Writes dev `wrangler.dev.jsonc` files: the root dev router gets `GATEKEEPER_*` service bindings for
   every gatekeeper; each gatekeeper gets its `BASE_URL` and (for OAuth gatekeepers) `CLIENT_ID`/
   `CLIENT_SECRET` seeded from shared shell vars (`GITHUB_CLIENT_ID`, `GOOGLE_CLIENT_ID`,
   `CLOUDFLARE_OAUTH_CLIENT_ID`, ...); the backend gets an `ADMINS: ["admin"]` var (so local admin
   features are testable), the `GATEKEEPER_*` bindings with `entrypoint: "GatekeeperVendor"` (the
   Context gatekeeper's binding gets `sharingDomain: "dev"`), optional feature vars passed through
   (`AUTH_GATEKEEPERS`, `ENABLE_CLOUDFLARE_LIMITS`, `CF_AI_GATEWAY*`, ...), and — with
   `--use-workers-ai-binding` — a `WORKERS_AI` binding.
5. Rewrites each worker's `build.command` to spawn binaries directly instead of through `pnpm exec`
   (a ~0.33s process-startup saving per call on the startup critical path), then starts a single
   multi-config `wrangler dev` across all configs.
6. Starts **watchers** only after Wrangler is listening (TCP poll): configurator UI watchers
   immediately, app-UI watchers (`vite build --watch`, which cannot skip their initial build) deferred
   to avoid competing with Wrangler's own bundling. Shutdown is driven by Wrangler's exit so Ctrl-C
   reaches the whole process group; a wedged Wrangler is SIGKILLed after a 10s grace.

## The build system: Vite+ tasks vs. scripts

The repo's commands are **Vite+ (`vp`) tasks**, not ordinary pnpm scripts:

- `pnpm build` runs `vp run -r --cache build` — a cached, dependency-ordered pass over every package.
- Most packages declare `build` as a *task* (type-check + codegen; every package but `typed-storage`
  is `noEmit`, because nothing imports the others' `dist`). `pnpm --filter` cannot see a task — that's
  why these run through `vp`.

Key semantics:

- **Caching**: each task is cached against its inputs, so an unchanged package replays its previous
  output. A task that reads a path it also writes is not cached (e.g. `workshop-frontend`'s `build`
  excludes its own `dist/` from `input`). `vp run --last-details` explains every hit and miss.
- **Environment**: a cached `vp` run strips the environment to a built-in set; anything else is
  invisible to the command *and* absent from the fingerprint. A var can only be declared on a *task*
  via `env` — hence `workshop-frontend`'s `build` declares `env: ['VITE_*']`, folding the flags into
  the fingerprint and forwarding them. Prefer `env` over `untrackedEnv` for anything that changes the
  output. A task that reads an environment-named path outside the workspace (e.g.
  `FORMAT_BLUEPRINTS_DIR`) must be `cache: false` instead, since the var's value (not the contents it
  points at) is what a fingerprint could see.
- **`build:app` / `build:app:dev`** are Vite+ tasks in each gatekeeper's `vite.config.ts` (not
  scripts) so their `input` can be stated explicitly; `build-app.mjs` bundles the single-file app UI
  into `src/generated/app.txt`. `build:app:dev` is the unminified twin used by the dev pre-flight.
- **`build:configurator`** compiles each gatekeeper's `src/configurator/*-ui.tsx` into generated
  iframe HTML via `scripts/build-gatekeeper-configurator.ts`. Gatekeepers with a configurator re-export
  the shared Vite+ tasks from `scripts/gatekeeper-configurator-vite-config.ts`, so `build` is just
  `tsc` and `dependsOn: ['build:configurator']`, and `deploy` runs `vp run --no-cache
  build:configurator && wrangler deploy` — deploys never replay a cached artifact.
- **Format blueprints**: `scripts/build-format-blueprints.mjs` globs `format-blueprints/` into the
  generated `src/generated/format-blueprints.ts`; it rewrites the module only when content changes so
  repeat invocations don't invalidate the task cache.

## Lint and type-checking

- `pnpm lint:check` / `pnpm lint:fix` — `vp lint`, i.e. oxlint driven by Vite+ with the rules in the
  root `vite.config.ts` (`correctness` + `suspicious` as errors). Unused imports/locals are errors;
  unused parameters and caught errors are not. Some rules are warnings (`no-shadow`,
  `no-this-alias`, ...) for incremental cleanup.
- `pnpm types:check` is an alias for `pnpm build`. `pnpm lint` runs lint + `types:scripts`
  (`tsc -p scripts/tsconfig.json`) + `types:check`.
- The workspace `tsc` is TypeScript 7 (tsgo), run **single-threaded** (`"singleThreaded": true` in the
  root tsconfig) because parallel checkers each re-derive capnweb's huge recursive type graphs.
  `typescript` (7.x) ships no JS compiler API, so build-time transpilers import the `typescript6`
  alias (the root package.json), and a lint rule bans bare `typescript` imports.

## Environment and package manager notes

- The repo uses pnpm (`pnpm-workspace.yaml`); the toolchain versions (typescript, vite, vite-plus,
  vitest, wrangler, capnweb) are pinned in the workspace `catalog` so a bump is one edit.
- `pnpm clean` is `vp run -r clean`. Don't reintroduce a root `pnpm run --recursive` script: `vp run
  -r` selects the root package too and would rebuild the workspace a second time.
- The dev backend seeds an `admin` user for testing admin features; a root `.dev.vars` can carry local
  secrets and optional feature vars (see the deployment page).
