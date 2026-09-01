---
type: workflow
title: Toolchain, Tasks, and Build Cache
description: The Vite+ (vp) task cache and its environment/pitfalls, the single-threaded tsgo configuration, gatekeeper UI build tasks, dev-server orchestration, and the dependency supply-chain policy.
tags: [build, vite-plus, cache, toolchain, dev-server]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-0f2f5137bb1273cf5872f9b9
    resource: repo://packages/gatekeeper-context/build-app.mjs
  - id: openwiki-source-0ac6cd7b65f3a12167bb0c4a
    resource: repo://packages/gatekeeper-context/package.json
  - id: openwiki-source-157c208310fd62f4ded4355b
    resource: repo://packages/gatekeeper-context/tsconfig.app.json
  - id: openwiki-source-cc333bc957c12eb5a814788c
    resource: repo://packages/gatekeeper-context/vite.config.ts
  - id: openwiki-source-46a6dc3f05f1e404c37ef40d
    resource: repo://packages/workshop-backend/vite.config.ts
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-afc75da9905cc42aa098b45e
    resource: repo://scripts/bin-entry.ts
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
  - id: openwiki-source-3a7b90392549396b274b427d
    resource: repo://scripts/env-passthrough.test.ts
  - id: openwiki-source-3ead0cf37cd6ff5300a12e93
    resource: repo://scripts/gatekeeper-configurator-vite-config.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-98d5ddb014a0fd4d678f6f2a
    resource: repo://tsconfig.json
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Toolchain, Tasks, and Build Cache

## Vite+ tasks, not scripts

