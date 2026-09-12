---
type: operations
title: "Build, Test, and Lint"
description: How to build, type-check, test, and lint the workspace — the Vite+ task/cache model, the exact command matrix, workerd suites, the single-threaded tsc rationale, and how caching strips the environment.
tags: [build, test, lint, vite-plus, cache, workerd]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-c5df897833c1439c003cbf44
    resource: repo://packages/workshop-frontend/README.md
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Build, Test, and Lint

The workspace uses **pnpm** and **Vite+ (vp)** instead of npm. `AGENTS.md` is authoritative and this
page condenses it. Everything below is grounded in `package.json` and `scripts/`.

## The command matrix

From the root `package.json`:

- **`pnpm build`** — `vp run -r --cache build` (build the whole workspace in dependency order).
- **`pnpm test`** — `node --test 'scripts/**/*.test.ts' && vp run --filter '!cloudflare-os' --cache test`.
- **`pnpm lint`** — `lint:check && types:scripts && types:check`.
  - `pnpm lint:check` / `pnpm lint:fix` — `vp lint` (oxlint via Vite+, pinned).
  - `pnpm types:scripts` — `tsc -p scripts/tsconfig.json`.
  - `pnpm types:check` — alias for `pnpm build`.
- **`pnpm clean`** — `vp run -r clean`.
- **`pnpm run-local`** — install deps, build only what's needed to run, then launch the local server.
- **`pnpm dev-server`** / **`pnpm dev-client`** — the dev loop (see Quickstart).
- **`pnpm types:generate`** — regenerate worker configuration types.
- **`pnpm preview:{config,deploy,delete,sweep}`** — preview deployments.

Per-package commands:
- **`pnpm --filter <pkg> test:run`** — go straight to vitest (used while iterating).
- **`vp run -F <pkg> test`** — through the Vite+ cache.
- **`vp run -F <pkg> build`** — one package's build (a task, not a script — `pnpm --filter` cannot
  see a task).

## Vite+ task/cache model

`build` and `test` are **Vite+ tasks**, not package.json scripts, so their `input`/`output` sets and
`env` can be declared. A cached `vp run` replays a task's previous output when inputs are unchanged.

- **A cached `vp` run strips the environment**: each task sees only a built-in set (`PATH`, `HOME`,
  `CI`, `NODE_OPTIONS`, …). Anything else is invisible to the command *and* absent from the
  fingerprint, so a build that depends on an env var silently ignores it. A var can only be declared
  on a task (`env`/`untrackedEnv`). `workshop-frontend`'s `build` declares `env: ['VITE_*']`, which
  forwards the flags *and* folds them into the fingerprint — a changed value is a cache miss rather
  than a stale bundle. `scripts/env-passthrough.test.ts` fails on any build-time env read that isn't
  accounted for (`AGENTS.md`).
- **`env` fingerprints the value, not what it points at.** `workshop-backend`'s `build` is therefore
  `cache: false`, not `env: ['FORMAT_BLUEPRINTS_DIR']`, because that var names a directory outside the
  workspace (edits inside it would be invisible to the fingerprint).
- **Commands joined with `&&`, or given as an array in a task, are cached as separate entries**, so
  a package whose codegen is fresh can re-run its `tsc`.
- **Caching is off for tasks that read a path they also write.** `test` tasks exclude the scratch
  paths vitest/wrangler write (`scripts/vitest-task-vite-config.ts`: `node_modules/.vite`,
  `node_modules/.vite-temp`, `.wrangler`), and `workshop-frontend`'s `build` excludes its own `dist/`.
  When a test task stops caching, `vp run --last-details` names the path it read and wrote
  (`vitest-task-vite-config.ts:65`).
- Don't reintroduce a root script that calls `pnpm run --recursive`: `vp run -r` selects the root
  package too and would rebuild the whole workspace a second time. `pnpm test` uses
  `--filter '!cloudflare-os'` rather than `-r` for the mirror-image reason (a second run of the root's
  own script suite).

## Single-threaded tsc

`"singleThreaded": true` is set in the root `tsconfig.json` (and mirrored in the two standalone
`.tsconfig.app.json`s) so every `tsc` run is single-threaded. tsgo's default mode splits the program
across parallel checker instances with separate type caches, and since every file here touches
capnweb's instantiation-heavy recursive generics, each checker re-derives the same huge type graphs.
Single-threaded is both fastest and smallest (measured several times faster and ~2.6x fewer
instantiations). `incremental` is intentionally **not** set, because `tsc` reads/writes its own
`.tsbuildinfo`, taking the whole type check out of the task cache to save less than the cache does
(`AGENTS.md`).

## Workerd suites and assert-workerd

Five packages whose tests run in workerd (`router`, `typed-storage`, `backend-utils`,
`workshop-backend`, `gatekeeper-scheduler`) load `scripts/assert-workerd.ts` as a `setupFiles` entry.
It throws unless `navigator.userAgent === "Cloudflare-Workers"`, so if the
`@cloudflare/vitest-pool-workers` pool fails to start, the suite fails rather than silently falling
back to Node (which would look like a pass for packages importing no `cloudflare:*` module)
(`AGENTS.md`; `scripts/assert-workerd.ts`). Don't remove it to make a suite green.

Every test-task command runs under `scripts/with-timeout.ts` (a watchdog killing the whole process
tree after 60s of silence, or 600s total) so a wedged run fails fast instead of stalling `vp run`. A
workerd OOM-kill (exit 137) wedges its vitest parent forever, so suspect memory first when you see a
silent-hang 124 and drop vp's concurrency.

## Linting

`pnpm lint:check` / `lint:fix` run **oxlint** driven by Vite+ (rules in the `lint` block of the root
`vite.config.ts`; `correctness` + `suspicious` as errors). Vite+ pins oxlint (1.76.0), so no separate
`oxlint` dependency. Unused function parameters and caught errors are not lint-enforced; unused
imports/local variables are still errors. Some rules stay warnings (e.g. `no-shadow`). Type-aware
oxlint rules are intentionally not enabled yet; type safety is enforced by `tsc` through
`types:check`/`build`.

## Build is a type-check + codegen pass

Every package but `typed-storage` is `noEmit` (nothing imports the others' `dist`; wrangler and vite
bundle from source); `typed-storage` emits because its `exports` resolves to `dist/index.js`. `build`
is a type check and codegen pass, not a compile.

## Uncertainty

Some scripts referenced conceptually in `AGENTS.md` (e.g. `generate-wrangler-prod.js`) are internal
to the closed-source deployment; for local/build behavior treat `package.json` + `scripts/*.ts` as
authoritative.
