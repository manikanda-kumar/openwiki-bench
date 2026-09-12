---
type: operations
title: Build, Test & Release Tooling
description: How the desktop is built (tsup main/preload/host, Vite renderer), tested (test-runner), gated (verify.mjs), packaged (electron-builder), and released across Linux/macOS/Windows, including the signature and signing status.
tags: [operations, build, test, release, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-e8381a19204e345fe447a619
    resource: repo://.github/workflows/build-desktop.yml
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-a17f71fdccd41d962e52eda5
    resource: repo://scripts/build-main.mjs
  - id: openwiki-source-cc8054650618de8344394e69
    resource: repo://scripts/build-windows-managed-helper.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-1e3c441fa9dc85197c422604
    resource: repo://scripts/verify-windows-helper-reproducibility.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Build, Test & Release Tooling

This page explains the build pipeline, the unit-test runner, the single release
gate (`verify.mjs`), packaging with `electron-builder`, the native Windows
helper build/verify, and the CI workflow that produces signed macOS and
unsigned-Beta Windows artifacts.

## Build pipeline

`npm run build` (`scripts/build.mjs`):

1. on `win32`-x64 also builds the Windows managed-process helper
   (`scripts/build-windows-managed-helper.mjs`);
2. `scripts/build-main.mjs` runs `tsup --config tsup.config.ts` to produce the
   main, preload, and Agent Host bundles into `out/main`, `out/preload`, and
   `out/agent-host` (the Host entry is `agent-host.mjs`);
3. `vite build` produces the renderer into `out/renderer`.

`package.json` `main` is `out/main/main.js`. Development uses
`scripts/dev.mjs`, which awaits a Vite dev server on `localhost:5173` then
launches Electron with a tsup watch loop building main/preload/host.

## Unit tests

`npm test` (`scripts/test.mjs` → `test-runner.mjs`) runs
`node --test src/**/*.test.mjs` with a default 120 s per-test timeout
(`PI_TEST_TIMEOUT_MS` overrides). The runner validates the timeout, spawns the
Node test runner, and asserts a clean exit status (no signal / non-zero exit
passes). It also rejects legacy test-bundle usage (`assertNoLegacyTestBundleUsage`)
and confirms no stray test artifacts remain.

## The verify gate

`scripts/verify.mjs` is ISSUE-010's single quality gate that blocks `pack` /
`dist`. In order it runs:

1. `format:check` (Prettier)
2. `lint` (ESLint, `--max-warnings=0`)
3. `typecheck` (`tsc -p tsconfig.json` and `tsc -p tsconfig.renderer.json`)
4. `check:dependencies` (dependency contract)
5. unit tests (`npm test`)
6. managed-process development workflows and the 60 s flood test
7. `check:contract-coverage`
8. Pi 0.84 compatibility check
9. toolchain contract safety and toolchain catalog checks
10. Browser i18n invariants
11. desktop security invariants (`check-desktop-security.mjs`)
12. `build`
13. production artifact isolation check
14. Electron smoke, Browser-Electron integration, and real-Agent E2E

Any failing step exits immediately. `scripts/package-desktop.mjs`
(unpackaging step) first runs `prepare-bundled-tools` and `verify`, then hands
off to `electron-builder` (`--dir` for `--pack`/`npm run pack`, `--publish
never` for `--release`/`npm run dist`).

## Packaging with electron-builder

`electron-builder.yml` packages a pure-ASAR app (`asar: true`) with `out/**`,
`package.json`, the license/icon/entitlements, and the Toolchain catalogs /
core tools as `extraResources` (signed `runtime-catalog.json`,
`core-catalog.json`, and the current target's `core/${platform}-${arch}`).
The Pi authoring docs/examples and declaration files that electron-builder
would otherwise strip are restored via explicit FileSets.

Targets: macOS `dmg`+`zip` (arm64+x64, hardened runtime), Windows `nsis`, and
Linux `AppImage`. The Windows artifact is deliberately named
`Pi-Agent-Desktop-Unsigned-Beta-Setup-${version}` because Authenticode is not
provisioned yet — the trust limitation is visible in the filename, and CI
enforces that no Windows release is ever labeled as a signed/stable build.

## Native Windows helper

`scripts/build-windows-managed-helper.mjs` builds
`native/windows-managed-process-helper` (Rust, pinned toolchain) into
`out/native/windows-managed-process-helper/` and is bundled as a
`managed-process/win32-x64` extra resource. Reproducibility is verified by
`scripts/verify-windows-helper-reproducibility.mjs` (double-build then diff),
and CI runs `cargo audit` + `cargo deny --locked check` against the pinned
`Cargo.lock`. The `check-desktop-security.mjs` gate further pins the helper to
a static CRT, no network surface, and protected-DACL kill-on-close Jobs.

## CI workflow

`.github/workflows/build-desktop.yml` runs a `test-platforms` matrix across
Linux x64, macOS arm64/x64, and Windows x64 (each `npm ci`, unit tests,
toolchain/contract/security checks, build, and smoke). Tagged/release runs then:

- **macOS**: sign and notarize (`npm run dist:mac:notarized`), codesign-verify
  the app and its `Renderer` entitlement, then upload signed artifacts.
- **Windows**: build the NSIS `Unsigned-Beta` installer, enforce that it stays
  `NotSigned` and carries the unsigned-beta `.exe` name, then upload.
- **Linux**: build the `AppImage` and upload.

The workflow pins the Node 22.x run and (for Windows) a `1.96.1` Rust
toolchain, and it gates updates on the `v*` tag release flow.
