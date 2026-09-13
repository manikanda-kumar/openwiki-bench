---
type: concept
title: Window, Tray, and App Lifecycle
description: Main-process window lifecycle, single-instance lock, deep links, tray/badge, menus, renderer crash recovery, window-state persistence, and background mode.
tags: [main, window, tray, lifecycle, deep-link]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-667228bc239d52d6e15a4685
    resource: repo://src/main/deep-link.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-59edd2d10e25a8877881b8c5
    resource: repo://src/main/renderer-crash-recovery.ts
  - id: openwiki-source-6839fa9ebdfa87a9e7d67f33
    resource: repo://src/main/single-instance.ts
  - id: openwiki-source-ed5597a328b081265415bed4
    resource: repo://src/main/tray.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Window, Tray, and App Lifecycle

The Electron Main process (`src/main/main.ts`) owns the desktop lifecycle: window creation, tray, menus, single-instance enforcement, deep links, renderer crash recovery, and `ui-state.json` persistence. It has no business logic; all agent work lives in the Agent Host.

## Startup sequence

1. Before `app.ready`: `registerAppProtocol()` (the `app://` scheme) and `crashReporter.start()` (upload disabled) run (`src/main/main.ts:42`).
2. `acquireSingleInstanceLock` — if another instance holds the lock, this process quits (`src/main/main.ts:285`).
3. On `ready` (in order): resolve the Windows managed-process helper and secure the reaper directory, initialize the `ManagedProcessReaper`, create the `CredentialVault` and `BrowserService`, build the `UpdateManager`, build the `ToolchainManager`, install desktop IPC and menus, create the tray, apply the persisted theme, and finally spawn the `HostManager` (`src/main/main.ts:367`).
4. The main window is created after the Host starts; the Renderer connects to the Host over a MessagePort.

## Window creation and hardening

`createMainWindow` (`src/main/window.ts:30`):

- Applies persisted bounds via `applyWindowBounds` (defaults 1280×840, min 900×600), maximizes if the stored state was maximized, and picks the display with the largest intersection for the saved position (`window-state-core.ts:60`).
- Uses `preload`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true` (`window.ts:48`).
- Blocks `window.open` (external https/mailto links go to `shell.openExternal`, everything else denied) and restricts navigation to allowed targets (`window.ts:78`).
- Sets a `backgroundColor` for the current theme to avoid white flashes (`window.ts:46`).

## Hide-on-close and background mode

- When `ui-state.json` has `backgroundMode !== false`, closing the window hides it instead of quitting (`shouldHideOnClose`, `src/main/main.ts:314`). The app keeps running in the tray; on `window-all-closed` only non-macOS quits, so macOS stays resident regardless.
- Quitting (tray Quit or app quit) goes through `before-quit`, which — if managed processes are running — prompts the user, then runs the bounded managed-process cleanup and browser disposal with a 15 s deadline before `app.quit()` (`src/main/main.ts:766`).

## Single instance and deep links

- `acquireSingleInstanceLock` (`single-instance.ts:6`) registers a `second-instance` handler that restores/focuses the main window and forwards `argv`.
- The app registers the `pi-agent-desktop` protocol (`src/main/main.ts:827`). `parseDesktopDeepLink` accepts `pi-agent-desktop://session/<id>` and `pi-agent-desktop:/session/<id>` forms (`deep-link.ts:3`).
- On macOS, `open-url` events are handled the same way. The session id is forwarded to the Renderer via `deep-link:session`; if no window exists yet, it is queued as `pendingDeepLink` and consumed after `did-finish-load` (`src/main/main.ts:269`, `window.ts:146`).
- Deep-link session ids are validated in the preload (`isValidDeepLinkSessionMessage` matches a UUID shape) before being delivered (`src/preload/preload-message-policy.ts:22`).

## Tray, badge, and notifications

- `createTray` (`tray.ts:19`) uses `build/icon.png` (resized; template image on macOS), shows the running session and background-process counts in the tooltip, and offers "Stop All Background Processes" (with a confirmation dialog in `main.ts:228`) when managed processes are running. Tray click shows/focuses the window.
- Unread-session badges: `applyBadgeCount` sets the Windows taskbar overlay icon or the macOS/Linux `app.setBadgeCount` (`src/main/main.ts:251`).
- Desktop notifications fire when a session completes in the background (window hidden/unfocused), and clicking them opens the session (`src/main/main.ts:723`).

## Menus

`installAppMenu` (`src/main/menu.ts`) builds the application menu. Menu items emit `menu:<event>` IPC to the Renderer (`new-session`, `settings`, `check-for-updates`, `show-update`, `switch-session`, `export-diagnostics`). The preload buffers one bounded pending command per fixed event with `EarlyEventReplay` so a menu click during Renderer startup is not lost (`src/preload/preload.ts:29`).

## Renderer crash recovery

`RendererCrashRecovery` (`renderer-crash-recovery.ts:15`) handles `render-process-gone`:

- `clean-exit` and `killed` are ignored; `oom`, `launch-failed`, and `integrity-failure` are non-recoverable and show a static crash page.
- Otherwise the window reloads the renderer with exponential backoff (250 ms → 4 s, max 3 reloads within 60 s); exceeding that halts with a `crash-loop` page (`window.ts:113`).
- During a reload, the browser service hides its native Views (`handleRendererUnavailable`) so a stale surface never covers the new UI, and a `did-start-loading` event also triggers the hide.
- `installWindowShowFallback` (`window-show-fallback.ts`) and `createLoadFailurePage`/`createRendererCrashPage` (`window-load-failure.ts`) provide a graceful load-failure page instead of a blank window.

## ui-state.json persistence

`window-state.ts` persists `ui-state.json` in Electron `userData`:

- Window bounds (debounced 400 ms on resize/move, flushed on close), `isMaximized`, sidebar width, `theme` (`light`/`dark`/`system`), `recentCwds` (up to 12), `backgroundMode`, `managedProcessesEnabled`, `automaticUpdateChecks`, and `chatAppearance` (`window-state.ts:8`).
- `trackWindowState` only persists when the window is not minimized/full-screen (`window-state-core.ts:53`).
- IPC (`desktop:get-ui-state` / `desktop:set-ui-state`) exposes a validated subset (`ui-state-patch.ts`) and theme/update settings read/write through it.

## Tests

- `window-state-core.test.mjs` and `window-state.test.mjs` cover bounds resolution and persistence.
- `renderer-crash-recovery.test.mjs` covers reload/halt decisions.
- `deep-link.test.mjs` covers deep-link parsing; `window-load-failure.test.mjs` and `window-show-fallback.test.mjs` cover load-failure UI.
- `single-instance` and tray are exercised through the smoke harness.
