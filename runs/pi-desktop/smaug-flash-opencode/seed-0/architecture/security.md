---
type: architecture
title: Security & Trust Boundaries
description: The security invariants that shape the desktop — a sandboxed renderer behind preload policies, IPC sender validation, safeStorage-backed credential vaults, toolchain download integrity, browser isolation, and secret redaction.
tags: [architecture, security, trust-boundaries, redaction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-0cbbd7f7984c9c7544030573
    resource: repo://src/agent-host/channels/redaction.ts
  - id: openwiki-source-44f960f8e719b9bbff35695c
    resource: repo://src/main/browser/browser-redaction.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-a8c37ae25e6ba3e4e8557ccd
    resource: repo://src/main/diagnostics-redaction.ts
  - id: openwiki-source-d481412a7917f2959e804ba1
    resource: repo://src/main/ipc-trust.ts
  - id: openwiki-source-81d6b731631ad3bc41db3616
    resource: repo://src/main/toolchains/downloader.ts
  - id: openwiki-source-41b523288256cc10e48366da
    resource: repo://src/main/toolchains/installer.ts
  - id: openwiki-source-910e879cd3b0e278b2b0eccd
    resource: repo://src/preload/preload-location-policy.ts
  - id: openwiki-source-d6e406a0fb0c67f1b3305128
    resource: repo://src/preload/preload-message-policy.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Security & Trust Boundaries

Pi Agent Desktop treats the renderer as untrusted and keeps security-relevant
policy enforced in the main process, with the Agent Host bridged narrowly.
This page captures the boundaries; concrete checking is codified in
`scripts/check-desktop-security.mjs`.

## Renderer sandbox and preload policies

The renderer runs with `sandbox` + `contextIsolation` and only exposes the
minimal `piBridge` (see [Architecture & Process Model](/openwiki/architecture/process-model.md)).
`src/preload/preload-location-policy.ts` gates whether the preload forwards
events at all: it only trusts `app://bundle` in production or a Vite dev server
at `http://localhost:5173` / `127.0.0.1:5173`. `src/preload/preload-message-policy.ts`
validates transferred port shape (`selectTransferredHostPort` requires
`postMessage`/`start`/`close` on exactly one port) and deep-link session ids
(strict UUID regex), so the preload never forwards an unexpected handle or a
non-UUID-session payload.

`scripts/check-desktop-security.mjs` is a compile-time gate run by
`verify.mjs` (inside the `check:desktop-security` step). It asserts string
invariants across the source: the renderer is sandboxed/context-isolated,
window creation enables the right security switches, the app protocol and
navigation policy are restrictive, redaction functions are present where
expected, and credentials are only ever persisted via the vault helpers.

## IPC sender trust

`src/main/ipc-trust.ts` (`isTrustedDesktopIpcSender`) is the single check that
main-process IPC handlers apply before acting on a renderer message: the sender
must be the main `BrowserWindow`'s `webContents`, and the sender frame must be
the main frame — not an iframe or a different window. This prevents a compromised
or nested frame from invoking privileged menu/dialog/toolchain actions.

A related boundary is that toolchain execution is only ever allowed from the
app-owned Host. `ExecutionContextRequest` carries a `trusted` flag that main
accepts only from the Host RPC path (see
[Toolchains & Developer Tools](/openwiki/architecture/toolchains.md)), never
from a Renderer-initiated request.

## Credential storage

### Desktop channel vault

`src/main/credential-vault.ts` persists channel credentials in a JSON file
(`channels.secrets.json`) under the user-data directory restricted to `0o600`.
Every entry is stored as a base64 blob produced by
`safeStorage.encryptString`, and reads/writes refuse to proceed unless
`safeStorage.isEncryptionAvailable()` (line `assertAvailable`). Keys are
strictly validated against `channel:(weixin|telegram|feishu):…`. Writes use a
temp-file + rename to stay crash-safe. The vault never returns plaintext peers
except to the Host's owned `channelSecrets.get/set/delete` requests.

### Browser header secrets

`BrowserSecretVault` (`browser-secret-vault.ts`) stores encrypted header
values in `browser-secrets.json` under the same safeStorage codec
(`encrypt`/`decrypt`). Values are referenced
by opaque `browser-secret-<uuid>` refs so the renderer and logs never carry the
plaintext, and the vault refuses values over 64 KB or containing NUL.

## Secret redaction

- **Channel**: `src/agent-host/channels/redaction.ts` exposes
  `fingerprintSecret` (only the last 4 characters), `redactChannelValue`
  (recursively redacts `token`/`secret`/`authorization`/`qr*`/
  `verification_*` keys), and `redactChannelText` (redacts bearer tokens,
  `token=`/`secret=`/`qrcode=` query items, Telegram bot tokens, and JSON
  credential fields). `safeChannelError` routes every surfaced channel error
  through redaction, capped at 500 chars.
- **Browser**: `src/main/browser/browser-redaction.ts` redacts URLs (username,
  password, sensitive query keys, and the hash) and text (bearer/api-key/pass
  patterns) before snippets or console content are shown to the agent.
- **Diagnostics**: `src/main/diagnostics-redaction.ts` substitutes userData,
  logs, and home directories with `<userData>`/`<logs>`/`$HOME`/`%USERPROFILE%`
  and redacts `authorization:` / `proxy-authorization:` headers.

## Toolchain download integrity

Managed toolchain installs never trust the network blind. `src/main/toolchains/downloader.ts`
(`verifyDownloadedArtifact`) hashes each downloaded artifact with SHA-256 and
compares it field-for-field against the signed `RuntimeCatalogVariant`, and
`assertRuntimeRedirectUrl` only permits HTTPS redirects to a fixed allow-list
of artifact hostnames. `src/main/toolchains/installer.ts` runs this verification
before extraction for both fresh and `--continue`-style partial downloads. The
catalog itself (a signed resource bundled with the app, plus the core catalog)
is the source of the `sha256` and `downloadBytes` that installs must match; the
security checker also verifies packaged toolchain extraction (renamed/sealed)
and that the catalog schema requires a `sha256` for every archive.

## Browser isolation

The built-in browser surface (see [Built-in Browser Service](/openwiki/architecture/browser-service.md))
enforces the permission/lease model in the main process. `check-desktop-security.mjs`
further pins the Windows managed-process helper to a fixed verified path, static
CRT, a protected-DACL kill-on-close Job, no network surface in the helper, and a
bounded reparse-aware journal so containment cannot be bypassed through the
helper binary.
