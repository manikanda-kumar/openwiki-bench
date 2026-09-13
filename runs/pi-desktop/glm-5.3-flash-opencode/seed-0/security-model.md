---
type: architecture
title: Security Model
description: The layered desktop security posture — sandboxed Renderer with strict CSP, custom app protocol, trusted-sender IPC, navigation policy, preload gating, browser-view isolation, and CI-enforced invariants.
tags: [security, sandbox, csp, ipc-trust, navigation-policy, protocol, invariants]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-4621d826900abafddcb9a394
    resource: repo://scripts/verify-packaged-toolchains.mjs
  - id: openwiki-source-8f5dba62b265d534a7117805
    resource: repo://src/agent-host/browser-agent-runtime.ts
  - id: openwiki-source-443d436bf8959f95e46739f8
    resource: repo://src/agent-host/browser-tools.ts
  - id: openwiki-source-0cbbd7f7984c9c7544030573
    resource: repo://src/agent-host/channels/redaction.ts
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-2f0c558288a8a32519e88ca2
    resource: repo://src/agent-host/file-watch.ts
  - id: openwiki-source-20b834548e65731a6b2db637
    resource: repo://src/agent-host/managed-process/session-redaction.ts
  - id: openwiki-source-b06181600828a8da06569e55
    resource: repo://src/main/browser/browser-network-policy.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-237e62042dfac18df827c94f
    resource: repo://src/main/browser/browser-tab-manager.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-4409b8bcec1076bcf5e8ef33
    resource: repo://src/main/diagnostics.ts
  - id: openwiki-source-d481412a7917f2959e804ba1
    resource: repo://src/main/ipc-trust.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-4d903eaf7a3b75c622fde541
    resource: repo://src/main/logger.ts
  - id: openwiki-source-ef164c6b28faef428d272acf
    resource: repo://src/main/managed-process/capability.ts
  - id: openwiki-source-e242e543588ed70c319e3140
    resource: repo://src/main/menu-policy.ts
  - id: openwiki-source-650ce447b08aa5092ed0ec70
    resource: repo://src/main/protocol.ts
  - id: openwiki-source-873302e5e8aa96bc6d329875
    resource: repo://src/main/update-adapter.ts
  - id: openwiki-source-db94ac485981ee6d84773d1b
    resource: repo://src/main/window-navigation-policy.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-910e879cd3b0e278b2b0eccd
    resource: repo://src/preload/preload-location-policy.ts
  - id: openwiki-source-d6e406a0fb0c67f1b3305128
    resource: repo://src/preload/preload-message-policy.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Security Model

The desktop app layers several independent defenses. Most guarantees below are enforced by code and re-verified by a dedicated security-invariant script; claims that come only from README prose are marked as such.

## Renderer hardening

The main window is created with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true` (src/main/window.ts:48-54). The preload bridge is installed only when `isTrustedPreloadLocation` validates the page URL — `app://bundle` in production or `http://localhost:5173`/`127.0.0.1:5173` in development (src/preload/preload-location-policy.ts:1-11). Transferred MessagePorts are shape-validated (`selectTransferredHostPort` requires exactly one port with the expected API) and deep-link session messages must match a strict UUID pattern (src/preload/preload-message-policy.ts:7-24).

## Custom protocol and CSP

The UI is served over a custom `app://` protocol registered before app ready with `secure: true` privileges and handled by `protocol.handle("app")` with a strict CSP: `script-src 'self' app:` (no unsafe-inline), restricted `connect-src`, and `object-src 'none'` / `base-uri 'none'` / `frame-ancestors 'none'` (src/main/protocol.ts:11-25, 154-170). HTML previews use a separate, more permissive CSP but still block plugins and forms (`object-src 'none'`, `form-action 'none'`), are size-capped (1 MiB document, 20 MiB assets), expire after 30 minutes, and are capped at 64 entries (src/main/protocol.ts:27-43).

## IPC trust and navigation policy

