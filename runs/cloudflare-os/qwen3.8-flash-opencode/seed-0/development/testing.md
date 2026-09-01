---
type: concept
title: Testing Strategy and Harnesses
description: The repo's test layers — node --test script suites, per-package vitest tasks (Node vs workerd pools), the assert-workerd fallback guard and with-timeout watchdog, golden-file manifests, and the out-of-process integration-tests harness with its fixture gatekeeper and fresh-identity rules.
tags: [testing, vitest, workerd, integration-tests, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
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
  - id: openwiki-source-dec9bb27f6c6f3072234ee98
    resource: repo://packages/integration-tests/src/mock-model.ts
  - id: openwiki-source-f984670cebcdb6f0af7b87ca
    resource: repo://packages/workshop-backend/vitest.integration.config.ts
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-3b8974a8bc6d44b3b420ad1e
    resource: repo://scripts/contribution-policy.test.ts
  - id: openwiki-source-7d8b3744f7e1cb06a10226fa
    resource: repo://scripts/release/manifest-lib.test.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Testing Strategy and Harnesses

`pnpm test` = the root's `node --test 'scripts/**/*.test.ts'` suite, then the per-package cached `test` tasks via `vp run --filter '!cloudflare-os' --cache test` (package.json:10). Below that sit distinct layers with different rules.

## Layer 1: `scripts/**/*.test.ts` — plain Node tests

Tooling tests run under `node --test`, not vitest — the root lint config's override ordering exists specifically so these files keep `env: node` instead of vitest globals (vite.config.ts:148-155). They cover the build/dev/release machinery itself: e.g. `contribution-policy.test.ts` drives the PR-policy automation against fixture pull requests (including fields the policy deliberately ignores, like `draft`/`merged`) and even reads `.github/pull_request_template.md` and the workflow YAML to keep them consistent (scripts/contribution-policy.test.ts:1-40); `env-passthrough.test.ts` audits build-time env usage ([Build System and Toolchain](/openwiki/development/build-tooling.md)); `dev-server-config.test.ts`, `pnpm-command.test.ts`, `kill-process-tree.test.ts` cover dev-server plumbing and process control.

## Layer 2: per-package vitest, cached through the shared task

Each test-bearing package exports the shared `vitestTask(...)` from `scripts/vitest-task-vite-config.ts` in its `vite.config.ts` as a `test` **task** (not a script — a task can't share a script's name, and only a task can exclude the scratch paths vitest itself writes and reads back: `node_modules/.vite/vitest/*/results.json` used for test ordering, timestamped `node_modules/.vite-temp/*.mjs` config compiles, `.wrangler` scratch) (scripts/vitest-task-vite-config.ts:1-49). Every command in that task is wrapped by `withTestTimeout` → `scripts/with-timeout.ts --idle 60 --max 600 --` (scripts/vitest-task-vite-config.ts:80-101).

**Why the watchdog exists** (scripts/with-timeout.ts:1-25): nothing else bounds a wedged run — vp has no task timeout; vitest's `testTimeout`/`hookTimeout` are enforced *inside* the test worker and die with it; `teardownTimeout` only arms after the run resolves; and `@cloudflare/vitest-pool-workers` doesn't pass `onWorkerdCrashRestart`, so an OOM-killed workerd (exit 137, the memory risk flagged by the singleThreaded note in [Build System and Toolchain](/openwiki/development/build-tooling.md)) would leave the pool awaiting a reply forever. Silence on the command's output is the primary detector (a healthy `vitest run` prints per file); it kills the whole process tree and exits **124** like GNU `timeout`.

Two ways to run one package: `pnpm --filter <pkg> test:run` (straight vitest, best while iterating) vs `vp run -F <pkg> test` (cached; replays instantly when untouched) (repo guidance). Packages with no test files re-export the configurator config's default instead of `withTests`, because `vitest run` exits 1 when it finds none (repo guidance; see `scripts/gatekeeper-configurator-vite-config.ts`).

## Layer 3: the workerd pool and its guard

Five-plus packages run tests in the production runtime via `@cloudflare/vitest-pool-workers` (`router`, `typed-storage`, `backend-utils`, `workshop-backend`, `gatekeeper-scheduler`, `gatekeeper-context`, and gatekeeper-cloudflare's workerd project), and **all load `scripts/assert-workerd.ts` as a `setupFiles` entry**: it throws unless `navigator.userAgent === "Cloudflare-Workers"`, because when the pool fails to start vitest silently falls back to Node and only suites importing `cloudflare:*` would notice — `router` and `typed-storage` import neither and would stay green testing the wrong runtime (scripts/assert-workerd.ts:1-13). The check comment itself says: fix the pool, don't delete the check.

gatekeeper-cloudflare illustrates the two-pool split: `vitest.config.ts` keeps pure-logic tests in Node ("far cheaper"), while `vitest.worker.config.ts` covers everything built on `RpcTarget`/`RpcStub`/DO `ctx.props` — including a `TestHooks` Durable Object, because a `DurableObjectClass` carrying props is only reachable via `ctx.facets`, the way the overseer instantiates it in production (packages/gatekeeper-cloudflare/vitest.worker.config.ts:6-30).

workshop-backend's `test` task runs two vitest commands: the unit pool and `vitest run --config vitest.integration.config.ts` (packages/workshop-backend/vite.config.ts:38-44). The integration config (packages/workshop-backend/vitest.integration.config.ts) pays an explicit ~6 s/18 s cold-start `testTimeout: 60_000`, and its `onUnhandledError` whitelists only *expected* independent rejections — coded openGadget errors and DO-abort fallout — leaving all other unhandled errors fatal.

## Layer 4: golden files

The release manifest is covered by a golden-file test: intentional changes are regenerated with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and the diff reviewed; a missing golden or mismatch throws with that instruction in the message (scripts/release/manifest-lib.test.ts:7, 59-66). See [Router, Release Pipeline, and Preview Deploys](/openwiki/operations/router-and-release-pipeline.md).

## Layer 5: the out-of-process integration suite

`packages/integration-tests` boots **real Workers in workerd** via wrangler's `createTestHarness()`, patching the checked-in `wrangler.jsonc` files in memory (pinning `build.cwd` to each package and absolutizing `main`, because an inline config has no file path), with the workshop backend plus a list of gatekeepers — a new suite is "point the harness at the package and plug in a handler module," never a forked copy (packages/integration-tests/src/harness.ts:1-80). Tests speak Cap'n Web over a WebSocket to `/api` — the browser's own transport — and serve an `ObserverConfigCallback` the overseer calls back into (packages/integration-tests/README.md; docs/integration-testing.md).

Consequences of "the code under test is in another process," which shape the whole suite (docs/integration-testing.md:28-44):

- **Fake timers cannot work.** `vi.useFakeTimers()` patches the test process's clock; workerd reads its own. (In-isolate `vitest-pool-workers` tests are different — they run *inside* the isolate and can fake it.)
- **Storage is never reset between tests.** `server.reset()` measured ~3 s per call (more than a full suite run), restarts the server, and kills every open RPC session. So it's a teardown, not a wipe, and **no test may assume a clean slate**: independence comes from fresh identities — `nextUsernames()`, per-test resource URLs, helper-allocated account labels (packages/integration-tests/README.md "Writing a test here").
- **The "nothing escaped to the internet" assertion belongs in `afterAll`.** With `it.concurrent`, an `afterEach` would inspect and clear state siblings are still using — and could discard an escape a sibling was about to be blamed for.

The escape guarantee comes from `NetworkInterceptor`: it patches `globalThis.fetch` (the harness routes Worker subrequests back through the Node process), passes loopback through, and **throws on anything unmatched** — a test physically cannot reach the real internet; vendor endpoints live in pluggable handler modules (packages/integration-tests/README.md; src/network-interceptor.ts). `src/mock-model.ts` is the OpenAI-compatible handler: agent steps come off a scripted queue, while quick-model auxiliary calls (thread/gadget titles, binding names) match on prompt prefix and have their own queue so they can't masquerade as agent steps (packages/integration-tests/src/mock-model.ts:1-30). A `global-setup.ts` shares the capnweb-validate builds (`.wrangler/validate/...` entries) across test-file processes and errors if the prebuild is missing (packages/integration-tests/src/global-setup.ts:1-25).

**Why a fixture gatekeeper** (`fixtures/gatekeeper-test/`): the overseer's observer cases need a gatekeeper that refuses verification *on command*; every real one can do it only at prohibitive cost (OAuth surface mocked first, or — like the Context Library — refusal requiring a recorded observation, which a singleton can't produce for two simultaneous bindings). Adding a test hook to production gatekeepers was considered and rejected because a "mark observed" hook would stub the very state the tracker maintains (docs/integration-testing.md:45-66). The fixture is a real Worker speaking the real protocol with one HTTP control knob `allow`; a single `deny` reason string covers both the "settled denial" and "expired credential" narratives because the overseer deliberately cannot tell thrown failures apart — it treats every failure as repairable (packages/integration-tests/README.md).

The suite lives in `__tests__/`: `workshop-agent.test.ts`, `workshop-agent-actions.test.ts`, `workshop-sharing.test.ts`, `workshop-blueprints.test.ts`, `workshop-lifecycle.test.ts`, `workshop-presence.test.ts`, `observer-reverification.test.ts` (file listing).

## What the suites are *not*

- No end-to-end browser test of the Workshop UI exists in-repo; the frontend has jsdom-based component tests (e.g. `workshop-frontend/src/GadgetUI.integration.test.tsx`, `ChatInterface.actions.test.tsx`), which run under the frontend's Node vitest.
- Per-vendor gatekeeper suites against mocked vendor endpoints are the toolkit's stated trajectory but none live in this repo (docs/integration-testing.md:1-18).
