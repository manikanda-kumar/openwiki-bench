---
type: testing
title: Test layout across packages
description: Where the tests live and why — vitest node vs workerd pools with the assert-workerd guard, the shared cached test task with its scratch exclusions and watchdog, the root scripts suite, and how to run per-package suites.
tags: [testing, vitest, workerd, cache, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-b5706caf3ceee3b49c6af949
    resource: repo://packages/gatekeeper-cloudflare/package.json
  - id: openwiki-source-30239eee070a503c224c24f6
    resource: repo://packages/workshop-backend/package.json
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
  - id: openwiki-source-24e06bf2d2a30965ab2d59ec
    resource: repo://scripts/assert-workerd.ts
  - id: openwiki-source-73f68b916aa178abb533e5a1
    resource: repo://scripts/vitest-task-vite-config.ts
  - id: openwiki-source-915358bbba30a4a53e4dc1d5
    resource: repo://scripts/with-timeout.ts
  - id: openwiki-source-98d5ddb014a0fd4d678f6f2a
    resource: repo://tsconfig.json
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Test layout across packages

`pnpm test` runs two things in order: the repo root's own `node --test 'scripts/**/*.test.ts'`
suite (the scripts are deliberately kept off `pnpm build`'s hot path and type-checked separately in
CI), then `vp run --filter '!cloudflare-os' --cache test` — the `--filter` hardcodes the root
package's name because `-r` would select the root and run its suite twice
(`package.json:10`; `REVIEW.md:84-87`).

Every other package's tests run under vitest. Two ways to run one package: `pnpm --filter <package>
test:run` goes straight to vitest; `vp run -F <package> test` goes through the cache (instant
replay when untouched, slower on a package you just edited). The direct script is `test:run`
because **a Vite+ task may not share a name with a package.json script** — hence no `test` script
anymore (`scripts/vitest-task-vite-config.ts:14-18`).

## Node vs workerd pools

Five packages' tests execute inside workerd via `@cloudflare/vitest-pool-workers`:
`router`, `typed-storage`, `backend-utils`, `workshop-backend`, and `gatekeeper-scheduler`
(marked by a `miniflare` block in their vitest configs). Everything else (`workshop-frontend`,
`workshop-shared` via the root, `mcp-shared`, most gatekeepers' logic tests) runs plain vitest in
Node.

**`scripts/assert-workerd.ts` is a `setupFiles` entry in every workerd pool.** It throws unless
`navigator.userAgent === "Cloudflare-Workers"`, because when the pool fails to start, vitest
silently falls back to Node — and only suites importing `cloudflare:test`/`cloudflare:workers`
would notice. `router` and `typed-storage` import neither, so without this guard they'd stay green
while testing the wrong runtime. Removing it to make a suite green is a review rejection
(`assert-workerd.ts:1-17`; `REVIEW.md:84-85`).

Some packages run **two** vitest passes: `gatekeeper-cloudflare` adds
`vitest.worker.config.ts` (workerd, for `RpcTarget`/`RpcStub`/Durable Objects — reaching the
gatekeeper through a `TestHooks` DO because a DO class carrying `ctx.props` is only reachable via
`ctx.facets`), `gatekeeper-context` adds `vitest.node.config.ts`, and `gatekeeper-scheduler` adds
`vitest.app.config.ts`. `workshop-backend`'s `test:run` also builds its generated inputs first
(browser runtime, format blueprints) and then runs its **integration** config as a second pass
(`vitest.integration.config.ts`; the [integration harness](/openwiki/testing/integration-harness.md)
is documented separately).

## The shared cached test task

`scripts/vitest-task-vite-config.ts` builds the Vite+ `test` task every vitest package re-exports.
Its reason to exist is cacheability: **vp declines to cache a task that reads a path it also
wrote**, and vitest writes scratch files it reads back on the next run. The shared exclusions
(workspace-wide, because tracking reaches past the owning package and siblings would otherwise
invalidate each other):

- `node_modules/.vite/**` — vitest's results.json (sequencer ordering); distinct from
  `node_modules/.vite/deps`, a real transform cache.
- `node_modules/.vite-temp/**` — vite's compiled-config temp modules, timestamped per run.
- `.wrangler/**` — the capnweb-validate build tree, derived from tracked sources.

When a test task stops caching, `vp run --last-details` names the path it read and wrote — add it
here if shared, or at the call site if it's one package's own (`vitest-task-vite-config.ts:41-73`).

## The watchdog

Every vitest command in the shared task runs under `scripts/with-timeout.ts` with two thresholds
baked into the command string: **60 s of silence** (a healthy `vitest run` prints a line per
completed file, so silence — not wall clock — distinguishes a hang) and a **600 s total cap**. It
exists because nothing else bounds a wedged run: vitest's own timeouts die with the test worker,
Vite+ has no task timeout, and `vitest-pool-workers` imports Miniflare without a crash-restart hook,
so a workerd that dies mid-run leaves the pool awaiting a reply forever. The watchdog kills the
child's **entire process tree** and exits **124** (GNU `timeout`'s code) — so suspect **memory
first** when you see one: an OOM-killed (exit 137) workerd child wedges its vitest parent instead of
failing, and the watchdog is what turns that into a fast, visible failure
(`with-timeout.ts:1-31`; `vitest-task-vite-config.ts:75-100`).

Thresholds are baked into the string rather than read from the environment on purpose: the command
is part of the cache fingerprint, and a cached `vp` run strips undeclared env vars — an override
would silently not apply. A policy change is therefore a visible, fingerprinted change.

## What runs where (summary)

| Package | Suite | Runtime |
| --- | --- | --- |
| root (`cloudflare-os`) | `node --test scripts/**/*.test.ts` | Node |
| workshop-backend | vitest + vitest.integration.config | workerd pool |
| workshop-frontend | vitest | Node (jsdom) |
| router, typed-storage, backend-utils | vitest | workerd pool |
| gatekeeper-cloudflare | vitest + vitest.worker.config | Node + workerd |
| gatekeeper-context | vitest + vitest.node.config | workerd + Node |
| gatekeeper-scheduler | vitest + vitest.app.config | workerd |
| mcp-shared, other gatekeepers | vitest | Node |
| integration-tests | prebuild + vitest | separate workerd harness |

Type checking is single recursive `tsc` with `"singleThreaded": true` in the root tsconfig —
measured both the fastest and the smallest configuration against tsgo's parallel checkers, and
reviewers will not accept churn on it (`tsconfig.json:19`; `REVIEW.md:108`).
