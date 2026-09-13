---
type: concept
title: Windows Managed Process Helper
description: The Rust win32 helper binary — Job Object containment, two-phase owner start, owner-lost watchdog, reaper modes, integrity verification, and the PIMP frame protocol.
tags: [managed-processes, windows, rust, job-object, helper]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-e8381a19204e345fe447a619
    resource: repo://.github/workflows/build-desktop.yml
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-4f30b7fcf4677f72807c326c
    resource: repo://native/windows-managed-process-helper/src/main.rs
  - id: openwiki-source-91913bdce21ef566872b89af
    resource: repo://native/windows-managed-process-helper/src/protocol.rs
  - id: openwiki-source-cc8054650618de8344394e69
    resource: repo://scripts/build-windows-managed-helper.mjs
  - id: openwiki-source-2d596ce9865a011e2e8cbbd2
    resource: repo://src/agent-host/managed-process/helper-codec.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-b3ef51aadfd706fb5a182b77
    resource: repo://src/shared/windows-managed-process-helper.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Windows Managed Process Helper

On Windows x64, managed background processes are contained by a native Rust helper binary (`native/windows-managed-process-helper/`) instead of POSIX process groups. The helper creates a Windows **Job Object**, launches the target process suspended, and only resumes it after the Host commits to the start — so a crash between prepare and commit cannot leak an uncontained process. The TypeScript side is `src/agent-host/managed-process/windows-helper-client.ts` (owner mode) plus the reaper in `src/main/managed-process/reaper.ts` (reaper mode).

## Platform support and packaging

- The helper only runs on Windows x64; the non-Windows `main()` prints an error and exits 2 (`native/windows-managed-process-helper/src/main.rs:526`). `projectManagedProcessCapability` requires `win32` + `x64` + non-Server Windows 10+ (`src/main/managed-process/capability.ts:13`).
- The build script `scripts/build-windows-managed-helper.mjs` compiles the crate (native MSVC or cross via cargo-xwin) and writes `manifest.json` next to the executable with `buildId` (`pimpd-<version>-p1-<revision>`), `provenance`, `arch: "x64"`, `sha256`, `sourceRevision`, and `targetTriple: x86_64-pc-windows-msvc` (`build-windows-managed-helper.mjs:277`).
- `electron-builder.yml` ships `pi-managed-process-helper.exe` + `manifest.json` to `managed-process/win32-x64` (`electron-builder.yml:129`). Release builds use provenance `release-authoritative`; dev builds use `windows-native-dev` (or `cross-dev` for the Linux cross-check) (`build-windows-managed-helper.mjs:204`).

## Integrity verification

`resolveWindowsManagedProcessHelper` (`src/shared/windows-managed-process-helper.ts:103`) resolves the helper in dev (`out/native/windows-managed-process-helper`) or packaged (`resources/managed-process/win32-x64`) mode and verifies:

- The manifest is a regular, non-symlink file inside the directory with an exact key set, schemaVersion 1, protocolVersion 1, a `pimpd-...` buildId, `arch: x64`, a valid provenance, the exact file name, a 64-hex sha256, a 7–12 hex sourceRevision, and the MSVC target triple (`windows-managed-process-helper.ts:43`).
- The executable's actual sha256 matches the manifest.
- The executable reports the same `protocolVersion`/`buildId`/`arch`/`provenance` via `--version-json-v1` (unless verification is disabled for tests).

`verifyWindowsManagedProcessHelperReplaceable` performs a rename probe to confirm the helper can be replaced during an update (`windows-managed-process-helper.ts:143`).

## Frame protocol

The wire format is a 16-byte little-endian header (`"PIMP"` magic, u16 protocol version, u16 kind, u32 payload length, u32 sequence) followed by the payload (`native/.../protocol.rs:69`). Sequence numbers must be strictly increasing on both sides, and payload sizes are bounded by kind: bootstrap ≤ 512 KiB, stdout/stderr ≤ 64 KiB, all other control frames ≤ 128 KiB. The TypeScript codec mirrors this exactly (`src/agent-host/managed-process/helper-codec.ts:35`).

