---
type: security-model
title: Security Model
description: Pi Agent Desktop's enforced security invariants — process sandboxing and CSP, trusted-desktop-IPC sender checks, file-root allowlists, encrypted credential storage, default-off policy engines for browser agents and managed processes, and the desktop security gate.
tags: [security, csp, sandbox, trust, policy, redaction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

Pi Agent Desktop's security posture is layered: Chromium-level isolation, one strict privilege gate per IPC surface, secret encryption at rest, and default-off capability engines that require explicit grants before any side effect. Some of these layering rules are not just convention — `scripts/check-desktop-security.mjs` asserts source-level invariants on every run of `npm run verify` (repo://scripts/check-desktop-security.mjs#L118-L727, repo://scripts/verify.mjs#L26).

## Chromium isolation and CSP

The main window runs with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true` (repo://src/main/window.ts#L48-L54). The UI is served from a custom `app://` protocol with a fixed Content Security Policy — `default-src 'self' app:`, no `object-src`, `base-uri 'none'`, `frame-ancestors 'none'` — with a deliberately narrower, separate policy for one-megabyte-capped HTML previews (repo://src/main/protocol.ts#L8-L55). Main-window navigation is restricted to an allowlist, external http(s)/mailto links are handed to the OS shell, and renderer-initiated `window.open` is denied (repo://src/main/window.ts#L80-L105). Dedicated browser views get their own hardened `webPreferences` (no Node, sandboxed, no webview tag) (repo://src/main/browser/browser-tab-manager.ts#L2310-L2333).

Device permissions are fail-closed: browser sessions install `setPermissionCheckHandler` / `setPermissionRequestHandler` that deny anything not promptable or without a consumed grant, with timeouts that auto-deny (repo://src/main/browser/browser-network-interceptor.ts#L113-L152). Requests bypass on every `webRequest` phase only after the policy engine's `check()` passes; otherwise the request is canceled (repo://src/main/browser/browser-network-interceptor.ts#L159-L179).

## Trusted desktop IPC

Every `ipcMain` channel registered by `installDesktopIpc` is wrapped so only senders matching the main window's exact `webContents` and `mainFrame` are served; anything else is rejected or silently dropped (repo://src/main/ipc.ts#L83-L103, repo://src/main/ipc-trust.ts#L12-L18). Layer validation beyond that is per-channel: boolean validation for update settings, structured request validation plus confirmation dialogs for toolchain actions, scheme restrictions for `open-external`, absolute/no-NUL path checks for `show-item-in-folder` (repo://src/main/ipc.ts#L126-L175). This trust rule is explicitly asserted by the security gate (repo://scripts/check-desktop-security.mjs#L509).

## File access allowlist

Host file APIs are gated by an allowlist, not a free-for-all filesystem. `isFilePathAllowed` resolves paths through `canonicalPath`, which realpaths the nearest existing ancestor so a symlink cannot hide behind not-yet-created segments, and compares case-insensitively on Windows paths with separator-aware prefix matching (repo://src/agent-host/file-access-core.ts#L13-L31, repo://src/agent-host/file-access-core.ts#L34-L50). Allowed roots are derived from existing Pi session cwds (plus home) with a watcher-aware TTL cache and single-retry semantics on invalidation races (repo://src/agent-host/file-access.ts#L21-L41). Session watchers invalidate the cache and mark watcher health (repo://src/agent-host/session-watcher.ts#L10-L19). Details: [Session Storage and File Access](/openwiki/concepts/session-storage-and-file-access.md).

## Credential and secret storage

Channel credentials live in a `CredentialVault` file written with mode `0o600` via atomic temp-file rename, keyed by a strict `channel:<channel>:<id>` regex (repo://src/main/credential-vault.ts#L31-L45). Values are encrypted with Electron `safeStorage`; `set`/`get` assert availability and refuse to store plaintext if encryption is unavailable (repo://src/main/credential-vault.ts#L47-L74). The vault is reachable by the Host only over the Main-answered `channelSecrets.*` parent RPC (repo://src/main/credential-vault.ts#L77-L101, repo://src/main/main.ts#L623-L625). Channel values and errors are scrubbed before display or logs: `redactChannelValue` replaces sensitive-keyed fields, and `redactChannelText` strips bearer tokens, bot tokens, query-string secrets, and JSON secret fields; `safeChannelError` bounds and redacts error text (repo://src/agent-host/channels/redaction.ts#L3-L33).

## Browser agent policy engine

Agent browser tools are gated by a layered policy in `BrowserPolicyEngine`:

- Capability is default-off: `assertRequest` throws `BROWSER_DISABLED` / `CAPABILITY_DISABLED` when the browser or automation is disabled (repo://src/main/browser/browser-policy.ts#L160-L199).
- Even when enabled, a call must present a valid `requestId`, a matching **policy revision**, a non-expired **capability lease** bound to the right session, and a permission rank (`none < read < interact < advanced`) that covers the requested level; `advanced` additionally requires the high-risk confirmation path (repo://src/main/browser/browser-policy.ts#L160-L199).
- Runtime grants expire (default 8 h TTL for grants, 15 min for leases), and a revision bump invalidates all leases (repo://src/main/browser/browser-policy.ts#L14-L16, repo://src/main/browser/browser-policy.ts#L203-L217).

The tool surface is ranked the same way at the Host (`browser_*` tools map to `read`/`interact`/`advanced`) (repo://src/agent-host/browser-tools.ts#L13-L48). Details: [Browser Integration](/openwiki/workflows/browser-integration.md).

## Default-off managed processes

Managed background processes are off by default: Main reports `enabled: capability.ready && loadUiState().managedProcessesEnabled === true` — both the projected platform/reaper/helper capability and the user's explicit setting must hold (repo://src/main/main.ts#L610-L618). Even when enabled, they are lifecycle containment, not a sandbox: policy validation, LAN-bind confirmation dialogs, session-cwd containment, and reaper registration are prerequisites, and the process keeps normal user-level file/network/environment permissions (repo://src/main/main.ts#L645-L672, repo://src/shared/managed-process-policy.ts#L6-L260). Details: [Managed Processes](/openwiki/workflows/managed-processes.md).

## Supply chain and update invariants

The security gate also enforces operational invariants: Windows helper sources must contain no unsafe code outside allowlisted SAFETY-commented Win32 operations (repo://scripts/check-desktop-security.mjs#L134-L157); tag releases must verify managed runtime checksums/sizes against upstream metadata (repo://scripts/check-desktop-security.mjs#L353-L357); runtime fetches must use Electron networking with synchronous redirect checks so system proxy/trust stays effective (repo://scripts/check-desktop-security.mjs#L330-L333); and packaged startup must write the validation report that `check:production-artifacts` inspects (repo://scripts/check-desktop-security.mjs#L370-L393). The updater reads only its fixed packaged configuration, never Renderer-supplied endpoints (repo://src/main/update-manager.ts#L1-L66).

## Failure behavior

The unifying pattern is fail-closed: untrusted IPC senders are dropped, requests blocked by policy are canceled, permissions without grants are denied, capability calls throw typed `BrowserError`s with retryable/hint semantics, channels redact secrets from any surfaced error, and file reads outside allowlisted roots are refused. Where the repository cannot enforce a boundary in code (e.g., private-network protection is labeled best-effort in the README), that limitation is stated rather than hidden (repo://README.md#L62).

## Related pages

- [IPC and RPC Contract](/openwiki/architecture/ipc-and-rpc.md) — the transport these gates wrap.
- [Browser Integration](/openwiki/workflows/browser-integration.md) — browser policy in action.
- [Messaging Channels](/openwiki/workflows/messaging-channels.md) — channel policy and redaction.
- [Managed Processes](/openwiki/workflows/managed-processes.md) — containment gating.
