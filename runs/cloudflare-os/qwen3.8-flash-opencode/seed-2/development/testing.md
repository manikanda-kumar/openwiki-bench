---
type: workflow
title: Testing Approach
description: How this repo tests itself — the pnpm test composition, cached vitest tasks with a process-tree watchdog, Node vs workerd suites, the assert-workerd guard, and the createTestHarness end-to-end integration toolkit.
tags: [testing, vitest, workerd, integration-tests, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-8c7aabc211b0309d42e559fd
    resource: repo://packages/integration-tests/src/network-interceptor.ts
  - id: openwiki-source-5b1b4d222bc653021150f73e
    resource: repo://packages/integration-tests/src/rpc-client.ts
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Testing Approach

## Runners and composition

`pnpm test` is two stages: the root's own plain `node --test 'scripts/**/*.test.ts'` suite (tooling logic — release manifests, dev-server config, pnpm/oxlint helpers), then `vp run --filter '!cloudflare-os' --cache test` for the per-package suites (package.json#L10). The filter names the root package explicitly rather than using `-r`, because the root *has* a `test` script — selecting it recursively would run the scripts suite twice; rename the root and the duplicate returns silently (AGENTS.md).

Per-package tests are a Vite+ **task** (in each `vite.config.ts`, usually via `vitestTask()` from `scripts/vitest-task-vite-config.ts`), not a package.json script — a task may not share a name with a script, which is why the direct-run escape hatch is `pnpm --filter <pkg> test:run` while the cached route is `vp run -F <pkg> test` (vitest-task-vite-config.ts#L14-L19). Use `test:run` while iterating (cache fingerprinting costs more than a small suite); use `pnpm test` to verify.

The task's `input`/`output` are `{auto: true}` minus workspace-wide exclusions for the scratch paths vitest/wrangler write and later read back — `**/node_modules/.vite/**`, `**/node_modules/.vite-temp/**`, `**/.wrangler/**` — because vp refuses to cache a task that reads a path it also wrote, and workspace-wide (not package-relative) globs keep sibling packages from invalidating each other (vitest-task-vite-config.ts#L41-L69). The list is acknowledged to be open-ended: when a test task stops caching, `vp run --last-details` names the offending path (vitest-task-vite-config.ts#L55-L59).

## The watchdog: nothing else bounds a wedged run

Every command in a `test` task — including codegen steps bundled into it — is wrapped by `scripts/with-timeout.ts` (`--idle 60 --max 600`, baked into the fingerprinted command string, relative on purpose for cache portability) (vitest-task-vite-config.ts#L70-L124). The gap is layered: vitest's `testTimeout`/`hookTimeout` die with the crashed test worker, its `teardownTimeout` only arms after resolution, Vite+ has no task timeout, and `@cloudflare/vitest-pool-workers` doesn't pass `onWorkerdCrashRestart`, so an OOM-killed (exit 137) workerd wedges its parent **forever** — silence, not wall clock, is the primary detector (a healthy run prints per file); when a threshold fires the whole process tree is killed and exit is 124 (with-timeout.ts#L1-L30; AGENTS.md). A `vp` cached run replays instantly when untouched; suspect memory first when you see an exit-124 in a workerd package and drop vp's concurrency.

## Node vs workerd suites

Most package tests are plain Node vitest. Five packages — `router`, `typed-storage`, `backend-utils`, `workshop-backend`, `gatekeeper-scheduler` — run under `@cloudflare/vitest-pool-workers` (production runtime) and each loads `scripts/assert-workerd.ts` as a `setupFiles` entry: it throws unless `navigator.userAgent === "Cloudflare-Workers"`, because a pool that fails to start otherwise falls back to Node silently — and packages importing no `cloudflare:*` module would "pass" against the wrong runtime. Don't delete the guard to go green (scripts/assert-workerd.ts#L1-L15; router/vite.config.ts#L22). `gatekeeper-cloudflare` runs **two vitest projects** — pure logic in Node, `RpcTarget`/Durable Object suites in workerd — and its workerd tests reach the gatekeeper through a `TestHooks` Durable Object because a `DurableObjectClass` carrying `ctx.props` is only reachable via `ctx.facets`, the way the overseer instantiates it (gatekeeper-cloudflare/vite.config.ts#L7; AGENTS.md).

## End-to-end integration tests (`packages/integration-tests`)

The `integration-tests` package is both a suite and the **toolkit** consumer repos reuse when they vendor this repo as a submodule (docs/integration-testing.md#L5-L22). Three source-only modules (packages/integration-tests/README.md#L9-L24):

- **`src/harness.ts`** boots `workshop-backend` and a *list* of gatekeepers as real Workers via wrangler's `createTestHarness()`, patching their checked-in `wrangler.jsonc` in memory with a deliberately loose zod schema that lets unknown config flow through (harness.ts#L1-L45).
- **`src/network-interceptor.ts`** patches `globalThis.fetch` (the harness routes Worker subrequests back through Node) — loopback passes, and **anything a handler didn't match throws**, so an unmocked call fails the test rather than escaping to the internet; what vendors answer lives in pluggable handler modules, so a new suite is a new handler file, not a fork (network-interceptor.ts#L1-L26).
- **`src/rpc-client.ts`** drives the Workshop over real Cap'n Web WebSockets to `/api` — the same transport the browser uses — including sign-up, connected-account reading, and an `ObserverConfigRecorder` that answers the overseer's `configure()` calls from a scripted queue (packages/integration-tests/README.md#L20-L24).

Nothing is stubbed except outbound HTTP, and the consequence the doc asks you to internalize: **the code under test is another process** — so `vi.useFakeTimers()` is invisible to it (workerd reads its own clock); fake timers only work in in-isolate pool-workers unit tests (docs/integration-testing.md#L34-L42).

### Conventions forced by that architecture

- **One shared harness, no clean slate.** `server.reset()` measures ~3 s per call (more than a whole suite run) and is a *teardown* (kills open RPC sessions), so storage persists for the suite's lifetime; tests take fresh identities (`nextUsernames()`), per-test resource URLs, and helper-allocated account labels (docs/integration-testing.md#L67-L77).
- **The "nothing escaped" assertion belongs in `afterAll`, never `afterEach`** — with `it.concurrent`, an `afterEach` fires while siblings run and could clear state (or discard an escape) they still need (docs/integration-testing.md#L79-L83).
- **A fixture gatekeeper, not a real one, for overseer observer logic.** `fixtures/gatekeeper-test/` is a real Worker speaking the real protocol whose verification outcome tests set over an HTTP control route — every shipping gatekeeper can only refuse at a cost that would dominate the test, and adding test hooks to them was considered and rejected as making the test circular. It's scoped to overseer logic, explicitly *not* a substitute for per-vendor coverage (docs/integration-testing.md#L44-L63).
- **The capnweb boundary is owned by the toolkit**: mint stubs only via `stubFor()` (rpc-client.ts#L65), enforced by an oxlint rule restricting value-imports of `capnweb` inside that package to `rpc-client.ts` with `allowTypeImports` (vite.config.ts#L77, #L158-L174; docs/integration-testing.md#L101-L118) — because a vendoring repo can end up with two capnweb copies and a stub from the wrong one fails to serialize, visibly only in CI.
- **workerd entry-module discipline**: every *value* named export of a Worker entry module becomes an entrypoint, so fixture entrypoints export only classes and the default handler; type-only exports are fine (docs/integration-testing.md#L120-L128).
- **wrangler↔workerd version coupling**: a root `overrides` pins workerd, so bumping wrangler past the release whose bundled workerd matches makes the harness fail to boot with a compatibility-date error (docs/integration-testing.md#L85-L99).

## CI surface

CI runs lint, build, and tests on every PR including forks; preview deployments deliberately do *not* run on forks because the deploy token can't reach fork PRs — a skipped preview job on your PR is working as intended (CONTRIBUTING.md#L13-L23). The manifest golden test regenerates only with `UPDATE_GOLDEN=1` and the diff must be reviewed (AGENTS.md; scripts/release/manifest-lib.test.ts).
