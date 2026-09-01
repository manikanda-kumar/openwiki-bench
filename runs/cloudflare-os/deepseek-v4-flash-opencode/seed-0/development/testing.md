---
type: guide
title: Testing infrastructure
description: How tests are organized and run — vitest projects (Node vs workerd pools), the assert-workerd setup, the cached per-package test tasks, the integration-test harness, and the constraints that shape suites.
tags: [testing, vitest, workerd, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-8c9bf5a84c0258d85f369973
    resource: repo://packages/integration-tests/README.md
  - id: openwiki-source-30239eee070a503c224c24f6
    resource: repo://packages/workshop-backend/package.json
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Testing infrastructure

The repo runs two kinds of suites: per-package **vitest** suites and the **integration-tests**
package, which boots the real Workshop and gatekeepers in workerd. All test commands run under a
watchdog so a wedged run fails fast instead of stalling CI.

## How to run tests

- **`pnpm test`** — runs the root's own `node --test 'scripts/**/*.test.ts'` suite, then
  `vp run --filter '!cloudflare-os' --cache test` (the root package is excluded by name because
  `-r` would select it and run the scripts suite twice).
- **`pnpm --filter <pkg> test:run`** — the package's direct vitest script (with codegen steps some
  packages prefix, e.g. `workshop-backend` runs `build-browser-runtime.mjs` and
  `build-format-blueprints.mjs` first).
- **`vp run -F <pkg> test`** — the cached path. The `test` task is a **Vite+ task, not a script**
  (a task may not share a name with a script), so its `input` can exclude the scratch paths vitest
  writes and reads back (`node_modules/.vite`, `node_modules/.vite-temp`, `.wrangler/validate`) — vp
  declines to cache a task that reads a path it also wrote. Use `test:run` while iterating (it beats
  the cache's fingerprinting on a package you just edited) and `pnpm test` to verify.

## Per-package vitest projects

Most packages that have tests declare **two vitest projects**:

- `vitest.config.ts` — runs under Node for pure-logic tests.
- `vitest.worker.config.ts` — runs under `@cloudflare/vitest-pool-workers` (workerd) for tests that
  exercise `RpcTarget`/`RpcStub`/Durable Objects.

The five packages that run in workerd (`router`, `typed-storage`, `backend-utils`,
`workshop-backend`, `gatekeeper-scheduler`) load `scripts/assert-workerd.ts` as a `setupFiles` entry.
It throws unless `navigator.userAgent === "Cloudflare-Workers"`, so a pool that fails to start fails
the suite instead of silently falling back to Node — which would otherwise look like a pass for the
packages that import no `cloudflare:*` module. Don't remove it to make a suite green.

### The timeout watchdog

`scripts/with-timeout.ts` wraps every command in the shared `test` task: an **idle timer** (60s with
no output — a healthy `vitest run` prints a line per completed test file, so silence is the hang
signal) and a **total wall-clock cap** (600s). When either fires it kills the command's entire
process tree and exits 124 (GNU `timeout`'s code). The watchdog exists because nothing else bounds a
wedged run: vitest's own timeouts die inside the test worker, and a workerd that dies mid-run leaves
the pool awaiting a reply forever. The workerd fleets are also the memory hogs — an OOM-killed
(exit 137) workerd wedges its vitest parent, so suspect memory first and drop vp's concurrency when
you see exit 124s.

## The integration-tests package

`packages/integration-tests` drives the real system over the real RPC transport. Three source-only
toolkit modules:

- **`src/harness.ts`** — boots `workshop-backend` and any set of gatekeepers as real Workers under
  `wrangler`'s `createTestHarness()`, patching their checked-in `wrangler.jsonc` in memory.
  Parameterised over gatekeepers on purpose: a suite for a new gatekeeper is "point the harness at the
  package", not a forked copy.
- **`src/network-interceptor.ts`** — mechanism only: patches `globalThis.fetch`, passes loopback
  through, and **throws on anything a handler didn't match**, so a test cannot reach the real
  internet. What a vendor's endpoints answer lives in a pluggable handler module.
- **`src/rpc-client.ts`** — speaks Cap'n Web over a WebSocket to `/api`, the same transport the
  browser uses, including an `ObserverConfigRecorder` that answers the overseer's `configure()` calls
  from a scripted queue.

Because the code under test is in another process, several constraints shape the suites:

- **No fake timers across processes** — `vi.useFakeTimers()` patches the test process's clock, which
  the workerd-isolated code cannot see.
- **Storage is shared and never reset** — `server.reset()` restarts the server (killing every open
  WebSocket session) and takes ~3s, so it is a teardown, not a per-test wipe. Tests take fresh
  identities from `nextUsernames()`, per-test resource URLs, and harness-allocated account labels.
- **The "nothing escaped to the internet" assertion belongs in `afterAll`, not `afterEach`** — with
  `it.concurrent`, an `afterEach` fires while siblings are still running.
- **A fixture gatekeeper, not a real one**, for the overseer's observer logic: `fixtures/gatekeeper-test`
  is a real Worker speaking the real protocol whose verification outcome tests set over an HTTP
  control route. A "mark observed" test hook on the real gatekeepers was rejected as circular.
- **Worker entry modules may export only classes and the default handler** — workerd treats every
  named export as an entrypoint, so a plain constant export fails to boot.
- **The capnweb boundary is owned by the toolkit** — the integration-tests lint rules restrict
  `capnweb` value imports to `rpc-client.ts`, which wraps stub minting in `stubFor()`. A consumer repo
  installing its own workspace *and* the `public/` submodule's gets two capnweb copies, and a stub is
  only serialisable by the instance that owns the session.
- **wrangler and workerd versions are coupled** — the root `overrides` pin collapses every transitive
  `workerd` request to one version, and `packages/integration-tests` pins `wrangler` to the release
  whose bundled `workerd` matches it.

## The workshop-backend unit suites

The bulk of kernel coverage is `packages/workshop-backend/__tests__/`: per-module vitest suites
(`sharing`, `admin-config`, `agent-compaction`, `git-store`, `auto-approval`, `do-retry`,
`ai-models`, `chat-changes`, `code-preview`, `client-errors`, ...), a shared `fixtures.ts` /
`mock-storage.ts` for constructing typed-storage over a mock DO, and an `__integration__` suite
(`vitest.integration.config.ts`) for cross-DO behavior. These run under the workerd pool with
`assert-workerd` guarding the runtime.
