---
type: guide
title: Windows Managed Process Helper Guide
description: How the Windows x64 Rust helper provides Job Object containment for managed background processes, its frame protocol, build/reproducibility pipeline, integrity verification, and the acceptance gates that protect it.
tags: [windows, rust, managed-process, job-object, helper]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-7c6fd1923225fa7adf47d1ce
    resource: repo://native/windows-managed-process-helper/Cargo.toml
  - id: openwiki-source-4f30b7fcf4677f72807c326c
    resource: repo://native/windows-managed-process-helper/src/main.rs
  - id: openwiki-source-91913bdce21ef566872b89af
    resource: repo://native/windows-managed-process-helper/src/protocol.rs
  - id: openwiki-source-cc8054650618de8344394e69
    resource: repo://scripts/build-windows-managed-helper.mjs
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-1e3c441fa9dc85197c422604
    resource: repo://scripts/verify-windows-helper-reproducibility.mjs
  - id: openwiki-source-389bb096ed54d0b6ca5e315b
    resource: repo://scripts/windows-helper-pe.mjs
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-b3ef51aadfd706fb5a182b77
    resource: repo://src/shared/windows-managed-process-helper.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Windows Managed Process Helper Guide

On Windows x64, managed background processes are contained by a small Rust binary, `pi-managed-process-helper.exe`, instead of the POSIX process-group mechanism used on macOS/Linux. It runs the target process inside a protected Job Object and is exercised both by the Agent Host (to spawn/control the process) and by Electron Main (to reap leftover jobs after a crash). This guide covers its protocol, build pipeline, integrity verification, and the gates that protect it.

## Responsibilities

The helper (`native/windows-managed-process-helper`) has fixed modes selected by the first CLI argument (`src/main.rs:476-518`):

- `--owner-stdio-v1` — owner mode: open owner handles, create the named Job, prepare a suspended target, assign it to the Job **before** resume with an inherited-handle allowlist, stream stdout/stderr, forward stdin, stop the process tree in graceful phases (CTRL_C → CTRL_BREAK → Job terminate), and terminate the Job if the owner/main identity is lost (`src/main.rs:252-401`).
- `--reap-stdio-v1` — reaper mode: either secure a journal directory or reap a named Job, verifying the helper's own identity by pid/start-fingerprint/build-id before touching it (`src/main.rs:403-448`).
- `--version-json-v1` and `--self-test-json-v1` — verification modes; the self-test validates `job-dacl`, `kill-on-close`, `completion-port`, and `accounting` (`src/main.rs:450-474`).

The helper must expose **no network surface** — owner/reaper/self-test/version modes only, with no `TcpListener`/`UdpSocket`/`std::net`/WinHttp code (`scripts/check-desktop-security.mjs:198-206`).

## Job containment invariants

The Win32 layer (`src/win32/mod.rs`) is gated by static security checks:

- the target is created `CREATE_SUSPENDED`, assigned to a `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job via `AssignProcessToJobObject`, then resumed — never with `CREATE_BREAKAWAY_FROM_JOB` (`check-desktop-security.mjs:161-169`);
- named Jobs retain an exact protected current-user plus SYSTEM DACL (`JOB_OBJECT_TERMINATE | JOB_OBJECT_QUERY | READ_CONTROL | SYNCHRONIZE`, `PROTECTED_DACL_SECURITY_INFORMATION`), and reapers reopen the Job and verify the DACL before terminating (`check-desktop-security.mjs:170-177`);
- completion notifications are advisory: authoritative empty detection queries job accounting rather than relying on `GetQueuedCompletionStatus` (`check-desktop-security.mjs:178-183`);
- the cwd and shell executable are final-path verified against device namespaces before `CreateProcessW`, with shared read/write (not delete) handles (`check-desktop-security.mjs:184-196`);
- every `unsafe` block in the Win32 module must retain a `// SAFETY:` invariant and the count is pinned at 99 (`check-desktop-security.mjs:128-135`).

## Frame protocol

The helper speaks a bounded binary frame protocol over stdio (`src/protocol.rs`):

- a 16-byte header: magic `PIMP`, 2-byte protocol version (`1`), 2-byte kind, 4-byte length, 4-byte monotonic sequence that must advance exactly (`protocol.rs:56-113`);
- payload limits: bootstrap 512 KiB, control 128 KiB, output 64 KiB; oversized frames are rejected before allocation (`protocol.rs:5-8`, `protocol.rs:41-54`);
- JSON payloads are escaped safely (`json_escape`, `protocol.rs:157-178`);
- the same framing is mirrored on the TypeScript side by `WindowsHelperFrameDecoder`/`encodeWindowsHelperJson` in `src/agent-host/managed-process/helper-codec.ts` and consumed by the reaper (`src/main/managed-process/reaper.ts:119-207`).

## Build IDs and provenance

