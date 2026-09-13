---
type: operations
title: Software Updates
description: How Pi Agent Desktop checks, downloads, and installs updates — the electron-updater adapter, the UpdateManager state machine, automatic checks, install-time cleanup, and error classification with redaction.
tags: [updates, electron-updater, github-releases, lifecycle, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T13:27:03.630Z
---

# Software Updates

Updates are managed by `UpdateManager` (`src/main/update-manager.ts`) over an injectable adapter that wraps `electron-updater` (`src/main/update-adapter.ts`). The update client uses only the GitHub Release configuration embedded in production builds; it never accepts update URLs or release credentials from the Renderer.

## Adapter and platform support

The `UpdateAdapter` interface (`src/main/update-adapter.ts:16-22`) is a thin, testable surface around `AppUpdater`: event subscriptions, `checkForUpdates`, `downloadUpdate`, optional `cancelDownload`, and `quitAndInstall`. `createProductionUpdateAdapter` lazily imports `electron-updater` only when the packaged main process needs it, keeping ordinary Node tests free of the updater (`src/main/update-adapter.ts:109-121`). `wrapElectronUpdater` hardens the config: `autoDownload = false`, `autoInstallOnAppQuit = false` (install must pass through the explicit `installUpdate()` gate), `allowPrerelease = false`, `allowDowngrade = false`, `disableWebInterpreter = true`, and `updater.logger = null` so the library cannot leak URLs/headers through its console logger (`src/main/update-adapter.ts:88-103`).

Updates are supported on **darwin and win32** only (`isProductionUpdatePlatformEnabled`, `src/main/update-adapter.ts:34-40`). Windows releases intentionally omit `publisherName` while Authenticode signing is unavailable, so electron-updater skips publisher verification but still validates the downloaded NSIS file against the SHA-512 digest in `latest.yml`. Linux AppImages are updated manually (per `README.en.md`). The adapter is only constructed when the platform is supported **and** the build is packaged (or `PI_DESKTOP_TEST_UPDATER=1` in dev) (`src/main/update-manager.ts:236-266`, `src/main/main.ts:438-452`).

## State machine and operations

The `DesktopUpdateState` phase set is: `disabled`, `idle`, `checking`, `up-to-date`, `available`, `downloading`, `downloaded`, `installing`, `error` (`src/contract/desktop.ts:44-56`). `UpdateManager` serializes operations: a concurrent call of the **same** kind is reused, a different kind is rejected with `UPDATE_BUSY` (`reuseOrReject`, `src/main/update-manager.ts:628-632`).

- **check** (`checkForUpdates`, `src/main/update-manager.ts:292-314`) is valid from `idle`/`up-to-date`/`error` and records adapter failures without leaving the flow.
- **download** (`downloadUpdate`, `src/main/update-manager.ts:316-343`) is valid only from `available`. It runs under a **no-progress watchdog** of 15 minutes (`DEFAULT_DOWNLOAD_WATCHDOG_MS`): if no `download-progress` event arrives in time, the download is cancelled and fails with `UPDATE_DOWNLOAD_FAILED` (`downloadWithWatchdog`/`armDownloadWatchdog`, `src/main/update-manager.ts:516-561`).
- **install** (`installUpdate`, `src/main/update-manager.ts:345-377`) is valid only from `downloaded` and **rejects with `UPDATE_BUSY` while any agent session is running** (`runningSessionCount > 0`). On success it calls `prepareToInstall()`, then `adapter.quitAndInstall(false, true)`. On failure it runs `recoverInstallLifecycle()` and rethrows a classified `UpdateManagerError`.

Automatic checks start after a 60 s initial delay and repeat every 6 hours with ±8 % jitter, skipping when the state is not `idle`/`up-to-date`/`error` (`src/main/update-manager.ts:391-402,661-692`). `setRunningSessionCount` drives the `installBlockedByActiveSessions` flag (`src/main/update-manager.ts:280-290`). When an update becomes `available` while the window is hidden/unfocused, Main raises a desktop notification (`src/main/main.ts:524-544`).

## Install-time preparation

`main.ts` wires `prepareToInstall` and `recoverFromInstallFailure` (`src/main/main.ts:458-483`). Preparing to install:

1. Sets `isQuitting = true` and destroys the tray.
2. Runs `cleanupManagedProcesses` with the **15 s shutdown deadline and `requireConfirmedEmpty: true`** — the install aborts unless Host stop and reaper completion are confirmed (`src/main/managed-process/shutdown-cleanup.ts:58-63`).
3. On Windows x64, re-resolves the managed-process helper and verifies it is **replaceable** (a rename probe proves the running helper is not locked); otherwise the install throws and recovery runs (`src/main/main.ts:463-474`, `src/shared/windows-managed-process-helper.ts:143-173`).

On failure, `recoverFromInstallFailure` resets `isQuitting`, recreates the tray, and restarts the Agent Host (`restartHostAfterExit`).

## Error classification and redaction

`classifyUpdateError` maps error text and context into the stable `UpdateErrorCode` set: signature failures → `UPDATE_SIGNATURE_INVALID`, network errors → `UPDATE_OFFLINE`, missing releases → `UPDATE_NOT_PUBLISHED`, metadata/checksum problems → `UPDATE_METADATA_INVALID`, download/blockmap problems → `UPDATE_DOWNLOAD_FAILED`, else `UPDATE_UNKNOWN` (`src/main/update-manager.ts:111-138`). `recordAdapterError` sets `canRetry = false` only for `UPDATE_SIGNATURE_INVALID` and `UPDATE_UNSUPPORTED` (`src/main/update-manager.ts:594-610`).

`redactUpdateError` strips home/user paths, `Bearer`/`Basic` auth, GitHub tokens, credentials, emails, and cache paths before any error is logged or surfaced (`src/main/update-manager.ts:81-109`), and release notes are converted to bounded plain text (`MAX_RELEASE_NOTES_LENGTH = 12_000`) with scripts/styles stripped (`releaseNotesToText`/`plainText`, `src/main/update-manager.ts:159-185`).

## Update configuration and verification

The publish target is embedded in `electron-builder.yml` (`provider: github`, `owner: DLYZZT`, `repo: pi-desktop`, `releaseType: draft`). CI verifies every packaged `app-update.yml` contains exactly the expected `provider`/`owner`/`repo` and no feed-override or credential fields, and refuses `publisherName` on the unsigned Windows release (`build-desktop.yml` macOS/Windows verification steps). `scripts/verify-update-metadata.mjs` additionally checks that `latest*.yml` declares exactly the expected artifacts with matching sizes and SHA-512 digests before artifacts ship (`scripts/verify-update-metadata.mjs:47-80`).

## Related pages

- [Desktop Lifecycle](/openwiki/operations/desktop-lifecycle.md)
- [Build, Test, and Packaging](/openwiki/development/build-and-test.md)
- [Security and Trust Model](/openwiki/security/security-model.md)