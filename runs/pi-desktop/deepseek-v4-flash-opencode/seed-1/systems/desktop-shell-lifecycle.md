---
type: "Reference"
title: "Desktop Shell and Lifecycle"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-667228bc239d52d6e15a4685
    resource: repo://src/main/deep-link.ts
  - id: openwiki-source-4409b8bcec1076bcf5e8ef33
    resource: repo://src/main/diagnostics.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-04edcdfa666f0fab08053db7
    resource: repo://src/main/menu.ts
  - id: openwiki-source-650ce447b08aa5092ed0ec70
    resource: repo://src/main/protocol.ts
  - id: openwiki-source-59edd2d10e25a8877881b8c5
    resource: repo://src/main/renderer-crash-recovery.ts
  - id: openwiki-source-6839fa9ebdfa87a9e7d67f33
    resource: repo://src/main/single-instance.ts
  - id: openwiki-source-ed5597a328b081265415bed4
    resource: repo://src/main/tray.ts
  - id: openwiki-source-873302e5e8aa96bc6d329875
    resource: repo://src/main/update-adapter.ts
  - id: openwiki-source-6051c8ebdc68fac1700c0be3
    resource: repo://src/main/update-manager.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---


# Desktop Shell and Lifecycle

The Electron Main process acts as the desktop shell: it owns the window, menus, tray, notifications, deep links, software updates, diagnostics export, and crash recovery, while delegating agent work to the Host. This page covers the shell behaviors and lifecycle.

## Window creation and state

- `createMainWindow` (`src/main/window.ts:30-170`) builds the main `BrowserWindow` with `sandbox`, `contextIsolation`, no Node integration, and `webSecurity`, applying persisted bounds and maximization from the UI state, then loading the renderer entry (Vite URL in dev, `app://bundle/index.html` otherwise).
- Window bounds/position are persisted by `trackWindowState`, which debounces resize/move by 400 ms and saves on close into `ui-state.json` under the user data dir (`src/main/window-state.ts:40-70`). The state also carries theme, sidebar width, recent cwds, `backgroundMode`, and `automaticUpdateChecks` (`window-state.ts:8-21`).
- Close can hide to tray instead of quitting when `backgroundMode` is on (`src/main/main.ts:306-322`). `window.open` is denied and navigation is restricted to `app:` and the dev server (see [Three-Process Architecture](../architecture/three-process-architecture.md)).

## Menus

`installAppMenu` (`src/main/menu.ts:5-157`) builds a platform-aware menu: a macOS app menu with a Check for Updates item, File (New Session `CmdOrCtrl+N`, Switch Session `CmdOrCtrl+K`, Settings), Edit, View (developer roles only in dev), Window, and Help (Open Logs Folder, Export Diagnostics…, Check for Updates on Windows). Menu commands are forwarded to the renderer as `menu:*` IPC events, which the preload buffers one generation per fixed event so early navigation is not lost (`src/preload/preload.ts:37-53`).

## Tray and badges

- `createTray` shows a system tray icon; clicking it focuses/restores the window. The tooltip and menu surface the running session count and managed background-process count, and a "Stop All Background Processes" action appears while processes are running (`src/main/tray.ts:19-145`).
- Unread badges use `app.setBadgeCount` on macOS/Linux and a 16×16 overlay icon on the Windows taskbar (`src/main/main.ts:251-267`).
- The tray action for stopping all processes confirms with a warning dialog and calls `processes.stopAll` with a 15 s Host timeout (`src/main/main.ts:228-249`).

## Single instance and deep links

- `acquireSingleInstanceLock` calls `app.requestSingleInstanceLock`; a second instance instead focuses the existing window and passes its argv through `onSecondInstance` (`src/main/single-instance.ts:6-24`).
- The app registers the `pi-agent-desktop://` custom protocol (`src/main/main.ts:828-834`). `parseDesktopDeepLink` accepts `pi-agent-desktop://session/<id>` (hostname form) and `pi-agent-desktop:///session/<id>` path form; `handleDeepLink` forwards the session id to the renderer as `deep-link:session`, or queues it until a window exists (`src/main/deep-link.ts:3-23`, `main.ts:269-281`). macOS `open-url` is handled the same way (`main.ts:294-297`).

