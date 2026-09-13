---
type: operations
title: Testing and Quality Gates
description: How quality is enforced — the staged npm run verify pipeline, the Node unit test runner with colocated *.test.mjs files, static contract/i18n/security checkers, Electron smoke and Browser E2E harnesses, and managed-process soak tests.
tags: [testing, quality-gates, verify, smoke, e2e, ci, invariants]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-e8381a19204e345fe447a619
    resource: repo://.github/workflows/build-desktop.yml
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-ceec8285580ad24a28bd3d14
    resource: repo://scripts/check-dependency-contract.mjs
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-ec02ba0de97a0c8d8e2233e7
    resource: repo://scripts/check-renderer-i18n.mjs
  - id: openwiki-source-32f4a8863f0c058acac9ff86
    resource: repo://scripts/renderer-i18n-checker.test.mjs
  - id: openwiki-source-87ca67717b8bc97c0f340810
    resource: repo://scripts/smoke-electron.mjs
  - id: openwiki-source-09db8769aa4932549f7e2051
    resource: repo://scripts/test-browser-agent-e2e.mjs
  - id: openwiki-source-6e52bfc6c587eba51706d58e
    resource: repo://scripts/test-managed-process-workflows.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-4621d826900abafddcb9a394
    resource: repo://scripts/verify-packaged-toolchains.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-1213b0911f06a7920a3d3e65
    resource: repo://src/smoke/browser-agent-e2e-harness.ts
  - id: openwiki-source-19413e0c475ef0944eea48ee
    resource: repo://src/smoke/host-checks.ts
  - id: openwiki-source-72a4a67ceb5732e7dc93520e
    resource: repo://src/smoke/main.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Testing and Quality Gates

Quality is enforced by a single staged pipeline, `npm run verify` (scripts/verify.mjs), which blocks `pack`/`dist`. Its stages, in order:

1. **format check** (`prettier --check`) and **lint** (`eslint --max-warnings=0` over src, scripts, and root TS/MJS).
2. **typecheck** — two separate projects: `tsconfig.json` (main/host/preload/shared/smoke) and `tsconfig.renderer.json` (scripts/verify.mjs:17-18).
3. **dependency contract** (`scripts/check-dependency-contract.mjs`): package.json must be private, the Node engine bounded to `>=22.19.0 <23`, `@types/node` pinned to 22.19.0, and every esbuild in the tree (root, tsup, bundle-require) resolved to exactly 0.27.7 (scripts/check-dependency-contract.mjs:7-36).
4. **unit tests** (`npm run test` → scripts/test.mjs → test-runner.mjs).
5. **managed-process development workflows** and a **60-second flood** soak test.
6. **contract coverage** (`scripts/check-contract-coverage.mjs`), **Pi 0.84 compatibility**, **toolchain contract safety**, **toolchain catalog**, and **Browser i18n invariants**.
7. **desktop security invariants** (`scripts/check-desktop-security.mjs`).
8. **build**, **production artifact isolation**, **Electron smoke**, **Browser Electron integration**, and **Browser real-Agent E2E** (scripts/verify.mjs:19-44).

## Unit tests

Tests use Node's built-in test runner, spawned as `node --test --test-timeout=<ms> src/**/*.test.mjs` with a 120-second default timeout (configurable via `PI_TEST_TIMEOUT_MS`) (scripts/test-runner.mjs:6-28). The convention is colocation: nearly every module has a sibling `*.test.mjs` in the same directory, exercising pure logic without Electron. The runner also refuses legacy test-bundle usage and cleans legacy artifact directories (scripts/test-runner.mjs:41-56).

## Static checkers as CI-enforced invariants

