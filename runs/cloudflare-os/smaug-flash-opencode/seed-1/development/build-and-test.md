---
type: "Reference"
title: "Build, Test, and Lint Workflows"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---


# Build, Test, and Lint Workflows

This repository uses **pnpm** and drives the workspace through **Vite+ (`vp`)**, a task runner that
caches each per-package build/test against its inputs. Understanding the difference between a package
**script** and a **Vite+ task** — and how the cache strips the environment — is essential to making
changes without silently building the wrong thing.

## The big three commands

- **`pnpm build`** — the recursive build/type-check, via `vp run -r build`. It is a *task* in each
  package's `vite.config.ts` (usually `tsc`). It is a type check and codegen pass, not a compile:
  every package but `typed-storage` is `noEmit` (wrangler and vite bundle from source; `typed-storage`
  emits because its `exports` resolves to `dist/index.js`). A re-run with nothing changed replays from
  the cache.
- **`pnpm test`** — runs the root's own `node --test 'scripts/**/*.test.ts'` suite, then the
  per-package tests via `vp run --filter '!cloudflare-os' test`. The filter (not `-r`) avoids running
  the root's `test` script a second time.
- **`pnpm lint`** — runs CI's banned combo: `lint:check` (oxlint via `vp lint`), `types:scripts`
  (`tsc -p scripts/tsconfig.json`), and `types:check` (an alias for `pnpm build`).

Two ways to run one package's tests:
- `pnpm --filter <package> test:run` — goes straight to vitest.
- `vp run -F <package> test` — goes through the cache.

The direct `test:run` is faster on a package you just edited (cache fingerprinting and archiving lose
to plain vitest on a small package, by more than the whole suite costs); use it while iterating and
`pnpm test` to verify and keep the cache warm.

## Tasks vs scripts

A package declares most of its build/test work as a **Vite+ task** (in `vite.config.ts`, under
`run.tasks`) rather than a `package.json` script. That matters for two reasons:

1. **A task's `input` can be declared explicitly.** The build/test reads and writes `dist/` and
   vitest's scratch paths, and Vite+ refuses to cache a task that reads a path it also wrote. Tasks
   declare `input`/`output` globs (with directory-contents exclusions) so those scratch paths stay
   out of the fingerprint; a `package.json` script cannot express that.
2. **A task may not share a name with a script.** So packages have no `build`/`test` *script*; the
   task replaces it across the workspace (commands that must be scripts — e.g. `deploy`,
   `test:run`, `clean` — keep the script name).

`vp run -r` also selects the root package (which has its own scripts/test suite), which is why
`pnpm test` uses `--filter` instead.

## Env-stripping of cached runs

**A cached `vp` run strips the environment.** Each task and script sees only a built-in set (`PATH`,
`HOME`, `CI`, `NODE_OPTIONS`, …). Anything else is invisible to the command *and* absent from its
cache fingerprint, so a build that depends on an env var silently ignores it and no warning says so.

The rules the repo encodes around this:

- An env var affecting output can only be declared on a **task** via `env:`/`untrackedEnv` (they don't
  exist on a `package.json` script). `workshop-frontend`'s `build` declares `env: ['VITE_*']`, which
  both forwards the flags and folds their values into the fingerprint — a changed value is a reported
  cache miss, not a stale bundle replayed. Prefer `env` over `untrackedEnv`.
- Declaring `env` on a task does **not** help a sibling script that does the same work — a script
  duplicating a task's command takes the stripped path, and the declaration buys nothing.
- `env` fingerprints the *value*, not what it points at. `workshop-backend`'s `build` is therefore
  `cache: false` (not `env: ['FORMAT_BLUEPRINTS_DIR']`): the var names a blueprint directory outside
  the workspace, so with the path fixed, edits inside it are invisible and a stale
  `format-blueprints.ts` would replay. Uncached tasks run with the full ambient environment and need
  no `env` declaration.
- `scripts/env-passthrough.test.ts` fails on any build-time env read that isn't accounted for.

## Caching pitfalls (when a build stops caching)

Caching is off for any task that reads a path it also writes. The known scratch paths are collected:

