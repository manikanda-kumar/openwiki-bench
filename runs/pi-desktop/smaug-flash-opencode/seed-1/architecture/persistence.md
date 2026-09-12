---
type: reference
title: Persistence and State Surface
description: Catalog where Pi Agent Desktop stores state — sessions and models in ~/.pi/agent, app-owned state in Electron userData, credential vaults, toolchain state, browser stores, reaper journal, and logs — and the write/versioning/failure conventions.
tags: [persistence, state, storage, userData, credentials]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-6e57d26818244fcb9df46c1b
    resource: repo://src/main/managed-process/reaper-journal.ts
  - id: openwiki-source-c1f94a7b98c130c6b4883c8f
    resource: repo://src/main/managed-process/reaper.ts
  - id: openwiki-source-7cff10ac56e3e7919e9999fd
    resource: repo://src/main/toolchains/state-store.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Persistence and State Surface

This page catalogs where Pi Agent Desktop stores state, who owns each piece, the write conventions used, and behavior when files are corrupt or encryption is unavailable. The surface splits into two roots:

- **`~/.pi/agent/`** — the Pi agent directory, shared with the Pi CLI.
- **Electron `userData`** (`app.getPath("userData")`) — app-owned state.

## `~/.pi/agent/`

Owned by the Agent Host via `@earendil-works/pi-coding-agent`.

| Path | Contents | Owner |
| ---- | -------- | ----- |
| `sessions/` | Pi session files (JSONL), the canonical transcript store | `pi-coding-agent` `SessionManager`, indexed/read by `session-reader.ts`/`session-index.ts` |
| `models.json` | Provider/model catalog for the model runtime | `handlers.ts` `writeModelsJson` (`getModelsPath`) |

`models.json` writes are conflict-checked against a sha256 content version and
committed via temp+rename, keeping `models.json.bak` (see Configuration page).

## Electron `userData`

These are the app-owned persisted files, each written by its Owner with an
atomic-write convention where noted.

| File | Contents | Owner | Write pattern / notes |
| ---- | -------- | ----- | ----- |
| `ui-state.json` | window bounds, sidebar width, theme, recent cwds, background mode, auto-update flag | `window-state.ts` | plain JSON; `loadUiState` tolerates missing/corrupt by returning `{}` |
| `channels.secrets.json` | channel (Weixin/Telegram/Feishu) credentials | `CredentialVault` (`credential-vault.ts`) | `safeStorage`-encrypted, temp+rename, mode `0o600`; refuses to operate when encryption unavailable |
| `logs/main.log` | rotating main-process log | `logger.ts`/`logger-core.ts` | async rotating file logger (see Logging page) |
| `browser-settings.json` | browser policy settings | `browser-settings-store.ts` | atomic write |
| `browser-session-grants.json` | persistent per-session browser permissions | `browser-persistent-grant-store.ts` | atomic write |
| `browser-secrets.json` | advanced-mode secrets (proxy creds, header-rule secrets) | `BrowserSecretVault` (`browser-secret-vault.ts`) | `safeStorage`-encrypted, `0o600` |
| `browser-tabs.json` | tab restore records | `browser-tab-restore-store.ts` | debounced write |
| `browser-header-rules.json` | local request/response header rules | `browser-header-rule-store.ts` | atomic write |
| `browser-page-snippets.json` | remembered page JavaScript snippets | `browser-snippet-store.ts` | atomic write |
| `browser-network-bodies/` | captured network request bodies | `browser-network-recorder` via `browser-service.ts` | transient capture area |
| `managed-process-reaper/journal-v2.json` | managed-process crash-recovery records | `ManagedProcessReaper` (`reaper.ts`/`reaper-journal.ts`) | v2 journal, temp+rename `0o600`, strict validation |
| toolchain `state.json` + `state.json.bak` | toolchain preferences/custom tools/managed runtime activations | `ToolchainStateStore` | schema v2, temp+rename, backup; future-schema becomes read-only |
| toolchain caches/`runtimes/`/`bin/` | managed runtimes and caches | `ToolchainManager` | see developer-toolchains page |

## Write conventions

App-owned state files generally follow:

- **Atomic write**: write to a `<file>.<pid>.<timestamp>.tmp` then `renameSync`
  over the target, cleaning the temp on failure. Seen in `credential-vault.ts`,
  `reaper-journal.ts`, `toolchains/state-store.ts`.
- **Permissions**: `mode 0o600` on files and `0o700` on the containing
  directory, with `chmodSync` best-effort on Windows
  (`reaper-journal.ts:213-225`, `toolchains/state-store.ts:156-166`).
- **Backup**: `models.json.bak`, toolchain `state.json.bak`, and the reaper
  journal's strict validation all provide recovery from a half-written file.

## Versioning and conflict detection

- `models.json`: content-version (sha256) checked before write; a stale editor
  raises `CONFLICT` (Configuration page).
- Toolchain state: `schemaVersion: 2`; a file written by a **newer** Pi Desktop
  (future `schemaVersion`) is treated as read-only
  (`toolchains/state-store.ts:202-206`, `:150-166`).
- Reaper journal: hard `version: 2`, max 64 KiB, max 16 records, duplicate
  identity rejection, and (on non-Windows) mode bits must be strict
  (`reaper-journal.ts:140-191`).

## Failure behavior on corruption

- `loadUiState` → returns `{}` (missing or corrupt).
- Toolchain state → tries `state.json` then the backup, then falls back to an
  empty recoverable state; if the file carries a future schema it becomes
  read-only rather than being overwritten (`state-store.ts:131-148`).
- Reaper journal → rejects the journal with `JOURNAL_INVALID` and marks the
  reaper not ready (`reaper.ts:246-251`); the app fails closed on managed
  process containment.
- Credential vault → refuses to read/write when `safeStorage.isEncryptionAvailable()`
  is false (never silently drops credentials) (`credential-vault.ts:46-56`).

## Ownership and cross-process notes

- The Renderer never persists app-owned state directly; all persistence goes
  through Main- or Host-owned files via the typed RPC surface.
- The Agent Host's session file accesses are gated by the allowed-roots policy
  (see Session page).
- Managed-process reaper files and the channel credential vault are owned by
  Main; channel account/binding config (`channels.json`, `channels.state.json`)
  is owned by the Host in its data directory.

## Related pages

- Configuration, Models, and Credentials
- Architecture Overview
- Built-in Browser Service
- Managed Process Crash Recovery (Reaper)
