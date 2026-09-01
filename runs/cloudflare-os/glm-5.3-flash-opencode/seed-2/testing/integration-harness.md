---
type: testing
title: Integration tests and the wrangler harness
description: The end-to-end suite — wrangler createTestHarness boots the real backend and gatekeepers, the network interceptor guarantees nothing reaches the internet, the Cap'n Web RPC client speaks the browser's transport, and the fixture gatekeeper makes observer denials testable.
tags: [testing, integration, wrangler, workerd, observers]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-fc70743079da2d3d1e2de35e
    resource: repo://packages/integration-tests/__tests__/observer-reverification.test.ts
  - id: openwiki-source-879d7af57430f6885e68b413
    resource: repo://packages/integration-tests/fixtures/gatekeeper-test/src/test-gatekeeper.ts
  - id: openwiki-source-8c9bf5a84c0258d85f369973
    resource: repo://packages/integration-tests/README.md
  - id: openwiki-source-87db9394464b0c1aaacbf04b
    resource: repo://packages/integration-tests/src/harness.ts
  - id: openwiki-source-8c7aabc211b0309d42e559fd
    resource: repo://packages/integration-tests/src/network-interceptor.ts
  - id: openwiki-source-5b1b4d222bc653021150f73e
    resource: repo://packages/integration-tests/src/rpc-client.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Integration tests and the wrangler harness

`packages/integration-tests` drives the **real** Workshop and a real gatekeeper over the actual RPC
API. Nothing is stubbed except outbound HTTP — and the code under test therefore runs in **another
process** (workerd), which shapes every decision in the suite
(`docs/integration-testing.md:23-33`; `packages/integration-tests/README.md:1-8`).

## The toolkit

Three source-only modules, consumed both here and by per-vendor suites in repos that vendor this
one as a submodule (`packages/integration-tests/README.md:10-27`):

- **`src/harness.ts`** — boots `workshop-backend` plus any set of gatekeepers under wrangler's
  `createTestHarness()`, patching the checked-in `wrangler.jsonc` files in memory (validated with a
  narrow zod schema, so a broken config fails with the field named). It is **parameterised over
  gatekeepers on purpose**: a suite for a new gatekeeper is "point the harness at the package and
  plug in a handler module", not a fork. With `WORKSHOP_INTEGRATION_PREBUILT=1` (set by the global
  setup after validating the wrangler-validated entry builds exist) it drops the build command so
  isolated test-file processes share one build (`harness.ts:12-143`).
- **`src/network-interceptor.ts`** — patches `globalThis.fetch` (enough, because the harness routes
  Worker subrequests back through the Node process). Loopback passes through; anything a handler
  doesn't claim **throws** — an unmocked call fails the test instead of silently reaching the
  internet, and `getUnmockedCalls()` backs the afterAll escape assertion. Handler modules are
  pluggable, so vendor endpoint mocks live outside the mechanism
  (`network-interceptor.ts:1-90`).
- **`src/rpc-client.ts`** — speaks Cap'n Web over a WebSocket to `/api`, the same transport the
  browser uses: sign-up, connected-account reads, and `ObserverConfigRecorder`, which records the
  overseer's `configure()` calls and answers from a scripted queue. It **owns the capnweb
  boundary**: callback stubs are minted with `stubFor()`, never with an imported `RpcStub`, because
  a consumer repo can end up with two capnweb copies and a stub from the wrong one fails to
  serialize (a lint rule in the root `vite.config.ts` enforces this in-repo)
  (`rpc-client.ts:52`, `65`, `149`; `vite.config.ts:157-193`).

## The fixture gatekeeper

`fixtures/gatekeeper-test/` is a real Worker speaking the real protocol whose verification outcome
the tests set over an HTTP control route. It exists because the overseer's observer cases need a
gatekeeper that refuses an observer *on command*, and no shipping one can do that cheaply: OAuth
gatekeepers need a whole vendor auth surface mocked before an account exists, and the Context
Library (a singleton) only refuses after an observation has been *recorded*. Adding test hooks to
shipping workers was considered and rejected — a "mark observed" hook would stub the very state the
tracker maintains (`docs/integration-testing.md:45-64`;
`fixtures/gatekeeper-test/src/test-gatekeeper.ts:1-21`).

Two deliberate departures from a shipping gatekeeper, both for cheapness: no `capnweb-validate`
build step (`main` points straight at source), and **one control knob, `allow`** — a settled denial
and an expired credential reach the overseer identically as a thrown error (it deliberately treats
every failure as repairable), so the reason string carries the distinction and tests exercise both
narratives by choosing reason text (`packages/integration-tests/README.md:51-59`).

## The four constraints

From `docs/integration-testing.md`, these are the findings any suite here must respect:

1. **Fake timers cannot work.** `vi.useFakeTimers()` patches the test process's clock; the code
   under test reads workerd's clock, out of process. (Fake timers *do* work for in-isolate unit
   tests under `vitest-pool-workers`, where the test runs in the same isolate.)
2. **A fixture gatekeeper, not a real one, for overseer logic** — for the cost reasons above; the
   fixture is scoped to overseer logic, not a substitute for per-vendor coverage.
3. **Storage isolation is by convention.** `server.reset()` costs ~3 s per call (more than an
   entire suite run) and restarts the server, killing every open WebSocket. So storage persists for
   the harness's lifetime and **no test may assume a clean slate**: tests take fresh identities
   (`nextUsernames()`), per-test resource URLs, and harness-allocated account labels. The
   "nothing escaped" assertion belongs in `afterAll`, not `afterEach` — with `it.concurrent` an
   `afterEach` fires while siblings are still running and could clear their state.
4. **wrangler and workerd versions are coupled.** The root `overrides` pins workerd; a newer
   wrangler brings a newer miniflare demanding a newer workerd, and the harness then fails to boot.
   The public package pins `wrangler ~4.104.0` to match; bumping one means bumping the other in
   step.

(Also: workerd entry modules may export only classes and the default handler — a named non-class
export fails with a confusing map-entry type error.)

## The suites

The `__tests__/` directory covers the overseer's observer logic end to end
(`observer-reverification.test.ts` — role-based scope, ambient auto-selection, first-open prompt,
re-prompt with the failed account, and the named-failure terminal message), agent behavior
(`workshop-agent*.test.ts`), blueprints, lifecycle, presence, and sharing. Per `docs/integration-testing.md:3-13`,
this repo's suite covers the overseer's observer logic; a *consumer* repo's per-vendor suite (the
shape this toolkit is parameterised for) covers a genuinely expired credential end to end against a
real vendor gatekeeper — no such suite lives here, and nothing depends on one existing.
