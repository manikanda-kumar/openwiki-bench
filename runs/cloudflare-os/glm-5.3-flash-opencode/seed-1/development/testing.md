---
type: "Reference"
title: "Testing: Unit, Workerd, and Integration Harness"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-9675fa97193760cba69103ba
    resource: repo://packages/gatekeeper-cloudflare/vitest.worker.config.ts
  - id: openwiki-source-8c9bf5a84c0258d85f369973
    resource: repo://packages/integration-tests/README.md
  - id: openwiki-source-87db9394464b0c1aaacbf04b
    resource: repo://packages/integration-tests/src/harness.ts
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
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Testing: Unit, Workerd, and Integration Harness

## Organization

- **Per-package unit tests** live in each package's `__tests__/` (e.g. 30+ suites under `packages/workshop-backend/__tests__`, covering sharing, git store, code changes, compaction, admin config, and more). Most run under plain vitest in Node.
- **Workerd-pool suites** run inside the production runtime via `@cloudflare/vitest-pool-workers` — e.g. `packages/gatekeeper-cloudflare/vitest.worker.config.ts` runs a second project (`__tests__/workerd/*.test.ts`) because what it covers (the approval-queue audit on every read, the collaborator ACL, stub disposal) is built on `RpcTarget`, `RpcStub`, and Durable Object props; its sibling `vitest.config.ts` keeps pure-logic tests in Node where they are far cheaper (vitest.worker.config.ts:6-11). `workshop-backend` and others reach gatekeeper DOs through a `TestHooks` Durable Object because "a DurableObjectClass carrying ctx.props is only reachable via ctx.facets — the way the overseer instantiates it" (vitest.worker.config.ts:22-26).
- **End-to-end tests** live in `packages/integration-tests`, which boots real Workers and drives them over the actual RPC API (README.md:1-5). Suites cover the agent, actions, blueprints, lifecycle, presence, sharing, and observer reverification.

## The shared `test` task and the watchdog

`test` is a Vite+ **task** rather than a package.json script so its inputs can exclude the scratch paths vitest writes and reads back (scripts/vitest-task-vite-config.ts:8-16): `node_modules/.vite/**` (vitest's results cache), `node_modules/.vite-temp/**` (vite's TS config loader temp modules), and `.wrangler/**` (the capnweb-validate build tree) — all workspace-wide "because tracking reaches past the package that owns the task, so a sibling's scratch files would otherwise stay in this package's fingerprint" (scripts/vitest-task-vite-config.ts:48-73). The direct script is `test:run` because vp forbids a task and a script sharing a name; use `test:run` while iterating and `pnpm test` to verify.

Every command in that task runs under `scripts/with-timeout.ts`: two watchdogs (idle-on-output, 60s default; total wall clock) that kill the whole process tree and exit 124 when either fires (scripts/with-timeout.ts:1-25). This exists because nothing else bounds a wedged run — vitest's own timeouts die with the worker, and a workerd OOM/kill can wedge the pool forever; silence, not wall clock, distinguishes a hang from a slow suite.

## The workerd guard

Packages whose tests must run in workerd (`router`, `typed-storage`, `backend-utils`, `workshop-backend`, `gatekeeper-scheduler`) load `scripts/assert-workerd.ts` as a `setupFiles` entry: it throws unless `navigator.userAgent` is `Cloudflare-Workers` (scripts/assert-workerd.ts:1-13). Without it, a `vitest-pool-workers` pool that fails to start silently falls back to Node — which otherwise looks like a pass in packages that import no `cloudflare:*` module. Do not remove it to make a suite green.

## The integration harness

`packages/integration-tests` boots `workshop-backend` plus any set of gatekeepers as real Workers under wrangler's `createTestHarness()`, patching checked-in wrangler.jsonc in memory (README.md:10-14; docs/integration-testing.md:22-25). Three toolkit modules under `src/`:

- **`src/harness.ts`** — parameterized over gatekeepers on purpose, so a suite for a new gatekeeper is "point the harness at the package", not a forked copy.
- **`src/network-interceptor.ts`** — patches `globalThis.fetch` (the harness routes worker subrequests back through the Node process), passes loopback through, and **throws on anything a handler didn't match** — a test cannot reach the real internet.
- **`src/rpc-client.ts`** — speaks Cap'n Web over a WebSocket to `/api` (the browser's transport), with sign-up, connected-account reads, and an `ObserverConfigRecorder` that answers the overseer's `configure()` callbacks from a scripted queue.

**Nothing is stubbed except outbound HTTP — and the code under test is in another process.** Consequences (docs/integration-testing.md):

- **Fake timers cannot work**: `vi.useFakeTimers()` patches the test process's clock, but the code under test reads workerd's clock, out of process (docs/integration-testing.md:32-38).
- **No clean slate**: `server.reset()` takes ~3s per call and restarts the server (killing every open WebSocket), so storage persists for the harness's lifetime; tests take fresh identities via `nextUsernames()`, per-test resource URLs, and helper-allocated account labels (docs/integration-testing.md:52-64).
- **The escape assertion lives in `afterAll`, not `afterEach`** — with `it.concurrent`, an `afterEach` fires while siblings are still running and would inspect/clear state they are using (packages/integration-tests/README.md:29-31).
- **wrangler and workerd are version-coupled**: the repo pins workerd via a root `overrides` entry and pins wrangler to the release whose bundled workerd matches (docs/integration-testing.md:66-80).
- **One capnweb copy only**: a consumer repo can end up with two capnweb instances (its own store plus the submodule's), and stubs are only serializable by the instance that owns the session — so the toolkit owns the capnweb boundary: mint callback stubs with `stubFor()` from `rpc-client`, never with an imported `RpcStub` (lint-enforced in this repo's vite.config.ts) (docs/integration-testing.md:82-104).

## The fixture gatekeeper

`fixtures/gatekeeper-test/` is a real Worker speaking the real gatekeeper protocol whose verification outcome the tests set over an HTTP control route. It exists because the overseer's observer cases need a gatekeeper that refuses an observer *on command*, and every shipping gatekeeper can only do that at a cost that would dominate the test (OAuth ones need a whole vendor auth surface; the Context Library only refuses after an observation is recorded, and it's a singleton so it can't produce two simultaneously-failing bindings). Adding test hooks to real workers was considered and rejected — a "mark observed" hook would stub the very state the tracker maintains, making the test circular (packages/integration-tests/README.md:33-55; docs/integration-testing.md:39-50).

Two deliberate departures from a shipping gatekeeper, both to keep the fixture cheap (README.md:57-60): no `capnweb-validate` build step (main points straight at source — the harness's handling of a generated `main` is covered by workshop-backend instead), and one control knob, `allow` — a settled denial and an expired credential reach the overseer identically as a thrown error, so the reason string carries the difference.

## Golden-file tests

The release manifest is covered by a golden-file test (`scripts/release/manifest-lib.test.ts`); after an intentional manifest change, regenerate with `UPDATE_GOLDEN=1` and review the diff (AGENTS.md).

## Running

- All packages: `pnpm test` (root's own `node --test 'scripts/**/*.test.ts'` suite first, then per-package tests, excluding the root itself via `--filter '!cloudflare-os'`).
- One package while iterating: `pnpm --filter <package> test:run`; through the cache: `vp run -F <package> test`.
