---
type: reference
title: Managed Process Crash Recovery (Reaper)
description: The Main-process ManagedProcessReaper that persists managed-process containment records in a versioned journal, verifies process identity by start fingerprint, reaps POSIX process groups or Windows Job Objects, and fails closed on containment.
tags: [managed-process, reaper, crash-recovery, journal, windows-helper]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-6e57d26818244fcb9df46c1b
    resource: repo://src/main/managed-process/reaper-journal.ts
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-0ab73e3f3f4c84fb624dd5b4
    resource: repo://src/main/managed-process/shutdown-cleanup.ts
  - id: openwiki-source-b3ef51aadfd706fb5a182b77
    resource: repo://src/shared/windows-managed-process-helper.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Managed Process Crash Recovery (Reaper)

The managed background-process subsystem must survive an Agent Host crash: if a
dev server or watcher is left behind, orphaned processes must still be cleaned
with their complete process tree. This is the job of the **Main-process
`ManagedProcessReaper`**.

## Model

When a managed process starts, the Agent Host worker registers a
`ManagedProcessReaperRecord` with Main. The record carries enough identity to
safely decide later whether the still-live process tree really belongs to that
registration. On Host exit/restart/quit, Main invokes `reapAll()` to terminate
each recorded tree. A record is only removed once its tree is confirmed gone.

The reaper lives in the **Main** process (`src/main/managed-process/reaper.ts`)
so it survives a Host crash. It is initialized at startup before the Host is
spawned, and it runs `reapAll()` automatically on `initialize()` when records
remain from a previous session (`reaper.ts:236-259`).

## Capability gating

`projectManagedProcessCapability` (`src/main/managed-process/capability.ts`)
reports whether managed processes are supported and ready:

- POSIX (`darwin`/`linux`) is supported.
- Windows is supported only for `x64` on Windows 10+ (and not Windows Server).
- A `ready` capability additionally requires the reaper to be `ready`, and for
  Windows the Rust helper to be healthy **and** the Host's owner identity to be
  acknowledged (`capability.ts:13-38`).

Failure codes are `PLATFORM_UNSUPPORTED`, `ARCH_UNSUPPORTED`,
`REAPER_UNHEALTHY`, `HELPER_MISSING`, `HELPER_INTEGRITY`,
`OWNER_IDENTITY_UNAVAILABLE`. The Host will not start processes unless
`managedProcesses.getSettings` reports `enabled` and `reaperReady`
(`managed-process/service.ts:725-758`).

## Journal persistence and validation

The journal is a single v2 JSON file, `journal-v2.json`, in the app-private
`managed-process-reaper` directory (default `userData/managed-process-reaper`).

Reaper journal records and versioning are enforced by
`reaper-journal.ts`:

- `version: 2`, max 64 KiB, max 16 records, and (non-Windows) strict mode bits
  (`reaper-journal.ts:5-7`, `:140-163`).
- `validateReaperRecord` verifies lengths, POSIX `pid === pgid`, and for
  Windows the `jobName` matches `Local\PiDesktop.Managed.<64-hex>` and the
  `nonce` is a 64-hex string equal to the `jobName` suffix (`reaper-journal.ts:38-103`).
- Legacy v1 POSIX records are migrated to v2 on read (`reaper-journal.ts:105-138`).
- Duplicate identities are rejected, and writes go through temp+rename with
  mode `0o600`; an empty journal is unlinked (`reaper-journal.ts:193-227`).

If the journal cannot be read/validated, the reaper becomes **not ready** with
`JOURNAL_INVALID` and containment fails closed (`reaper.ts:246-251`).

## Reap: identity checks and outcomes

`reap(record)` dispatches by platform:

- **POSIX**: `processGroupExists(pgid)` is the sentinel. If the group is gone → `removed`.
  Otherwise Main fingerprints `record.pid` and compares it to the recorded
  `startFingerprint`. A mismatch → `identity-uncertain` (refuses to kill an
  arbitrary reused PID). A matching tree is terminated
  (`terminatePosixProcessGroup` with interrupt then terminate then force);
  if it could not be stopped → `failed`. Success → `removed`
  (`reaper.ts:354-367`).
- **Windows**: only valid when running on `win32`. It shells out to the Rust
  helper (`--reap-stdio-v1`) passing the `jobName`, `helperPid`,
  `helperStartFingerprint`, `helperBuildId`, and `nonce`; the helper reports
  `removed`, `identity-uncertain`, or `failed` (`reaper.ts:119-207`).

After `reapAll`, any non-`removed` outcome marks the reaper **not ready** and
sets `IDENTITY_UNCERTAIN` or `REAP_FAILED` (`reaper.ts:304-331`). This is the
fail-closed guarantee: if orphaned process containment cannot be confirmed, the
app refuses to continue starting managed processes until the operator reviews
the Processes panel and restarts.

## Registration and unregistration

`register` inserts a validated record (rejecting a nonce conflict for an
existing identity) and persists the journal. `unregister` requires the
`hostInstanceId` and `nonce` to match the stored record before deleting
(`reaper.ts:270-302`). The reaper also guards against identity conflicts so a
reused process/run key cannot mask a stale tree.

## Owner identity (Windows)

Windows reaping needs to know the process tree actually belongs to the current
app instance. At Host startup Main publishes a `managed-process-owner:init`
message with `mainPid`, a `mainStartFingerprint` (main process creation
time), `mainImagePath`, and a fresh `hostInstanceId`; the Host replies
`managed-process-owner:ack` confirming it recorded the owner
(`host-manager.ts:436-456`). `getManagedProcessOwnerIdentity()` is used by the
Windows helper to decide identity, and `managedProcesses.register` for a `win32`
record refuses an owner-generation mismatch (`main.ts:618-633`).

## Windows Rust helper

The native helper is a Rust binary in `native/windows-managed-process-helper`,
built for `x86_64-pc-windows-msvc`. It is packaged with a strict `manifest.json`
and verified at resolution: `resolveWindowsManagedProcessHelper` requires the
manifest to be well-formed, the executable to be a real contained non-symlink
file, its sha256 to match the manifest, and a live `--version-json-v1` run to
report the same protocolVersion/buildId/arch/provenance
(`src/shared/windows-managed-process-helper.ts:103-141`).

`verifyWindowsManagedProcessHelperReplaceable` verifies the helper can be
renamed aside and back (must not be locked by a running process) and is used by
the updater before install (`windows-managed-process-helper.ts:143-173`,
`main.ts:464-473`).

The `secureWindowsReaperDirectory` flow makes Main ask the helper to
ACL-lock the reaper journal directory so a local attacker cannot swap the
journal (`reaper.ts:41-117`).

## Quit and update cleanup

`cleanupManagedProcessContainment` in `shutdown-cleanup.ts` runs before quit and
update-install: it stops the Host and reaps all managed processes within the
shutdown deadline (15s). When `requireConfirmedEmpty` is set (update install,
or Host restart), it throws unless the Host stopped, the reaper completed, no
reaper failure occurred, the reaper is `ready`, and zero records remain —
otherwise "Managed process cleanup could not be safely confirmed"
(`shutdown-cleanup.ts:35-63`).

The same gate runs before every Host restart via `beforeRestartHandler`
(`main.ts:579-587`).

## Related pages

- Managed Background Processes (service)
- Architecture Overview
- Updates and Packaging
