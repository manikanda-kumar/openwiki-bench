---
type: architecture
title: Security Model
description: The layered security boundaries of Pi Agent Desktop — renderer sandbox and CSP, trusted preload and IPC senders, file access roots, encrypted channel credentials, redaction, and the desktop-security invariant gate.
tags: [security, sandbox, csp, ipc, credentials, redaction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T19:27:00.576Z
---

# Security Model

Security in Pi Agent Desktop is enforced in depth by several independent layers: process isolation with a sandboxed renderer and strict CSP, a location-validated preload, sender-verified IPC, path-canonicalized file access roots, OS-encrypted credential storage, and pervasive redaction. A dedicated static analysis gate (`check:desktop-security`) pins many of these invariants so they fail the build if regressed, and it runs inside `npm run verify` (`repo://scripts/verify.mjs#L41`).

## Renderer isolation and CSP

The main window is created with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` (`repo://src/main/window.ts#L48-L55`). The desktop-security gate asserts that `sandbox: true` and `nodeIntegration: false` remain in the window factory (`repo://scripts/check-desktop-security.mjs#L321-L323`).

The packaged renderer loads from the `app://` protocol whose handler injects a strict CSP: `default-src 'self' app:`, no `object-src`, `base-uri 'none'`, `frame-ancestors 'none'`, and `connect-src 'self' app:` (`repo://src/main/protocol.ts#L9-L27`). HTML previews get a separate, more permissive CSP in an isolated context with `form-action 'none'` and a 1 MiB size cap (`HTML_PREVIEW_MAX_BYTES = 1024 * 1024`) (`repo://src/main/protocol.ts#L29-L43`). The security gate also verifies the CSP block and the renderer's CSP meta tag (`repo://scripts/check-desktop-security.mjs#L95-L96`).

## Trusted preload location

The preload only installs the `piBridge` when its own location is trusted: `app://bundle` when packaged, or `http://localhost:5173` / `http://127.0.0.1:5173` in dev (`repo://src/preload/preload-location-policy.ts#L1-L12`). Outside these, no bridge is exposed. MessagePorts reach the page through `window.postMessage` transfer instead of crossing `contextBridge` (`repo://src/preload/preload.ts#L9-L27`).

## Sender-verified IPC

Desktop IPC handlers are registered only through `trustedHandle`, `trustedOn`, and `browserHandler` wrappers; `isTrustedDesktopIpcSender` requires the event sender to be the live main window's `webContents` and its main frame before a handler proceeds (`repo://src/main/ipc.ts#L87-L115`, `repo://src/main/ipc-trust.ts#L13-L20`). The contract coverage gate requires every preload `invoke`/`send` channel to have a matching trusted registration (`repo://scripts/check-contract-coverage.mjs#L238-L243`).

## File access roots

The Agent Host restricts which filesystem paths the UI and file APIs may touch. Allowed roots are derived from persisted sessions (`cwd` and `projectRoot` of every known session), plus `~/pi-cwd-<date>` working directories, plus explicitly allowed roots added at runtime (`allowFileRoot`) (`repo://src/agent-host/file-access.ts#L43-L66`).

Path checks are not string-prefix comparisons on raw input:

- `canonicalPath` resolves the nearest existing ancestor via `realpath`, so a symlink cannot hide behind not-yet-created path segments (`repo://src/agent-host/file-access-core.ts#L14-L35`).
- `isFilePathAllowed` canonicalizes both target and root, applies Windows lexical rules and case-insensitive comparison where Windows absolute paths are involved, and requires the target to equal the root or live under it with a separator boundary (`repo://src/agent-host/file-access-core.ts#L38-L60`).

Root scanning is cached with a watcher-aware TTL: 10 minutes when the session watcher is healthy (mutations invalidate the cache explicitly, so the TTL is only a safety net), 5 seconds as a fallback when `fs.watch` is degraded, so externally created session cwds still appear promptly (`repo://src/shared/allowed-roots.ts#L48-L62`). A generation counter guards against stale caches when the watcher invalidates roots mid-scan (`repo://src/agent-host/file-access.ts#L21-L41`).

## Credential vault

Channel credentials (WeChat/Telegram/Feishu tokens) are stored by Main in a single vault file written with mode `0o600` via atomic temp-file rename (`repo://src/main/credential-vault.ts#L30-L43`). Values are encrypted with Electron `safeStorage`; both `get` and `set` assert that OS-level encryption is available and refuse to persist otherwise (`repo://src/main/credential-vault.ts#L46-L70`). Vault keys are strictly validated against the pattern `channel:(weixin|telegram|feishu):<id>` (`repo://src/main/credential-vault.ts#L10-L16`). The Agent Host reaches the vault only through Main's `channelSecrets.*` reverse-RPC handler (`repo://src/main/credential-vault.ts#L73-L92`), so secrets never live in the Host process.

## Redaction layers

Diagnostics exports are scrubbed by `redactDiagnosticText`, which replaces user paths (userData, logs, home) including slash-variant forms with `<userData>`/`<logs>`/`$HOME` (or `%USERPROFILE%` on Windows), removes `authorization`/`proxy-authorization` headers, masks token-bearing environment variables (`NODE_AUTH_TOKEN`, `NPM_TOKEN`, `PIP_INDEX_URL`, proxy URLs, …), redacts generic `token`/`password`/`secret`/`api_key` assignments, strips known token shapes (`npm_*`, `ghp_*`, `github_pat_*`), and removes URL credentials (`repo://src/main/diagnostics-redaction.ts#L13-L59`). Managed-process logs have a separate session redaction layer, and the browser subsystem has its own redaction module (`repo://src/agent-host/managed-process/session-redaction.ts`, `repo://src/main/browser/browser-redaction.ts`).

## Windows helper hardening

The native Windows managed-process helper is pinned by the security gate: exact `windows-sys` version, `panic = "abort"`, `unsafe_op_in_unsafe_fn = "deny"`, no async/network/TLS/serialization dependencies, zero `unsafe` in the safe parser/state machine modules, and every allowlisted Win32 unsafe operation in `win32/mod.rs` must carry a `// SAFETY:` comment with an exact count (99) enforced (`repo://scripts/check-desktop-security.mjs#L106-L137`). The build config must keep `crt-static`, `control-flow-guard`, and `/Brepro` reproducible linking (`repo://scripts/check-desktop-security.mjs#L138-L141`).

## Desktop-security invariant gate

`scripts/check-desktop-security.mjs` reads ~60 source files and evaluates 64 boolean invariant checks spanning renderer sandbox flags, CSP, the preload location policy, IPC trust, credential vault usage, channel adapters (outbound-only transports, secret fingerprinting), browser policy/authorization/redaction/grant stores, agent browser budgets, toolchain installer constraints, update adapter fixed-config rules, and the Windows helper (`repo://scripts/check-desktop-security.mjs#L30-L71`, `repo://scripts/check-desktop-security.mjs#L105-L707`). Any failing check prints `FAIL: <message>` and exits non-zero; the success line reports `OK: <n> desktop security invariants hold` (`repo://scripts/check-desktop-security.mjs#L709-L733`). The gate is part of the `verify` pipeline (`repo://scripts/verify.mjs#L41`).

## Trust boundary summary

- The renderer has no Node access and only the exposed `piBridge`; the Host RPC port is delivered only after preload location validation (`repo://src/preload/preload.ts#L1-L27`).
- The Agent Host validates every filesystem request against canonicalized allowed roots (`repo://src/agent-host/file-access-core.ts#L38-L60`).
- Main is the only process that reads/writes OS-encrypted credentials (`repo://src/main/credential-vault.ts#L46-L70`).
- Agent-facing surfaces (browser tools, managed-process tools) enforce budgets, permissions, and redaction in the Host, with Main holding authorization state (`repo://scripts/check-desktop-security.mjs#L692-L705`).
