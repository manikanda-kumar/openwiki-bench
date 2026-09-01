---
type: testing
title: Testing and Build Tooling
description: The Vite+ task cache and its silent-staleness pitfalls (env stripping, value-vs-path fingerprinting, read-and-write paths), the with-timeout watchdog, the assert-workerd pool guard, oxlint configuration, and how to run one package's tests.
tags: [testing, build, vp, cache, vitest, oxlint, workerd]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-3f5b9cd2faa3bc1cceda94ff
    resource: repo://packages/gatekeeper-cloudflare/__tests__/worker.ts
  - id: openwiki-source-9675fa97193760cba69103ba
    resource: repo://packages/gatekeeper-cloudflare/vitest.worker.config.ts
  - id: openwiki-source-cc333bc957c12eb5a814788c
    resource: repo://packages/gatekeeper-context/vite.config.ts
  - id: openwiki-source-2aa79db0f81a9ae03810b504
    resource: repo://packages/typed-storage/package.json
  - id: openwiki-source-46a6dc3f05f1e404c37ef40d
    resource: repo://packages/workshop-backend/vite.config.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-3a7b90392549396b274b427d
    resource: repo://scripts/env-passthrough.test.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
  - id: openwiki-source-98d5ddb014a0fd4d678f6f2a
    resource: repo://tsconfig.json
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Testing and Build Tooling

The repo runs on pnpm + Vite+ (`vp`), which adds a task cache on top of per-package scripts. The
cache is the main source of *silent* breakage, so the toolchain has explicit guards — start with
them.

## Commands