`pnpm build` and `pnpm clean` are `vp run -r <task>` — Vite+ runs each package's build tasks/scripts in dependency order and **caches each command against its tracked inputs**, replaying an unchanged package's previous output (package.json#L8, #L17). Commands joined with `&&` or given as arrays cache as *separate* entries, so a package with fresh codegen can still re-run just its `tsc` (gatekeeper-configurator-vite-config.ts#L71-L73). When a build is slower (or faster!) than expected, `vp run --last-details` explains every hit and miss. It is a type-check + codegen pass, not a compile: the shared tsconfig sets `noEmit` (tsconfig.json#L14), and nothing imports another package's `dist` — wrangler and vite bundle from source — with `typed-storage` the one emitter because its `exports` resolve to `dist/index.js` (packages/workshop-frontend/vite.config.ts#L8-L12).

Three cache traps are load-bearing knowledge:

1. **Cached runs strip the environment.** A task sees only a built-in env set (`PATH`, `HOME`, `CI`, …); anything else is invisible to the command *and* absent from its fingerprint. A var can only be declared on a *task* (`env:`/`untrackedEnv:` don't exist on scripts), so any build that reads one must be a task: `workshop-frontend`'s `build` declares `env: ['VITE_*']` and comments exactly which flags reach the bundle (`VITE_CF_ACCESS_MODE` is inlined into `useAuth.ts`; `VITE_FRONTEND_ERROR_REPORTING` selects hidden source maps) (packages/workshop-frontend/vite.config.ts#L14, #L38-L44). `scripts/env-passthrough.test.ts` fails on any build-time env read not accounted for this way.
2. **A sibling script duplicating a task's command bypasses the declaration.** The configurator gatekeepers avoid it by having *no* `build` script at all: `build` is a task that is just `tsc` with `dependsOn: ["build:configurator"]` — after exactly this bug was observed (a `build` script running the builder directly bypassed the env declaration "for every deploy", measured on slack-gatekeeper) (scripts/gatekeeper-configurator-vite-config.ts#L33-L43, #L75-L77).
3. **`env` fingerprints the value, not what it points at.** `workshop-backend`'s `build` is therefore `cache: false`: its `FORMAT_BLUEPRINTS_DIR` names a directory *outside* the workspace, so edits there would be invisible to the fingerprint and a stale generated module replayed; uncached tasks get the full ambient environment so no declaration is needed (packages/workshop-backend/vite.config.ts#L12-L16).

A task may not share a name with a package.json script — hence the `test:run`/`test` split (see [Testing Approach](testing.md)). Caching is also off for tasks that read a path they write, which is why `build`/`build:app`/`test` declare explicit `input` exclusions for `dist/`, `src/generated/`, and tool scratch dirs — always workspace-scoped, or sibling packages invalidate each other (packages/workshop-frontend/vite.config.ts#L9-L14; scripts/vitest-task-vite-config.ts#L41-L69). No tsconfig sets `incremental`: because tsc reads and rewrites its own `.tsbuildinfo`, enabling it takes the whole type-check out of the task cache — the trade measured strictly worse, so don't add it back without re-measuring `vp run --last-details`.

## TypeScript: tsgo, single-threaded

The `typescript` catalog entry is 7.0.2 (tsgo, the native compiler); everything type-checks under it (tsconfig.json#L15-L19 sets `"singleThreaded": true` with its rationale as an inline comment, mirrored in standalone configs like packages/gatekeeper-context/tsconfig.app.json#L4-L5; pnpm-workspace.yaml#L13-L17). Default multi-checker mode splits the program across parallel instances with separate type caches, and capnweb's instantiation-heavy recursive generics force each checker to re-derive the same huge type graphs — measured on workshop-backend at 6.9× types and 4.2× instantiations, 7.3s/1.9GB vs 2.0s/0.7GB single-threaded — so single-threaded is both faster and smaller, which also keeps vp's default concurrency safe (tsconfig.json#L15-L18). TS 7 dropped the JS compiler API from its main export, so the few build-time transpilers that need it use the root `typescript6` alias (`npm:typescript@6.0.3`) or ship their own (capnweb-validate does; `typed-storage`, the only emitting package, sets the `rootDir` TS 7 requires) (pnpm-workspace.yaml#L13-L17; scripts/build-gatekeeper-configurator.ts). 

## Gatekeeper UI builds: `build:configurator` and `build:app`

Two generated-asset pipelines write into package `src/generated/` as part of builds:

- **Configurator UIs** compile per-file with `scripts/build-gatekeeper-configurator.ts` (type-stripping only `@gadgets/configurator-ui` and type imports — which is why `packages/configurator-ui` is type-only). Packages re-export the shared config from `scripts/gatekeeper-configurator-vite-config.ts`: those *with* test files take `withTests` (both tasks), those without take the default, because `vitest run` exits 1 on zero files and `--passWithNoTests` would mask undiscovered tests (gatekeeper-configurator-vite-config.ts#L82-L93).
- **Management SPAs** (`app/`, Vite+Tailwind+Kumo) are bundled by the package's `build-app.mjs` into `src/generated/app.txt`. Its config lives in `vite.app.config.ts` because Vite+ reads per-package task settings only from `vite.config.*`, and the SPA needed the other file (packages/gatekeeper-context/build-app.mjs#L22). `build:app` is a task (explicit `input` with the generated-output exclusions, plus `output`) for the fingerprint reasons above; `build:app:dev` is the same build unminified so the dev-server pre-flight's `app.txt` byte-matches what the watcher's un-skippable initial build will write — otherwise `emitAppText` rewrites the file and wrangler restarts the worker mid-startup (gatekeeper-context/vite.config.ts#L30-L64). `build-app.mjs` always sets `GATEKEEPER_APP_UNMINIFIED` explicitly, because an inherited value would make a production build unminified *and get cached that way* (gatekeeper-context/build-app.mjs#L33-L35). Production `build`/`deploy` reach the minified task through the cache (`deploy` uses `--no-cache` deliberately: a cache hit is only as fresh as its fingerprint, and stale-replay is cheap to absorb on a re-runnable build, not on a deploy) (gatekeeper-context/package.json#L8-L10; gatekeeper-configurator-vite-config.ts#L17-L31).

## The dev server (`pnpm dev-server`)

`scripts/run-dev-server.ts` generates dev wrangler configs (gatekeeper service bindings + Workers AI), builds `build:configurator` and `build:app:dev` via two concurrent `vp run -r --cache` calls (a package is built here only if it declares one of those tasks — same requirement as `pnpm build`), and *then* spawns `wrangler dev` plus watchers (run-dev-server.ts#L257-L276). Two dev-only performance decisions are encoded in the script:

- Generated configs spawn each worker's build command **binary directly** through `resolveBinEntry` (resolved via the package's own `node_modules`) rather than `pnpm exec`, which costs ~0.33 s of process startup per worker per rebuild, all on the startup critical path; unresolvable commands are left as written (run-dev-server.ts#L365; scripts/bin-entry.ts).
- App watchers are **deferred until Wrangler is listening** (TCP poll with a 60 s backstop), because `vite build --watch` cannot skip its initial build and these are the repo's largest builds; watchers spawn only after the pre-flight so two processes never write the same `src/generated` files (run-dev-server.ts#L119, #L153, #L309-L315, #L583). Wrangler is `spawn`ed (not `execFileSync`) precisely so those deferred watchers can start while it runs, and shutdown stays driven by Wrangler's exit — Ctrl-C reaches the process group, and exiting out from under Wrangler would orphan its workerd children (run-dev-server.ts#L563-L583).

## Dependency and supply-chain policy

`pnpm-workspace.yaml` centralizes toolchain versions in a `catalog` (one edit bumps them all: capnweb 0.12, exact pinned `capnweb-validate` 0.3.0 as its peer, vite 7.3.6 *exact* because its esbuild transform is the only thing that lowers the Stage-3 decorators capnweb-validate relies on, TypeScript 7.0.2, wrangler ^4.119) (pnpm-workspace.yaml#L6-L24). `overrides` pin what catalogs can't reach: `vite` for other packages' peers, plus two deps that `minimumReleaseAge` doesn't gate (`@types/node` as an optional peer that would resolve to latest, `@lezer/markdown` as a deep transitive) (pnpm-workspace.yaml#L26-L35). **`minimumReleaseAge: 1440`** refuses dependency versions published within 24 h, matching the CI supply-chain policy so a local install can't commit a too-fresh lockfile — with an explicit allowlist (`capnweb`, `capnweb-validate`, `workerd`, `@cloudflare/workerd-*`) because this repo is the Workers team's own bleeding edge (pnpm-workspace.yaml#L37-L43). `allowBuilds` whitelists exactly which dependencies may run install scripts (pnpm-workspace.yaml#L45-L52).

## Lint

`pnpm lint` = `vp lint` (oxlint driven by Vite+; rules live in the `lint` block of the root `vite.config.ts` with `correctness`/`suspicious` as errors, plus a repo-local JS plugin for the capnweb-import rule) + `types:scripts` + `types:check` (alias of `build`) (vite.config.ts#L14-L32; package.json#L18-L22). The ruleset moved out of `.oxlintrc.json` into this one place so `vp lint` reads it directly (vite.config.ts#L4-L6). Type-aware rules stay off pending a triage pass, notably because `no-floating-promises` conflicts with intentional RPC promise pipelining (vite.config.ts#L22-L28).
