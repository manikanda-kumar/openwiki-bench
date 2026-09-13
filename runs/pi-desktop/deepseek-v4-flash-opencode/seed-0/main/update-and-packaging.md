---
type: concept
title: Updates and Distribution Packaging
description: The electron-updater integration, the update manager state machine with download watchdog and install gating, and the electron-builder packaging/release pipeline for macOS, Windows, and Linux.
tags: [main, updates, packaging, electron-builder, distribution]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-225b5fd1956078dfb2193515
    resource: repo://scripts/verify-update-metadata.mjs
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-873302e5e8aa96bc6d329875
    resource: repo://src/main/update-adapter.ts
  - id: openwiki-source-6051c8ebdc68fac1700c0be3
    resource: repo://src/main/update-manager.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Updates and Distribution Packaging

Pi Agent Desktop ships auto-updates for macOS and Windows through `electron-updater`, wrapped by a Main-process adapter and a stateful `UpdateManager`. Packaging uses `electron-builder` with a strict verify-before-pack gate and per-platform release artifacts.

## Update adapter and platform gating

- `update-adapter.ts` wraps `electron-updater`'s `AppUpdater` behind a small injectable `UpdateAdapter` interface (`on`, `checkForUpdates`, `downloadUpdate`, `cancelDownload`, `quitAndInstall`), so tests never load Electron or contact an update server (`src/main/update-adapter.ts:16`).
- `isProductionUpdatePlatformEnabled` returns true only for `darwin` and `win32` (`src/main/update-adapter.ts:34`). The adapter pins `autoDownload = false`, `autoInstallOnAppQuit = false`, `allowPrerelease = false`, `allowDowngrade = false`, and disables the library console logger so errors flow through `UpdateManager`'s redacted logging (`src/main/update-adapter.ts:88`).
- In dev, the updater only activates with `PI_DESKTOP_TEST_UPDATER=1`; in packaged builds it activates for supported platforms (`src/main/main.ts:438`).

## Update manager state machine

`UpdateManager` (`src/main/update-manager.ts:203`) drives a state machine with phases `disabled → idle → checking → up-to-date | available → downloading → downloaded → installing → error`:

- **Automatic checks** start after an initial 60 s delay, then run on a 6-hour interval with ±8% jitter, unref'd timers, and a phase gate (`update-manager.ts:391`). The interval is restarted only after the previous check settles.
- **Check** aborts on a concurrent operation with `UPDATE_BUSY`; download requires phase `available`; install requires phase `downloaded` and rejects while active Agent sessions are running (`installBlockedByActiveSessions`, `update-manager.ts:345`).
- **Download watchdog**: `armDownloadWatchdog` cancels a download that makes no progress for 15 minutes and rejects with `UPDATE_DOWNLOAD_FAILED` (`update-manager.ts:542`). Download events are deduplicated and the state settles only when both the adapter promise and the `update-downloaded` event have arrived (`finishDownloadedUpdate`).
- **Install** calls `prepareToInstall` — which stops managed processes, destroys the tray, and (on Windows) re-verifies and swaps the managed-process helper — before `adapter.quitAndInstall(false, true)` (`src/main/main.ts:458`). On failure `recoverInstallLifecycle` restores the tray and restarts the Host.
- **Error classification** maps adapter failures to stable codes (`UPDATE_OFFLINE`, `UPDATE_NOT_PUBLISHED`, `UPDATE_METADATA_INVALID`, `UPDATE_SIGNATURE_INVALID`, `UPDATE_DOWNLOAD_FAILED`, `UPDATE_UNKNOWN`) with user-facing messages (`update-manager.ts:111`).
- **Redaction**: `redactUpdateError` strips credentials, bearer/basic tokens, API keys, local paths, emails, and trims to 800 chars before writing errors to logs (`update-manager.ts:81`).

Release notes are HTML-decoded, script/style-stripped to plain text, and bounded to 12 000 chars (`update-manager.ts:159`).

## Electron-builder packaging

`electron-builder.yml` defines the distribution layout:

- **files**: only `out/**`, `package.json`, LICENSE, icon, and the macOS entitlements. `dist/`, `scripts/`, `src/`, tsconfig/tsup/vite configs are excluded. Authoring files from the Pi packages (READMEs, docs, examples, `.d.ts`) are restored via explicit FileSets because the Pi agent injects package-relative paths into its system prompt (`electron-builder.yml:29`).
- **extraResources**: `THIRD_PARTY_NOTICES.md`, the signed runtime/core toolchain catalogs, and the current target's bundled core search tools under `toolchains/core/<platform>-<arch>` (`electron-builder.yml:102`). Windows additionally ships the managed-process helper (`out/native/windows-managed-process-helper` → `managed-process/win32-x64`) with its manifest (`electron-builder.yml:129`).
- **macOS**: DMG + ZIP for arm64 and x64, hardened runtime, signed with entitlements.
- **Windows**: NSIS installer (x64 only), unsigned beta naming (`Pi-Agent-Desktop-Unsigned-Beta-Setup-<version>.exe`) while Authenticode is not provisioned.
- **Linux**: AppImage (x64) with `--appimage-desktop-launch` to keep Chromium sandboxing on.
- **publish**: GitHub Releases provider (`owner: DLYZZT`, repo `pi-desktop`, `releaseType: draft`) (`electron-builder.yml:171`).

## The verify-before-pack quality gate

`scripts/package-desktop.mjs` (`--dir` for unpacked, `--release` for installers) runs, in order:

1. `prepare-bundled-tools` (builds the bundled ripgrep/fd core search tools into `build/toolchains/core`).
2. `verify` — the full quality gate (format, lint, typecheck, unit, contract, security, build, smoke, browser E2E).
3. On Windows release: `check:windows-helper-reproducibility` (authoritative helper must be reproducible).
4. `electron-builder` (`--publish never` for release; `CSC_IDENTITY_AUTO_DISCOVERY=false`).
5. On Windows release: `generate-windows-sbom` + `verify-windows-sbom`.

## Update metadata verification

`scripts/verify-update-metadata.mjs` validates a `latest*.yml` against the actual release artifacts: version match, exact file-name set, byte-exact sizes, SHA-512 digests, and blockmap presence (embedded block map for AppImage, sibling `.blockmap` otherwise) (`scripts/verify-update-metadata.mjs:47`). `src/main/update-metadata.test.mjs` exercises it with tamper-detection cases.

## CI packaging jobs

`build-desktop.yml` runs packaging per target (`darwin-arm64`, `darwin-x64`, `win32-x64`, `linux-x64`) with `check:packaged-toolchains` verifying production startup and toolchain integrity, `--release-helper` on Windows, the NSIS upgrade path test (`test:windows-nsis-upgrade`), and Windows SBOM generation/verification.

## Tests

- `src/main/update-manager.test.mjs` covers the state machine, watchdog, gating, and error classification.
- `src/main/update-adapter.test.mjs` covers the adapter wrapper policy.
- `src/main/update-metadata.test.mjs` covers metadata verification.
- `scripts/package-desktop.test.mjs` covers the packaging step sequence.