- `workshop-frontend`'s `build` excludes its own `dist/` from `input`.
- The per-package `test` tasks exclude `node_modules/.vite`, `node_modules/.vite-temp`, and `.wrangler`
  (see `scripts/vitest-task-vite-config.ts`), workspace-wide so sibling packages don't invalidate each
  other.
- No tsconfig sets `incremental`, because `tsc` would read/write its own `.tsbuildinfo`, taking the
  whole type check out of the task cache (measured: far worse hit rate than the cache saves).

When a test task stops caching, `vp run --last-details` names the path it read and wrote — that's
the thing to read, and the place to add a new exclusion if it is shared.

## The `test` task and its watchdog

Every command in the shared `test` task runs under `scripts/with-timeout.ts` (an idle timer plus a
total wall-clock cap, killing the whole process tree and exiting 124 after 60s of silence or 600s
total). It exists because nothing else bounds a wedged run: Vite+ has no task timeout, and
`@cloudflare/vitest-pool-workers` imports Miniflare without `onWorkerdCrashRestart`, so a workerd that
dies must not wedge the pool forever. The thresholds are baked into the command string (not env vars)
so they are part of the fingerprint and always apply to cached runs.

The five packages that run tests in workerd (`router`, `typed-storage`, `backend-utils`,
`workshop-backend`, `gatekeeper-scheduler`) import `scripts/assert-workerd.ts` as a vitest
`setupFiles` entry. It throws unless `navigator.userAgent` is `Cloudflare-Workers`, so a pool that
fails to start fails the suite instead of silently falling back to Node.

## TypeScript and the single-threaded decision

The workspace `tsc` is **tsgo (TypeScript 7)**. The root `tsconfig.json` (and the two standalone
`tsconfig.app.json`s) set `"singleThreaded": true`, so every `tsc` run is single-threaded without
per-script flags. tsgo's default splits the program across parallel checker instances that each
re-derive capnweb's instantiation-heavy recursive generics; measured on workshop-backend this was
several times the types/instantiations and slower than single-threaded, so single-threaded is both
faster and cheaper, keeping build tasks cheap enough for vp's default concurrency.

Tests are the separate memory risk: the workerd fleets are the memory hogs. An OOM-killed (exit 137)
workerd child wedges its vitest parent forever — the watchdog above turns that into an exit 124 after
60s of silence. Suspect memory first when you see one.

No tsconfig sets `baseUrl`; every `paths` entry is an explicit relative path resolved against the
tsconfig's own directory (TypeScript 7 removed `baseUrl` outright).

## Linting

Lint is **oxlint**, driven by Vite+ (`pnpm lint:check` / `pnpm lint:fix` runs `vp lint`). Vite+ pins
the oxlint it runs (1.76.0), and rules live in the `lint` block of the root `vite.config.ts`
(`correctness` + `suspicious` as errors). There is no `.oxlintrc.json`.

- Unused function parameters and caught errors are not enforced; unused **imports and local
  variables** are still errors.
- Some rules are kept as warnings (e.g. `no-shadow`) for incremental cleanup; warnings don't block
  CI.
- The type-aware oxlint engine is intentionally not enabled yet. `no-floating-promises` conflicts with
  RPC promise pipelining (which intentionally leaves promises unawaited), so type safety is enforced
  by `tsc` through `pnpm types:check` / `pnpm build`, not by type-aware lint rules.

## The gatekeeper configurator build

Gatekeepers with a configurator UI re-export their build tasks from
`scripts/gatekeeper-configurator-vite-config.ts`. Their `build` task is only `tsc` and `dependsOn:
['build:configurator']` (which carries `VITE_FRONTEND_ERROR_REPORTING` in its fingerprint); there is
no `build` script, and `deploy` runs `vp run --no-cache build:configurator && wrangler deploy` so
deploys never replay a cached artifact. `scripts/build-gatekeeper-configurator.ts` transpiles each
`src/configurator/*-ui.tsx` per-file, stripping only `@gadgets/configurator-ui` and type-only imports,
into `src/generated/*.txt`. Nothing invokes the builder by hand.
