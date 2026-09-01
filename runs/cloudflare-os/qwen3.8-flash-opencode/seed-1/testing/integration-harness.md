---
type: testing
title: Integration Test Harness
description: packages/integration-tests boots real Workers under wrangler's createTestHarness with no stubs but the network — why fake timers cannot work, why a fixture gatekeeper covers overseer logic, the storage-isolation-by-identity convention, and the capnweb single-copy boundary.
tags: [testing, workerd, wrangler, harness, network-interception, fixtures]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-b24a5a09b5c0a5bf2dfdbdd3
    resource: repo://packages/integration-tests/src/global-setup.ts
  - id: openwiki-source-87db9394464b0c1aaacbf04b
    resource: repo://packages/integration-tests/src/harness.ts
  - id: openwiki-source-8c7aabc211b0309d42e559fd
    resource: repo://packages/integration-tests/src/network-interceptor.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Integration Test Harness

`packages/integration-tests` runs the production code end to end: wrangler's
`createTestHarness()` boots `workshop-backend` (and one or more gatekeepers) as **real Workers in
workerd**, using each package's checked-in `wrangler.jsonc` patched in memory, and tests speak
Cap'n Web over a WebSocket to `/api` — the same transport the browser uses
(docs/integration-testing.md#L24-L30; `NetworkInterceptor` relies on createTestHarness routing
outbound `fetch()` back into the Node process, packages/integration-tests/src/network-interceptor.ts#L1-L9;
harness at packages/integration-tests/src/harness.ts#L1-L6). The consequence to internalize: **the
code under test is in another process**. Everything below follows from that.

## Why fake timers don't work

`vi.useFakeTimers()` patches the *test process's* clock; the Workers read workerd's clock, out of
process, so faked time is invisible to them (e.g. a token-expiry skew check inside a gatekeeper
evaluates on the real clock). Fake timers only work for in-isolate tests under
`vitest-pool-workers` (docs/integration-testing.md#L32-L42).

## Why a fixture gatekeeper

The overseer's observer logic needs a gatekeeper that refuses verification *on command*. Every
shipping public gatekeeper could do that only at a cost that dominates the test (full vendor auth
mocks, or a singleton that can't produce two simultaneously-failing bindings), and adding
"mark observed" hooks to real workers would stub the very state the tracker maintains — making the
test circular. So `fixtures/gatekeeper-test/` is a real Worker speaking the real protocol whose
verification outcome tests set over an HTTP control route — explicitly scoped to overseer logic,
"not a long-term substitute for per-vendor coverage"
(docs/integration-testing.md#L44-L63). The design anticipates per-vendor suites (including in
consumer repos that vendor this repo as a `public/` submodule): the harness takes a *list* of
`GatekeeperSpec`s and the interceptor takes pluggable `Handler` modules, so a new connector's suite
is "add `google-handlers.ts`, point the harness at the package"
(docs/integration-testing.md#L56-L63; packages/integration-tests/src/harness.ts#L3-L6,
packages/integration-tests/src/network-interceptor.ts#L8-L24).

## Storage isolation is by convention

`server.reset()` measures ~3 s per call and tears down the running server (killing every WebSocket
session), so it's a teardown, not a between-test wipe. Storage therefore persists for the harness
lifetime and **no test may assume a clean slate**: independence comes from fresh identities —
`nextUsernames()`, per-test resource URLs, helper-allocated account labels — and the "nothing
escaped to the internet" assertion belongs in `afterAll`, not `afterEach`, because concurrent
siblings are still exercising interceptor state (docs/integration-testing.md#L65-L83; helpers in
packages/integration-tests/src/rpc-client.ts).

## The capnweb single-copy boundary

A stub is serializable only by the capnweb instance that owns its session. A consumer repo with
two pnpm stores ends up with two `capnweb` copies, and mixing them fails with
`Cannot serialize value: [object RpcStub]` — a trap that only shows in CI, where the submodule is
installed separately. So the toolkit owns the boundary: tests mint stubs via `stubFor()` from
`rpc-client` (type-only `RpcStub` imports are fine), enforced structurally by lint rules restricting
`capnweb` value imports in that package to `rpc-client.ts`
(docs/integration-testing.md#L104-L125).

## Operational constraints

- **workerd/wrangler versions are coupled**: a root `overrides` pins workerd, and the public
  package pins wrangler to `~4.104.0` whose bundled workerd matches; bump one and the harness
  refuses to boot on a compatibility-date mismatch (docs/integration-testing.md#L85-L102).
- **Entry modules may export only classes and the default handler** — workerd treats every named
  export as an entrypoint, so string constants must stay module-private
  (docs/integration-testing.md#L127-L136).
- **Validated builds are shared**: a vitest `globalSetup` reuses the `capnweb-validate` outputs of
  `workshop-backend` and the fixture (`.wrangler/validate/...`) across test-file processes,
  rebuilding them in watch mode (packages/integration-tests/src/global-setup.ts#L8-L22).
- `TEST_GATEKEEPER_BINDING = "TEST"` is what the Workshop's `GATEKEEPER_*` scan turns into the
  fixture's `test` vendor id — the same derivation the production router uses
  (packages/integration-tests/src/harness.ts#L22-L29; packages/router/src/index.ts#L26-L29).

## What the suites cover

The `__tests__/` directory splits by concern: `workshop-lifecycle` (accounts/workspaces),
`workshop-agent` and `workshop-agent-actions` (turns and approvals), `workshop-sharing`,
`workshop-presence`, `workshop-blueprints`, `observer-reverification` (the re-prompt path — see
[Capability Security Model](../security/capability-security-model.md)), plus toolkit self-tests
(`network-interceptor`, `mock-model`). The agent's own model responses come from
`src/mock-model.ts`, not a live provider.

Related: [Testing and Build Tooling](./testing-and-tooling.md),
[Gatekeeper Framework](../security/gatekeeper-framework.md).
