---
type: architecture
title: Architecture Overview and Host Supervision
description: The Electron three-process topology, how Main supervises the Agent Host utilityProcess with heartbeats and a restart budget, and how renderer crashes and host exits are recovered.
tags: [architecture, electron, utility-process, supervision, crash-recovery, messageport]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-aea5c2916208b69846d86e76
    resource: repo://src/main/host-install-recovery.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-2e66fb4f566860c1e33d2bc9
    resource: repo://src/main/host-restart-core.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-59edd2d10e25a8877881b8c5
    resource: repo://src/main/renderer-crash-recovery.ts
  - id: openwiki-source-78a0fdd1bbac4bc19b5c57d4
    resource: repo://src/shared/heartbeat-liveness.ts
  - id: openwiki-source-74c6b0267a12bbfb67847a09
    resource: repo://tsup.config.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Architecture Overview and Host Supervision

Pi Agent Desktop is an Electron app with a deliberate three-process split: the Main process owns desktop capabilities and supervision, a dedicated Agent Host `utilityProcess` runs the Pi coding agent, and the sandboxed Renderer runs the React UI. The build outputs reflect this: `out/main/main.js` (CJS), `out/main/agent-host.mjs` plus `plugin-worker.mjs` and `managed-process-worker.mjs` (ESM, because pi packages are import-only), and `out/preload/preload.js` (tsup.config.ts).

## Responsibilities by process

- **Main** (`src/main/main.ts`, header comment: "window lifecycle, menus, tray/badge, deep link, Host supervision, system IPC. No business logic"): window creation with `sandbox: true`, tray and badges, deep links (`pi-agent-desktop://`), software updates, custom `app://` protocol, and supervision of the Agent Host (src/main/main.ts:1-5).
- **Agent Host** (`src/agent-host/index.ts`, "Runs pi-coding-agent in-process; serves Api/Streams over MessagePort"): sessions, files, configuration, channels, managed processes, and extensions (src/agent-host/index.ts:1-4).
- **Renderer** (`src/renderer/`): React 19 UI, talking only through the preload bridge and the typed MessagePort RPC.

The Host exists as a separate process so the third-party pi runtime, its extensions, and long-running agent work are isolated from the UI process; a corrupted Host exits instead of serving requests, and Main restarts it within a bounded budget (src/agent-host/index.ts:113-118).

## Host lifecycle in Main

`HostManager` (src/main/host-manager.ts) forks the Host with `utilityProcess.fork`, stripping `ELECTRON_RUN_AS_NODE` so the child receives `parentPort`, and setting `PI_AGENT_HOST`, `PI_DESKTOP_USER_DATA`, and `PI_DESKTOP_VERSION` env markers (src/main/host-manager.ts:219-236).

The parent/child control protocol over `parentPort`:

- Host → Main: `ready` (with pi version), `pong`, `log`, `toolchain:ack`, `browser:ack`, `managed-process-owner:ack` (src/agent-host/index.ts:45-106; src/main/host-manager.ts:263-299).
- Main → Host: `ping`, `attach-port` (transfers a renderer MessagePort), `toolchain:init|changed` and `browser:init|changed` snapshots, `managed-process-owner:init`, and `shutdown` (src/main/host-manager.ts:112-137, 418-456; src/agent-host/index.ts:45-104).

On `ready`, Main (re)sends both policy snapshots and the managed-process owner identity, marks the Host ready, and starts the ping loop; a Host that was ready before its exit triggers a `host-restarted` (crash-recovery) notification (src/main/host-manager.ts:263-277). A replacement Host must acknowledge both snapshots itself — acknowledgements from the previous Host are not transferable, so ack revisions reset to -1 on every spawn (src/main/host-manager.ts:211-216).

## Liveness and crash handling

Main pings every 15 seconds and kills the Host if no pong arrives within the 10-second timeout budget (`PING_INTERVAL_MS`, `PING_TIMEOUT_MS`, src/main/host-manager.ts:17-20, 386-416). The heartbeat evaluator distinguishes an unresponsive peer from a suspended clock: after a clock discontinuity (tick gap larger than interval + timeout, or negative gaps) it re-establishes one heartbeat before declaring the peer dead, because ownership safety is separately enforced by process handles and pipe EOF (src/shared/heartbeat-liveness.ts:14-29).

Restarts are budgeted: at most 2 restarts within a 30-second crash window (`CRASH_WINDOW_MS`, `MAX_RESTARTS`); when the budget is exhausted the Host is marked `crashed` instead of looping (src/main/host-manager.ts:17-18, 368-384; src/main/host-restart-core.ts:37-49). On any non-stopped exit, Main first runs the before-restart handler — managed-process cleanup; if that cleanup cannot be safely confirmed, the Host is marked `crashed` rather than restarted (src/main/host-manager.ts:344-359).

`stop()` sends `shutdown` and force-kills after a 10-second grace period; the Host responds by stopping the watcher, restoring the git runner, and disposing handlers before `process.exit(0)` (src/main/host-manager.ts:112-137; src/agent-host/index.ts:99-104).

## MessagePort plumbing

Renderer connections use `MessageChannelMain`: Main keeps one port and forwards the other to the Host with `attach-port`; ports requested before the Host is ready are queued and flushed on `spawn` (src/main/host-manager.ts:139-166, 251-261). Main can also issue one-shot RPCs to the Host over a fresh channel with a 10-second default timeout, and answers Host-initiated `host-rpc` requests (browser methods, diagnostics export) through its request handler (src/main/host-manager.ts:168-202, 299-331; src/main/main.ts:681-683).

## Renderer recovery

`RendererCrashRecovery` classifies renderer crashes: `clean-exit`/`killed` are ignored, `oom`/`launch-failed`/`integrity-failure` halt, and everything else reloads with exponential backoff (250 ms base, 4 s max) — but at most 3 reloads per 60-second window before declaring a crash loop (src/main/renderer-crash-recovery.ts:12-46). The window shows a dedicated crash page with a retry URL when the renderer is unavailable (src/main/window.ts:6, via `createRendererCrashPage`).

`restartHostAfterExit` implements the packaged-app recovery path where the Host must be stopped and restarted after an update install (src/main/host-install-recovery.ts:6-11).

## Startup validation and shutdown

Packaged builds support `--validate-packaged-startup`, which only reports success when the renderer loaded, the Host is ready, the toolchain core is ready with healthy bundled `search.rg`/`search.fd` capabilities, the Pi version matches the pinned expectation, and the Host acknowledged the toolchain revision (src/main/main.ts:108-120). `--validate-packaged-cleanup-fault` exercises the failure path of managed-process cleanup validation (src/main/main.ts:52).

Quit is staged: `before-quit` is prevented once, users with running managed processes are asked to confirm, and then managed processes and browser state are cleaned up within a 15-second deadline before `app.quit()` proceeds (src/main/main.ts:766-807).

## Representative tests

- src/main/main-bootstrap.test.mjs and src/main/host-manager-adjacent tests — spawn/env handling and message protocol
- src/main/host-restart-core.test.mjs — restart budget arithmetic
- src/main/renderer-crash-recovery.test.mjs — crash classification and backoff
- src/shared/heartbeat-liveness.test.mjs — suspension vs. unresponsive-peer discrimination
