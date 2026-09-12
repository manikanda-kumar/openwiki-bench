---
type: architecture
title: Managed Background Processes
description: The supervised managed-process subsystem — lifecycle states and stop modes, posix and Windows-native backends, output buffering, loopback endpoints, readiness probing, and crash reaping guarded by a durable journal.
tags: [architecture, managed-process, supervision, windows]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-4f30b7fcf4677f72807c326c
    resource: repo://native/windows-managed-process-helper/src/main.rs
  - id: openwiki-source-6a522d4bdbfe99a8f8efca0e
    resource: repo://src/agent-host/managed-process/output-buffer.ts
  - id: openwiki-source-ace54e5d1ee50511cb867e05
    resource: repo://src/agent-host/managed-process/posix-backend.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-de3dc8a8bda3ce2c2a499995
    resource: repo://src/agent-host/managed-process/windows-helper-client.ts
  - id: openwiki-source-7ba8124a5d3d5315cb1efbb9
    resource: repo://src/agent-host/managed-process/worker.ts
  - id: openwiki-source-bce9e325dbb765f2515acb9f
    resource: repo://src/contract/processes.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-6e57d26818244fcb9df46c1b
    resource: repo://src/main/managed-process/reaper-journal.ts
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-0ab73e3f3f4c84fb624dd5b4
    resource: repo://src/main/managed-process/shutdown-cleanup.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Managed Background Processes

Managed processes are long-lived background commands (dev servers, watchers,
tasks) that the agent can start, supervise, stream logs from, and stop. They run
under strict containment: the command is validated against a policy, the process
group is owned by the Host, and the main process keeps a durable reaper journal
so orphaned process groups can be killed across a Host crash.

## Lifecycle and stop modes

`src/contract/processes.ts` defines the state model. Active states are
`created → starting → running → ready → stopping → restarting`; terminal states
are `exited | failed | killed | lost | reaped`. A process's `readiness` is an
independent value: `not-requested | pending | ready | timed-out`. Stop modes are
`graceful` (signal then bounded wait) and `force` (immediate group terminate);
a stop can originate from `agent`, `user`, `host`, or `main`.

`ManagedProcessService` (`src/agent-host/managed-process/service.ts`) owns the
records and the RPC surface (`processes.list` / `get` / `read` / `wait` /
`write` / `stop` / `stopAll` / `restart` / `dismiss` / `export`). It enforces
`MANAGED_PROCESS_LIMITS` from `src/shared/managed-process-policy.ts`:
per-session and global active-process caps (`sessionActive: 4`,
`globalActive: 8`), command size and line bounds, a 64 KB stdin cap, exited
record retention (64 records, 15 min), and wait/start-wait windows. Starts are
rate-limited (at most `START_RATE_LIMIT` within the rolling start window).

## Command validation and containment

`src/shared/managed-process-policy.ts` (`validateManagedProcessCommand`)
rejects commands that would escape containment: nohup/disown/setsid/daemonize,
systemd-run, launchctl submit, `start /b`, PowerShell `Start-Process`, runas,
schtasks/sc service creation, WMI process create, external terminals
(Terminal/iTerm, `wt`), `cmd.exe start`, background `&` control, plus the
`PROCESS_PROJECT_UNTRUSTED` / `PROCESS_SHELL_UNAVAILABLE` toolchain failures.
It also inspects the command for loopback endpoint candidates and network-`0.0.0.0`
bind warnings so public binds are surfaced to the user. The command hash and a
bounded display form are computed for auditing.

## Backends

The service chooses a backend by platform:

- **Posix** — `PosixManagedProcessBackend` spawns a dedicated **worker
  process** (`managed-process-worker.mjs`, `src/agent-host/managed-process/worker.ts`)
  that runs the actual shell. The worker isolates the managed command from the
  Host: stdout/stderr/system events are streamed back, the group is signalled on
  stop, and the backend tracks `getProcessStartFingerprint` for later reaping.
- **Windows** — `WindowsJobProcessBackend` talks to a native Rust helper binary
  (`native/windows-managed-process-helper/src/main.rs` presented as
  `WindowsJobProcessBackend` in `windows-helper-client.ts`). The helper creates
  a Windows Job object with a completion port so the entire process tree is
  contained and can be terminated; it streams stdout/stderr frames over a
  length-prefixed codec (`helper-codec.ts`) with a heartbeat, and refuses to
  start if it cannot prove the parent's identity (PID, start time, image path).
  Output forwarding is rate-limited (128 KB/s, 64 KB burst).

## Output buffering, log windows and loopback endpoints

`ManagedProcessOutputBuffer` (with `ManagedProcessOutputDecoder`) retains a
bounded ring of `stdout` / `stderr` / `system` records. `processes.read` /
`processes.wait` return a `ManagedProcessLogWindow` slice from a cursor, and
`processes.restart` / `processes.wait` can await a readiness condition
(`readinessSpec: ManagedProcessWaitFor`) with a default 10 s / max 30 s window.
`extractManagedLoopbackEndpoints` in the policy module parses stdout/stderr for
localhost URLs (e.g. a server's printed bind address) and stores them as
`ManagedLoopbackEndpoint`s (`endpointCount` max 8) so the UI and agent can open
the running service. `processes.write` streams stdin to the process via
`stdinWindow`.

## Crash reaping and the journal

Because a Host crash would orphan contained process groups, the main process
runs `ManagedProcessReaper` (`src/main/managed-process/reaper.ts`) backed by a
durable JSON journal (`reaper-journal.ts`, version 2, max 16 records, 64 KB).
Each contained process is registered by the Host (`reaper.register`) and
journaled before it matters. On startup the reaper loads any surviving records
and, if identity can be proven, terminates the recorded process groups
(`reapAll`). The journal directory is checked for unsafe permissions, and on
Windows the reaper can call `secureWindowsReaperDirectory` (via the helper) to
lock down the journal directory before use. Records remaining at startup after
an uncertain identity are retained so a restarted process may still clean them
up. `JOURNAL_INVALID` / `IDENTITY_UNCERTAIN` / `REAP_FAILED` leave affected
records in place and mark the reaper not ready.

The reaper is made ready only when the platform is supported and (on Windows)
a helper descriptor or callback is present. `capability.ts` combines reaper
readiness with the Host's managed-process owner acknowledgement to publish the
`ManagedProcessCapability` the renderer uses to gate the Processes panel.

## Shutdown cleanup

`cleanupManagedProcessContainment` (`shutdown-cleanup.ts`) is the bounded,
fail-closed gate used during quit and before update-install. It stops the Host
and reaps all records within a single deadline (`MANAGED_PROCESS_SHUTDOWN_DEADLINE_MS`
from `main.ts`), then inspects `getStatus()`. If the Host did not stop before the
deadline, the reaper did not complete, `reapAll` threw, or the reaper status is
not `ready` with zero records, cleanup reports failure so ordinary quit is
bounded while update-install fails closed without clearing uncertain reaper
records.
