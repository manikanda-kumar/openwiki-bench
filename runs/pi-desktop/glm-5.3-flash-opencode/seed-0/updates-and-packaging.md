---
type: operations
title: Updates and Packaging
description: How updates are checked, downloaded, and installed safely, how desktop packages are built for macOS/Windows/Linux, and the release CI pipeline with signing, notarization, SBOM, and helper gates.
tags: [updates, packaging, electron-builder, signing, notarization, sbom, release-ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-e8381a19204e345fe447a619
    resource: repo://.github/workflows/build-desktop.yml
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-5812d3193fdc8d73c2eaffde
    resource: repo://scripts/generate-windows-sbom.test.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-00820ecbfa6fb8f0f092b5ed
    resource: repo://scripts/verify-windows-sbom.mjs
  - id: openwiki-source-873302e5e8aa96bc6d329875
    resource: repo://src/main/update-adapter.ts
  - id: openwiki-source-7323b286b3c73bd6949195f8
    resource: repo://src/main/update-manager.test.mjs
  - id: openwiki-source-6051c8ebdc68fac1700c0be3
    resource: repo://src/main/update-manager.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Updates and Packaging

## Update flow

`UpdateManager` (Main) owns update state as a small state machine (`phase`, `installBlockedByActiveSessions`, `canRetry`) and is enabled only for packaged macOS/Windows builds (`PI_DESKTOP_TEST_UPDATER=1` enables it in development) (src/main/update-manager.ts:236-267). Automatic checks start after a 60-second delay and repeat every 6 hours with ±8% jitter; downloads carry a 15-minute watchdog; release notes are capped at 12,000 characters and error details at 800 (src/main/update-manager.ts:4-9).

The adapter layer wraps `electron-updater` with a deliberately hardened configuration: `autoDownload = false`, `autoInstallOnAppQuit = false` (installation must pass through `UpdateManager.installUpdate()` which gates active Agent sessions), no prereleases, no downgrades, the web installer disabled, and the library's default console logger nulled so URLs/headers never leak (src/main/update-adapter.ts:88-103). Publishing configuration is fixed in the packaged app (`publish: github, DLYZZT/pi-desktop` in electron-builder.yml:171-174); the Renderer can only invoke `desktop:update:*` IPC actions, never supply update URLs or credentials.

Installation is user-confirmed and session-gated: `installUpdate()` rejects with `UPDATE_BUSY` while any agent session is running, then calls `prepareToInstall()` (managed-process cleanup with a hard deadline) before quitting to install; a failed prepare triggers `recoverFromInstallFailure` (src/main/update-manager.ts:345-368; src/main/update-manager.test.mjs:224-236). Windows packages are intentionally unsigned ("Unsigned-Beta" in every downloaded filename) while electron-updater still validates the NSIS file against the SHA-512 digest in `latest.yml`; production updates are enabled only on darwin/win32 (src/main/update-adapter.ts:34-40; electron-builder.yml:140-143). Linux currently uses manual download/install updates (README.md, 桌面安装包系统要求).

## Packaging targets

`electron-builder.yml` defines the matrix:

- **macOS**: DMG + ZIP for arm64 and x64, hardened runtime, entitlements, `Pi-Agent-Desktop-${version}-${arch}` naming (electron-builder.yml:112-127).
- **Windows**: NSIS x64 with the Rust managed-process helper and its manifest shipped as extraResources under `managed-process/win32-x64` (electron-builder.yml:129-150).
- **Linux**: AppImage x64 with `executableName: pi-agent-desktop` and an app-owned `--appimage-desktop-launch` marker that keeps the Chromium sandbox enabled (electron-builder.yml:152-163).
- **Resources**: signed runtime catalogs plus the current target's core search tools; managed Node/Python/Git archives are never shipped — they download on consent (electron-builder.yml:100-110).

The packaging pipeline (`npm run pack`/`dist` → scripts/package-desktop.mjs) always runs: prepare bundled tools → `npm run verify` → electron-builder (`--dir` or `--publish never`, with `CSC_IDENTITY_AUTO_DISCOVERY=false`); Windows releases add helper reproducibility verification and SBOM generation/verification (scripts/package-desktop.mjs:9-66).

## Windows helper and SBOM gates

Release Windows builds require the Rust helper to be bit-for-bit reproducible against the authoritative build (`check:windows-helper-reproducibility`) and ship a CycloneDX SBOM that must exactly match the locked release inputs, contain no local absolute paths, have unique bom-refs, and cover the full production dependency graph (scripts/package-desktop.test.mjs:22-29; scripts/verify-windows-sbom.mjs:16-29; scripts/generate-windows-sbom.test.mjs:110-142).

## Release CI

`.github/workflows/build-desktop.yml` runs on pushes/PRs to main and `v*` tags:

- **quality + test matrix** on Linux x64, macOS arm64/x64, Windows x64, with pinned Rust 1.96.1, cargo-audit/cargo-deny, helper compile checks via cargo-xwin on Linux, clippy/tests/fmt on the helper, and `test:windows-managed-helper` acceptance (`.github/workflows/build-desktop.yml:26-95`).
- **packaging matrix** (non-tag builds and tag releases) producing macOS/Windows/Linux artifacts, with the Linux `chrome-sandbox` set as root-owned setuid, packaged-toolchain E2E per target, and a Windows NSIS upgrade test against a pinned previous release (`.github/workflows/build-desktop.yml:214-335`).
- **release contract** (tags only): the tag must point at a commit on main, the version must be stable `x.y.z` with tag/version parity, no existing public release may be overwritten, and the managed runtime catalog is verified against upstream releases (`SHASUMS256.txt`, asset digest/size) (`.github/workflows/build-desktop.yml:384-466`).
- **release-macos**: build, sign, and notarize both architectures via `npm run dist:mac:notarized`, verify codesign/TeamIdentifier/entitlements, then a separate x64 verification job (`.github/workflows/build-desktop.yml:467-729`).
- **release-windows**: package the unsigned-beta NSIS installer with SBOM gates (`.github/workflows/build-desktop.yml:730+`).

## Platform support limits

Per the README: macOS 12+ (Apple Silicon and Intel), Windows 10/11 64-bit x64, and Linux x64 AppImage on modern glibc with a desktop session. No Windows 32-bit (x86) or Windows ARM64 installers are provided, and managed background processes additionally require Windows 11 x64 (README.md, 桌面安装包系统要求; 受管开发进程).

## Representative tests

- src/main/update-manager.test.mjs — state machine, session gating, install failure recovery, log redaction
- scripts/package-desktop.test.mjs — packaging step composition and gating order
- scripts/verify-windows-sbom.test.mjs and generate-windows-sbom.test.mjs — SBOM determinism and integrity
- scripts/test-windows-nsis-upgrade.mjs — upgrade path acceptance
