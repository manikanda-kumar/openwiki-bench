---
type: security
title: Security and Trust Model
description: The defense-in-depth posture of Pi Agent Desktop — sandboxed renderer with CSP, preload and IPC trust checks, file-path allowlists, OS-encrypted credential vaults, redaction points, and the browser/managed-process boundaries.
tags: [security, trust, sandbox, csp, redaction, credentials, allowlist]
---

# Security and Trust Model

Pi Agent Desktop applies defense in depth across every process boundary. The invariants below are enforced in code and, for many, re-checked statically by `scripts/check-desktop-security.mjs` (run by `npm run check:desktop-security`, part of `verify`). Where the repository does not establish a guarantee, that is stated explicitly.

## Renderer and window hardening

The main window is created with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and `webSecurity: true` (`src/main/window.ts:48-54`). The renderer HTML is served over the `app://` protocol with a strict Content Security Policy: `default-src 'self' app:`, no `unsafe-inline` scripts, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` (`src/main/protocol.ts:11-25`). `check-desktop-security.mjs` asserts these flags and that the renderer HTML has no inline `<script>` (`scripts/check-desktop-security.mjs:321-323,346-347,437`).

Two additional controls confine the window:

- **Navigation policy**: `isAllowedMainNavigation` permits only `app:` URLs and, in dev only, `localhost:5173`; anything else is blocked and `https?` targets are pushed to the external browser instead (`src/main/window-navigation-policy.ts:1-10`, `src/main/window.ts:83-97`). `setWindowOpenHandler` denies every new window and routes `http(s)`/`mailto` to `shell.openExternal` (`src/main/window.ts:78-81`).
- **HTML previews**: `app://preview/<token>/index.html` is served with its own locked-down CSP (`default-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`) and preview content is size- and count-bounded with a 30-minute TTL (`src/main/protocol.ts:27-43,40-42`). FileViewer renders previews in an `allow-scripts` sandboxed iframe (`scripts/check-desktop-security.mjs:347`).

## Preload and IPC trust

The renderer gets exactly one bridge object, `piBridge` (`src/preload/preload.ts:187`), typed by the shared `PiBridge` contract (`src/contract/desktop.ts:131-226`). The preload installs it only for trusted locations — `app://bundle` or the `localhost:5173` dev server (`src/preload/preload-location-policy.ts:1-11`) — and validates the transferred Host port shape and deep-link session ids before use (`src/preload/preload-message-policy.ts:7-24`).

Every desktop IPC registration wraps the handler in `assertTrustedSender`, which requires the sender's `webContents` to be the main window's and the `senderFrame` to be its `mainFrame` — subframes and other `WebContents` are rejected (`src/main/ipc-trust.ts:13-19`, `src/main/ipc.ts:83-124`). This is what prevents remote web content in the built-in Browser from reaching desktop capabilities.

## File-path allowlists

Host file operations (`files.*`, `worktrees.*`, `git.status`) go through `assertPathAllowed`, which throws `RpcError` `FORBIDDEN` unless the target is inside an allowed root — or is a file referenced by the calling session (`src/agent-host/handlers.ts:203-208`). Allowed roots are derived from session `cwd`s, their project roots, the `~/pi-cwd-*` default directories, plus `allowFileRoot` registrations made when a project is validated/selected (`src/agent-host/file-access.ts:43-65`). The root set is cached with a watcher-aware TTL (10 minutes when the session watcher invalidates on mutation, 5 seconds as fallback) and protected by a generation counter so a stale async scan cannot republish old roots (`src/shared/allowed-roots.ts:26-70`).

## Credential vaults

- **Channel credentials** (`src/main/credential-vault.ts`): stored encrypted with Electron `safeStorage` (`safeStorage.encryptString`/`decryptString`), persisted atomically with `0600` mode, keyed by a strict `channel:(weixin|telegram|feishu):<account>` pattern, and **fails closed** when `safeStorage.isEncryptionAvailable()` is false (`credential-vault.ts:10-15,46-68`). The check script requires `safeStorage` usage and fail-closed persistence (`scripts/check-desktop-security.mjs:440-441`).
- **Browser secrets** (`src/main/browser/browser-secret-vault.ts`): header-rule secrets encrypted with the same `safeStorage` codec, referenced by `browser-secret-<uuid>` tokens, bounded to 64 KiB per value and a 2 MB vault file, and failing closed on corrupt/unavailable loads (`browser-secret-vault.ts:35-47,72-89`).