The build id is `pimpd-<app-version>-p<protocol>-<revision>`, where `revision` is a 12-hex SHA-256 digest over the build script, `.cargo/config.toml`, `build.rs`, `Cargo.lock`, `Cargo.toml`, `deny.toml`, `rust-toolchain.toml`, and every file under `resources/` and `src/` (`scripts/build-windows-managed-helper.mjs:35-70`). Provenance is one of:

- `windows-native-dev` — a native Windows x64 build (`build-windows-managed-helper.mjs:205`);
- `release-authoritative` — the release build on Windows (`build-windows-managed-helper.mjs:205`);
- `cross-dev` — the cargo-xwin compile-only gate on macOS/Linux (`build-windows-managed-helper.mjs:159-161`).

The version resource embeds the tuple/version/build-id (`helper.rc.template`), and the build refuses to proceed unless the running `--version-json-v1` output matches exactly (`build-windows-managed-helper.mjs:233-253`).

## Build and packaging pipeline

`npm run build:windows-helper` → `scripts/build-windows-managed-helper.mjs`:

- **On Windows x64** it compiles the version resource with the pinned SDK's `rc.exe`, runs `cargo build --locked --release --target x86_64-pc-windows-msvc`, verifies the PE, copies the exe to `out/native/windows-managed-process-helper/pi-managed-process-helper.exe`, runs `--version-json-v1` and `--self-test-json-v1`, and writes a `manifest.json` with the sha256 (`build-windows-managed-helper.mjs:197-291`).
- **On other platforms** it runs the compile-only cross gate: `cargo-xwin 0.23.1` with pinned LLVM 18, SDK `10.0.26100`, and CRT `14.44.17.14`, then verifies the PE (`build-windows-managed-helper.mjs:155-195`).
- `verifyWindowsHelperPe` (`scripts/windows-helper-pe.mjs:33-...`) enforces the PE shape: MZ/PE signature, x86-64, PE32+, subsystem 3, DLL characteristics `highEntropyVa | dynamicBase | nxCompat | guardCf`, and an import allowlist of exactly `advapi32.dll`, `api-ms-win-core-synch-l1-2-0.dll`, `kernel32.dll`, `ntdll.dll`, `user32.dll`.

Reproducibility is verified by `npm run check:windows-helper-reproducibility`, which builds twice with a targeted `cargo clean` between builds and requires identical sha256 (`scripts/verify-windows-helper-reproducibility.mjs:29-47`).

Supply chain: `Cargo.toml` pins `windows-sys = "=0.61.2"` with `panic = "abort"`, fat LTO, `unsafe_op_in_unsafe_fn = "deny"`, and clippy `-D warnings`; CI runs pinned `cargo-audit` and `cargo-deny` against the lockfile and `deny.toml`, and the crate must not use tokio/serde/reqwest/socket/tls (`Cargo.toml:8-34`, `check-desktop-security.mjs:118-127`).

## Integrity verification at runtime

`resolveWindowsManagedProcessHelper` (`src/shared/windows-managed-process-helper.ts:103-141`) is the fail-closed resolver used by Main at startup and update time:

- the helper directory is fixed: packaged `resources/managed-process/win32-x64`, dev `out/native/windows-managed-process-helper` (`windows-managed-process-helper.ts:109-111`);
- it requires an exact `manifest.json` schema and a sha256 of the executable matching the manifest; `--version-json-v1` output must also match unless verification is explicitly disabled (`windows-managed-process-helper.ts:43-101`, `:125-129`);
- any mismatch resolves to `HELPER_MISSING` or `HELPER_INTEGRITY` and the managed-process capability becomes not-ready (`contract/processes.ts:189-206`).

The executable is also locked against write/delete replacement while running (`lock_current_executable`), and update installation checks `verifyWindowsManagedProcessHelperReplaceable` before replacing the helper (`windows-managed-process-helper.ts:143-173`, `src/main/main.ts:463-474`). The reaper journal directory is secured through the helper itself (`secureWindowsReaperDirectory`, `src/main/managed-process/reaper.ts:41-117`).

## Acceptance tests

The helper is gated by Windows-only acceptance suites in CI (`scripts/test-windows-managed-process-helper.mjs`, plus the workflow steps in `build-desktop.yml`):

- `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `cargo audit`, `cargo deny`;
- `npm run check:windows-helper-reproducibility`;
- `npm run test:windows-managed-helper` with `PI_WINDOWS_HELPER_HANDLE_LOOPS=100`;
- `npm run test:managed-process-workflows` and the 60-second, eight-process dual-stream `test:managed-process-flood`;
- `npm run test:managed-process-frameworks` (real Next/Storybook/Spring Boot cold starts) and `npm run test:windows-nsis-upgrade` (hash-pinned previous NSIS upgrade, installed-helper locking, direct rollback).

## Related pages

- [Managed Background Processes](../systems/managed-processes.md)
- [Development and Verification Guide](./development-and-verification.md)
- [Security Model](../architecture/security-model.md)
