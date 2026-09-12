---
type: reference
title: Agent Host Supervision and Resilience
description: How the Electron Main process supervises the Agent Host utilityProcess, detects crashes and hangs, applies a restart budget, gates restarts on managed-process containment, and recovers the Renderer.
tags: [host, supervision, crash-recovery, heartbeat, renderer]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
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
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
  - id: openwiki-source-78a0fdd1bbac4bc19b5c57d4
    resource: repo://src/shared/heartbeat-liveness.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Agent Host Supervision and Resilience

Pi Agent Desktop runs Pi Coding Agent in a dedicated Electron `utilityProcess`
("Agent Host"). The Main process supervises it: it spawns the Host, holds a
heartbeat, tracks crash windows and a restart budget, requires acknowledgement
of policy snapshots, and gates any restart on a clean managed-process
containment state.

## HostManager responsibilities

`HostManager` (`src/main/host-manager.ts`) owns the lifecycle of the Agent Host
child process:

- **Spawn** with `utilityProcess.fork` under a fixed `serviceName`
  (`host-manager.ts:230-240`). It deletes `ELECTRON_RUN_AS_NODE` so the child
  gets a real `parentPort`, and injects `PI_AGENT_HOST`, `PI_DESKTOP_USER_DATA`,
  and `PI_DESKTOP_VERSION` into the child environment (`host-manager.ts:225-228`).
- **Renderer port handoff**: a renderer asks for a Host port via
  `desktop:connect-host`; Main creates a `MessageChannelMain` and delivers the
  renderer-side port over IPC and forwards the Host-side port via
  `attach-port`. Ports requested before the child is ready are queued and
  flushed on `spawn` (`host-manager.ts:139-166`, `:254-260`).
- **Main↔Host calls**: `call()` opens a fresh one-shot renderer channel so Main
  can issue RPC to the Host, with a default 10s timeout (`host-manager.ts:169-202`).
- **Host→Main calls**: `host-rpc` messages are dispatched to a
  `requestHandler` registered by `main.ts`; results flow back as
  `host-rpc-result`. These back the browser, toolchain, credential, and
  managed-process operations that only Main can perform.

## Crash detection and restart budget

The Host emits `ready` then stays alive. Main pings every 15s
(`PING_INTERVAL_MS`) and treats a pong gap exceeding interval+timeout as a
failure. `evaluateHeartbeatTick` distinguishes a genuine timeout from a clock
discontinuity (e.g. machine suspend); on a clock discontinuity the tick is
reset rather than declaring the process dead (`heartbeat-liveness.ts:21-30`).
On a real timeout Main `kill()`s the child (`host-manager.ts:401-408`).

A crash window of 30s and a maximum of 2 restarts bounds restart storms:
`reserveHostRestart` keeps only restart times inside `CRASH_WINDOW_MS` and, once
`MAX_RESTARTS` are reached inside the window, the Host is placed in a
`crashed` state and the renderer is told the Host crashed (`host-restart-core.ts:37-49`,
`host-manager.ts:368-384`). Restarts are delayed 500ms.

Each spawn resets the acknowledged revisions for the toolchain and browser
capability snapshots and registers a fresh `hostInstanceId`
(`host-manager.ts:209-217`).

## Policy snapshot acknowledgements

Main pushes two policy snapshots to the Host and waits for acknowledgement as a
liveness/consistency signal:

- `toolchain:init` / `toolchain:changed` with the `ToolchainSnapshot`; the Host
  replies `toolchain:ack` with the revision (`host-manager.ts:418-425`, `:282-289`).
- `browser:init` / `browser:changed` with the `BrowserCapabilitySnapshot`
  (`host-manager.ts:427-434`).

A replacement Host must acknowledge both snapshots itself; acknowledgements
from a previous process are not transferable (`host-manager.ts:211-214`).
`getToolchainAckRevision` is used by the packaged startup validation to confirm
that a fresh packaged instance actually applied the advertised toolchain
snapshot.

## Managed-process pre-restart gate

Before restarting after an exit, Main runs `beforeRestartHandler`, which calls
`managedProcessReaper.reapAll()`. If the reaper is not ready or the journal is
not empty, the restart is blocked and the Host goes to `crashed` with a
"Managed process cleanup could not be safely confirmed" detail
(`main.ts:579-587`, `host-manager.ts:347-359`). This fails closed: an orphaned
process tree is never leaked on a restart.

## Renderer recovery

The React Renderer is separate from the Host. On Host restart or crash the
preload bridge notifies the renderer (`host:restarted` / `host:crashed`), and
the renderer drops its RPC client via `resetRpc()` and reconnects through a
fresh Host port (`src/renderer/App.tsx:64-71`, `src/renderer/lib/api-client.ts:11-20`).

The Renderer process itself has its own crash-recovery controller
(`renderer-crash-recovery.ts`): `oom`, `launch-failed`, and `integrity-failure`
are non-recoverable (halt), `clean-exit`/`killed` are ignored, and other reasons
are retried with exponential delays (`250ms * 2^(attempt-1)`, capped 4s) up to 3
reloads per 60s window, after which it halts with a crash-loop page
(`src/main/window.ts:113-133`).

When the Host is not ready (`starting`/`stopped`), the renderer waits for
`host:status` up to 30s before failing the connection with a retryable error
(`api-client.ts:74-116`).

## Host stopped state

`hostManager.stop()` posts a `shutdown` message and falls back to `kill()`
after 10s; it resolves on the child's exit signal. `restartHostAfterExit` stops
and conditionally restarts the Host, used by the updater's
`recoverFromInstallFailure` path (`host-install-recovery.ts`, `main.ts:480-481`).

## Diagnostics surface

Every status change flows to the renderer via `host:status`; a crash emits
`host:crashed` with a detail string; a successful restart after a crash emits
`host-restarted` with `reason: "crash-recovery"` (`main.ts:686-710`, `:744-748`).
The packaged-startup validation uses `startupHostReady` / `startupRendererReady`
plus the toolchain ack to write `packaged-startup-check.json`
(`main.ts:51-53`, `:111-121`).

## Testing

Focused unit tests cover `host-restart-core`, `heartbeat-liveness`, and
`renderer-crash-recovery` under `src/**/*.test.mjs`. Integration-style tests
for browser + Host coexistence run separately via `test-browser-electron` and
the managed-process workflow suites.