Frame kinds (host → helper): `bootstrap`(1), `commit`(2), `stdin`(3), `closeStdin`(4), `stop`(5), `ping`(6), `shutdown`(7), `reap`(8), `secureJournalDirectory`(9). Helper → host: `hello`(0x100), `prepared`(0x101), `started`(0x102), `stdout`/`stderr`(0x103/0x104), `outputDropped`(0x105), `stdinClosed`(0x106), `stopping`(0x107), `activeZero`(0x108), `exit`(0x109), `error`(0x10a), `pong`(0x10b), `reapOutcome`(0x10c), `journalDirectorySecured`(0x10d).

## Owner mode (process containment)

Invoked as `--owner-stdio-v1` (`main.rs:252`):

1. Reads a `bootstrap` frame, opens owner handles (the Main process, whose loss triggers the watchdog), creates the named Job Object, and prepares the target process **suspended** with its pipes (`Target::prepare`).
2. Sends `prepared` with the helper pid, helper start fingerprint, job name, build id, nonce, and host instance id.
3. Waits for the `commit` frame (must match the bootstrap nonce), then **resumes** the target and starts draining stdout/stderr.
4. Spawns a watchdog thread that waits for owner loss and, if the owner disappears, terminates the Job Object (`main.rs:293`).
5. Sends `started` and then loops handling `stdin`, `closeStdin`, `stop`, `ping`; it reports `activeZero` when the Job Object has no active processes, then sends `exit` with a reason (`exit`, `stopped`, `host-failure`).
6. On EOF/disconnect it marks owner-lost and terminates the Job.

**Stop phases** (`stop_job`, `main.rs:226`): graceful sends `HELPER_STOPPING {phase:"interrupt"}` and a `CTRL_C_EVENT`, waits 2 s; then `CTRL_BREAK_EVENT`, waits 3 s; then force `TerminateJobObject` and waits 1.5 s. A root process that exits while descendants remain gets force-terminated after 1 s (`main.rs:396`).

The Job Object is configured with a DACL and kill-on-close so closing the handle kills the tree, and a completion port provides active-process accounting (`self_test_mode` checks `job-dacl`, `kill-on-close`, `completion-port`, `accounting`).

## Reaper mode

Invoked as `--reap-stdio-v1` (`main.rs:403`), used by Main's `ManagedProcessReaper`:

- With `secureJournalDirectory`, it applies the helper's DACL to the reaper journal directory and replies `journalDirectorySecured` (`main.rs:406`).
- With `reap`, it opens the named Job Object (`Job::open_for_reap`); if absent it reports `already-empty`. It verifies the recorded helper pid/start-fingerprint/build id via `open_reap_owner`; a mismatch reports `identity-uncertain` rather than killing an unrelated job. Otherwise it terminates the job, waits for it to empty, terminates the recorded owner, and reports `removed` (`main.rs:420`).

`ManagedProcessReaper.reapWindowsRecord` drives this over stdio with a 3 s timeout and validates the `hello` frame's protocol/build/arch before sending `reap` (`src/main/managed-process/reaper.ts:119`).

## Protocol hardening

The helper locks its own executable while running (`lock_current_executable`), escapes all JSON control output itself, and treats malformed/oversized/out-of-sequence frames as protocol errors. The Rust test module includes a 10 000-case bounded random frame corpus that must never panic or overallocate (`protocol.rs:213`).

## Tests and gates

- `npm run test:windows-managed-helper` runs Windows x64 acceptance of the helper and Job Object (`scripts/test-windows-managed-process-helper.mjs`).
- `npm run check:windows-helper-reproducibility` asserts the release helper is reproducible; the Windows CI job also runs `cargo fmt`, `clippy -D warnings`, `cargo test`, `cargo audit`, and `cargo deny`.
- `scripts/generate-windows-sbom.mjs` / `verify-windows-sbom.mjs` and the release packaging step gate the Windows artifacts.
