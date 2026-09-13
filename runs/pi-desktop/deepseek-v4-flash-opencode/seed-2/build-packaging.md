---
type: concept
title: Build, packaging and release
description: The production pipeline that bundles the main process, preload, and Agent Host with tsup, builds the Vite renderer, prepares bundled tools and the Windows managed-process helper, runs the verify gate, and produces electron-builder installers with SBOMs.
tags: [build, packaging, tsup, electron-builder, release, sbom, windows-helper]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T15:27:00.466Z
---

# Build, packaging and release

The desktop app is a pure Electron package: tsup bundles the TypeScript main/preload/Host entrypoints, Vite builds the React renderer, and electron-builder produces platform installers. Packaging is gated by `verify.mjs` so a broken tree cannot be shipped.

## tsup bundle layout

`tsup.config.ts` defines three bundle groups:

- **Main (CJS)** — `src/main/main.ts` → `out/main/main.js`. Externals: `electron`, `electron-updater` (resolved dynamically at runtime). It `define`s `process.env.PI_DESKTOP_EXPECTED_PI_VERSION` from the exact `@earendil-works/pi-coding-agent` dependency version (the build fails if that dependency is not an exact `x.y.z` version, `tsup.config.ts:7-13`).
- **ESM Host workers** — `src/agent-host/index.ts`, `plugin-worker.ts`, and `managed-process/worker.ts` → `out/main/*.mjs`. ESM is required because Pi packages export only the `import` condition. Externals include the Pi packages and `silk-wasm` so adjacent assets stay resolvable.
- **Preload (CJS, browser platform)** — `src/preload/preload.ts` → `out/preload/preload.js`, external `electron`.

`npm run build` (`scripts/build.mjs`) runs the Windows managed-helper build (only on win32-x64), then `scripts/build-main.mjs` (which cleans `out/main` and `out/preload` and runs tsup), then `vite build`.

## electron-builder configuration

`electron-builder.yml`:

- `appId: app.dlyzzt.pi-agent-desktop`, `productName: Pi Agent Desktop`, output to `dist/`.
- App files: `out/**/*`, `package.json`, `LICENSE`, `build/icon.png`, entitlements. Excludes maps, Markdown/TS sources, `scripts`, `src`, `dist`, and config files. Explicit FileSets restore Pi authoring assets (READMEs, `docs/**`, `examples/**`, `.d.ts` declarations) that the broad exclusions and electron-builder's dependency walk would otherwise drop.
- `asar: true`; `extraResources` ships `THIRD_PARTY_NOTICES.md`, the signed `runtime-catalog.json` and `core-catalog.json`, and the platform-specific bundled core tool directory (`build/toolchains/core/${platform}-${arch}`).
- **mac**: hardened runtime, entitlements, targets DMG + ZIP for arm64 and x64.
- **win**: NSIS x64, with `extraResources` adding `out/native/windows-managed-process-helper` → `resources/managed-process/win32-x64` (helper exe + manifest). Artifact names stay `Unsigned-Beta` because Authenticode signing is not provisioned.
- **linux**: AppImage x64 with `--appimage-desktop-launch` to keep Chromium sandboxing enabled.
- **protocols**: registers the `pi-agent-desktop` custom scheme.
- **publish**: GitHub draft release provider for the DLYZZT/pi-desktop repo.

## Bundled tools and core catalog

`scripts/prepare-bundled-tools.mjs` builds the offline search toolchain shipped in every installer:

- Reads `build/toolchains/core-catalog.json` (signed runtime catalog) and downloads fixed-version `ripgrep` and `fd` binaries plus pinned license files into `build/toolchains/core/${platform}-${arch}`.
- Fixed files (e.g. licenses) are verified against exact byte counts and SHA-256 before being atomically written; runtime archives go through `downloadRuntimeArtifact` → `verifyDownloadedArtifact` → `extractRuntimeArchive` and, on macOS, `darwinCodeDigest`.
- These bundled `rg`/`fd` guarantee offline search (`search.rg`, `search.fd` providers), and the catalog drives which managed components (Node, Python, uv, PortableGit, etc.) can be downloaded on consent.

## Windows managed-process helper

`native/windows-managed-process-helper/` is a Rust crate (`pi-windows-managed-process-helper`) built for `x86_64-pc-windows-msvc` with `windows-sys` Job Objects, pipes, console, and DACL features. `scripts/build-windows-managed-helper.mjs`:

- Computes a source revision (SHA-256 of crate inputs + build script + toolchain pin) and a `buildId = pimpd-<version>-p<protocol>-<revision>`.
- Compiles a version resource, builds with `cargo build --locked --release` on Windows (provenance `windows-native-dev` or `release-authoritative`), or cross-compiles with `cargo-xwin` on macOS/Linux (provenance `cross-dev`) as a compile-only gate.
- Verifies the PE via `verifyWindowsHelperPe`, runs the helper's `--version-json-v1` and `--self-test-json-v1` (checks: job-dacl, kill-on-close, completion-port, accounting), and writes `out/native/windows-managed-process-helper/manifest.json` with the SHA-256.
- Reproducibility is enforced at release time by `verify-windows-helper-reproducibility.mjs`.

## Windows SBOM

`scripts/generate-windows-sbom.mjs` produces an SBOM for Windows release assets by resolving the npm lockfile dependency graph, applying target rules and known SPDX ids, and hashing artifacts; `verify-windows-sbom.mjs` validates the generated SBOM. Both run only for win32 releases in `package-desktop.mjs`.

## package-desktop pipeline

`scripts/package-desktop.mjs` (used by `npm run pack` / `npm run dist`) executes:

1. `prepare-bundled-tools.mjs` (with `--release` for dist),
2. `verify.mjs` (the full quality gate),
3. (win32 release only) `verify-windows-helper-reproducibility.mjs`,
4. electron-builder (`--dir` for pack, `--publish never` for release) with `CSC_IDENTITY_AUTO_DISCOVERY=false`,
5. (win32 release only) `generate-windows-sbom.mjs` then `verify-windows-sbom.mjs`.

Every step must exit 0 or the pipeline aborts. macOS signed/notarized builds are handled separately by `scripts/build-mac-release.mjs` (`dist:mac:signed` / `dist:mac:notarized`).

## CI matrix

`.github/workflows/build-desktop.yml` runs tests across Linux x64, macOS arm64, macOS x64, and Windows x64. Linux additionally cross-compile-checks the Windows helper with `cargo-xwin`; Windows installs pinned Rust supply-chain gates (`cargo-audit`, `cargo-deny`) and the pinned Rust toolchain before building the helper natively.