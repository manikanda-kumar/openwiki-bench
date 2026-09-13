---
type: concept
title: Agent Host Supervision and Recovery
description: How the Electron Main process supervises the Agent Host utilityProcess — spawn, heartbeat liveness, crash restart budget, toolchain/browser snapshot acknowledgement, managed-process owner identity, and packaged startup validation.
tags: [main, agent-host, supervision, restart, heartbeat]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
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
  - id: openwiki-source-78a0fdd1bbac4bc19b5c57d4
    resource: repo://src/shared/heartbeat-liveness.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Agent Host Supervision and Recovery

`HostManager` (`src/main/host-manager.ts:35`) is the Main-process supervisor for the Agent Host `utilityProcess`. It spawns the Host, forwards MessagePorts between Renderer and Host, monitors liveness, and restarts the Host within a bounded budget when it crashes. Recovery is a desktop value-add: the Host itself deliberately exits on `uncaughtException`/`unhandledRejection` so Main can bring it back (`src/agent-host/index.ts:113`).

## Spawn

- `spawn()` forks `out/main/agent-host.mjs` with `serviceName: "pi-agent-host"`, piped stdio, and a filtered env. It deletes `ELECTRON_RUN_AS_NODE` (the Host needs `process.parentPort` from `utilityProcess`) and injects `PI_AGENT_HOST=1`, `PI_DESKTOP_USER_DATA`, and `PI_DESKTOP_VERSION` (`src/main/host-manager.ts:209`).
- A new `hostInstanceId` (UUID) is generated per spawn, and the toolchain/browser acknowledgement revisions are reset to `-1` because a replacement Host must re-acknowledge the policy snapshots itself (`src/main/host-manager.ts:212`).
- Spawn failures (e.g. `utilityProcess.fork` throwing) go through the same restart scheduling (`trySpawnHost`).

## Heartbeat liveness

- Once the Host reports `ready`, Main starts a 15 s ping interval (`PING_INTERVAL_MS`) and kills the child if it has not `pong`ed within 10 s (`PING_TIMEOUT_MS`) (`src/main/host-manager.ts:386`).
- Liveness is evaluated by `evaluateHeartbeatTick` (`src/shared/heartbeat-liveness.ts:21`), which distinguishes a genuinely unresponsive peer from a clock discontinuity (machine sleep or paused event loop). After a clock discontinuity the caller re-establishes one heartbeat before declaring the peer dead — ownership safety is enforced separately by process handles and pipe EOF.

## Crash restart budget

- On unexpected exit, `HostManager` runs the `beforeRestartHandler` — which reaps managed processes via the `ManagedProcessReaper` and refuses to restart if reaping cannot be confirmed — then schedules a restart (`src/main/host-manager.ts:334`).
- `reserveHostRestart` (`src/main/host-restart-core.ts:37`) implements the budget: at most `MAX_RESTARTS = 2` restarts within `CRASH_WINDOW_MS = 30_000`. When the budget is exhausted the status transitions to `crashed` with detail `"...restart budget exhausted"`, and the Host stays down.
- Restarts are scheduled after 500 ms and only spawn if status is still `starting` and no child exists (`src/main/host-manager.ts:368`).
- A Host that exited after being `ready` is reported as `host-restarted` (reason `crash-recovery`) to the Renderer and to Main's message listener.

## Snapshot and acknowledgement flow

On `ready`, Main pushes the current policy snapshots to the replacement Host (`src/main/host-manager.ts:263`):

- `toolchain:init` carries the `ToolchainSnapshot`; the Host replies `toolchain:ack` with a revision, and `HostManager` records the max acknowledged revision (`getToolchainAckRevision`). Later snapshot changes are pushed as `toolchain:changed`.
- `browser:init` carries the `BrowserCapabilitySnapshot`; the Host replies `browser:ack` similarly.
- `managed-process-owner:init` carries the Main PID, main start fingerprint (process creation time), real main image path, and the new `hostInstanceId`; the Host replies `managed-process-owner:ack` (version 1). `getManagedProcessOwnerState` reports readiness, which gates Windows managed-process registration in Main (`src/main/host-manager.ts:436`).

`setToolchainSnapshot`/`setBrowserCapabilitySnapshot` push changes to a live ready Host; a not-yet-ready Host gets the snapshot on its next `ready`.

## Host status propagation to the Renderer

`HostManager` forwards status transitions to the Renderer through the `host:status`, `host:restarted`, and `host:crashed` IPC events (`src/main/main.ts:686`). When the Host is not `ready`, Main also resets running counts, the tray badge, the update manager's session gate, and the browser service's agent state (`src/main/main.ts:693`).

## Packaged startup validation

In packaged builds, Main can run `--validate-packaged-startup` (`src/main/main.ts:51`):

- The check waits for renderer `did-finish-load`, Host `ready`, a toolchain snapshot with `coreReady`, the expected Pi version, a toolchain acknowledgement at or above the snapshot revision, and healthy bundled `search.rg`/`search.fd` candidates (`src/main/main.ts:108`).
- A report is written to `<userData>/packaged-startup-check.json` (mode `0o600`) and the app exits with code 0 (success) or 1 (failure). A 45 s timer bounds the whole check.
- A separate `--validate-packaged-cleanup-fault` mode runs the managed-process shutdown cleanup fault validation (`src/main/main.ts:369`).

## Host install recovery

`restartHostAfterExit` (`src/main/host-install-recovery.ts:6`) is used by the updater after a failed install to stop the Host and restart it only if the app is not quitting — the "recover from install failure" path (`src/main/main.ts:476`).

## Exit signal plumbing

`createHostExitSignal` provides a per-spawn promise resolved on exit; `HostManager.stop()` awaits it after posting `shutdown` to the child and force-kills after 10 s as a fallback (`src/main/host-manager.ts:112`).

## Tests

- `src/main/host-restart-core.test.mjs` covers the restart budget reservation.
- `src/main/main-bootstrap.test.mjs` exercises the bootstrap wiring.
- `src/shared/heartbeat-liveness.test.mjs` covers heartbeat tick evaluation (timeout vs clock discontinuity).
- `src/smoke/host-checks.ts` exercises the real Host through the smoke harness.
