---
type: operations
title: Desktop Window, Updates & App Lifecycle
description: The desktop shell — main window creation and persisted state, menu and tray, deep links, single-instance lock and custom app protocol, plus the update manager's state machine and install-on-quit gates.
tags: [operations, window, updates, lifecycle]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-667228bc239d52d6e15a4685
    resource: repo://src/main/deep-link.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-04edcdfa666f0fab08053db7
    resource: repo://src/main/menu.ts
  - id: openwiki-source-e77e5730690451625dcaf42f
    resource: repo://src/main/packaged-cleanup-fault-validation.ts
  - id: openwiki-source-6839fa9ebdfa87a9e7d67f33
    resource: repo://src/main/single-instance.ts
  - id: openwiki-source-873302e5e8aa96bc6d329875
    resource: repo://src/main/update-adapter.ts
  - id: openwiki-source-6051c8ebdc68fac1700c0be3
    resource: repo://src/main/update-manager.ts
  - id: openwiki-source-b080a136de6f407ff90079ea
    resource: repo://src/main/window-load-failure.ts
  - id: openwiki-source-b17e5c5c0108e5bcbd2fab10
    resource: repo://src/main/window-show-fallback.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-6224abe359e944dd1872f9ad
    resource: repo://src/preload/early-event-replay.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Desktop Window, Updates & App Lifecycle

The main process owns the desktop shell around the Agent-Host–driven chat UI:
a single main window (with persisted bounds and crash recovery), an app menu
and tray, deep-link and single-instance handling, a custom app protocol, and a
supervised update manager.

## Main window creation and state

`createMainWindow` (`src/main/window.ts`) loads the persisted UI state
(`loadUiState` from `src/main/window-state.ts`, file `ui-state.json`), applies
restored bounds and maximization (`applyWindowBounds`, `shouldMaximize`),
creates the `BrowserWindow`, and tracks window state via `trackWindowState`.
The window content is the built renderer (or the Vite dev server in dev), loaded
from `resolveRendererEntry`. On window moves/resize/maximize, state is persisted;
on close the state is saved before teardown.

When the renderer fails to load or crashes, `src/main/window-load-failure.ts` and
`src/main/renderer-crash-recovery.ts` provide fallback pages / a retry URL, and
`src/main/window-show-fallback.ts` retries showing a window that failed to appear
on first paint. `src/main/window-navigation-policy.ts` restricts permitted
in-window navigation.

## Menu, tray and badge

`installAppMenu` (`src/main/menu.ts`) builds the native application menu with
per-OS roles (Settings `CmdOrCtrl+,`, Check for Updates, developer-view roles,
reload, quit, tray actions). Menu commands are delivered to the renderer via
`sendWindowMenuCommand` (`menu:<event>`), and the preload replays them with
`EarlyEventReplay` so a late-subscribing renderer does not miss a command issued
before it subscribed. `src/main/tray.ts` provides the tray icon and badge;
`src/main/protocol.ts` registers the custom `app://` scheme and an HTML preview
page mechanism (`createHtmlPreviewUrl` / `releaseHtmlPreviewUrl`).

The main window applies an unread badge (`applyBadgeCount`) and the menu shows
the live Host/session counts in the tray tooltip.

## Single instance and deep links

`src/main/single-instance.ts` (`acquireSingleInstanceLock`) requests the
single-instance lock; if it is already held, returns `false` so the second
process exits, and focuses/restores the existing window on `second-instance`.
Deep links use the `pi-agent-desktop:` scheme (`parseDesktopDeepLink` /
`findDesktopDeepLink` in `src/main/deep-link.ts`): a URL with host
`session` or path `/session/<id>` maps to a session id that is routed to the
renderer (`onDeepLinkSession`). The custom scheme is declared in
`electron-builder.yml` (`protocols: pi-agent-desktop`). The app
protocol registration runs before `app` is ready.

## Startup readiness gating and validation flags

`main.ts` tracks a startup readiness machine (renderer ready, Host ready, and a
toolchain snapshot) and surfaces it to the UI footer. In packaged builds the
process accepts `--validate-packaged-startup` and
`--validate-packaged-cleanup-fault` to run headless self-validation instead of
launching the normal UI. A toolchain focus-rescan is debounced (60 s TTL) and
the Host ping/restart budget interacts with window state and tray counts.

## Update manager

`src/main/update-manager.ts` is the state machine; `src/main/update-adapter.ts`
wraps `electron-updater`. `DesktopUpdateState` phases are
`disabled | idle | checking | up-to-date | available | downloading |
downloaded | installing | error`, with a closed error-code set.

- Automatic checks run after an initial delay (default 60 s) and then on an
  interval (default 6 h) with jitter, only when `automaticChecksEnabled`.
- A download watchdog (`DOWNLOAD_WATCHDOG_MS`, default 15 min) fails a download
  that stalls.
- `installUpdate()` requires no active agent session:
  `installBlockedByActiveSessions` is set while `runningSessionCount > 0`
  (the manager is fed host `agent.running` counts by `main.ts`), and the
  install is gated on that. Before launching the interactive installer it runs
  the `prepareToInstall` hook (which performs managed-process cleanup and
  fail-closed containment checks); if that fails, `recoverFromInstallFailure`
  restores the app without launching the installer.
- State is pushed to the renderer through the `DesktopUpdateState` bridge and
  menu/notification actions (`menu:check-for-updates`, `menu:show-update`).

`redactUpdateError` scrubs home paths, bearer/basic tokens, GitHub tokens,
authorization headers, query secrets, e-mail addresses, and `Users`/`home`/tmp
paths before updater errors reach logs, capped at `MAX_ERROR_DETAIL_LENGTH`.

`src/main/update-adapter.ts` only publishes an update when the updater verifies
a signature (latest.yml SHA-512) and `main.ts` creates the adapter only in
packaged builds (or `PI_DESKTOP_TEST_UPDATER=1` in dev) on supported platforms.
`src/main/packaged-cleanup-fault-validation.ts` provides a headless mode that
proves update-install fails closed when managed-process cleanups are uncertain.

## Failure behavior

Window renderer crashes trigger the fallback crash page rather than a silent
blank; a failure-to-show window is retried. If the second instance already holds
the lock, the new process exits. Update downloads that stall fail; installs are
rejected while agent sessions run or when pre-install cleanup cannot be
confirmed; an adapter error is classified into the nearest `UpdateErrorCode` and
surfaced to the renderer while the app remains usable.