## Notifications

Main shows desktop notifications for background session completion (`agent-end`) with a click-through to the session, and for an available update when the window is hidden or unfocused (`src/main/main.ts:723-743`, `main.ts:524-544`). Notifications increment the unread badge for completed background sessions.

## Software updates

- `UpdateManager` (`src/main/update-manager.ts`) drives the state machine with phases `disabled`/`idle`/`checking`/`up-to-date`/`available`/`downloading`/`downloaded`/`installing`/`error` and typed error codes (`contract/desktop.ts:44-74`). Automatic checks start after 60 s and repeat every 6 h with 8% jitter, with a 15-minute download watchdog (`update-manager.ts:4-7`).
- The updater is gated to `darwin` and `win32` in production (or a dev test mode) and only exists in packaged builds (`src/main/main.ts:438-452`). Install is blocked while agent sessions are running; `prepareToInstall` stops managed processes within a hard deadline and verifies the Windows helper is replaceable before update installation, while `recoverFromInstallFailure` restarts the Host if installation fails (`src/main/main.ts:458-483`).
- `createProductionUpdateAdapter` wraps `electron-updater` with `autoDownload`, `autoInstallOnAppQuit`, `allowPrerelease`, and `allowDowngrade` all false, `disableWebInstaller` true, and a nulled logger; the renderer updater contract exposes only fixed actions and cannot configure a feed (`src/main/update-adapter.ts:88-103`, `check-desktop-security.mjs:525-544`).
- Updates are downloaded only after user confirmation, installed after the current tasks finish, and the client uses only the packaged app's fixed GitHub release configuration.

## Diagnostics export

`exportDiagnostics` (`src/main/diagnostics.ts:19-80`) writes, into a user-selected directory with `0700` permissions:

- `system.json` (version/platform info, privacy statement) and redacted `toolchains.json`/`browser.json` summaries;
- bounded, redacted copies of `main.log` and the app log directory (5 MiB cap, tail read for larger logs, `0600` files);
- crash metadata only — minidumps can contain process memory and credentials, so raw dumps are excluded by design (`diagnostics.ts:73-76`, `diagnostics.ts:114-133`).

Redaction is performed by `redactDiagnosticText` (see [Security Model](../architecture/security-model.md)).

## Crash recovery

- `RendererCrashRecovery` (`src/main/renderer-crash-recovery.ts:15-51`) bounds renderer reloads after `render-process-gone`: exponential backoff from 250 ms to 4 s, at most 3 reloads in a 60 s window, then a crash page. `oom`, `launch-failed`, and `integrity-failure` halt immediately; `clean-exit`/`killed` are ignored.
- A `--validate-packaged-startup` probe mode and a packaged cleanup-fault validation write reports into the user data dir and exit with a non-zero code on failure (`src/main/main.ts:51-52`, `main.ts:108-166`).
- Host crashes are handled by `HostManager` (heartbeat + bounded restarts); the renderer reconnects over a fresh MessagePort after a restart (see [Agent Host Runtime](../architecture/agent-host-runtime.md)).

## app:// protocol serving

`handleAppProtocol` serves the built renderer over the privileged `app://` scheme with a strict CSP and path containment, and serves user HTML previews under `app://preview/<token>/...` with a much narrower CSP, 30-minute TTL, and bounded assets (see [Security Model](../architecture/security-model.md) and `src/main/protocol.ts:154-251`).

## Related pages

- [Three-Process Architecture](../architecture/three-process-architecture.md)
- [Development and Verification Guide](../guides/development-and-verification.md)
- [Agent Host Runtime](../architecture/agent-host-runtime.md)