Every desktop IPC handler verifies the sender is the live main frame of the main window (`isTrustedDesktopIpcSender` compares `event.sender`/`event.senderFrame` against the window's webContents/mainFrame) (src/main/ipc-trust.ts:13-19). Browser IPC handlers additionally go through `requireTrustedBrowser` (src/main/ipc.ts:105-111).

Main-window navigation is restricted by `isAllowedMainNavigation`: only `app:` URLs, plus dev-server `http://localhost:5173`/`127.0.0.1:5173` in development, are allowed; anything else is prevented and http(s)/mailto links are handed to the OS browser instead. `setWindowOpenHandler` denies all window.open calls, delegating http(s)/mailto to `shell.openExternal` (src/main/window-navigation-policy.ts:1-9; src/main/window.ts:78-97). Developer view roles (reload/devtools) exist only when `!app.isPackaged` (src/main/menu-policy.ts:3-4).

## Browser-view isolation

Remote web pages never run inside the Renderer. Browser tabs are Main-owned `WebContentsView` instances with `sandbox: true`, `contextIsolation: true`, no Node integration, no webview tag, and no preload; programmatic CDP is enabled only for screenshots, uploads, and allowlisted advanced commands, and no remote view receives a DevTools menu or bridge (src/main/browser/browser-tab-manager.ts:2312-2336). Advanced mode can relax `webSecurity` only for `unsafe`-mode profiles with the advanced runtime policy enabled (src/main/browser/browser-tab-manager.ts:2317-2326).

## Agent-side boundaries

- File access is rooted in session cwds/project roots; paths outside allowed roots are rejected unless the requesting session references the file (src/agent-host/file-access.ts:43-60; src/agent-host/file-watch.ts:19-24).
- Browser tool calls are gated per session by capability leases and policy revisions, with read/interact/advanced tiers and per-turn call budgets (src/agent-host/browser-tools.ts:92-114; src/agent-host/browser-agent-runtime.ts:135-149).
- Managed processes enforce command allow/blocklists, workspace-contained cwds, rate limits, and identity-verified reaping — explicitly lifecycle containment, not a sandbox (src/shared/managed-process-policy.ts:29-66; src/main/managed-process/capability.ts:12-53).
- Channel errors, logs, and tool arguments are redacted before leaving their subsystem (src/agent-host/channels/redaction.ts; src/shared/managed-process-policy.ts:165-177; src/agent-host/managed-process/session-redaction.ts).
- The update client uses only the packaged GitHub release configuration and never accepts Renderer-supplied update URLs or credentials (README prose, corroborated by src/main/update-adapter.ts:88-109 which wraps electron-updater with production-only configuration).

## CI-enforced invariants

`scripts/check-desktop-security.mjs` (733 lines) asserts source-level invariants and runs inside `npm run verify`. Notable checks include: BrowserWindow `sandbox: true`, `contextIsolation: true`, and `nodeIntegration: false` must remain; the renderer CSP must not allow `unsafe-inline` in `script-src`; HTML previews must remain sandboxed with plugins/forms blocked; diagnostics export must redact bounded logs and exclude raw crash memory; managed downloads must use Electron networking with synchronous redirect checks; desktop grep/find must use injected bundled rg/fd descriptors without upstream dynamic downloads; the Linux AppImage desktop entry must not disable the Chromium sandbox and the packaged `chrome-sandbox` must be root-owned setuid (scripts/check-desktop-security.mjs:321-402; scripts/verify-packaged-toolchains.mjs:517-530).

Update-related invariants require quit and update cleanup to share a hard deadline, and the packaged Windows gate to fault-inject cleanup uncertainty, retain the reaper journal, and never launch the installer on unconfirmed cleanup (scripts/check-desktop-security.mjs:296-320).

## Data protection

Credentials (channel tokens, browser secrets) are encrypted at rest with Electron `safeStorage` and written atomically with `0600` modes; both vaults refuse to persist when OS encryption is unavailable (src/main/credential-vault.ts:46-50; src/main/browser/browser-secret-vault.ts:35-40). Logs are sanitized and rotated; diagnostics export is redacted and excludes crash memory (src/main/logger.ts:23-30; src/main/diagnostics.ts:52-54).

## What is not guaranteed

Private-network protection in the embedded browser is explicitly best-effort; Strict isolation fails closed when no enforcing network sandbox exists (src/main/browser/browser-network-policy.ts:96-118; README prose). Managed processes are not a security boundary against the processes they start. These limits are documented rather than hidden.
