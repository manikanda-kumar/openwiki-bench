---
type: concept
title: Testing and Quality Gates
description: How the repository is tested and gated — node:test unit tests, contract and security invariant checks, Electron smoke, browser E2E, managed-process stress tests, and the verify pipeline plus CI matrix.
tags: [testing, quality, verify, smoke, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-e8381a19204e345fe447a619
    resource: repo://.github/workflows/build-desktop.yml
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-87ca67717b8bc97c0f340810
    resource: repo://scripts/smoke-electron.mjs
  - id: openwiki-source-09db8769aa4932549f7e2051
    resource: repo://scripts/test-browser-agent-e2e.mjs
  - id: openwiki-source-78dd55f4c5467ee2e06095d7
    resource: repo://scripts/test-browser-electron.mjs
  - id: openwiki-source-01888e2db30c06bbecb192b4
    resource: repo://scripts/test-managed-process-flood.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-28b3cfee41f93978aa200e9e
    resource: repo://src/main/desktop-workflow.test.mjs
  - id: openwiki-source-72a4a67ceb5732e7dc93520e
    resource: repo://src/smoke/main.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Testing and Quality Gates

The repository treats tests as a first-class contract: `npm run verify` is the single quality gate that blocks packaging, and CI runs a platform matrix of the same checks plus platform-specific managed-process and Windows helper acceptance.

## Unit test runner

- `npm test` → `scripts/test.mjs` → `scripts/test-runner.mjs` runs Node's built-in test runner (`node --test`) over `src/**/*.test.mjs` (`scripts/test-runner.mjs:18`).
- Every unit test is an ESM `.test.mjs` beside its source (e.g. `src/agent-host/handlers.test.mjs`, `src/main/browser/browser-policy.test.mjs`). The default timeout is 120 s, overridable with `PI_TEST_TIMEOUT_MS` (`scripts/test-runner.mjs:6`).
- The runner refuses legacy `#test-bundle` imports (`assertNoLegacyTestBundleUsage`) and cleans `.artifacts/test-modules` before and after.

### Running a single test file

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-timeout=120000 src/agent-host/handlers.test.mjs
```

## Invariant checks (contract and security)

- `npm run check:contract` (`scripts/check-contract-coverage.mjs`): parses `Api` (and stream/desktop contracts) with the TypeScript compiler and asserts every declared method is implemented by a Host handler and every renderer call references a declared method.
- `npm run check:desktop-security` (`scripts/check-desktop-security.mjs`): static invariant checks over many source files — it reads main/window/protocol/preload, diagnostics redaction, credential vault, channel APIs/media/outbound, toolchain installer/manager/state-store, updater, and the browser service/policy, verifying security-relevant patterns (trusted IPC, CSP, vault key regex, redaction, downloader host allowlists, updater redaction, packaged toolchain verification).
- `npm run check:toolchain-contract` and `check:toolchain-catalog`: enforce the toolchain capability/action contract and the runtime catalog schema (see the Toolchains pages).
- `npm run check:pi-compat`: validates compatibility with the pinned `@earendil-works/pi-coding-agent` 0.84.0.
- `npm run check:production-artifacts`: verifies packaging isolation (the packaged `files` set and `extraResources`).
- `npm run check:i18n` / `check:browser-i18n`: renderer i18n dictionary invariants.

### Adding a new contract check

Create a `scripts/check-*.mjs` script, add a `check:...` script in `package.json`, and add it to `scripts/verify.mjs` (and the CI quality step in `build-desktop.yml` if it must run on all platforms). Keep it deterministic and self-contained with its own `.test.mjs` (e.g. `scripts/check-contract-coverage.test.mjs`).

## Electron smoke

`npm run smoke` (`scripts/smoke-electron.mjs`) builds a minimal smoke bundle (`tsup.smoke.config.ts` → `.artifacts/smoke/main.js`), then launches the real Electron binary with a fresh temp `PI_DESKTOP_SMOKE_USER_DATA` and a 45 s timeout. `src/smoke/main.ts` boots Main + Host + a hidden window and `src/smoke/host-checks.ts` exercises: host `ping`, sessions, Worktree conflict handling, Git status, directory watching, exact binary download, and safe Skill editing over a real MessagePort.

## Browser tests

- `npm run test:browser-electron` (`scripts/test-browser-electron.mjs`): esbuild-bundles `src/smoke/browser-electron-harness.ts` and runs it under Electron (60 s timeout) to validate the Main-owned Browser service against a real Chromium.
- `npm run test:browser-agent-e2e` (`scripts/test-browser-agent-e2e.mjs`): builds a full Agent Host + managed-process worker + harness, and drives a real Agent session using the Browser tools end-to-end.
- `src/renderer/components/browser/browser-renderer-contract.test.mjs` and `browser-error-message.test.mjs` cover the renderer-side browser surface.

## Managed-process tests

- `npm run test:managed-process-workflows` (`scripts/test-managed-process-workflows.mjs`): starts/restarts/stops real dev servers (Vite etc.) under `ManagedProcessService`, exercising readiness, stdin, output cursors, and crash reaper behavior on the native platform.
- `npm run test:managed-process-flood` (`scripts/test-managed-process-flood.mjs`): a configurable stress run (`PI_MANAGED_FLOOD_DURATION_MS`, `PI_MANAGED_FLOOD_PROCESSES` 1–8, `PI_MANAGED_FLOOD_STREAMS`) to exercise resource bounds.
- `npm run test:managed-process-frameworks` and `test:managed-process-frameworks`: framework-specific (Vite/React/Storybook/Flask/Spring Boot) acceptance.
- `npm run test:windows-managed-helper`: Windows x64 acceptance of the Rust helper and Job Object (see the Windows helper page).
- `npm run check:windows-helper-reproducibility` and `check:windows-sbom`/`build:windows-sbom`: Windows-only release gates.

## The verify pipeline

`scripts/verify.mjs` runs, in order (`scripts/verify.mjs:21`):

1. `format:check` → 2. `lint` → 3. `typecheck` (main/host + renderer) → 4. `check:dependencies` → 5. unit tests → 6. `test:managed-process-workflows` → 7. `test:managed-process-flood` → 8. `check:contract` → 9. `check:pi-compat` → 10. `check:toolchain-contract` → 11. `check:toolchain-catalog` → 12. `check:browser-i18n` → 13. `check:desktop-security` → 14. `build` → 15. `check:production-artifacts` → 16. `smoke` → 17. `test:browser-electron` → 18. `test:browser-agent-e2e`.

`npm run verify` is the documented pre-merge requirement (README "参与开发" section).

## CI matrix

`.github/workflows/build-desktop.yml` runs:

- **`test-platforms`** on Linux x64, macOS arm64/x64, and Windows x64. Windows additionally installs a pinned Rust toolchain (1.96.1) and runs `cargo fmt/clippy/test`, `cargo audit`, `cargo deny`, helper reproducibility, `test:windows-managed-helper`, `test:managed-process-workflows`, and the 60 s flood (`build-desktop.yml:28`).
- **`package`** on the four targets (`darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`) verifies packaged toolchains and production startup (`check:packaged-toolchains`), with `--release-helper` on Windows; Windows also validates the NSIS upgrade path (`test:windows-nsis-upgrade`) and generates/verifies the release SBOM.
- `desktop-workflow.test.mjs` asserts structural invariants of the workflow itself (matrix contents, step ordering, no Xvfb on Windows).

## Adding a test that gates a change

For a source change, add a `.test.mjs` next to the module and run the single file first. If the change crosses processes (Host/Main/Browser), cover the seam with the contract check plus a targeted harness test rather than a heavyweight E2E.
