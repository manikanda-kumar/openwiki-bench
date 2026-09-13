---
type: development-workflow
title: Build and Testing
description: The developer loop (Vite + tsup watch + Electron), the main/preload/host build pipeline, the npm run verify quality gate step-by-step, test harnesses, and the CI matrix.
tags: [build, testing, ci, dev-loop, tsup, vite, verify]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

## Dev loop: `npm run dev`

`scripts/dev.mjs` orchestrates three processes: a Vite dev server for the Renderer at `http://localhost:5173` (with a readiness poll: 30 s deadline, 100 ms interval), tsup watch builds for main/preload/host, and Electron itself (repo://scripts/dev.mjs#L6-L32, repo://scripts/dev.mjs#L34-L46). When Vite is unreachable, the app falls back to the built renderer via the `app://` protocol (`resolveRendererEntry`, repo://src/main/host-manager.ts#L1-L10).

## Build pipeline: `npm run build`

`scripts/build.mjs` runs, in order: the Windows helper build (only on win32 x64), `build-main.mjs`, then `vite build` into `out/` (repo://scripts/build.mjs#L12-L21). `buildMain` cleans `out/main` and `out/preload` and runs tsup with `tsup.config.ts` (repo://scripts/build-main.mjs#L14-L24). The tsup config emits three bundles from `tsup.config.ts` (repo://tsup.config.ts):

- `main` — CJS, node22 target, with `electron` and `electron-updater` external; injects `PI_DESKTOP_EXPECTED_PI_VERSION` from the exact pinned pi-coding-agent dependency (repo://tsup.config.ts#L15-L35).
- `agent-host`, `plugin-worker`, `managed-process-worker` — ESM (`.mjs`) because pi-coding-agent only exports the `import` condition; Pi packages and silk-wasm stay external (repo://tsup.config.ts#L36-L76).
- `preload` — CJS, browser platform, es2022 (repo://tsup.config.ts#L77-L93).

Both tsup and Vite hard-fail if the installed Pi package version does not exactly match `package.json`; Vite also bakes `VITE_APP_VERSION`/`VITE_PI_VERSION` into the renderer (repo://tsup.config.ts#L5-L12, repo://vite.config.ts#L6-L28).

## The `npm run verify` gate, in order

`scripts/verify.mjs` is a single pre-submit quality gate that blocks pack/dist (its header: "ISSUE-010: single quality gate that blocks pack/dist") (repo://scripts/verify.mjs#L1-L4). Exact sequence:

1. format check (`format:check`)
2. lint (`eslint --max-warnings=0`)
3. typecheck (main/host, then renderer tsconfigs)
4. dependency contract (`check-dependency-contract.mjs`)
5. unit tests (`npm test`)
6. managed-process development workflows (`test:managed-process-workflows`)
7. managed-process 60 s flood (`test:managed-process-flood`)
8. contract coverage (`check-contract-coverage.mjs`)
9. Pi 0.84 compatibility (`check-pi-084-compatibility.mjs`)
10. toolchain contract safety + toolchain catalog verification
11. Browser i18n invariants
12. desktop security invariants (`check-desktop-security.mjs`)
13. build (`npm run build`)
14. production artifact isolation (`check-production-artifacts.mjs`)
15. Electron smoke (`smoke`)
16. Browser Electron integration tests
17. Browser real-Agent E2E tests

Any step failing exits immediately with `[verify] FAILED: <label>` (repo://scripts/verify.mjs#L11-L18, repo://scripts/verify.mjs#L19-L60).

## Test harness

`npm test` runs `scripts/test.mjs` → `test-runner.mjs`, which spawns Node's built-in test runner over `src/**/*.test.mjs` with a 120 s default timeout (configurable via `PI_TEST_TIMEOUT_MS`, validated as a positive integer) (repo://scripts/test-runner.mjs#L3-L33). It also asserts no legacy test-bundle usage and cleans `.artifacts/test-modules` first. Tests are co-located with sources — 232 `*.test.mjs` files sit beside their implementations, plus Electron-native integration scripts (`smoke-electron`, `test-browser-electron`, `test-browser-agent-e2e`, managed-process workflows/flood/frameworks, NSIS upgrade test) exposed via `package.json` scripts (repo://package.json#L47-L56).

The Windows managed-process acceptance path is exercised by `test:windows-managed-helper` (real Rust helper + Job Object) and `test:managed-process-flood` with tunable duration/process/stream counts (repo://.github/workflows/build-desktop.yml#L108-L114).

## CI matrix (.github/workflows/build-desktop.yml)

- **test-platforms** runs on Linux x64, macOS arm64, macOS x64 (25 min), and Windows x64 (45 min): `npm ci`, platform-specific pinned Rust toolchains (1.96.1), the Windows helper gates (fmt/clippy/test/`cargo audit`/`cargo deny`/reproducibility plus managed-process helper/workflow/flood tests), `npm test`, and cross-platform quality checks on Windows (format/lint/typecheck/dependencies/contract/pi-compat/toolchain-contract/toolchain-catalog/browser-i18n) (repo://.github/workflows/build-desktop.yml#L36-L124).
- **windows-frameworks** prepares pinned framework fixtures (Next, Storybook, Vite, Java 21 + Spring Boot 4.1.1) and runs the real managed-framework matrix (repo://.github/workflows/build-desktop.yml#L117-L168).
- **quality** installs the Electron binary, prepares verified bundled search tools for linux-x64, fixes the Electron chrome-sandbox setuid bit, and runs the full `npm run verify` under `xvfb-run` (repo://.github/workflows/build-desktop.yml#L170-L200).
- **package** (non-tag refs) and release/tag jobs build installers after the gate jobs; tags (`v*`) additionally verify managed runtime checksums against upstream metadata (per the security gate, repo://scripts/check-desktop-security.mjs#L353-L357).

## Related pages

- [Quickstart](/openwiki/quickstart.md) — first-run commands.
- [Packaging and Release](/openwiki/operations/packaging-and-release.md) — what happens after the gate.
