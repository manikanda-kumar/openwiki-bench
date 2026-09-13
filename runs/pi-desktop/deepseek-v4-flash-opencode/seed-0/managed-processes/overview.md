---
type: concept
title: Managed Background Processes
description: Long-running dev-server process management — the process_* tool surface, service lifecycle, containment and policy, output buffers and cursors, readiness, and the Main-process crash reaper.
tags: [managed-processes, agent-host, reaper, containment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-6a522d4bdbfe99a8f8efca0e
    resource: repo://src/agent-host/managed-process/output-buffer.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-cf828109fc80a4ee1ea13246
    resource: repo://src/agent-host/managed-process/tools.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Managed Background Processes

Managed background processes let the Agent run long-lived project commands (Vite, React, Storybook, Flask, Spring Boot, mock APIs, watch builds) under Pi Desktop lifecycle control instead of `&`/`nohup`/external terminals. The subsystem spans the Agent Host (`ManagedProcessService`, the `process_*` tools, the worker/backends) and the Main process (capability projection and the crash reaper).

## Capability and enablement

- `projectManagedProcessCapability` (`src/main/managed-process/capability.ts:4`) projects whether managed processes are supported/ready on the current platform:
  - POSIX: `darwin`/`linux`, backend `posix-group`.
  - Windows: only `win32` + `x64`, non-Server Windows 10+, and requires both the verified Rust helper and the Host's acknowledged owner identity; backend `windows-job`.
  - Ready additionally requires a healthy crash reaper (`REAPER_UNHEALTHY` otherwise).
- `ManagedProcessService.assertStartEnabled` re-checks the capability through Main (`managedProcesses.getSettings`) and gates on `ui-state.json`'s `managedProcessesEnabled` (`src/agent-host/managed-process/service.ts:709`). The feature is off by default and is a lifecycle controller, not a container or sandbox.

## The process_* tool surface

The `process_*` tools are registered per-session in `rpc-manager.ts` via `createManagedProcessToolDefinitions` (`src/agent-host/managed-process/tools.ts:100`):

| Tool | Behavior |
| --- | --- |
| `process_start` | Start a long-running command; options `cwd` (contained in owner workspace), `label`, `kind` (server/watcher/task), `waitFor` (none/output/loopback-url, ≤ 10 s), `activateUi`. |
| `process_list` | List processes owned by this Agent session only. |
| `process_read` | Bounded immediate read (≤ 128 KiB for the agent). |
| `process_wait` | Long-poll for output/state change; a timeout is not an error, resume with the returned `nextCursor`. |
| `process_write` | Write bounded UTF-8 stdin (not a PTY, ≤ 64 KiB, never persisted). |
| `process_stop` | Stop the run and its complete process group (graceful/force); stale generations rejected. |
| `process_restart` | Stop the group and start a new generation; a user stop barrier cannot be overridden by the Agent. |

Tool constraints and limits come from `MANAGED_PROCESS_LIMITS` (`src/shared/managed-process-policy.ts:6`): 32 KiB commands, 16 KiB lines, 2 MiB/10k records per process, 16 MiB global output, ≤ 4 processes per session / ≤ 8 global, 30 s wait max, 8 loopback endpoints. Managed-process tools are **unavailable for messaging-channel turns** (`assertLocalTurn`, `tools.ts:58`).

## Command policy and fail-closed containment

`validateManagedProcessCommand` (`src/shared/managed-process-policy.ts:112`) rejects:

- Detach/escape commands: `nohup`, `disown`, `setsid`, `daemonize`, `systemd-run`, `launchctl submit`, `start /b`, `Start-Process`, `runas`, `schtasks`, `sc create`, `wmic process call create`, `wt`, `cmd start`, background `&`.
- LAN binds (`--host 0.0.0.0`, `--listen ::`, `HOST=0.0.0.0`): these require a Main-process confirmation dialog (`managedProcesses.confirmLanBind`); until confirmed the start fails with `PROCESS_CONFIRMATION_REQUIRED`.
- `resolveManagedProcessCwd` requires the resolved cwd (after `realpath`) to remain inside the owner workspace (`PROCESS_CWD_DENIED`).
- Every start requires project trust (`PROCESS_PROJECT_UNTRUSTED` otherwise).
- On POSIX the worker runs the command in the session's **own process group** (`setpgid`) so group signals reach descendants; on Windows a Job Object + Rust helper contain the tree (see the Windows helper page). Both register a reaper record before committing, and unregister/cleanup failures set `containmentFailed`, which **disables new starts** until the app is restarted (`service.ts:709`).

## Lifecycle and state

`ManagedProcessService` (`src/agent-host/managed-process/service.ts:186`) records each process with states `created → starting → running → ready`, `stopping`, `restarting`, and terminal `exited | failed | killed | lost | reaped`:

- **Start**: validate command/cwd, check budgets, create the record, `startRun` builds a toolchain execution context (intent `managed-process`, trusted), resolves `shell.bash`, and starts the platform backend (`startPosixRun`/`startWindowsRun`). The backend `prepare` → reaper register → `commit` sequence ensures the process is crash-recoverable before it is resumed.
- **Stop**: `stop(processId, runId, mode, source)` marks `stopping`, asks the backend to stop, and awaits the finish promise within 8.5 s; a timeout force-disposes containment and marks `lost` (host-failure). Stop sources are `agent | user | host | main`; a user stop sets `userStopBarrier` so the Agent cannot restart.
- **Restart**: `restart` stops, increments generation, allocates a fresh `runId`/output buffer, and starts a new run. Stale `runId`s are rejected (`PROCESS_STALE_RUN`).
- **Readiness**: `waitFor` of type `output` matches a substring; `loopback-url` matches a `localhost`/`127.0.0.1` endpoint extracted from output (`extractManagedLoopbackEndpoints`). Readiness states: `not-requested | pending | ready | timed-out`.
- **Output**: stdout/stderr bytes stream through `ManagedProcessOutputDecoder` (line-bounded, non-UTF-8 detected and warned) into `ManagedProcessOutputBuffer` — a bounded ring (2 MiB / 10k records) that reports `gap` metadata when older records were evicted. Reads/wait use `runId:seq` cursors so a stale cursor across a restart is detected.
- **Limits/rate limits**: global/per-session active caps, start rate limit (12/min), stdin byte-rate limits, global output trimming, and exited-record retention (64 records, 15 min).

## Main-process crash reaper

`ManagedProcessReaper` (`src/main/managed-process/reaper.ts:209`) is the crash-recovery authority in Main:

- It keeps a persistent journal (`journal-v2.json` under `<userData>/managed-process-reaper/`) of reaper records (process group id + start fingerprint on POSIX; job name + helper pid/fingerprint/build on Windows). Records are written with a monotonic `revision` and a `nonce` to detect identity conflicts (`reaper.ts:270`).
- POSIX reap: verify the process-group leader's start fingerprint matches, then terminate the group (interrupt 500 ms → terminate 1 s → force 1 s). An identity mismatch returns `identity-uncertain` (never kills an unrelated process).
- Windows reap: a helper invocation verifies the job/helper identity before terminating the Job Object (see the Windows helper page).
- The reaper runs before Host restart (`hostManager.setBeforeRestartHandler`), and a failed or identity-uncertain reap **blocks the Host restart** (`src/main/main.ts:579`). `reapAll` persists removal and can be scoped to one Host instance.
- Main also secures the Windows reaper directory via the helper (`secureWindowsReaperDirectory`) before the reaper becomes ready (`reaper.ts:41`).

## Counts and UI integration

The service reports `managed-process-count` to Main, which updates the tray badge/tooltip and the "Stop all" / quit confirmation dialogs (`src/main/main.ts:719`). The Processes panel reads `processes.list/read` and subscribes to `processes.changed/output` streams.

## Tests

- `src/agent-host/managed-process/service.test.mjs`, `worker.test.mjs`, `posix-backend.test.mjs`, `output-buffer.test.mjs`, `session-redaction.test.mjs`, `tools-contract.test.mjs`, and `helper-codec.test.mjs`.
- `scripts/test-managed-process-workflows.mjs` and `scripts/test-managed-process-flood.mjs` run real lifecycle/stress tests; `src/main/managed-process/reaper.test.mjs` covers reaper logic.
