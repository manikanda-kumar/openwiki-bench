---
type: "Reference"
title: "Security Model"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-20b834548e65731a6b2db637
    resource: repo://src/agent-host/managed-process/session-redaction.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-a8c37ae25e6ba3e4e8557ccd
    resource: repo://src/main/diagnostics-redaction.ts
  - id: openwiki-source-d481412a7917f2959e804ba1
    resource: repo://src/main/ipc-trust.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-650ce447b08aa5092ed0ec70
    resource: repo://src/main/protocol.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-910e879cd3b0e278b2b0eccd
    resource: repo://src/preload/preload-location-policy.ts
  - id: openwiki-source-3e3ed0024f143ea91aebc38a
    resource: repo://src/shared/managed-process-policy.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---


# Security Model

Pi Agent Desktop is built around a strict process and trust boundary: the sandboxed renderer can only reach the Agent Host through the typed RPC surface, Electron Main validates every trusted request, and remote web content never gets app preload, Node, or the renderer bridge. The security posture is statically enforced by `scripts/check-desktop-security.mjs`, which runs in `npm run verify`.

## Renderer hardening

- The main window is created with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true` (`src/main/window.ts:48-54`).
- The renderer is served over the privileged `app://` protocol with a strict Content Security Policy: `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, and `script-src` with **no** `unsafe-inline` (`src/main/protocol.ts:11-25`). The renderer HTML contains no inline scripts (`src/renderer/index.html`).
- The preload exposes only the `piBridge` surface via `contextBridge` (`src/preload/preload.ts:187`), and the bridge contract lives in `src/contract/desktop.ts`.

## Preload policies

- `isTrustedPreloadLocation` only enables the host-port and menu relay when the preload URL is `app://bundle` or the dev server at `http://localhost:5173` (`src/preload/preload-location-policy.ts:1-11`).
- `selectTransferredHostPort` accepts a transferred port only if it looks like a real MessagePort, and deep-link session messages must match a UUID shape (`src/preload/preload-message-policy.ts:7-24`).

## IPC trust checks

- Every desktop IPC handler in `src/main/ipc.ts` goes through `assertTrustedSender`, which requires `event.sender === window.webContents` and `event.senderFrame === window.webContents.mainFrame` (`src/main/ipc-trust.ts:13-19`, `src/main/ipc.ts:83-104`).
- The toolchain bridge validates senders, actions (`isToolchainActionRequest`), and workspaces, and keeps download/destructive consent dialogs in Main (`src/main/ipc.ts`, enforced by `check-desktop-security.mjs`).

## Host request trust boundary

Requests the Host makes to Main (`channelSecrets.*`, `toolchain.*`, `managedProcesses.*`, `browser.*`) are dispatched only after Main-side validation:

- `toolchain.resolve` requires an absolute bounded `cwd`, a known `ExecutionIntent`, and an explicit `trusted` boolean (`src/main/main.ts:594-607`). Project-local tool trust comes only from the app-owned Host — the renderer bridge has no `trustedProject`/`projectTrusted` field (`check-desktop-security.mjs:517-523`).
- Windows `managedProcesses.register` rejects an owner generation mismatch (`src/main/main.ts:618-633`).

## Encrypted credential vaults

- Channel credentials are stored through `CredentialVault`, which uses Electron `safeStorage` (OS credential encryption) and fails closed when encryption is unavailable. Keys are validated against `^channel:(weixin|telegram|feishu):...`, and the vault file is written atomically with mode `0600` (`src/main/credential-vault.ts:10-76`).
- Browser secrets use `BrowserSecretVault` with an injectable codec (default `safeStorage`), opaque `browser-secret-*` references, a bounded 2 MiB file, atomic writes, and `0600` permissions; a missing or corrupt vault fails closed (`src/main/browser/browser-secret-vault.ts:20-111`).
- The renderer bridge for channel credentials is **write-only** (`desktopContract.setChannelCredential` exists, `getChannelCredential` does not), and the RPC contract never carries raw `botToken`/`appSecret` (`check-desktop-security.mjs:482-488`).

