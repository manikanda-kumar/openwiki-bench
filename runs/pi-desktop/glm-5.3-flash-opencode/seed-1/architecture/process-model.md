---
type: architecture
title: Process Architecture
description: How Pi Agent Desktop splits work across the Electron main process, the Agent Host utilityProcess, and the sandboxed renderer, including supervision, restart, and MessagePort plumbing.
tags: [electron, architecture, utilityprocess, process-model, supervision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T19:27:00.576Z
---

# Process Architecture

Pi Agent Desktop is an Electron application that deliberately separates high-privilege desktop capabilities, the Pi coding-agent runtime, and the UI into three process tiers. The main process owns windows, tray, menus, custom protocol, updates, and Agent Host supervision; a dedicated `utilityProcess` (the "Agent Host") runs `@earendil-works/pi-coding-agent` in-process and serves sessions, files, and configuration over MessagePort RPC; the renderer is a sandboxed React UI that only talks through a preload bridge and typed MessagePort channels (`repo://src/main/main.ts#L1-L5`, `repo://src/agent-host/index.ts#L1-L4`).

## Main process responsibilities

`src/main/main.ts` is the bootstrap. Its header states the intent explicitly: window lifecycle, menus, tray/badge, deep link, Host supervision, and system IPC — no business logic (`repo://src/main/main.ts#L1-L5`). Concretely, at startup it:

1. Registers the `app://` protocol and the crash reporter before `app.ready` (`repo://src/main/main.ts#L42-L48`).
2. Acquires the single-instance lock and handles `pi-agent-desktop://` deep links (`repo://src/main/main.ts#L279-L297`).
3. On `app.whenReady()`, resolves the Windows managed-process helper (win32 x64 only), initializes the managed-process crash reaper, creates the credential vault, `BrowserService`, the update manager, and the `ToolchainManager` (`repo://src/main/main.ts#L366-L460`).
4. Installs desktop IPC, the app menu, and the tray (`repo://src/main/main.ts#L498-L508`).
5. Constructs the `HostManager` around the resolved host entry, wires its request handler, status listener, and message listener, then starts it and creates the main window (`repo://src/main/main.ts#L515-L726`).

The main process is also the policy boundary for managed-process shutdown: on quit it shows a confirmation dialog when background processes are still running, then cleans up the full managed-process tree (stopping the Host and reaping all records) within a fixed 15-second deadline (`repo://src/main/main.ts#L55`, `repo://src/main/main.ts#L741-L778`).

## Agent Host: a supervised utilityProcess

The Agent Host entry (`src/agent-host/index.ts`) runs inside `utilityProcess.fork` and hosts the Pi runtime. It builds an RPC server, registers all API handlers, and starts the session watcher; the parent's messages drive its lifecycle (`repo://src/agent-host/index.ts#L17-L22`):

- `attach-port` attaches a renderer MessagePort to the RPC server so the UI can call the Host directly (`repo://src/agent-host/index.ts#L49-L62`).
- `toolchain:init` / `toolchain:changed` apply versioned toolchain snapshots and reply with a revisioned `toolchain:ack` (`repo://src/agent-host/index.ts#L76-L86`).
- `browser:init` / `browser:changed` apply browser capability snapshots and re-sync browser tools for all sessions (`repo://src/agent-host/index.ts#L87-L98`).
- `managed-process-owner:init` binds the Windows managed-process owner identity for this Host generation and is acknowledged with the Host instance id (`repo://src/agent-host/index.ts#L63-L75`).
- `shutdown` stops the watcher, restores the git runner, stops handlers, and exits cleanly (`repo://src/agent-host/index.ts#L99-L103`).

The Host treats internal faults as fatal: `uncaughtException` and `unhandledRejection` log and exit, because the main-process supervisor will restart the utility process within its budget (`repo://src/agent-host/index.ts#L113-L122`).

### HostManager supervision contract

`HostManager` (`src/main/host-manager.ts`) owns spawn, port forwarding, liveness, and restart policy:

- It forks the host entry as `utilityProcess` named `pi-agent-host`, scrubs `ELECTRON_RUN_AS_NODE` (the Host needs `parentPort`), and injects `PI_AGENT_HOST`, `PI_DESKTOP_USER_DATA`, and `PI_DESKTOP_VERSION` (`repo://src/main/host-manager.ts#L236-L258`).
- Every replacement Host gets a fresh `hostInstanceId`, and both policy-snapshot acknowledgement revisions reset to `-1` — a new Host must acknowledge toolchain and browser snapshots itself (`repo://src/main/host-manager.ts#L239-L243`).
- Liveness is a ping/pong heartbeat: pings every 15 s with a 10 s timeout, evaluated through the shared `evaluateHeartbeatTick` helper, which also tolerates clock discontinuities (`repo://src/main/host-manager.ts#L15-L18`, `repo://src/main/host-manager.ts#L382-L400`).
- On child exit, the manager first runs the pre-restart cleanup handler (a managed-process reap that must confirm zero remaining records), then schedules a restart. If cleanup cannot be confirmed safe, the Host is marked `crashed` and is not restarted (`repo://src/main/host-manager.ts#L334-L365`).
- Restart budget: at most 2 restarts within a 30 s window (`CRASH_WINDOW_MS = 30_000`, `MAX_RESTARTS = 2`); exhausting the budget marks the Host `crashed` instead of looping (`repo://src/main/host-manager.ts#L13-L14`, `repo://src/main/host-manager.ts#L367-L390`).

### Host → Main reverse RPC

The Host can call back into Main over the parent port with `host-rpc` messages. Main's request handler in `main.ts` routes these to the owning service: `channelSecrets.*` to the credential vault, `toolchain.getSnapshot` / `toolchain.resolve` to the toolchain manager (with strict validation of `cwd` and execution intent), `managedProcesses.*` to the reaper/capability/dialog layer, and `browser.*` to `BrowserService` (`repo://src/main/main.ts#L538-L689`). Anything unrecognized is rejected (`repo://src/main/main.ts#L686-L688`).

## Renderer isolation

The main window is created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true` (`repo://src/main/window.ts#L48-L55`). The preload script exposes a single `piBridge` and deliberately does not pass the MessagePort across `contextBridge` (which would silently break it); instead Main sends `desktop:host-port` and the preload re-posts the port to the page via `window.postMessage` transfer (`repo://src/preload/preload.ts#L1-L27`). The preload also validates its own location (`preload-location-policy`) and replays early menu/deep-link events that arrive before React subscribes (`repo://src/preload/preload.ts#L37-L60`).

When packaged, the renderer is served from the custom `app://` protocol with a strict CSP (no `object-src`, no remote scripts, `connect-src` restricted to `self`/`app:`); in dev without a prior build, the renderer entry falls back to the Vite server on `http://localhost:5173` (`repo://src/main/protocol.ts#L9-L27`, `repo://src/main/host-manager.ts#L485-L494`).

## MessagePort plumbing

Renderer-to-Host communication uses one MessagePort per client:

1. Renderer calls `window.piBridge.requestHostPort()`.
2. Main creates a `MessageChannelMain`; `port2` is forwarded to the Host via `attach-port` (`repo://src/main/host-manager.ts#L139-L167`).
3. The Host attaches the port to the RPC server; requests/responses/events then flow directly between renderer and Host without passing through Main (`repo://src/agent-host/index.ts#L49-L62`).
4. Ports requested before the Host is ready are queued in `pendingPorts` and flushed on `spawn` (`repo://src/main/host-manager.ts#L271-L278`).

Main itself uses the same wire protocol for one-shot calls via `HostManager.call`, which opens a fresh channel per request with a 10 s default timeout (`repo://src/main/host-manager.ts#L170-L206`).

## Status, notifications, and failure visibility

Host status changes are broadcast to every window as `host:status`, `host:restarted`, and `host:crashed` events, and reset running-session/managed-process counters and tray state when the Host is not ready (`repo://src/main/main.ts#L691-L709`). Host messages drive desktop value-adds: unread badges and notifications on `agent-end` when no focused window exists, tray counters for running sessions and managed processes, and crash-recovery notifications (`repo://src/main/main.ts#L711-L741`).

## Data and state ownership summary

- Main owns: window/tray/menu state, UI state persistence, credential vault file, browser service and its WebContentsViews, toolchain manager, update manager, managed-process reaper and journal (`repo://src/main/main.ts#L366-L513`).
- Agent Host owns: Pi sessions, session index/watcher, file access policy, channels, managed-process service runtime, toolchain/browser capability runtimes (`repo://src/agent-host/index.ts#L17-L22`).
- Renderer owns: React UI state only; everything else arrives via the `piBridge` contract (`repo://src/preload/preload.ts#L1-L7`).
