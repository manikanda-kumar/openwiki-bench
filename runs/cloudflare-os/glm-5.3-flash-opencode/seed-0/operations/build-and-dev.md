---
type: build-and-dev
title: "Build System and Dev Server"
description: How the workspace builds and runs in development — the vp (vite-plus) task system with caching and env stripping, per-package build tasks (frontend bundle, gatekeeper configurator and app UIs, format-blueprint codegen), and the dev-server composition that generates bindings, spawns watchers, and rewires wrangler build commands.
tags: [build, vite-plus, dev-server, codegen, caching, lint]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-3ead0cf37cd6ff5300a12e93
    resource: repo://scripts/gatekeeper-configurator-vite-config.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Build System and Dev Server

The workspace's build/test orchestration is **vite-plus (`vp`)**, configured per package in `vite.config.ts` and centrally for lint in the root `vite.config.ts`.

## Tasks vs scripts, caching, and env stripping

Two rules drive the whole layout (documented at each site):

- **A cached `vp` run strips the environment.** A task or script sees only a built-in set of variables; anything else is invisible *and* absent from the cache fingerprint. A var can only be declared on a **task** — so any build that reads an env var must be a task. `workshop-frontend`'s `build` is a task declaring `env: ['VITE_*']`, which forwards the flags and folds them into the fingerprint so a changed value is a reported cache miss (packages/workshop-frontend/vite.config.ts:38-45, 14).
- **A task may not share a name with a package.json script**, and reading a path you also write defeats caching — hence `clean:dist` is uncached, `dist/` is excluded from the bundle task's inputs (package-relative, because `typed-storage` emits to `dist` and a workspace-wide exclusion would drop a real input), and `.wrangler/**` scratch trees are excluded workspace-wide because wrangler's scratch bundle names reach past the owning package (packages/workshop-frontend/vite.config.ts:15-36).

The gatekeeper configurator build makes the same tradeoff explicitly: `build:configurator` is a task so `VITE_FRONTEND_ERROR_REPORTING` is passed through and fingerprinted, with an **uncached** `clean:error-reporting-artifacts` dependency first, because a cache hit restores archived outputs without deleting anything — a reporting-disabled deploy could otherwise keep the previous enabled build's sourcemaps. `deploy` reaches the task with `vp run --no-cache build:configurator` (deploys never trust the fingerprint) (scripts/gatekeeper-configurator-vite-config.ts:7-40).

## The root commands

From the root `package.json`: `pnpm build` is `vp run -r --cache build` (type-check plus codegen in dependency order; a re-run with nothing changed replays from cache), `pnpm test` runs the root's own `node --test` scripts suite then per-package cached test tasks, `pnpm lint:check` is `vp lint` (oxlint pinned by vite-plus, rules in the root `vite.config.ts`), and `pnpm types:check` aliases `pnpm build` (package.json:7-27). The lint ruleset lives in `vite.config.ts`: `correctness`/`suspicious` as errors, type-aware linting intentionally off (RPC pipelining deliberately leaves promises unawaited, which `no-floating-promises` would flag; full type safety remains `tsc`'s job), a custom `gadgets/prefer-jsdoc` rule, and overrides for browser/worker scopes (vite.config.ts:14-90+).

TypeScript is **tsgo (7.0.2)** with `singleThreaded: true` in the root tsconfig — parallel checker instances re-derive capnweb's huge type graphs separately, so single-threaded is both faster and smaller; transpilers needing the JS compiler API import the root `typescript6` alias, and a lint rule forbids importing bare `typescript` for that API (pnpm-workspace.yaml:11-19, vite.config.ts:71-84, AGENTS.md §TypeScript — the measurement rationale lives in tsconfig comments and AGENTS.md).

## Format-blueprint codegen

`scripts/build-format-blueprints.mjs` globs `format-blueprints/` (overridable with `FORMAT_BLUEPRINTS_DIR`) into the gitignored `src/generated/format-blueprints.ts`; `workshop-backend`'s `build` and `test` tasks run it first, and it rewrites the module only when content changes so repeat invocations don't invalidate downstream task caches (packages/workshop-backend/format-blueprints/README.md:84-102; AGENTS.md §format-blueprints). `workshop-backend`'s build is deliberately **uncached** (`cache: false`) because `FORMAT_BLUEPRINTS_DIR` names a path outside the workspace — an `env` declaration fingerprints the *value*, not the contents of what it points at (AGENTS.md §build; packages/workshop-backend/vite.config.ts).

## The dev server

`pnpm dev-server` (`scripts/run-dev-server.ts`) composes everything (scripts/run-dev-server.ts:1-30, 224-330):

1. **Pre-flight (concurrent):** the format-blueprint generator, `vp run -r --cache build:configurator --dev` (configurator UIs), and `vp run -r --cache build:app:dev` (gatekeeper app UIs, **unminified** so the pre-flight output matches what the app watchers' unskippable initial build will write — otherwise `emitAppText` rewrites the file and Wrangler restarts the worker mid-startup). `vp run` takes one task per call, hence two invocations; a new gatekeeper needs one of those tasks or it is never built here.
2. **Watchers spawn only after the pre-flight** (watch modes build before watching; starting earlier would put two processes on the same `src/generated` files): configurator watchers start immediately; **app-UI watchers are deferred until Wrangler is listening** (TCP poll with a timeout backstop) because `vite build --watch` can't skip its initial build and these are the largest builds in the repo (scripts/run-dev-server.ts:110-160, 290-330).
3. **Dynamic bindings:** wrangler.dev.jsonc files are generated for discovered `gatekeeper-*` packages (`GATEKEEPER_<NAME>` bindings), with the Context Library getting extra `sharingDomain` props (scripts/run-dev-server.ts:100-108, 323+).
4. **Direct binary dispatch:** wrangler runs each worker's `build.command` twice at startup and again on every rebuild, and reaching the binary via `pnpm exec` costs ~0.33 s of process startup each time — so for dev only, commands are rewritten to spawn the binaries directly (resolved through the package's own node_modules); anything unresolvable is left as written (scripts/run-dev-server.ts:333-360).
5. **Shutdown is driven by Wrangler's exit** (Ctrl-C reaches the whole process group; exiting out from under Wrangler would orphan workerd children), with deep tree-kills for watcher grandchildren that a bare `kill()` would leave holding CPU (scripts/run-dev-server.ts:135-155, 563+).

`pnpm run-local` (scripts/run-local.ts) is the single-command production-shaped local run: the backend serves the pre-built frontend as static assets (no Vite), on workerd via wrangler (scripts/run-dev-server.ts:44-46, README.md:20-28).

## Related pages

- [Quickstart](/openwiki/quickstart.md) — the commands themselves.
- [Testing Strategy](/openwiki/operations/testing.md) — the cached test tasks and watchdogs.
- [Blueprints: Templates, Archives, and Screenshots](/openwiki/backend/blueprints.md) — what the codegen embeds.
