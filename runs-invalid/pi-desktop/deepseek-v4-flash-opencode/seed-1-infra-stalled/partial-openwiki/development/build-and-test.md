---
type: development
title: Build, Test, and Packaging
description: How Pi Agent Desktop is built (main, preload, renderer), how its unit and workflow tests are organized and run, the verify gate, and the electron-builder packaging plus Windows helper/SBOM reproducibility gates.
tags: [build, testing, packaging, ci, electron-builder, verify]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T13:27:03.630Z
---

# Build, Test, and Packaging

This page covers the reproducible build pipeline, the layered test and check system, the `verify` quality gate, desktop packaging, and the CI/release workflow.

## Dev loop

`npm run dev` runs `scripts/dev.mjs`, which performs an initial `scripts/build-main.mjs` build, then starts `tsup --watch` and Vite in parallel, waits for Vite on `http://localhost:5173` (strict port), and finally launches Electron with `VITE_DEV_SERVER_URL` set so the renderer loads from the dev server (`scripts/dev.mjs:85-112`). Shutdown terminates the whole spawned process tree (`createDevRuntime`, `scripts/dev.mjs:35-73`).

## Build pipeline

`npm run build` (`scripts/build.mjs`) runs, in order:

1. On Windows x64 only, `scripts/build-windows-managed-helper.mjs` (the Rust helper).
2. `scripts/build-main.mjs`, which wipes `out/main` and `out/preload` and runs `tsup` (`scripts/build-main.mjs:11-26`).
3. `vite build` for the renderer.

### Bundling (tsup)

`tsup.config.ts` defines three builds (`tsup.config.ts:15-86`):

- **main** — `src/main/main.ts` → `out/main/main.js`, CommonJS, `platform: node`, `target: node22`. `electron` and `electron-updater` are external (electron-updater resolves providers dynamically at runtime).
- **agent-host** — `src/agent-host/index.ts`, plus the `plugin-worker` and `managed-process-worker` entries, → `out/main/*.mjs`, ESM, because `@earendil-works/pi-coding-agent` only exposes an `import` condition. The Pi packages and `silk-wasm` are external.
- **preload** — `src/preload/preload.ts` → `out/preload/preload.js`, CommonJS, `platform: browser`, `target: es2022`, with `electron` external.

All three `define` the expected Pi version from the exact `@earendil-works/pi-coding-agent` dependency into `process.env.PI_DESKTOP_EXPECTED_PI_VERSION`; the build fails if that dependency is not an exact `x.y.z` version (`tsup.config.ts:7-13`). `tsup.smoke.config.ts` builds `src/smoke/main.ts` → `.artifacts/smoke` for the Electron smoke harness.

### Renderer (Vite)

`vite.config.ts` roots the renderer at `src/renderer`, uses React plugin, aliases `@` → `src/renderer`, `@contract` → `src/contract`, `@shared` → `src/shared`, and bakes the app and Pi versions into the bundle (`vite.config.ts:31-60`). It verifies that the installed Pi package version matches `package.json` exactly and errors otherwise (`readPiVersion`, `vite.config.ts:13-27`).

## Test conventions

Unit tests are `node:test` files named `*.test.mjs` colocated with their source. `scripts/test.mjs` → `scripts/test-runner.mjs` runs them with:

```
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test --test-timeout=<ms> "src/**/*.test.mjs"
```

The default timeout is 120 s and can be overridden with `PI_TEST_TIMEOUT_MS` (`scripts/test-runner.mjs:6-28`). The runner also refuses legacy test-bundle usage and clears `.artifacts/test-modules` before and after (`scripts/test-runner.mjs:37-56`).

There are several test tiers beyond the unit suite, each a dedicated npm script:

- **Managed-process workflow/flood/framework suites**: `test:managed-process-workflows`, `test:managed-process-flood`, `test:managed-process-frameworks`, `test:windows-managed-helper`, `test:windows-nsis-upgrade`.
- **Electron integration**: `smoke` (`scripts/smoke-electron.mjs`, built from `tsup.smoke.config.ts`), `test:browser-electron`, `test:browser-agent-e2e`, `test:build-watch`.
- **Static check scripts** (see below).

## Check scripts and the verify gate

Several `scripts/check-*.mjs` scripts encode invariants as static source analysis, so regressions fail before runtime:

- `check-contract-coverage.mjs` — every `Api` method handled, every `Streams` topic emitted, every `PiBridge` method implemented, IPC channels registered, browser Host methods dispatched.
- `check-desktop-security.mjs` — source-level security invariants across CSP, sandbox flags, IPC trust, secrets handling, channel transports, and toolchain isolation (used by `npm run check:desktop-security`).
- `check-dependency-contract.mjs`, `check-pi-084-compatibility.mjs`, `check-toolchain-contract.mjs`, `check-toolchain-catalog.mjs`, `check-renderer-i18n.mjs`, `check-production-artifacts.mjs`, `check-packaged-toolchains.mjs`.

