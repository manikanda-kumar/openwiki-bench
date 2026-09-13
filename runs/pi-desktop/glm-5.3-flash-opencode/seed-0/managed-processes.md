---
type: workflow
title: Managed Processes
description: How Pi Desktop starts, observes, contains, and cleans up long-running project processes — POSIX process groups, the Windows Rust helper with Job Objects, the crash reaper, policy limits, redaction, and the process_* Agent tools.
tags: [managed-processes, posix, windows-job-object, reaper, process-tools, containment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-7c6fd1923225fa7adf47d1ce
    resource: repo://native/windows-managed-process-helper/Cargo.toml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-ace54e5d1ee50511cb867e05
    resource: repo://src/agent-host/managed-process/posix-backend.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-20b834548e65731a6b2db637
    resource: repo://src/agent-host/managed-process/session-redaction.ts
  - id: openwiki-source-765ce1a610881d3351a2cc0a
    resource: repo://src/agent-host/managed-process/tool-names.ts
  - id: openwiki-source-cf828109fc80a4ee1ea13246
    resource: repo://src/agent-host/managed-process/tools.ts
  - id: openwiki-source-de3dc8a8bda3ce2c2a499995
    resource: repo://src/agent-host/managed-process/windows-helper-client.ts
  - id: openwiki-source-7ba8124a5d3d5315cb1efbb9
    resource: repo://src/agent-host/managed-process/worker.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-6e57d26818244fcb9df46c1b
    resource: repo://src/main/managed-process/reaper-journal.ts
  - id: openwiki-source-e2a0fbb35a08f3fba4bc6e42
    resource: repo://src/main/managed-process/reaper.test.mjs
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-0ab73e3f3f4c84fb624dd5b4
    resource: repo://src/main/managed-process/shutdown-cleanup.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
  - id: openwiki-source-b3ef51aadfd706fb5a182b77
    resource: repo://src/shared/windows-managed-process-helper.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Managed Processes

Managed background processes let the Agent keep Vite dev servers, watchers, mock APIs, and similar long-running commands alive under explicit lifecycle control. The feature is off by default, is supported on macOS, Linux, and Windows 11 x64 (not Windows ARM64/Server/32-bit), and is lifecycle containment — **not** a sandbox: child processes have the same local file, network, and environment permissions as Agent Bash (README.md, 受管开发进程).

## Ownership and the two backends

`ManagedProcessService` runs in the Agent Host and owns every record: processId/runId/generation, owner session and cwd, command, state, output buffer, and exit info (src/agent-host/managed-process/service.ts:66-70, 293-310). It selects a backend per platform:

- **POSIX** (`PosixManagedProcessBackend`): a dedicated `managed-process-worker` utilityProcess spawns the command as a POSIX process group (`process.kill(-pid)`) and signals the whole group; the worker is bootstrapped with `ELECTRON_RUN_AS_NODE=1` plus `PI_DESKTOP_MANAGED*` identity markers (src/agent-host/managed-process/posix-backend.ts:29-39; src/agent-host/managed-process/worker.ts:28-36).
- **Windows** (`WindowsJobProcessBackend`): containment is delegated to a compiled Rust helper (`native/windows-managed-process-helper`) that manages Job Objects over a length-prefixed JSON protocol (src/agent-host/managed-process/windows-helper-client.ts; src/agent-host/managed-process/helper-codec.ts).

## Windows helper integrity

The helper is resolved from a fixed location and verified before use: a manifest with schema/protocol version, buildId format, provenance (`windows-native-dev` or `release-authoritative`), target triple, and SHA-256 must validate, the file must be a regular non-symlink file inside the directory, and the executable's reported version must match the manifest; failure yields `HELPER_MISSING` or `HELPER_INTEGRITY` (src/shared/windows-managed-process-helper.ts:19-80). Reproducibility is enforced in CI (`npm run check:windows-helper-reproducibility`, `npm run check:windows-sbom`).

## Capability gating

Main projects the capability snapshot with `projectManagedProcessCapability`: POSIX is supported on darwin/linux; Windows requires x64 plus Windows ≥10 and not Windows Server; `ready` additionally requires a healthy reaper and, on Windows, a verified helper plus owner identity. Error codes distinguish `ARCH_UNSUPPORTED`, `PLATFORM_UNSUPPORTED`, `REAPER_UNHEALTHY`, `HELPER_INTEGRITY`, `HELPER_MISSING`, and `OWNER_IDENTITY_UNAVAILABLE` (src/main/managed-process/capability.ts:12-53). The service also refuses to start anything when containment is unavailable: reaper readiness is mandatory, and on Windows the job backend, helper, and owner identity must all be present (src/agent-host/managed-process/service.ts:740-758).

Owner identity is established at Host spawn: Main sends its pid, a start fingerprint derived from the main process creation time, the resolved main image path, and a fresh `hostInstanceId`; the Host acknowledges only if the identity matches its own instance (src/main/host-manager.ts:436-456; src/main/host-manager.ts:294-298).

## Command policy and limits

`validateManagedProcessCommand` enforces a 32 KiB command limit and blocks detachment patterns — `nohup`, `disown`, `setsid`, `daemonize`, `systemd-run`, `launchctl submit`, external terminals, `start /b`, `Start-Process`, `runas`, scheduled tasks, Windows service creation, WMI process creation, and background shell control (src/shared/managed-process-policy.ts:6-66). Commands that appear to bind all interfaces (`0.0.0.0`/`::`) require explicit confirmation and are surfaced as LAN warnings, both from the command and from process output (src/shared/managed-process-policy.ts:68-71, 127-132, 239-249). Resource limits bound everything: 4 active processes per session, 8 globally, 12 starts per 60-second window, 64 KiB stdin lines, 2 MiB/10,000 records per process output buffer with a 16 MiB global cap, and 64 exited records retained for 15 minutes (src/shared/managed-process-policy.ts:6-27; src/agent-host/managed-process/service.ts:57-61, 761-777).

The process cwd must resolve (realpath) inside the owner session's workspace (src/shared/managed-process-policy.ts:141-163).

## Output, cursors, and loopback endpoints

Output is decoded, sanitized, and buffered per process with sequence cursors; readers resume from a cursor and a gap produces an explicit `[system]` dropped-bytes notice rather than silent loss (src/agent-host/managed-process/service.ts:339-355). Log text is redacted: ANSI sequences are stripped, URL credentials, Authorization headers, secret-looking CLI arguments and assignments, common token shapes (GitHub/OpenAI/Slack/JWT), and Pi nonces are replaced with `[redacted]` (src/shared/managed-process-policy.ts:165-177). The service scans output for loopback URLs (`localhost`/`127.0.0.1`/`::1`), redacts query secrets, and publishes up to 8 endpoints per run (src/shared/managed-process-policy.ts:193-237). Output notifications are batched at 100 ms (src/agent-host/managed-process/service.ts:57, 1277-1278).

Stops are graceful-then-force with an 8.5-second total timeout (src/agent-host/managed-process/service.ts:60). Session aborts stop the session's processes (src/agent-host/managed-process/service.ts:313-317).

## Agent tools and the trusted control surface

Seven Agent tools — `process_start`, `process_list`, `process_read`, `process_wait`, `process_write`, `process_stop`, `process_restart` — wrap the service; they are unavailable for messaging-channel turns (`assertLocalTurn`) and stale runIds are rejected (src/agent-host/managed-process/tool-names.ts:1-11; src/agent-host/managed-process/tools.ts:58-65, 107-110). The same operations are exposed to the Renderer as the typed `processes.*` API with owner-scoped access (src/contract/api.ts:68-108). Session-visible tool call arguments are additionally redacted: `process_start` commands, stdin text, and `contains` patterns are replaced before they reach the session history (src/agent-host/managed-process/session-redaction.ts:37-45).

## Crash reaper and shutdown

Main runs a `ManagedProcessReaper` over a journal at `<userData>/managed-process-reaper/journal-v2.json` (version 2, ≤64 KiB, ≤16 records, strict identity validation) (src/main/main.ts:403-410; src/main/managed-process/reaper-journal.ts:5-7). Records register the exact process identity (start fingerprint plus nonce); reaping verifies the live fingerprint before killing the group and fails closed on mismatch or termination failure (src/main/managed-process/reaper.test.mjs:23-63). On Windows the reaper invokes the same Rust helper with `--reap-stdio-v1` (src/main/managed-process/reaper.ts:119-157).

Shutdown is deadline-bounded: `cleanupManagedProcessContainment` stops the Host and reaps all records within the 15-second `MANAGED_PROCESS_SHUTDOWN_DEADLINE_MS`, and when confirmation is required (pre-restart/install paths) any deadline overrun, reaper failure, or non-zero record count aborts the operation (src/main/managed-process/shutdown-cleanup.ts:35-63; src/main/main.ts:55, 795-799).

## Representative tests

- src/agent-host/managed-process/service.test.mjs — lifecycle, stale runIds, stop modes, rate limits
- src/agent-host/managed-process/posix-backend.test.mjs — process-group containment
- src/main/managed-process/reaper.test.mjs and reaper-journal.test.mjs — identity-verified reaping and journal validation
- src/agent-host/managed-process/session-redaction.test.mjs — tool argument redaction
- scripts/test-managed-process-workflows.mjs, test-managed-process-flood.mjs, test-managed-process-frameworks.mjs — end-to-end lifecycle, resource bounds, and framework startup
- scripts/test-windows-managed-process-helper.mjs — Windows helper and Job Object acceptance
