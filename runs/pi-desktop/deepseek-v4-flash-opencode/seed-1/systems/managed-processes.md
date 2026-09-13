---
type: concept
title: Managed Background Processes
description: The process_* tool family and ManagedProcessService lifecycle, POSIX process-group and Windows Job Object backends, the crash reaper journal, policy limits, output buffering and cursors, readiness, and capability gating.
tags: [managed-process, process, lifecycle, reaper, policy, tools]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-6a522d4bdbfe99a8f8efca0e
    resource: repo://src/agent-host/managed-process/output-buffer.ts
  - id: openwiki-source-ace54e5d1ee50511cb867e05
    resource: repo://src/agent-host/managed-process/posix-backend.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-cf828109fc80a4ee1ea13246
    resource: repo://src/agent-host/managed-process/tools.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Managed Background Processes

Managed background processes let the Agent run long-lived project commands (Vite, React/Three.js dev servers, Storybook, Flask, Spring Boot, mock APIs, watch builds) under Pi Desktop's lifecycle control, instead of `&`/`nohup`/external terminals. The feature is **off by default**, is not a security sandbox, and only works where containment is verified.

## Capability gating

`projectManagedProcessCapability` (`src/main/managed-process/capability.ts:4-53`) computes a `ManagedProcessCapability` from platform, arch, reaper readiness, the verified Windows helper, and the Host owner identity:

- supported on `darwin`/`linux` (POSIX group backend) and Windows x64 (Job helper) on non-Server Windows releases;
- `ready` requires the supported platform **and** a healthy reaper **and**, on Windows, a verified helper and an acknowledged owner identity;
- failures map to explicit error codes (`PLATFORM_UNSUPPORTED`, `ARCH_UNSUPPORTED`, `REAPER_UNHEALTHY`, `HELPER_MISSING`, `HELPER_INTEGRITY`, `OWNER_IDENTITY_UNAVAILABLE`), and the service throws `PROCESS_CONTAINMENT_UNAVAILABLE`/`PROCESS_FEATURE_DISABLED` before starting anything.

The feature must also be enabled in Settings (`loadUiState().managedProcessesEnabled === true`), confirmed via the `managedProcesses.getSettings` host request which returns `enabled`, `reaperReady`, `capability`, and the Windows helper descriptor (`src/main/main.ts:608-617`).

## The process_* tools

`createManagedProcessToolDefinitions` (`src/agent-host/managed-process/tools.ts:100-253`) exposes `process_start`, `process_list`, `process_read`, `process_wait`, `process_write`, `process_stop`, and `process_restart`:

- `process_start` validates the command against the policy, resolves a cwd contained in the owner workspace, and starts a run with an optional `waitFor` (`output` substring or `loopback-url`) and `activateUi`;
- `process_read`/`process_wait` operate on cursor windows; `process_wait` long-polls and a timeout is not an error;
- `process_write` sends bounded stdin (not a PTY) and can close it;
- `process_stop`/`process_restart` keep the current `runId`; stale runs are rejected (`PROCESS_STALE_RUN`), and a user stop barrier cannot be overridden by the Agent (`PROCESS_USER_STOPPED`);
- all tools require a local turn — they throw `PROCESS_FEATURE_DISABLED` for messaging-channel sessions (`tools.ts:58-65`), and a session can own at most 4 processes while 8 are allowed globally (`shared/managed-process-policy.ts:18`).

## Lifecycle and state machine

`ManagedProcessService` (`src/agent-host/managed-process/service.ts:186-1324`) keeps a per-process record with states `created → starting → running → ready` (active) plus `stopping`/`restarting`, and terminal states `exited`, `failed`, `killed`, `lost`, and `reaped` (`contract/processes.ts:1-11`):

- a start goes through `assertStartEnabled` (feature, platform, reaper, Windows owner identity) and `assertStartBudget` (rate limit of 12 starts/min, global and per-session caps) (`service.ts:709-777`);
- after backend preparation, the reaper record is registered with Main (`managedProcesses.register`), and only after a journal revision is returned does the backend commit the containment and the process become `running`/`ready` (`service.ts:779-965`);
- readiness is derived from an `output` substring match or a detected `loopback-url` endpoint (`service.ts:1090-1122`);
- `stop` marks the record `stopping`, invokes the backend, and waits up to 8.5 s; a stop that cannot be confirmed flips the record to `lost` and **disables new starts** (`service.ts:452-511`);
- `restart` starts a new generation with a fresh `runId` and a fresh output buffer (`service.ts:513-588`);
- exited records are pruned after 15 minutes or beyond 64 retained records (`service.ts:1309-1323`).

## Policy and limits

`src/shared/managed-process-policy.ts` is the pure policy module:

- `MANAGED_PROCESS_LIMITS` bounds commands (32 KiB), labels (80 code points), lines (16 KiB), per-process output (2 MiB / 10 000 records), global output (16 MiB), read windows (128 KiB agent / 256 KiB renderer), stdin writes (64 KiB with rate limits), active processes (4/session, 8 global), endpoints (8), and wait/start timeouts (`managed-process-policy.ts:6-27`);
- `validateManagedProcessCommand` rejects detaching/escaping constructs (`nohup`, `disown`, `setsid`, `daemonize`, `systemd-run`, `launchctl submit`, `start /b`, `Start-Process`, external terminals, background `&`, Task Scheduler/WMI/Windows services) and commands binding to `0.0.0.0`/`::` unless a LAN-bind confirmation is granted (`managed-process-policy.ts:29-134`);
- `resolveManagedProcessCwd` requires the working directory to resolve inside the owner workspace (`managed-process-policy.ts:141-163`);
- `sanitizeManagedProcessText` strips ANSI escapes, URL credentials, authorization/cookie headers, secret CLI arguments, common token formats, and `PI_DESKTOP_*` nonces before anything is stored or shown (`managed-process-policy.ts:165-177`).

## Backends

- **POSIX** (`src/agent-host/managed-process/posix-backend.ts`): spawns a worker (`managed-process-worker.mjs`) via `process.execPath` with `ELECTRON_RUN_AS_NODE`, `detached: true`, and an IPC channel; the worker launches the shell in a new process group. The reaper record stores `pid`, `pgid`, and a `/proc`-derived start fingerprint. Shutdown uses `terminatePosixProcessGroup` (interrupt → terminate → force). If the process group cannot be confirmed clean, the exit reason becomes `host-failure` and new starts are disabled (`posix-backend.ts:96-278`).
- **Windows** (`src/agent-host/managed-process/windows-helper-client.ts`): spawns `pi-managed-process-helper.exe --owner-stdio-v1`, exchanges the framed JSON protocol, and forwards stdout/stderr with rate limiting (128 KiB/s, 64 KiB burst). A 15 s/10 s heartbeat detects a dead helper (`windows-helper-client.ts:30-36`). The helper contains the target in a kill-on-close Job (see [Windows Managed Process Helper Guide](../guides/windows-managed-process-helper.md)).

## Crash reaper and journal

`ManagedProcessReaper` (`src/main/managed-process/reaper.ts:209-381`) is a Main-process safety net:

- every started process registers a reaper record persisted to `journal-v2.json` under `userData/managed-process-reaper/` (`main.ts:403-419`); records carry `hostInstanceId`, a nonce, and identity (pid/pgid/start fingerprint on POSIX; helperPid/jobName/helperBuildId on Windows) (`contract/processes.ts:160-187`);
- on startup the reaper loads the journal and reaps leftover records; POSIX reaps require the process group to exist and the start fingerprint to match before termination, otherwise the outcome is `identity-uncertain` and the reaper goes unhealthy (`reaper.ts:333-367`);
- Windows reaps are delegated to the helper (`--reap-stdio-v1`), and the journal directory itself is secured through the helper (`secureWindowsReaperDirectory`, `reaper.ts:41-117`);
- before a Host restart, `reapAll` must return a ready status with zero records, otherwise the restart is blocked (`main.ts:579-587`). A bounded journal (`reaper-journal.ts`: 64 KiB max, 16 records) keeps the recovery surface small.

## Fail-closed behavior

- If containment cleanup cannot be verified — stop timeout, failed reap acknowledgment, or lost ownership — the service sets `containmentFailed` and **rejects every subsequent start** with `PROCESS_TREE_REAP_FAILED` until the app is restarted (`service.ts:709-715`, `service.ts:1068-1073`).
- On quit or update, `cleanupManagedProcessContainment` runs against a hard 15 s deadline; if confirmation is required and records remain, quit/update aborts (`main.ts:93-106`, `src/main/managed-process/shutdown-cleanup.ts`).
- The Host owner identity (`managed-process-owner:init`: main pid, start fingerprint, image path, hostInstanceId) must be acknowledged before Windows starts are allowed (`src/agent-host/managed-process/owner-identity.ts`, `main.ts:591-633`).

## Output buffering and cursors

- `ManagedProcessOutputBuffer` (`src/agent-host/managed-process/output-buffer.ts:34-165`) is a bounded ring of sanitized records; reads use opaque cursors of the form `<runId>:<seq>`, report a `gap` when older records were evicted, and are capped per request. Cursors belonging to another run are rejected as `PROCESS_STALE_RUN`.
- `ManagedProcessOutputDecoder` (`output-buffer.ts:175-294`) is a line-oriented UTF-8 decoder that truncates overlong lines at 16 KiB with a marker and emits an encoding warning when replacement characters dominate.
- Output events are coalesced to one `processes.output` notification per 100 ms (`service.ts:1266-1280`).

## Related pages

- [Windows Managed Process Helper Guide](../guides/windows-managed-process-helper.md)
- [Security Model](../architecture/security-model.md)
- [Toolchain Management](./toolchain-management.md)
- [RPC and Contract Layer](../architecture/rpc-and-contracts.md)