`npm run verify` (`scripts/verify.mjs`) is the single gate that blocks pack/dist. Its order is: format check → eslint → typecheck (`tsconfig.json` + `tsconfig.renderer.json`) → dependency contract → unit tests → managed-process workflows → managed-process flood → contract coverage → Pi 0.84 compatibility → toolchain contract → toolchain catalog → browser i18n → desktop security → build → production-artifact isolation → Electron smoke → Browser Electron integration → Browser real Agent E2E (`scripts/verify.mjs:12-42`).

## Packaging

`npm run pack` / `npm run dist` run `scripts/package-desktop.mjs`, whose step sequence is:

1. `prepare-bundled-tools.mjs` — download/verify the target's bundled search tools.
2. `verify` — the full quality gate.
3. Windows release only — `verify-windows-helper-reproducibility.mjs` (authoritative helper rebuild).
4. `electron-builder` with `--dir` (unpacked) or `--publish never` (release), with `CSC_IDENTITY_AUTO_DISCOVERY=false`.
5. Windows release only — `generate-windows-sbom.mjs` then `verify-windows-sbom.mjs`.

`electron-builder.yml` declares targets and resources (`electron-builder.yml:112-175`): macOS `dmg`+`zip` for arm64 and x64, Windows `nsis` x64 (unsigned — the artifact is named `Pi-Agent-Desktop-Unsigned-Beta-Setup-<version>.exe` to keep the missing Authenticode visible), and Linux `AppImage` x64. It packages `out/**`, the signed toolchain catalogs (`runtime-catalog.json`, `core-catalog.json`) and the current target's bundled core tools as `extraResources`, and restores specific Pi package authoring files (READMEs, docs, examples, `.d.ts`) that the broad production exclusions would otherwise drop. `asar: true` and the `pi-agent-desktop://` protocol scheme are configured. Update publishing targets the GitHub repo `DLYZZT/pi-desktop` with `releaseType: draft`.

### Windows helper and SBOM reproducibility

The Windows managed-process helper is a Rust crate (`native/windows-managed-process-helper`) built for `x86_64-pc-windows-msvc` with a pinned cross-toolchain (cargo-xwin 0.23.1, LLVM 18, xwin 17, Windows SDK 10.0.26100, CRT 14.44.17.14; `scripts/build-windows-managed-helper.mjs:11-20`). `verify-windows-helper-reproducibility.mjs` rebuilds it from source inputs and checks the authoritative binary matches. `generate-windows-sbom.mjs` produces a CycloneDX SBOM (`*.cdx.json`) for the Windows release from `package-lock.json` plus the helper, with a curated SPDX allowlist (`scripts/generate-windows-sbom.mjs:12-26`).

## CI workflow

`.github/workflows/build-desktop.yml` runs on `main` pushes, `v*` tags, and PRs, with these jobs:

- **test-platforms** — a matrix of Linux x64, macOS arm64, macOS x64, and Windows x64 that runs `npm test` plus platform-specific checks. On Windows it also compiles/validates the Rust helper (`cargo fmt/clippy/test/audit/deny`), the reproducibility check, the managed-process workflows, and the 60 s flood (`build-desktop.yml:22-115`). On Linux it cross-compile-checks the helper with `cargo-xwin`.
- **windows-frameworks** — real managed framework acceptance (Next.js, React/Storybook, Vite, Spring Boot) on Windows (`build-desktop.yml:117-175`).
- **quality** — runs `xvfb-run npm run verify` on Ubuntu, with `prepare:bundled-tools -- --target linux-x64` and the Electron sandbox configured (`build-desktop.yml:177-210`).
- **package** — for non-tag refs, builds each platform and packages with `electron-builder` (`--publish never`), runs packaged toolchain E2E (`check:packaged-toolchains`), the Windows SBOM generation/verification, the NSIS upgrade/rollback E2E against a pinned prior installer with a pinned hash, and `verify-update-metadata.mjs` (`build-desktop.yml:212-382`).
- **release-contract** — for `v*` tags: verifies the tag/version triplet across `package.json`/`package-lock.json`, refuses re-publishing an already-public release, and checks the toolchain catalog against upstream (`build-desktop.yml:384-465`).
- **release-macos / release-windows / release-linux** — signed+notarized macOS build with codesign/stapler/spctl verification, the Windows Unsigned-Beta gate that *requires* `Get-AuthenticodeSignature` to report `NotSigned`, and Linux AppImage packaging with sandbox setup (`build-desktop.yml:467-1010`).
- **release** — assembles the draft GitHub Release from the platform artifacts, deduplicating and cleaning stale assets (`build-desktop.yml:1012-1086`).

## Related pages

- [Quickstart](/openwiki/quickstart.md)
- [Change Guides](/openwiki/development/change-guides.md)
- [Desktop Lifecycle](/openwiki/operations/desktop-lifecycle.md)