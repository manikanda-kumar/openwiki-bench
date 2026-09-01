---
type: concept
title: Build System and Toolchain
description: How this pnpm workspace builds — Vite+ (vp) recursive task cache semantics, the build-time env declaration rules that keep cached builds honest, tsgo/tsconfig decisions, lint via vp's oxlint, and the codegen tasks each build runs first.
tags: [build, vp, pnpm, caching, lint, typescript]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-157c208310fd62f4ded4355b
    resource: repo://packages/gatekeeper-context/tsconfig.app.json
  - id: openwiki-source-cc333bc957c12eb5a814788c
    resource: repo://packages/gatekeeper-context/vite.config.ts
  - id: openwiki-source-72eae9e0de338dc23afbc739
    resource: repo://packages/gatekeeper-github/package.json
  - id: openwiki-source-2aa79db0f81a9ae03810b504
    resource: repo://packages/typed-storage/package.json
  - id: openwiki-source-46a6dc3f05f1e404c37ef40d
    resource: repo://packages/workshop-backend/vite.config.ts
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-3a7b90392549396b274b427d
    resource: repo://scripts/env-passthrough.test.ts
  - id: openwiki-source-3ead0cf37cd6ff5300a12e93
    resource: repo://scripts/gatekeeper-configurator-vite-config.ts
  - id: openwiki-source-cc8b5a31645ca2544a9644a6
    resource: repo://scripts/generate-worker-types.ts
  - id: openwiki-source-95159c0a64d4f0e39a78722e
    resource: repo://scripts/registry-policy.test.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-98d5ddb014a0fd4d678f6f2a
    resource: repo://tsconfig.json
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Build System and Toolchain

The workspace is pnpm (`packageManager` pinned in package.json with a hash, package.json:6) plus **Vite+** (`vite-plus`), which supplies `vp` — a task runner with a per-task content cache. Root scripts are thin wrappers over it: `pnpm build` = `vp run -r --cache build`; `pnpm clean` = `vp run -r clean`; `pnpm test` runs the root's own `node --test 'scripts/**/*.test.ts'` suite then `vp run --filter '!cloudflare-os' --cache test` — the filter (rather than plain `-r`) exists because `vp run -r` also selects the root package, which would run its own `test` script a second time (package.json:8-10, 17; stated in repo guidance).

## What "build" actually is

`build` is a type-check and codegen pass, *not* a compile: the shared compiler options are `noEmit` (`tsconfig.json:14`), because nothing imports others' `dist` — wrangler and vite bundle from source. `typed-storage` emits anyway because its `exports` resolve to `dist/index.js` (packages/typed-storage/package.json:6-12). On an unchanged tree a `vp` run replays the previous output from cache (root `package.json:8` `vp run -r --cache build`).

## The task cache and its two traps

vp caches each task against its *inputs*; `vp run --last-details` explains every hit/miss. Two structural traps have produced most of this repo's caching rules, both documented in code:

**1. A cached run strips the environment.** Each task sees only a built-in set (`PATH`, `HOME`, `CI`, `NODE_OPTIONS`, …); anything else is invisible to the command *and* absent from the fingerprint, so a build depending on an undeclared var silently ignores it with no warning (scripts/env-passthrough.test.ts:5-16). A var can only be declared on a *task* (`env` doesn't exist on package.json scripts), so any build that reads one must *be* a task. Measured behavior — declared vs undeclared under `vp run --cache` / `--no-cache` — is pinned in the header of scripts/env-passthrough.test.ts:1-28, and **that test is the guard**: it discovers every build-time env read in the workspace and fails on any not categorized `forwarded`/`uncached`/`injected`/`external` (scripts/env-passthrough.test.ts:29-80). Concrete declarations:

- `workshop-frontend`'s `build` task uses `env: ['VITE_*']` because vite's `define` inlines *any* `VITE_`-prefixed var — the wildcard is "the only honest declaration"; a replayed bundle built under different values is *wrong*, not stale (packages/workshop-frontend/vite.config.ts:12-14, 37-55).
- `workshop-backend`'s `build` and `build:format-blueprints` are `cache: false` instead: `FORMAT_BLUEPRINTS_DIR` names a directory *outside* the workspace and `env` fingerprints the *value*, not its contents, so edits inside it would replay a stale generated module (packages/workshop-backend/vite.config.ts:10-24).
- Configurator gatekeepers have *no* `build` script at all — `build` is a task of `tsc` + `dependsOn: ['build:configurator']`; when `build` was a script running the builder directly, `pnpm build` bypassed the env declaration entirely and shipped byte-identical configurator bundles under opposite flag values (scripts/gatekeeper-configurator-vite-config.ts:28-40).

A sibling corollary, stated in the same file: declaring `env` on one task does not help a *script* that duplicates its command — the script takes the stripped path regardless. And every gatekeeper's `deploy` script starts with `vp run --no-cache build:configurator` (packages/gatekeeper-github/package.json:8): "a cache hit is only as correct as the fingerprint is complete", so deploys rebuild even though codegen costs a second or two (scripts/gatekeeper-configurator-vite-config.ts:18-27). Cache hits also never *delete* files, which is why an uncached `clean:error-reporting-artifacts` task must run before them or sourcemaps from an enabled-reporting build survive a disabled-reporting replay (scripts/gatekeeper-configurator-vite-config.ts:42-48).

**2. A task may not read what it writes.** vp declines to cache any task whose input paths overlap its outputs. Hence: `workshop-frontend` excludes its own `dist/**` from inputs (but package-relative only — a workspace-wide `!dist/**` would drop typed-storage's real input) (packages/workshop-frontend/vite.config.ts:8-24); the gatekeeper SPA `build:app` task excludes `**/dist-app/**`, `**/src/generated/**` and `**/.wrangler/**` at workspace base (packages/gatekeeper-context/vite.config.ts:22-40); and the shared `test` task excludes vitest/wrangler scratch paths under `node_modules/.vite*` and `.wrangler` (scripts/vitest-task-vite-config.ts:1-49). The same logic is why **no tsconfig sets `incremental`**: tsc reads and rewrites its own `.tsbuildinfo`, taking the whole type check out of the task cache (repo guidance records the measurements; none of the workspace's tsconfigs enable it).

## Naming rules

`vp` selects work by which packages *declare* the task or script, and **a task may not share a name with a package.json script** (scripts/vitest-task-vite-config.ts:15-19) — which is why packages have `test:run` (plain vitest, for iterating) versus the cached `test` task, why `build:app` exists only as a task (`build` scripts call `vp run --cache build:app`), and why the gatekeeper `build:app` task is declared per-package (its `input` needs workspace-base exclusions to keep sibling gatekeepers from invalidating each other; packages/gatekeeper-context/vite.config.ts:22-41). `pnpm --filter` cannot see tasks, so single-package builds go through `vp run -F <package> build`.

## Codegen tasks

Three generated-source pipelines are prerequisites of builds/tests:

- `scripts/build-format-blueprints.mjs` → `src/generated/format-blueprints.ts` (rewritten only when content changes, so repeat invocations don't invalidate downstream caches);
- `scripts/build-gatekeeper-configurator.ts` → per-gatekeeper configurator UI modules, transpiled per-file with only `@gadgets/configurator-ui` and type imports stripped — using the `typescript6` alias because TS 7's `typescript` ships no JS compiler API;
- `pnpm types:generate` → `scripts/generate-worker-types.ts` regenerates `worker-configuration.d.ts` for every package with a wrangler.jsonc, with scripted post-processing so nobody hand-edits it (scripts/generate-worker-types.ts:1-16).

## TypeScript: tsgo decisions

The catalog's `typescript` is **7.0.2 (tsgo)**, the native compiler (pnpm-workspace.yaml:14-18). Two root-level choices:

- `"singleThreaded": true` in `tsconfig.json:16-20` — the config's own comment records why: tsgo's parallel checkers each keep separate type caches, so every checker re-derives capnweb's recursive type graphs, and single-threaded is both faster and smaller (measured numbers live in repo guidance, not in a source file); the two standalone `tsconfig.app.json`s that don't extend the root mirror it (packages/gatekeeper-context/tsconfig.app.json:4-5, packages/gatekeeper-scheduler/tsconfig.app.json:3-4).
- **No `baseUrl`, anywhere** — no tsconfig in the workspace sets it (verifiable by grep); with every `paths` entry an explicit relative path, `baseUrl` bought nothing, and TypeScript 7 removed the option outright (TS5102).

Code that still needs the JS compiler API imports the root's `typescript6` alias (`npm:typescript@6.0.3`, package.json:31); oxlint enforces this by erroring on value imports of bare `typescript` (vite.config.ts:63-76).

## Lint and CI gate

`pnpm lint` = `vp lint` (oxlint driven by Vite+) + `types:scripts` + `types:check`; `types:check` is an alias for `build`, and there is no separate `oxlint` dependency and no `.oxlintrc.json` — one toolchain config (package.json:20-24; the lint block of the root config). The ruleset lives in the `lint` block of the root `vite.config.ts:6-100`: `correctness`/`suspicious` as errors, a repo plugin (`scripts/oxlint-plugin.mjs`) enforcing `gadgets/prefer-jsdoc` for exported API declarations, per-scope env overrides (worker/service-worker for backend packages, react/jsx-a11y for the frontend, classic-JSX pragma for configurator `.tsx`, vitest for tests — with `scripts/**/*.test.ts` ordered last so node's `--test` globals don't get vitest's), and deliberate `no-unused-vars` options (args/caughtErrors exempt; `^_` vars exempt) (vite.config.ts:44-59). Type-aware linting is intentionally off: `no-floating-promises` would flag RPC promise *pipelining*, which is the house style (vite.config.ts:20-27). `vp lint` is not part of `vp run`, so it has no task cache.

The supply-chain policy is build-adjacent: `minimumReleaseAge: 1440` minutes in pnpm-workspace.yaml rejects dependency versions published within 24h (with an exclusion list and pinned overrides for what the age gate can't reach — pnpm-workspace.yaml:27-44), which scripts/registry-policy.test.ts verifies against the lockfile.

## Where to look next

Test-task plumbing, workerd suites, and the with-timeout watchdog: [Testing Strategy and Harnesses](/openwiki/development/testing.md). The dev server's build preflight and direct-binary spawning: [Quickstart](/openwiki/quickstart.md) and scripts/run-dev-server.ts.
