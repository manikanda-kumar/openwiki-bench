---
type: reference
title: Testing and Quality Gates
description: The Node-12 unit test runner, the verify gate pipeline, contract/security/i18n checks, managed-process workflow tests, Electron smoke tests, and how to run focused tests.
tags: [testing, quality-gates, verify, unit-tests, smoke]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-87ca67717b8bc97c0f340810
    resource: repo://scripts/smoke-electron.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-610d63015519b5ce933f8f5f
    resource: repo://tsup.smoke.config.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Testing and Quality Gates

Pi Agent Desktop relies on a layered test strategy: fast, GPU-free Node unit
tests for the bulk of logic, focused workflow/flood suites for the managed
process subsystem, Electron integration tests for the browser, and a single
`verify` gate that blocks packaging/release if any layer fails.

## Unit tests (Node, no display)

`npm run test` runs `scripts/test.mjs`, which invokes `scripts/test-runner.mjs`.
The runner discovers every `src/**/*.test.mjs` file and runs them under Node's
built-in test runner (`node --test`) with a per-test timeout
(`--test-timeout=120000` default, override with `PI_TEST_TIMEOUT_MS`)
(`test-runner.mjs:18-28`).

Because the RPC layer is transport-agnostic (`AnyMessagePort`) and most Host
modules avoid Electron-only types, unit tests run in a pure Node process without
a GPU, display, or real utility process. This keeps the suite fast and reliable
in CI.

`runTests` also asserts there is no legacy test-bundle usage and cleans up
`.artifacts/test-modules`.

## Electron smoke test

`npm run smoke` (`scripts/smoke-electron.mjs`) builds a small bundle with
`tsup.smoke.config.ts` (`src/smoke/main.ts` → CJS) and launches Electron against
a temp user-data dir with `PI_DESKTOP_SMOKE_USER_DATA`. It verifies, over a real
MessagePort connection to the Host: host/toolchain ping, sessions, Worktree
conflict handling, Git status, directory watching, exact binary download, and
safe Skill editing. A 45s timeout and 0-exit-or-signal exit handling bound the
run.

## Managed-process workflow and flood tests

Separate targeted scripts simulate real managed background-process scenarios
without a full build:

- `npm run test:managed-process-workflows` — lifecycle and cleanup workflows.
- `npm run test:managed-process-flood` — a 60-second high-rate start/stop load
  test.
- `npm run test:managed-process-frameworks` — framework-backed (Vite/React/
  Flask/…) start + readiness behavior.
- `npm run test:windows-nsis-upgrade` / `test:windows-managed-helper` —
  Windows helpers and upgrade paths.

## Contract, security, i18n, tooling checks

These are standalone scripts that enforce invariants:

- `npm run check:contract` (`scripts/check-contract-coverage.mjs`) — every `Api`
  method has a Host handler and vice versa.
- `npm run check:pi-compat`, `check:toolchain-contract`,
  `check:toolchain-catalog` — Pi 0.84 compatibility and toolchain catalog safety.
- `npm run check:desktop-security` (`scripts/check-desktop-security.mjs`) —
  security-context invariants (sandbox/CSP/secret handling).
- `npm run check:i18n` (`scripts/check-renderer-i18n.mjs`) — renderer i18n
  string invariants.
- `npm run check:dependencies`, `check:production-artifacts`,
  `verify-packaged-toolchains` — dependency and packaged-artifact invariants.
- `npm run check:windows-helper-reproducibility`, `check:windows-sbom` —
  reproducible/sbom verification for the Windows helper.

## Electron/browser integration tests

- `npm run test:browser-electron` — local Browser Electron integration tests.
- `npm run test:browser-agent-e2e` — real Browser + Agent E2E.

These require Electron and are run later in the pipeline than the Node unit
tests.

## The verify gate

`npm run verify` (`scripts/verify.mjs`) blocks `pack`/`dist` (README). It runs,
in order and aborts on the first failure:

format check → lint → typecheck (main/host) → typecheck (renderer) →
dependency contract → unit tests → managed-process workflows → managed-process
flood → contract coverage → Pi 0.84 compat → toolchain contract →
toolchain catalog → browser i18n → desktop security → build →
production-artifact isolation → Electron smoke → Browser Electron integration →
Browser real Agent E2E (`verify.mjs:21-43`).

## Running focused tests

- Unit + focused helpers: `npm run test` (or `node --test src/path/*.test.mjs`).
- A specific pattern: the runner scans `src/**/*.test.mjs`; you can instead use
  Node's test runner directly on an individual file, e.g.
  `node --test src/contract/rpc.test.mjs`.
- Type-only: `npm run typecheck`.
- Lint/format before committing: `npm run lint && npm run format:check`.

## Related pages

- Quickstart
- Change Guide: Main Process and IPC
- Logging and Diagnostics