## Redaction points

- **Diagnostics export**: replaces home/userData/logs paths with placeholders, redacts `authorization` headers, npm/GitHub tokens, API keys, and credential-bearing URLs, and exports only crash *metadata* — raw minidumps are excluded because they can contain process memory and credentials (`src/main/diagnostics-redaction.ts:12-61`, `src/main/diagnostics.ts:73-76`).
- **Channel errors**: `redactChannelValue`/`redactChannelText` redact tokens, secrets, QR content, bot tokens, device/user codes, and verification URLs; `safeChannelError` caps to 500 chars (`src/agent-host/channels/redaction.ts:10-46`).
- **Updater errors**: `redactUpdateError` strips home paths, Bearer/Basic auth, GitHub tokens, emails, and cache paths (`src/main/update-manager.ts:81-109`).
- **Browser**: `redactBrowserUrl` removes URL userinfo, redacts sensitive query keys (token, password, auth, code, key, secret, session, state, ...), and strips hashes; `redactBrowserText` applies it to URLs and secret-looking key/value text (`src/main/browser/browser-redaction.ts:1-27`).
- **Toolchains**: public state exposes path-free labels, and diagnostic summaries omit paths (`src/main/diagnostics-redaction.ts:63-105`).

## Browser and managed-process boundaries

- **Browser**: remote pages load only in Main-owned sandboxed `WebContentsView` sessions without the app preload, Node.js, or the main Renderer bridge. Agent browsing is gated by the capability snapshot, session grants/leases, and policy revision checks before any target-tool side effect; agent tools neither accept nor return cookie values. Full detail is in [Built-in Browser and Agent Browsing](/openwiki/systems/browser.md). Proxy credentials are supplied only through the Electron `login` event for the matching `WebContents` (`src/main/main.ts:299-304`).
- **Managed processes**: the capability gate (platform, reaper readiness, Windows helper integrity, Host owner identity) fails closed when any prerequisite is missing. The README and code are explicit that managed-process support is **lifecycle control, not a security sandbox**: child processes retain the same local file/network/environment access as Agent Bash (`src/main/managed-process/capability.ts`, `src/shared/windows-managed-process-helper.ts`). Windows containment relies on an integrity-verified Rust helper with a pinned path, SHA-256 manifest, and protected Job Objects.
- **Toolchain trust**: renderer toolchain actions are validated against `ToolchainActionRequest`, destructive actions (`install`, `repair`, `remove`, `clear-cache`) require a Main-process confirmation dialog, and the renderer may never supply URLs, paths, or executables (`scripts/check-toolchain-contract.mjs:23-53`). Managed downloads use pinned checksums from signed catalogs; execution resolution is trusted only when requested by the app-owned Host (`src/main/main.ts:594-606`).

## Invariants enforced by check-desktop-security

The `check:desktop-security` gate statically re-verifies the posture above and more — e.g. no channel transport opens a local listener (WeChat/Telegram/Feishu are outbound-only), channel media staging enforces byte/count/symlink controls, the Windows helper's Win32 surface is pinned, update installs fail closed on cleanup uncertainty, and packaged release gates retain the pinned checksum/upstream verification steps (`scripts/check-desktop-security.mjs:126-522`).

## Known limitations (stated by the repo)

- Private-network protection in the browser is labeled **best-effort**; Strict mode is documented to fail closed only until an enforcing network sandbox is deployed.
- The Linux AppImage relies on the sandboxed `chrome-sandbox` binary being setuid root (`chown root:root` + `chmod 4755` in CI); on systems where that is not configured, Chromium's sandbox guarantees are reduced.
- Windows installers are currently unsigned (`Unsigned Beta`), which the release workflow deliberately enforces and documents rather than relabeling as stable.

## Related pages

- [IPC and Type Contracts](/openwiki/architecture/ipc-and-contracts.md)
- [Architecture Overview](/openwiki/architecture/overview.md)
- [Built-in Browser and Agent Browsing](/openwiki/systems/browser.md)
- [Managed Background Processes](/openwiki/systems/managed-processes.md)
- [Software Updates](/openwiki/operations/updates.md)