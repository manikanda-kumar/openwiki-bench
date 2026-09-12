---
type: reference
title: Managed Background Processes (Agent Host)
description: The managed background-process service in the Agent Host — lifecycle and states, readiness, output buffering and cursors, policy limits, LAN-bind confirmation, stop modes, and the POSIX/Windows backends.
tags: [managed-process, process-tools, output, readiness, backend]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-ace54e5d1ee50511cb867e05
    resource: repo://src/agent-host/managed-process/posix-backend.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-cf828109fc80a4ee1ea13246
    resource: repo://src/agent-host/managed-process/tools.ts
  - id: openwiki-source-de3dc8a8bda3ce2c2a499995
    resource: repo://src/agent-host/managed-process/windows-helper-client.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Managed Background Processes (Agent Host)

On supported platforms the Agent lets long-running project commands (dev
servers, watchers, mock APIs) run under the app's lifecycle control via
`process_*` agent tools and a Processes panel. The service lives in the **Agent
Host** under `src/agent-host/managed-process`.

## process_* agent tools

`createManagedProcessToolDefinitions` (`src/agent-host/managed-process/tools.ts`)
defines the tools:

- `process_start` — start a long-running command with optional `waitFor`
  readiness spec and `activateUi`.
- `process_list` — list processes owned by the current session (other sessions
  are invisible).
- `process_read` — read a bounded output window by `cursor`.
- `process_wait` — long-poll for output or a state change (a timeout is not an
  error; reuse `nextCursor` for cold starts longer than the poll window).
- `process_write` — write bounded text to stdin (not a PTY; never persisted).
- `process_stop` — stop the current run + complete process tree.
- `process_restart` — full stop then a new generation; a user stop barrier
  cannot be overridden by the Agent.

All tools refuse to run during messaging-channel turns (`assertLocalTurn`).

## Lifecycle states and policy gates

`ManagedProcessService` (`src/agent-host/managed-process/service.ts`) tracks
each process through states (`created → starting → running → ready),
async-terminal states (`exited`, `failed`, `killed`, `lost`, `reaped`), and
transient `stopping`/`restarting` (`contract/processes.ts`).

`startForAgent` enforces, in order:

1. Feature/platform guard (`assertStartEnabled`): only darwin/linux/win32;
   Windows requires x64; the feature must be enabled in settings; the reaper
   must be `ready`; on Windows the verified helper and owner identity must be
   ready (`service.ts:709-759`).
2. Project trust is required (`PROCESS_PROJECT_UNTRUSTED`).
3. Start budget: a start-rate limit (12 per 60s), a global active limit (8),
   and a per-session active limit (4) (`service.ts:761-777`).
4. Command/`cwd` policy (`src/shared/managed-process-policy.ts`) — see below.

## Command and cwd policy

`validateManagedProcessCommand` in `managed-process-policy.ts`:

- rejects commands > 32 KiB, with NUL or U+FFFD;
- blocks detachment patterns — `nohup`, `disown`, `setsid`, `daemonize`,
  `systemd-run`, `launchctl submit`, external-terminal launches, `start /b`,
  `Start-Process`, `runas`, `schtasks`, service-creation, and background shell
  `&` control (`managed-process-policy.ts:29-66`);
- requires confirmation when a command appears to bind all network interfaces
  (`--host 0.0.0.0`, `--listen ::`), with a one-shot `confirmLanBind` Main
  dialog (`managed-process-policy.ts:68-71`, `service.ts:271-284`).

`resolveManagedProcessCwd` confines the process cwd to the owner workspace
(`managed-process-policy.ts:141-163`).

## Output buffering and cursors

Each activated run owns an in-memory `ManagedProcessOutputBuffer` with a
`runId`-bound opaque `cursor` sequence. `process_read`/`process_wait` return a
window + `nextCursor`; stale run cursors are rejected (`service.ts:1233-1239`).

Output is decoded from a worker, redacted (`sanitizeManagedProcessText`) so ANSI
sequences, credentials in URLs/flags/headers, and tokens never reach logs,
loopback-endpoint extraction only accepts `localhost`/`127.0.0.1`/`[::1]` URLs
and removes credentials/`hash`/sensitive query params (`managed-process-policy.ts:165-237`).

Global retained output is bounded (16 MiB) with per-process limits (2 MiB /
10k records); when the bound is reached the oldest records are dropped and a
gap marker is reported in the next read (`service.ts:1254-1264`,
`output-buffer.ts`). An output-revision event (`processes.output`) fires at most
every 100ms so the renderer can drain new output.

## Readiness detection

A `waitFor` spec (`none` | `output contains` | `loopback-url`) lets the agent
wait for the process to reach `ready`:

- `output` — matches when a stdout/stderr line contains the string.
- `loopback-url` — matches when an endpoint is extracted.
- Without a spec, initial output is observed once (or up to the start-wait
  default). Readiness may end as `ready` or `timed-out`
  (`service.ts:1114-1170`).

## Stop modes and user-stop barrier

`stop(mode, source, ownerSessionId)`:

- `graceful` — sends interrupt, then terminate, then force via the backend.
- `force` — force-kills the tree.

A user-initiated stop sets a `userStopBarrier`; the Agent cannot `process_restart`
across that barrier and cannot restart after a user stop except by a user action
(`service.ts:513-544`, `:520-553`). Stop is bounded by an 8.5s total timeout;
a containment failure sets `containmentFailed`, marks the process `lost`,
and disables new starts until restart (`service.ts:476-511`).

## POSIX vs Windows backends

- **POSIX** (`posix-backend.ts`): spawns a worker in a new process group
  (`setsid`); the backend registers its reaper record and commits containment.
  Cleanup terminates the process group. Used on macOS/Linux.
- **Windows** (`windows-helper-client.ts`): talks to the **Rust helper**
  (`native/windows-managed-process-helper`) over a framed stdio protocol; the
  helper places the target in a named Job Object
  (`Local\PiDesktop.Managed.<64-hex>`), starts it suspended, and the backend
  resumes it. Cleanup asks the helper to terminate the contained Job Object.
  Windows requires a healthy verified helper and acknowledged owner identity
  (`service.ts:881-965`).

Both register a reaper record with Main before starting and unregister on clean
exit, so an Agent Host crash leaves a record Main can reap later (see the
crash-recovery page).

The `ManagedProcessBackend` interface (`backend.ts`) abstracts this: `prepare`
builds containment, `commit` starts it, and `stop`/`dispose` clean it up.

## Ownership and visibility

Each process records an `ownerSessionId` and `ownerCwd`. `process_list` is
scoped to the owning session; the RPC `processes.*` surface used by the
Processes panel also carries an owner check (`requireRecord(processId,
ownerSessionId)`). Managing a process for a deleted/stopped session is refused
(e.g. `sessions.delete` first stops leftovers).

## Related pages

- Managed Process Crash Recovery (Reaper)
- Agent Sessions and Project Workflows
- Architecture Overview