From the root (package.json#L7-L24):

- `pnpm build` = `vp run -r --cache build` — recursive, dependency-ordered, cached; it is a type
  check plus codegen, not a compile: every package but `typed-storage` is `noEmit` because nothing
  imports others' `dist` (wrangler/vite bundle from source; typed-storage's `exports` resolve to
  built JS — packages/typed-storage/package.json#L5-L15).
- `pnpm test` = root `node --test 'scripts/**/*.test.ts'` then `vp run --filter '!cloudflare-os'
  --cache test` (the filter names the root package so its own `test` script doesn't run twice).
- `pnpm lint` = `lint:check` (`vp lint`) + `types:scripts` + `types:check` (an alias for `build`)
  — run it before pushing.
- One package: `vp run -F <package> build|test` (cached) or `pnpm --filter <package> test:run`
  (straight vitest). The direct script is `test:run` because **a task may not share a name with a
  package.json script** (scripts/vitest-task-vite-config.ts#L13-L17) — and that's also why plain
  `pnpm --filter <pkg> build` can't see a task (REVIEW.md#L104-L105).

## The cache model — three pitfalls that fail silently

1. **A cached `vp` run strips the environment.** Each task sees only a built-in set (`PATH`,
   `HOME`, `CI`, …); undeclared vars are invisible to the command *and* absent from the
   fingerprint, so a build that reads one succeeds with wrong input. The measured behavior and the
   workspace-wide guard are in scripts/env-passthrough.test.ts#L8-L21 — the test discovers every
   build-time env read and demands it be categorized (`forwarded` via an `env` declaration,
   `uncached`, `injected`, or `external`). `env`/`untrackedEnv` exist only on tasks, never on
   scripts, so a build reading an env var must *be* a task — and a sibling script duplicating its
   command gets no benefit from the declaration (REVIEW.md#L71-L77).
2. **`env` fingerprints the variable's value, not what it points at.** `FORMAT_BLUEPRINTS_DIR`
   names a directory outside the workspace, so with the path held fixed, edits inside are invisible
   — which is why workshop-backend's `build:format-blueprints` is `cache: false` rather than
   `env: [...]` (packages/workshop-backend/vite.config.ts#L11-L24).
3. **A task that reads a path it also wrote never caches.** That's why the shared `test` task
   explicitly excludes vitest/wrangler scratch paths from `input` —
   `node_modules/.vite/vitest/<hash>/results.json` (read back by the sequencer),
   `node_modules/.vite-temp/*.timestamp-*.mjs` (timestamped, so no fingerprint ever repeats), and
   friends — and why `build:app` states workspace-wide `dist-app/`/`src/generated/` exclusions so
   sibling gatekeepers don't invalidate each other
   (scripts/vitest-task-vite-config.ts#L18-L50; packages/gatekeeper-context/vite.config.ts#L23-L34).
   When a test task stops caching, `vp run --last-details` names the path; don't fix it by hand —
   extend the shared exclusion list (REVIEW.md#L79-L82).

Corollary: no tsconfig sets `incremental` — `tsc` reading its own `.tsbuildinfo` would take the
whole type check out of the task cache (REVIEW.md#L83-L84). Root `tsconfig.json` sets
`"singleThreaded": true` for every `tsc` run, measured as the fastest and smallest configuration
(tsconfig.json#L19, REVIEW.md#L108).

## Watchdog: `with-timeout.ts`

Every command in the shared `test` task runs under
`scripts/with-timeout.ts --idle <s> --max <s> -- <cmd>`. It exists because nothing else bounds a
wedged run: `vp` has no task timeout; vitest's `testTimeout`/`hookTimeout` die with the worker they
protect; `teardownTimeout` only arms after the run resolves; and
`@cloudflare/vitest-pool-workers` doesn't wire `onWorkerdCrashRestart`, so a dead workerd child
leaves the pool waiting forever. Idle silence is the primary detector (a healthy `vitest run`
prints per file); exit code 124 signals a fired threshold, killing the whole process tree with an
escalating SIGKILL grace (scripts/with-timeout.ts#L1-L30). And note that `pnpm test`'s
`--filter '!cloudflare-os'` hardcodes the root package's name — rename the root and the scripts
suite silently runs twice (REVIEW.md#L86-L87).

## Guard: `assert-workerd.ts`

Every package whose vitest pool can run workerd lists scripts/assert-workerd.ts as a `setupFiles`
entry (e.g. packages/router/vitest.config.ts,
packages/gatekeeper-cloudflare/vitest.worker.config.ts,
packages/workshop-backend/vitest.config.ts). Vitest silently falls back to
Node when the pool fails to start, and packages importing no `cloudflare:*` module would test the
wrong runtime while staying green; the guard throws unless
`navigator.userAgent === "Cloudflare-Workers"` — **fix the pool, never delete the check**
(scripts/assert-workerd.ts#L1-L15).

## Lint

`vp lint` runs oxlint with `correctness` + `suspicious` as errors, the `typescript`/`unicorn`/
`oxc`/`import` plugins, and a repo-local JS plugin; the ruleset lives in the `lint` block of the
root `vite.config.ts` (one config, no `.oxlintrc.json`), which also pins deliberate exceptions:
`prefer-jsdoc` for exported API docs, `import/default` off (`.txt` asset imports), no-churn
`_`-prefix rules, and **type-aware linting intentionally not enabled** because its first triage and
`no-floating-promises` policy (RPC pipelining) are undecided — full type safety stays with `tsc`
(vite.config.ts#L1-L60, REVIEW.md#L90-L96).

## Two vitest projects in one package

Packages testing both pure logic and runtime classes split configs — e.g.
`gatekeeper-cloudflare/vitest.config.ts` (Node, "far cheaper" for pure logic) and
`vitest.worker.config.ts` (workerd, because the approval-queue audit, collaborator ACL, and stub
disposal are built on `RpcTarget`/`RpcStub`/`DurableObject` props)
(packages/gatekeeper-cloudflare/vitest.worker.config.ts#L5-L10). The workerd suite reaches the
gatekeeper through a `TestHooks` Durable Object because a `DurableObjectClass` carrying
`ctx.props` is only reachable via `ctx.facets` — the way production instantiates it
(packages/gatekeeper-cloudflare/__tests__/worker.ts#L4).

Related: [Integration Test Harness](./integration-harness.md), [Quickstart](../quickstart.md).