- **Contract coverage** statically parses the TS AST to require Api-method/handler parity, declared stream topics for every `server.emit`, and browser dispatch parity (scripts/check-contract-coverage.mjs:51-102, 190-200).
- **Renderer i18n** (`scripts/check-renderer-i18n.mjs`) walks Renderer sources and requires en-US/zh-CN dictionary parity, registered fallbacks matching en-US values, no duplicate keys, no orphan keys, and no unguarded user-facing English literals (scripts/renderer-i18n-checker.test.mjs:29-95).
- **Desktop security** asserts source-level invariants — sandbox/contextIsolation flags, CSP properties, redaction in diagnostics, toolchain download integrity, packaged startup gates, and Linux sandbox requirements (scripts/check-desktop-security.mjs:296-402).
- **Toolchain contract/catalog** verify the managed-runtime catalog against fixed manifests and upstream checksums (`SHASUMS256.txt`, asset digest/size) for tag releases (scripts/check-desktop-security.mjs:352-357).

## Electron smoke test

`npm run smoke` builds a dedicated smoke bundle (`tsup.smoke.config.ts` → `.artifacts/smoke/main.js`), launches Electron with an isolated temporary `PI_DESKTOP_SMOKE_USER_DATA`, and runs `src/smoke/main.ts` — a real Main-process bootstrap (protocol, HostManager, IPC, credential vault, update manager, toolchain manager) that executes `runSmokeHostChecks` over a live Host MessagePort: ping, sessions, worktree conflict handling, git status, directory watching, binary download, and safe skill editing (scripts/smoke-electron.mjs:1-60; src/smoke/main.ts:18-60). The harness fails on renderer security violations (CSP/sandbox events) and enforces iframe sandboxing (src/smoke/host-checks.ts:410, 472). A 45-second outer timeout kills the process tree (scripts/smoke-electron.mjs:55-60).

## Browser E2E

Two Electron-level suites build esbuild bundles on the fly:

- `test:browser-electron` uses `src/smoke/browser-electron-harness.ts` (sandboxed harness window, CSP behavior checks).
- `test:browser-agent-e2e` builds `src/smoke/browser-agent-host.ts` (a real Agent Host), the managed-process worker, and `src/smoke/browser-agent-e2e-harness.ts`, then drives real agent turns through the embedded browser with sandboxed webPreferences (scripts/test-browser-agent-e2e.mjs:22-50; src/smoke/browser-agent-e2e-harness.ts:170).

## Managed-process suites

`test:managed-process-workflows` exercises the real `ManagedProcessService` end-to-end (spawning Vite, readiness waits, stdin, restarts, cleanup) against a temp fixture root, with Windows-specific native bash detection (scripts/test-managed-process-workflows.mjs:10-40). `test:managed-process-flood` soaks start/stop churn against the rate limits, and `test:managed-process-frameworks` validates readiness detection for known frameworks. `test:windows-managed-helper` is the Windows x64 acceptance run for the Rust helper and Job Objects.

## Packaged validation flags

Packaged builds accept two self-check flags handled in `src/main/main.ts`:

- `--validate-packaged-startup`: succeeds only when the renderer loaded, the Host is ready, the toolchain core is ready with healthy bundled `search.rg`/`search.fd`, the Pi version matches `PI_DESKTOP_EXPECTED_PI_VERSION`, and the Host acknowledged the toolchain revision; results are written to `packaged-startup-check.json` (src/main/main.ts:108-120).
- `--validate-packaged-cleanup-fault`: fault-injects managed-process cleanup uncertainty, requires the reaper journal to be retained and lifecycle state recovered, and must never launch the installer (src/main/main.ts:52; scripts/check-desktop-security.mjs:307-320).

`scripts/verify-packaged-toolchains.mjs` runs the full packaged E2E matrix (darwin-arm64/x64, win32-x64, linux-x64) with exact resource checks, manifest hash verification, functional rg/fd probes, Linux `chrome-sandbox` setuid checks, and the production startup ack (scripts/verify-packaged-toolchains.mjs:377-390, 517-530).

## CI

`.github/workflows/build-desktop.yml` runs the test matrix on Linux x64, macOS arm64, macOS x64, and Windows x64 (with pinned Rust toolchains for the Windows helper, cargo-audit/deny supply-chain gates, and cargo-xwin cross-compilation checks on Linux) (`.github/workflows/build-desktop.yml:19-80`).