## Secret redaction

- Diagnostic export redacts machine paths, authorization/proxy headers, `NODE_AUTH_TOKEN`-style env values, token/secret assignments, npm/GitHub token patterns, and credential-bearing URLs; the toolchain summary drops executable paths (`src/main/diagnostics-redaction.ts:12-105`).
- Managed-process tool calls and results are redacted before they are persisted into the session JSONL (commands, cwd, stdin, and readiness text are replaced; result bodies are omitted with an explanatory marker) (`src/agent-host/managed-process/session-redaction.ts:34-99`).
- Managed-process log text is scrubbed of ANSI escapes, URL credentials, authorization/cookie headers, secret CLI arguments, common token formats, and `PI_DESKTOP_*` nonces (`src/shared/managed-process-policy.ts:165-177`).
- Updater errors are redacted before logging (paths, bearer/basic tokens, GitHub tokens, auth query params, emails) (`src/main/update-manager.ts:81-109`).

## Protocol serving and HTML previews

- The `app` scheme is registered as privileged (standard, secure, fetch, CORS, stream) and the handler enforces path containment under the renderer root (`src/main/protocol.ts:154-251`).
- HTML previews are served under `app://preview/<token>/...` with a separate, much narrower CSP (`default-src 'none'`, `object-src 'none'`, `form-action 'none'`), a 30-minute TTL, a 64-entry cap, and 1 MiB content limit. Preview assets are confined to the preview's own directory and capped at 20 MiB (`src/main/protocol.ts:27-43`, `protocol.ts:81-134`). The renderer displays previews in a sandboxed iframe (`check-desktop-security.mjs:347`).

## Remote browser isolation

- Browser tabs are `WebContentsView` instances with `sandbox: true`, `contextIsolation: true`, no Node integration, no `webviewTag`, and no preload bridge (`check-desktop-security.mjs:579-587`).
- Browser sessions install permission request/check handlers and deny device permissions by default (`check-desktop-security.mjs:589-593`). Private-network protection is **best-effort** unless a controlled network sandbox is deployed — in `strict` mode requests to private networks are denied (see [Builtin Browser](../systems/builtin-browser.md)).
- Production code must not enable `remote-debugging-port`, global `ignore-certificate-errors`, or `webSecurity: false`; the only DevTools entry is a F12 shortcut (`check-desktop-security.mjs:655-663`). Certificate errors are handled per hostname by `BrowserService.handleCertificateError` (`src/main/main.ts:809-819`).
- Agent browser automation and the advanced browser mode both default to disabled, and renderer IPC cannot mint arbitrary runtime grants (`check-desktop-security.mjs:595-616`).

## Updater trust

- The production update adapter uses the packaged app's fixed GitHub release configuration, with `autoDownload`, `autoInstallOnAppQuit`, `allowPrerelease`, and `allowDowngrade` all false, `disableWebInstaller` true, and no environment-driven feed (`check-desktop-security.mjs:546-557`). The renderer updater contract exposes only fixed actions and cannot configure a feed (`check-desktop-security.mjs:525-544`).

## Static enforcement

`check-desktop-security.mjs` asserts roughly one hundred invariants covering the areas above — sandbox flags, CSP, no remote debugging, credential vault behavior, channel transport (no local listeners), bounded media staging, browser tool preflight order, hashed denied-target state, and sealed replay memory — and fails `npm run verify` on any regression (`scripts/check-desktop-security.mjs:118-725`, `scripts/verify.mjs:37`).

## Related pages

- [Three-Process Architecture](./three-process-architecture.md)
- [RPC and Contract Layer](./rpc-and-contracts.md)
- [Builtin Browser](../systems/builtin-browser.md)
- [Managed Background Processes](../systems/managed-processes.md)
