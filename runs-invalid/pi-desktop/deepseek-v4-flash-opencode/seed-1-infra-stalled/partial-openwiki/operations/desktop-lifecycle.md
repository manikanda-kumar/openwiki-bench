---
type: "Reference"
title: "Desktop Lifecycle: Startup, Window, Recovery, Diagnostics"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T13:27:03.630Z
---


# Desktop Lifecycle: Startup, Window, Recovery, Diagnostics

This page covers the Main-process lifecycle around the core agent machinery: startup and single-instance behavior, window/tray/badge management, crash recovery for both the Host and the renderer, state persistence, diagnostics export, and quit cleanup. (Agent Host supervision, the managed-process reaper, and updates each have their own dedicated pages.)

## Startup

`startMainProcess` (`src/main/main.ts:283`) registers the `app://` protocol and starts `crashReporter` with `uploadToServer: false` before the app is ready (`src/main/main.ts:43-48`). It then enforces a single instance: `acquireSingleInstanceLock` returns `false` (and the process exits) if another instance holds the lock, otherwise a `second-instance` event restores/focuses the existing window and forwards any deep link found in the new argv (`src/main/single-instance.ts:6-24`).

Deep links use the `pi-agent-desktop://` scheme. `parseDesktopDeepLink` accepts `pi-agent-desktop://session/<id>` and `pi-agent-desktop://<id>` and returns a session id; links are accepted from `second-instance` argv, macOS `open-url`, and (in dev) explicit protocol registration (`src/main/deep-link.ts:3-19`, `src/main/main.ts:294-297,828-834`). If no window exists yet, the link is parked in `pendingDeepLink` and consumed when `createWindow` runs (`src/main/main.ts:279-280,309-313`).

The `whenReady` pipeline (detailed in [Architecture Overview](/openwiki/architecture/overview.md)) constructs the reaper, vault, browser service, updater, and toolchain manager, installs IPC/menu/tray, then starts the Host and creates the window (`src/main/main.ts:367-764`). Two **packaged validation probes** run instead of the normal UI:

- `--validate-packaged-startup` waits for renderer + Host ready, a matching expected Pi version, a toolchain ack at or above the scanned revision, and healthy bundled `rg`/`fd`, then writes `packaged-startup-check.json` and exits (with a 45 s timeout) (`src/main/main.ts:51,108-166,420-425`).
- `--validate-packaged-cleanup-fault` runs `runPackagedCleanupFaultValidation`, which forces a fault deadline through `cleanupManagedProcessContainment` and a `ValidationUpdateAdapter` install/recover cycle, writes `packaged-cleanup-fault-check.json`, and exits with the report's outcome (`src/main/main.ts:52,369-390`, `src/main/packaged-cleanup-fault-validation.ts:62-90`).

## Window, tray, badges

`createMainWindow` (`src/main/window.ts:30-55`) restores persisted bounds (falling back to `1280×840` on the primary work area), configures the sandboxed `webPreferences`, and defers showing until the renderer signals readiness (`installWindowShowFallback`). Closing hides to the tray when `backgroundMode` is enabled; real quits only happen when `isQuitting` is set (`src/main/window.ts:99-104`, `src/main/main.ts:314`).

Window and UI state persist to `ui-state.json` under `userData`: bounds, maximized, theme, recent cwds, sidebar width, background mode, automatic-update-checks, and chat appearance. `trackWindowState` debounces resize/move persistence by 400 ms and writes on close (`src/main/window-state.ts:27-70`).

The tray shows live session + managed-process counts, and offers a "Stop all" flow that prompts the user before calling `processes.stopAll` (`src/main/tray.ts:58-70`, `src/main/main.ts:228-249`). Unread completion badges use the macOS `app.setBadgeCount` or a Windows 16×16 overlay icon (`applyBadgeCount`, `src/main/main.ts:251-267`). Host messages drive these: `running-sessions`, `managed-process-count`, and `agent-end` (which also raises a desktop notification when the window is hidden or unfocused) (`src/main/main.ts:712-749`).

## Crash recovery

- **Agent Host**: the `HostManager` supervises the utility process (ping/liveness, restart budget of 2 within 30 s, per-Host snapshot acks) — see [Architecture Overview](/openwiki/architecture/overview.md). Crash status is broadcast to every window via `host:status` / `host:crashed`, and a successful restart emits `host:restarted` (`src/main/main.ts:686-710`). The Host deliberately exits on `uncaughtException`/`unhandledRejection` so the supervisor can restart it.
- **Renderer**: `RendererCrashRecovery` (`src/main/renderer-crash-recovery.ts:15-51`) classifies `render-process-gone` reasons. `clean-exit`/`killed` are ignored; `oom`/`launch-failed`/`integrity-failure` halt immediately; otherwise it auto-reloads with exponential backoff (`250 ms` base, `4 s` max) and stops after 3 reloads within a 60 s window (`crash-loop`). After a halt the window shows a self-contained crash page with a `pi-desktop://renderer-retry` link; a retry resets the recovery and reloads the renderer (`src/main/window.ts:113-120`, `src/main/window-load-failure.ts:54-63`). If the initial renderer load fails, a load-failure page is shown instead (`src/main/window-load-failure.ts:40-52`).

## Logging and diagnostics

Main logs go through an async rotating file logger to `main.log` under the app logs directory: 5 MB per file, 3 generations, a bounded in-memory queue flushed every 50 ms, and every line sanitized (`src/main/logger.ts:8-53`).

`exportDiagnostics` (`src/main/diagnostics.ts:19-80`) is an explicitly user-triggered, redacted export: it saves `system.json` (with all machine paths redacted to placeholders), a toolchain summary and browser diagnostics if available, redacted copies of `main.log` and every `*.log` under the logs directory, and a **crash-dumps.json metadata summary only** — raw minidumps are deliberately excluded because they can contain process memory and credentials. Redaction removes home/userData/log paths, credentials, tokens, and emails (`src/main/diagnostics-redaction.ts`, referenced from `diagnostics.ts:9`).

## Quit and shutdown cleanup

Quitting goes through the `before-quit` handler (`src/main/main.ts:766-807`):

1. If managed processes are still running (and not in packaged validation), the user is prompted to stop them or cancel the quit.
2. `isQuitting` is set, automatic update checks stop, and the tray is destroyed.
3. `cleanupManagedProcessContainment` runs with a **15 s deadline** (`MANAGED_PROCESS_SHUTDOWN_DEADLINE_MS`): it asks the Host to stop, then has the reaper reap all records, and logs whether each side completed or hit the deadline (`src/main/managed-process/shutdown-cleanup.ts:35-63`).
4. The browser service is disposed under the same deadline via `beforeDeadline` (`src/main/managed-process/shutdown-cleanup.ts:16-33`).
5. `app.quit()` runs again with `quitCleanupComplete` set.

For an update install, the same cleanup runs with `requireConfirmedEmpty: true`, meaning cleanup must be *confirmed* complete (Host stopped, reaper ready with zero records) or the install path aborts (`src/main/main.ts:458-463`).

## Related pages

- [Software Updates](/openwiki/operations/updates.md)
- [Managed Background Processes](/openwiki/systems/managed-processes.md)
- [Architecture Overview](/openwiki/architecture/overview.md)
- [Quickstart](/openwiki/quickstart.md)