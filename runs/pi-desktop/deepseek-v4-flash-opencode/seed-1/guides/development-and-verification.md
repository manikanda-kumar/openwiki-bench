---
type: guide
title: Development and Verification Guide
description: How to develop, build, test, verify, package, and release Pi Agent Desktop, including the verify gate, the unit test runner, and the CI pipeline.
tags: [development, build, test, verify, packaging, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-e8381a19204e345fe447a619
    resource: repo://.github/workflows/build-desktop.yml
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-8936130ae7ee0f81fa347046
    resource: repo://scripts/build-mac-release.mjs
  - id: openwiki-source-a17f71fdccd41d962e52eda5
    resource: repo://scripts/build-main.mjs
  - id: openwiki-source-436e0ba48b22bd7bf59403aa
    resource: repo://scripts/build.mjs
  - id: openwiki-source-7164859f3d7c069d9fda8e58
    resource: repo://scripts/dev.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-87ca67717b8bc97c0f340810
    resource: repo://scripts/smoke-electron.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-74c6b0267a12bbfb67847a09
    resource: repo://tsup.config.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Development and Verification Guide

This guide covers the development, verification, and packaging workflows for Pi Agent Desktop. Treat the source of each script as authoritative; the `verify` sequence below is the pre-commit/pre-pack gate.

## Prerequisites

- Node.js 22.19.0 or higher, below 23 (`engines` field in `package.json`), and npm.
- A supported OS (macOS, Windows, or Linux). Platform-specific builds (Windows helper, macOS signing) require their native platform or the documented cross toolchain.

## Development loop

`npm run dev` runs `scripts/dev.mjs`, which orchestrates three processes (`scripts/dev.mjs:85-112`):

1. an initial `scripts/build-main.mjs` build of main/preload/host (must succeed before continuing);
2. `tsup --watch` (main/preload/host rebuilds) and Vite (renderer) in parallel;
3. Electron with `VITE_DEV_SERVER_URL=http://localhost:5173` once Vite is ready.

`dev.mjs` waits for Vite to answer on port 5173 (30 s timeout) and tears down every spawned child with `terminateProcessTree` on exit (`scripts/dev.mjs:12-33`, `dev.mjs:39-44`).

## Build pipeline

- `npm run build` → `scripts/build.mjs`: on Windows x64 it first builds the Rust managed-process helper, then `scripts/build-main.mjs` (tsup), then `vite build` (`scripts/build.mjs:14-18`).
- `scripts/build-main.mjs` cleans `out/main` and `out/preload` and runs tsup with `tsup.config.ts` (`scripts/build-main.mjs:11-26`).
- `tsup.config.ts` produces:
  - `out/main/main.js` — Main process, CJS, platform node, target node22, external `electron`/`electron-updater` (`tsup.config.ts:15-35`);
  - `out/main/agent-host.mjs`, `plugin-worker.mjs`, `managed-process-worker.mjs` — ESM (the pi packages only export an `import` condition), external to the `@earendil-works/pi-*` packages and `silk-wasm` (`tsup.config.ts:36-68`);
  - `out/preload/preload.js` — CJS, platform browser, target es2022 (`tsup.config.ts:69-85`).
- The build fails unless `@earendil-works/pi-coding-agent` is an exact version dependency; it is injected as `process.env.PI_DESKTOP_EXPECTED_PI_VERSION` via a define (`tsup.config.ts:6-13`, `vite.config.ts:13-27`).

## Unit tests

`npm test` runs `scripts/test.mjs`, which delegates to `scripts/test-runner.mjs` (`scripts/test.mjs:1-12`). The runner:

- executes `node --test src/**/*.test.mjs` with a per-test timeout (`PI_TEST_TIMEOUT_MS`, default 120 000 ms) (`scripts/test-runner.mjs:18-35`);
- rejects legacy test-bundle usage and cleans `.artifacts/test-modules` before and after (`scripts/test-runner.mjs:37-56`).

## The verify gate

`npm run verify` → `scripts/verify.mjs` runs, in order, and aborts on the first failure (`scripts/verify.mjs:21-42`):

1. `format:check` (prettier)
2. `lint` (eslint, `--max-warnings=0`)
3. `typecheck` for both `tsconfig.json` and `tsconfig.renderer.json`
4. `check:dependencies` (dependency contract)
5. unit tests (`npm test`)
6. managed-process development workflows
7. managed-process 60 s flood
8. contract coverage (`check-contract-coverage.mjs`)
9. Pi 0.84 compatibility
10. toolchain contract safety
11. toolchain catalog verification
12. Browser i18n invariants
13. desktop security invariants (`check-desktop-security.mjs`)
14. build (`npm run build`)
15. production artifact isolation
16. Electron smoke test
17. Browser Electron integration
18. Browser real Agent E2E

This is the same gate that `package-desktop.mjs` runs before packaging (`scripts/package-desktop.mjs:26-31`).

## Checks and acceptance suites

- `npm run smoke` launches a real Electron instance in a temp user-data dir, connects to the Host over MessagePort, and verifies ping, sessions, worktree conflict handling, git status, directory watching, exact binary download, and safe skill editing (`scripts/smoke-electron.mjs:1-60`).
- `npm run test:browser-electron` / `npm run test:browser-agent-e2e` run the built-in browser integration and real-Agent browser E2E (`src/smoke/`).
- `npm run test:managed-process-workflows`, `test:managed-process-flood`, `test:managed-process-frameworks`, and `test:windows-managed-helper` exercise the managed-process lifecycle, output flood budgets, real Next/Storybook/Spring Boot cold starts, and the Windows Job helper.
- `npm run check:contract` asserts the exact API/streams/bridge/IPC coverage described in [RPC and Contract Layer](../architecture/rpc-and-contracts.md).
- `npm run check:production-artifacts` and `npm run check:desktop-security` enforce packaging and security invariants (see [Security Model](../architecture/security-model.md)).

## Packaging

`npm run pack` (`--dir`) and `npm run dist` (`--release`) run `scripts/package-desktop.mjs` (`scripts/package-desktop.mjs:9-66`):

1. `prepare-bundled-tools.mjs` prepares the bundled `rg`/`fd` core and runtime catalogs;
2. the full `verify` gate;
3. on Windows release, `verify-windows-helper-reproducibility.mjs`;
4. `electron-builder` (`--dir` or `--publish never`);
5. on Windows release, generate and verify the CycloneDX SBOM.

`electron-builder.yml` configures: ASAR packaging of `out/**`, extra resources for the signed runtime/core catalogs and bundled core tools, macOS hardened-runtime DMG+ZIP (arm64+x64), Windows NSIS x64 (unsigned, artifact named `Pi-Agent-Desktop-Unsigned-Beta-Setup`), Linux AppImage x64 with the `--appimage-desktop-launch` override, the `pi-agent-desktop` protocol, and a GitHub draft-release publisher (`electron-builder.yml:98-175`).

`npm run dist:mac:signed` and `npm run dist:mac:notarized` run `scripts/build-mac-release.mjs`, which must run on macOS and supports `--notarize`, `--arm64`, `--x64`; notarization requires Apple credentials via one of the supported env strategies (`scripts/build-mac-release.mjs:7-60`).

## CI pipeline

`.github/workflows/build-desktop.yml` runs on push to `main`, `v*` tags, and PRs:

- `test-platforms`: the unit/handler/quality matrix on Linux x64, macOS arm64, macOS x64, and Windows x64, with pinned Rust toolchains; Windows additionally runs `cargo fmt/clippy/test`, `cargo audit`, `cargo deny`, helper reproducibility, managed-process workflows, and the 60 s flood (`build-desktop.yml:22-115`);
- `windows-frameworks`: real Next/Storybook/Spring Boot framework acceptance on Windows;
- `quality` and `package`: cross-platform quality checks and packaging;
- `release-contract`, `release-macos`, `release-windows`, `release-linux`, and `release`: the signed/notarized macOS release pipeline, Windows release asset pipeline (SBOM + packaged E2E), Linux AppImage release under Xvfb, and final release aggregation (`build-desktop.yml:384-1012`).

## Related pages

- [Quickstart](../quickstart.md)
- [Windows Managed Process Helper Guide](./windows-managed-process-helper.md)
- [Desktop Shell and Lifecycle](../systems/desktop-shell-lifecycle.md)
