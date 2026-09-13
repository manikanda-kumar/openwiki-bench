---
type: concept
title: Data, Persistence, and Diagnostics
description: Where all persistent state lives (~/.pi/agent and Electron userData), file formats and owners, atomic-write patterns, credential handling, logs, diagnostics export, and session file layout.
tags: [operations, persistence, data, secrets, diagnostics]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-0c5ad2ceefae629223df3182
    resource: repo://src/agent-host/channels/config-store.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-b756a250bef1687434bf56f4
    resource: repo://src/agent-host/session-index.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-4409b8bcec1076bcf5e8ef33
    resource: repo://src/main/diagnostics.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-4d903eaf7a3b75c622fde541
    resource: repo://src/main/logger.ts
  - id: openwiki-source-e8a73aae9225973c81043759
    resource: repo://src/main/toolchains/paths.ts
  - id: openwiki-source-7cff10ac56e3e7919e9999fd
    resource: repo://src/main/toolchains/state-store.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Data, Persistence, and Diagnostics

Pi Agent Desktop splits persistent state between **Pi's agent directory** (shared with the Pi CLI) and the **Electron `userData` directory** (desktop-owned state). All secrets are encrypted at rest; most stores write atomically.

## The Pi agent directory (`~/.pi/agent/`)

Owned by Pi (`@earendil-works/pi-coding-agent`'s `getAgentDir`) and shared with the Pi CLI (`src/agent-host/session-reader.ts:20`):

| File/dir | Content | Owner |
| --- | --- | --- |
| `sessions/*.jsonl` | Session transcripts (header + entry JSONL) | Pi `SessionManager`; indexed by the Host's `SessionIndex` (`session-index.ts:84`) |
| `models.json` | Provider/model config, optimistic-concurrency + atomic writes | Host `handlers.ts` (`writeModelsJson`) |
| `models.json.bak` | Previous good models config | Host |
| `pi-desktop-plugin-filters.json` | Disabled-plugin resource backups | Host `plugins-service.ts` |
| `pi-desktop-session-tools.json` | Desktop-owned per-session tool names (kept outside Pi's JSONL so the CLI is unaffected) | Host `session-tool-store.ts` (`<PI_DESKTOP_USER_DATA>/session-tools.json`) |
| `sessions/...` (recursive `fs.watch`) | Drives `sessions.changed` events | Host `session-watcher.ts` |

## Electron `userData`

Desktop-owned state, all under `app.getPath("userData")`:

| File | Content | Owner |
| --- | --- | --- |
| `ui-state.json` | Window bounds, theme, recentCwds, backgroundMode, managedProcessesEnabled, automaticUpdateChecks, chatAppearance | Main `window-state.ts` |
| `channels.secrets.json` | Encrypted channel credentials (safeStorage) | Main `CredentialVault` |
| `channels.json` / `channels.state.json` | Channel accounts/bindings and runtime state | Host `config-store.ts` / `state-store.ts` (located under `PI_DESKTOP_USER_DATA`) |
| `channel-media/` | Staged inbound media (hashed account/envelope dirs, 24 h TTL) | Host `media-store.ts` |
| `toolchains/` | Toolchain state, downloads, staging, runtimes, caches, prefixes, shims, logs, locks | Main `ToolchainManager` (`paths.ts`) |
| `managed-process-reaper/journal-v2.json` | Crash-reaper records (POSIX pgid+ fingerprint / Windows job+helper identity) | Main `reaper.ts` |
| `browser-settings.json` | Browser settings (persisted `BrowserSettingsV2`) | Main `browser-settings-store.ts` |
| `browser-session-grants.json` | Persistent per-session browser permissions | Main `browser-persistent-grant-store.ts` |
| `browser-profiles.json` | Persistent browser profiles | Main `browser-profile-manager.ts` |
| `browser-tabs.json` | Tab restoration records | Main `browser-tab-restore-store.ts` |
| `browser-header-rules.json` | URL-matched header rules | Main `browser-header-rule-store.ts` |
| `browser-secrets.json` | Encrypted browser header secrets (safeStorage) | Main `browser-secret-vault.ts` |
| `browser-page-snippets.json` | Saved JavaScript experiences | Main `browser-snippet-store.ts` |
| `browser-network-bodies/` | Captured network response bodies (0o600, cleared when capture stops) | Main `browser-network-recorder.ts` |
| `packaged-startup-check.json` / `packaged-cleanup-fault-check.json` | Packaged validation reports | Main `main.ts` |
| `logs/main.log` | Main process rotating log | Main `logger.ts` |

Where the Host resolves paths: `channel-manager.ts:61` uses `PI_DESKTOP_USER_DATA` (injected by Main) else `~/.pi/desktop`; `session-tool-store.ts:100` likewise. Main injects `PI_DESKTOP_USER_DATA = app.getPath("userData")` at Host spawn (`host-manager.ts:227`).

## Atomic-write patterns

Stores consistently use temp-file + rename (with `0o600`), and move corrupt files aside instead of reusing them:

- `models.json`: temp + rename with optimistic concurrency; `.bak` keeps the previous good file (`handlers.ts:249`).
- Channels config/state: `atomicWrite` (temp + rename + chmod 0o600); corrupt `channels.state.json` is renamed to `*.corrupt-*` (`config-store.ts:13`, `state-store.ts:60`).
- Credential vault, browser secret vault, toolchain state store, window state, session-tool store: temp + rename, mode `0o600`.
- The toolchain state store additionally maintains `state.json.bak` and enters a **compatibility read-only mode** when the file was written by a newer Pi Desktop (`state-store.ts:150`).

## Credential handling

- **Channel credentials**: `CredentialVault` encrypts values with Electron `safeStorage` (OS keychain) into `channels.secrets.json`, validates the `channel:(weixin|telegram|feishu):<id>` key shape, and refuses persistence when encryption is unavailable (`credential-vault.ts:46`). The Host never stores secrets; it reads them through `channelSecrets.*` parent-RPC, and the UI sees only a fingerprint (`••••last4`).
- **Browser secrets**: `BrowserSecretVault` encrypts header values with `safeStorage` into `browser-secrets.json` (2 MiB cap, atomic), returns opaque `browser-secret-<uuid>` refs, and fails closed when unavailable (`browser-secret-vault.ts:35`).
- **Redaction**: channel text/errors are redacted (`redaction.ts`), managed-process output sanitizes tokens/URLs (`managed-process-policy.ts`), and updater errors are redacted (`update-manager.ts` `redactUpdateError`). Diagnostics export redacts paths and credentials (`diagnostics-redaction.ts`).

## Session file layout

A session is a `*.jsonl` file under the sessions root: a header entry (`type: "session"`, id, cwd, parentSession) followed by message/compaction/branch_summary/model_change/thinking_level_change/custom entries (`src/shared/types.ts`). The Host's `SessionIndex` fingerprints files (size/mtime/ctime/ino) and caches parsed `SessionInfo`; the UI reads history through paged cursors rather than parsing the raw file (`session-history.ts`).

## Logs

- Main writes a rotating `main.log` under `app.getPath("logs")` (5 MiB × 3 generations, async, 512 KiB queue, sanitized lines) (`logger.ts:8`). In dev it also mirrors to stdout.
- Host stdout/stderr are captured into Main's log with `[host:out]`/`[host:err]` prefixes (`host-manager.ts:244`); the Host posts `{type:"log"}` messages for structured host logs.
- Renderer console messages at warning+ are appended to the main log (`window.ts:158`).

## Diagnostics export

`exportDiagnostics` (`diagnostics.ts:19`) writes an explicitly user-selected folder containing:

- `system.json` (versions, platform; paths redacted).
- `toolchains.json` and `browser.json` (redacted summaries).
- Redacted copies of `main.log` and every `*.log` in the logs dir (≤ 5 MiB each, path/credential redaction via `diagnostics-redaction.ts`).
- `crash-dumps.json` — **metadata only** (name/size/mtime) because raw minidumps can contain credentials and must be shared only after user review.

## Compatibility/read-only modes

Two stores enter read-only compatibility mode when a newer Pi Desktop wrote them: the browser settings store (`browser-settings-store.ts`) and the toolchain state store (`state-store.ts`). Both refuse writes to a newer-schema file so a downgrade cannot corrupt forward-compatible state.
