---
type: reference
title: Updates and Packaging
description: The software-update pipeline (electron-updater adapter and UpdateManager state machine), the install protocol and its gating, automatic scheduling, error classification/redaction, and platform packaging targets.
tags: [updates, electron-updater, packaging, install, release]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-873302e5e8aa96bc6d329875
    resource: repo://src/main/update-adapter.ts
  - id: openwiki-source-6051c8ebdc68fac1700c0be3
    resource: repo://src/main/update-manager.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Updates and Packaging

Pi Agent Desktop ships as a packaged Electron app and supports software updates
on macOS and Windows through an `electron-updater` adapter wrapped by a
framework-free `UpdateManager` state machine.

## UpdateManager state machine

`UpdateManager` (`src/main/update-manager.ts`) is a pure, testable state machine
binding `electron-updater` events into a single `DesktopUpdateState`
(`phase`, `currentVersion`, `availableVersion`, release metadata, progress,
`error`, `installBlockedByActiveSessions`, `canRetry`).

Phases: `disabled | idle | checking | up-to-date | available | downloading |
downloaded | installing | error`.

- **Enabled** only when `adapter` exists, platform is `darwin`/`win32`, and the
  app is packaged (or `PI_DESKTOP_TEST_UPDATER=1` for dev) (`update-manager.ts:236-244`).
- **check** → `checking` → `up-to-date`/`available`. Only legal from `idle`,
  `up-to-date`, or `error`; re-entering an in-flight check reuses the existing
  operation, and a different-kind concurrent operation fails with `UPDATE_BUSY`
  (`update-manager.ts:296-314`, `:628-659`).
- **download** → only from `available`; progress comes from the adapter's
  `download-progress`; completion (`update-downloaded`) → `downloaded`
  (`update-manager.ts:450-463`, `:510-514`).
- **install** → only from `downloaded`; requires zero running agent sessions
  (else `UPDATE_BUSY`) (`update-manager.ts:351-361`).

Each operation tracks a single `activeOperation`; a second call of the same
kind returns the in-flight promise, and a different kind rejects with
`UPDATE_BUSY`.

## Install protocol

`installUpdate()`:

1. Rejects unless phase is `downloaded`.
2. Refuses while any agent session is running (`installBlockedByActiveSessions`).
3. Marks install lifecycle prepared, calls `prepareToInstall()`, then
   `adapter.quitAndInstall(false, true)` (silent, run-after-install).

`prepareToInstall` in `main.ts` sets `isQuitting`, destroys the tray, cleans up
all managed processes within the shutdown deadline, and (on Windows) re-resolves
and verifies the managed-process helper is replaceable — throwing if not
(`main.ts:458-474`). On install failure, `recoverFromInstallFailure` restores the
tray and restarts the Agent Host (`main.ts:476-481`, `update-manager.ts:578-592`).

The update client uses only the fixed public GitHub Release config baked into
the package; it does not accept an update URL or publish credentials from the
Renderer (`README` / `electron-builder.yml` `publish`).

## Automatic updates

Automatic checks begin after `startAutomaticChecks()` at startup with `idle` —
first check at 60s (jitter ±8%), then every 6h (`update-manager.ts:4-7`). The
next interval applies `jitterRatio` (±8%). Automatic checks are skipped while
`automaticChecksEnabled` is off or while the phase is not an idle/retryable
state (`update-manager.ts:661-692`). `setRunningSessionCount` maintains
`installBlockedByActiveSessions`.

Because `main.ts` calls `startAutomaticChecks()` and `updateManager.subscribe`
notifies the renderer and pushes a desktop notification when a new version is
available (`main.ts:520-544`), users see and download updates through the
settings UI.

## Download watchdog

A watchdog rejects a download that makes no progress within 15 minutes,
cancelling the adapter download and surfacing `UPDATE_DOWNLOAD_FAILED`
(`update-manager.ts:542-568`).

## Error classification and redaction

`classifyUpdateError` maps adapter/network/protocol failures to a stable
`UpdateErrorCode`: `UPDATE_OFFLINE`, `UPDATE_NOT_PUBLISHED`,
`UPDATE_METADATA_INVALID`, `UPDATE_SIGNATURE_INVALID`, `UPDATE_DOWNLOAD_FAILED`,
`UPDATE_BUSY`, `UPDATE_INVALID_STATE`, `UPDATE_UNSUPPORTED`, `UPDATE_UNKNOWN`
(`update-manager.ts:111-138`). Signature-invalid and unsupported errors are not
retryable.

`redactUpdateError` strips local paths (home, temp, cache), auth/bearer headers,
tokens, emails, and query-string credentials before any error is logged
(`update-manager.ts:81-109`). Release notes are sanitized from HTML to plain text
with a length cap.

## Adapter

`UpdateAdapter` (`update-adapter.ts`) is a small injectable surface around
`electron-updater` so tests never contact a server. `createProductionUpdateAdapter`
uses the packaged configuration. `isProductionUpdatePlatformEnabled` returns
true only for `darwin`/`win32`.

The README notes a trust limitation: Windows releases currently omit
`publisherName` while Authenticode signing is unavailable, so
`electron-updater` skips publisher verification but still validates the
downloaded NSIS file against the SHA-512 digest in `latest.yml` before running
the interactive installer (`update-adapter.ts:34-40`).

## Packaging targets

`electron-builder.yml` defines:

- **macOS**: DMG + ZIP for `arm64` and `x64`, hardened runtime, Developer ID
  entitlements.
- **Windows**: NSIS installer for `x64`; artifact name is
  `Pi-Agent-Desktop-Unsigned-Beta-Setup-<version>.exe` until Authenticode is
  provisioned (`electron-builder.yml:129-143`).
- **Linux**: AppImage for `x64`, with `--appimage-desktop-launch` to keep the
  Chromium sandbox and an app-owned inert launch marker.

`scripts/package-desktop.mjs` drives `--dir` (unpacked) and `--release`
(installers). Pre/post-build checks (`check-production-artifacts`,
`verify-packaged-toolchains`, `verify-windows-helper-reproducibility`,
`verify-windows-sbom`) gate packaging in `scripts/verify.mjs` / the release
workflow.

## Packaged startup validation

A packaged executable can run with `--validate-packaged-startup` to write
`packaged-startup-check.json` (reporting app/pi version, renderer/host
readiness, toolchain ack revision, and bundled-search candidate health) and
exit. This validates that a freshly packaged instance actually applied its
expected Pi + toolchain at startup (`main.ts:51-52`, `:108-166`).

## Related pages

- Architecture Overview
- Managed Process Crash Recovery (Reaper)
- Logging and Diagnostics
- Quickstart
