---
type: testing
title: "Testing Strategy"
description: How tests run across the workspace — cached per-package vitest tasks with watchdog timeouts, workerd-pool suites guarded by assert-workerd, the integration-tests harness that boots the real backend plus gatekeepers with a mock model and network interceptor, and the root scripts suite.
tags: [testing, vitest, workerd, integration, caching]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-87db9394464b0c1aaacbf04b
    resource: repo://packages/integration-tests/src/harness.ts
  - id: openwiki-source-dec9bb27f6c6f3072234ee98
    resource: repo://packages/integration-tests/src/mock-model.ts
  - id: openwiki-source-8c7aabc211b0309d42e559fd
    resource: repo://packages/integration-tests/src/network-interceptor.ts
  - id: openwiki-source-4aaf717c32155bd6cada3076
    resource: repo://packages/workshop-backend/vitest.config.ts
  - id: openwiki-source-f984670cebcdb6f0af7b87ca
    resource: repo://packages/workshop-backend/vitest.integration.config.ts
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Testing Strategy

## Two ways to run one package's tests

`pnpm test` runs the root's own `node --test 'scripts/**/*.test.ts'` suite and then the per-package **cached** test tasks (package.json:21). Each package declares `test` as a **Vite+ task rather than a script** so vitest's scratch paths can be excluded from the fingerprint — vp declines to cache a task that reads a path it also writes, and without excluding `node_modules/.vite`, `.vite-temp` and `.wrangler` (workspace-wide, because wrangler scratch bundles reach past the owning package) almost nothing would cache (scripts/vitest-task-vite-config.ts:13-17, 63-72). Since a task may not share a name with a script, packages have no `test` script; the direct path is `pnpm --filter <package> test:run` (plain vitest) versus `vp run -F <package> test` (cached).

Tradeoffs, as documented: the cached path **replays instantly when the package is untouched**, but its fingerprinting/archiving loses to plain vitest on a package you just edited — by more than the whole suite costs on a small one. Use `test:run` while iterating and `pnpm test` to verify (AGENTS.md §testing; scripts/vitest-task-vite-config.ts:19-34). A task's commands run as an array cached as one entry per command, so a package with codegen ahead of its tests can replay the codegen and re-run only tests (scripts/vitest-task-vite-config.ts:100-108).

## The watchdog

Every test command runs under `scripts/with-timeout.ts` (scripts/vitest-task-vite-config.ts:76-98):

- **Idle timeout 60 s** — silence, not wall clock, distinguishes a hang from a slow suite (a healthy `vitest run` prints a line per completed file); **total cap 600 s** for a chatty loop.
- It kills the **whole process tree** and exits **124** (GNU `timeout`'s code, distinct from any vitest code) (scripts/with-timeout.ts:1-28).
- Why it exists: nothing else bounds a wedged run — vitest's own timeouts are enforced *inside* the test worker that died, Vite+ has no task timeout, and `@cloudflare/vitest-pool-workers` imports Miniflare without `onWorkerdCrashRestart`, so a workerd that dies mid-run leaves the pool awaiting a reply that never arrives. The thresholds are baked into the command string (part of the cache fingerprint) rather than read from env, which a cached run would strip (scripts/with-timeout.ts:4-24).

Suspect **memory first** when a run dies this way: an OOM-killed (exit 137) workerd child wedges its vitest parent instead of failing (AGENTS.md §testing).

## Workerd-pool suites and assert-workerd

Five packages' tests run inside **workerd** via `@cloudflare/vitest-pool-workers` (`router`, `typed-storage`, `backend-utils`, `workshop-backend`, `gatekeeper-scheduler`) so they exercise production runtime APIs. Each loads `scripts/assert-workerd.ts` as a `setupFiles` entry, which **throws unless `navigator.userAgent` is `Cloudflare-Workers`** — so a pool that fails to start fails the suite instead of silently falling back to Node, which would otherwise look like a pass in packages importing no `cloudflare:*` module (packages/workshop-backend/vitest.config.ts:1-24, scripts/assert-workerd.ts:1-14).

workshop-backend's workerd suite binds a test-only SQLite DO (`TEST_OVERSEER` → `OverseerDurableObject`) to support the Overseer cost-persistence integration test without loading the full deployment configuration (packages/workshop-backend/vitest.config.ts:10-16).

## The integration suite

`packages/workshop-backend` also runs `vitest.integration.config.ts` against `__integration__/*.test.ts` (packages/workshop-backend/vitest.integration.config.ts:1-50):

- It boots the real `wrangler.jsonc` configuration with `remoteBindings: false`, pays the workerd cold start in a generous 60 s first-test timeout, and tolerates only the exact unhandled rejections its reset-recovery tests intentionally provoke (expected open-error codes, abortAllDurableObjects, injected user-DO resets) — everything else stays fatal.

The reusable harness (`packages/integration-tests/src/harness.ts`) is **parameterized over gatekeepers on purpose** — "point the harness at the package and plug in a handler module" (packages/integration-tests/src/harness.ts:1-8):

- It boots the **real workshop-backend alongside real gatekeepers** under wrangler's `createTestHarness`, reading each package's checked-in `wrangler.jsonc` (pinning `build.cwd` for generated-main workers and absolutizing `main`, the same way run-dev-server does) (packages/integration-tests/src/harness.ts:60-90).
- **Mock model** (`mock-model.ts`): intercepts chat-completions calls, answers agent steps from a scripted queue, and pattern-matches the auxiliary one-shot calls (thread title, gadget title, binding name) to canned responses, so no real inference is needed (packages/integration-tests/src/mock-model.ts:1-40).
- **Network interceptor** (`network-interceptor.ts`): createTestHarness routes outbound `fetch()` back through the Node process, so patching `globalThis.fetch` suffices; localhost passes through and **anything unmocked throws**, so an unmocked call fails the test instead of silently reaching the internet (packages/integration-tests/src/network-interceptor.ts:1-10).
- **RPC client** (`rpc-client.ts`) drives the backend over the same Cap'n Web surface the SPA uses.

## Related pages

- [Build System and Dev Server](/openwiki/operations/build-and-dev.md) — the caching rules these tasks live under.
- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md) — what the integration tests drive.
