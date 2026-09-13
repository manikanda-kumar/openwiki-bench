---
type: architecture
title: Data and Persistence
description: Where the desktop app keeps state — ~/.pi/agent sessions and Pi config, app-data stores for toolchains, channels, browser, reaper journal, credentials, UI state, and logs — and the write/retention guarantees each store provides.
tags: [persistence, user-data, atomic-writes, credentials, journal, logs]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-0c5ad2ceefae629223df3182
    resource: repo://src/agent-host/channels/config-store.ts
  - id: openwiki-source-e26f4ff537d17d17f171ae27
    resource: repo://src/agent-host/channels/media-store.test.mjs
  - id: openwiki-source-fd0c084d772701f9985e43c7
    resource: repo://src/agent-host/channels/state-store.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-f4cdbdc0e1108a244c58712b
    resource: repo://src/main/browser/browser-persistent-grant-store.ts
  - id: openwiki-source-a9485bab3420888add71e1f7
    resource: repo://src/main/browser/browser-profile-manager.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-35be2618b88e62f795e3d9bd
    resource: repo://src/main/browser/browser-settings-store.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-4409b8bcec1076bcf5e8ef33
    resource: repo://src/main/diagnostics.ts
  - id: openwiki-source-4d903eaf7a3b75c622fde541
    resource: repo://src/main/logger.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-6e57d26818244fcb9df46c1b
    resource: repo://src/main/managed-process/reaper-journal.ts
  - id: openwiki-source-e2a0fbb35a08f3fba4bc6e42
    resource: repo://src/main/managed-process/reaper.test.mjs
  - id: openwiki-source-650ce447b08aa5092ed0ec70
    resource: repo://src/main/protocol.ts
  - id: openwiki-source-e817e3605c14a9401e326e76
    resource: repo://src/main/toolchains/candidate-normalizer.test.mjs
  - id: openwiki-source-41b523288256cc10e48366da
    resource: repo://src/main/toolchains/installer.ts
  - id: openwiki-source-e8a73aae9225973c81043759
    resource: repo://src/main/toolchains/paths.ts
  - id: openwiki-source-7cff10ac56e3e7919e9999fd
    resource: repo://src/main/toolchains/state-store.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Data and Persistence

State is split between the shared Pi directory (`~/.pi/agent/`) and the Electron `userData` directory. Most app-data stores follow the same pattern: versioned JSON, atomic temp-file + rename writes, `0600` file modes (best-effort `chmod` on Windows), and corruption fallbacks.

## ~/.pi/agent — sessions and Pi configuration

Sessions and Pi configuration belong to the pi-coding-agent runtime, resolved with `getAgentDir()`; the session root defaults to `<agentDir>/sessions` and can be redirected with `PI_CODING_AGENT_SESSION_DIR` (src/agent-host/session-watcher.ts:15-28). The Agent Host creates the directory when missing and watches it for external changes; the session index caches parsed metadata by file fingerprint (src/agent-host/session-index.ts:33-45). Because this directory is shared with the Pi CLI, the desktop app neither owns nor migrates it (README.md, 快速开始).

Channel data is adjacent, not inside the agent dir: `ChannelManager` uses `PI_CODING_AGENT_DIR/desktop` or `~/.pi/desktop` as its base, storing `channels.json` (accounts + bindings), `channels.state.json`, and a `channel-media/` staging directory (src/agent-host/channels/channel-manager.ts:64-65, 153-155).

## Channel stores

`ChannelConfigStore` writes `channels.json` atomically with mode `0600` and preserves a `.corrupt-*` copy of unparsable files instead of silently discarding them (src/agent-host/channels/config-store.ts:13-32). `ChannelStateStore` keeps delivery cursors, WeChat context tokens, processed-message ids, pairing requests, delivery receipts, and activity records with bounded retention: at most 5,000 processed ids with a 7-day TTL, 500 delivery receipts, and 100 activities (src/agent-host/channels/state-store.ts:15-18). Inbound attachments are staged in `channel-media/` with randomized disk names, sanitized display names, `0600` permissions, a symlink-refusing root, and TTL-based cleanup (src/agent-host/channels/media-store.test.mjs:23-107).

## Toolchain state

`ToolchainPaths` places `state.json`, `state.json.bak`, `downloads/`, and `runtimes/` under `<userData>/toolchains` (src/main/toolchains/paths.ts:20-30). `ToolchainStateStore` (schema version 2) writes atomically with a backup: the previous state file is copied to `.bak` before the rename, corrupt state falls back to the backup, and a future schema version is preserved untouched (src/main/toolchains/state-store.ts:123-163, 195). The installer additionally recovers interrupted operations at startup — partial downloads are removed and interrupted runtime renames are restored (src/main/toolchains/installer.ts:367-373). Absolute paths of managed runtimes are redacted to `<userData>/...` labels before reaching the Renderer (src/main/toolchains/candidate-normalizer.test.mjs:58-65).

## Browser stores

All browser stores live under `userData` and follow the atomic-write pattern (src/main/browser/browser-service.ts:99-148):

- `browser-settings.json` — `BrowserSettingsStore`, atomic with private mode, corruption recovery, and future-version preservation (src/main/browser/browser-settings-store.ts:87-101).
- `browser-session-grants.json` — `BrowserPersistentGrantStore`, capped at 1 MiB and 10,000 grants (src/main/browser/browser-persistent-grant-store.ts:6-8).
- `browser-secrets.json` — `BrowserSecretVault`, values encrypted via Electron `safeStorage`, capped at 2 MiB (src/main/browser/browser-secret-vault.ts:6-7).
- `browser-tabs.json` — tab restore records, written debounced 500 ms after changes (src/main/browser/browser-service.ts:54).
- `browser-header-rules.json`, `browser-page-snippets.json`, `browser-profiles.json`, and a `browser-network-bodies/` directory for captured response bodies (src/main/browser/browser-service.ts:143-159).
- Persistent profile partitions live under `userData/Partitions` (src/main/browser/browser-profile-manager.ts:300-306).

## Credential vault

Channel credentials are stored by Main in a versioned vault file encrypted with `safeStorage`; writes are atomic temp-file + rename with mode `0600`, and persistence is refused entirely when OS credential encryption is unavailable (src/main/credential-vault.ts:34-50). Keys are validated against `channel:(weixin|telegram|feishu):<id>` before any read or write (src/main/credential-vault.ts:10-16).

## Reaper journal

The managed-process crash reaper persists records in `<userData>/managed-process-reaper/journal-v2.json` (src/main/main.ts:403-410). The journal format is version 2, capped at 64 KiB and 16 records, with strict per-platform record validation (POSIX records require `pid === pgid`; legacy v1 records are validated and migrated) (src/main/managed-process/reaper-journal.ts:5-7, 38-102). Records survive Host or app crashes so leftover process groups can be reaped on the next launch; uncertain identity (live pid whose start fingerprint does not match) fails closed rather than killing an unrelated process (src/main/managed-process/reaper.test.mjs:35-63).

## UI state, logs, and transient data

- `ui-state.json` in `userData` persists window bounds, sidebar width, theme, recent cwds, background mode, and update-check preference; saves are best-effort with a strict variant used where persistence must not fail silently (src/main/window-state.ts:23-53).
- Main logs go to `<logs>/main.log` through an async rotating logger: 5 MiB per generation, 3 generations, sanitized lines, and a bounded write queue (src/main/logger.ts:8-17). Diagnostics export copies size-limited, redacted logs into a user-chosen folder and excludes environment variables, credentials, and raw crash dumps (src/main/diagnostics.ts:40-54).
- HTML previews are in-memory only: entries expire after 30 minutes, capped at 64 entries (src/main/protocol.ts:42-43).
- The Agent Host keeps session-id → path mappings and session tool names in memory for the Host's lifetime (src/agent-host/session-reader.ts:68-70).

Where retention is not established in code (for example, long-term growth of `browser-network-bodies/` beyond the recorder's idle-suspension behavior), this wiki does not assert a guarantee.

## Representative tests

- src/agent-host/channels/config-store.test.mjs and state-store retention behavior
- src/main/toolchains/state-store.test.mjs — atomic writes, backup recovery, future-schema preservation
- src/main/browser/browser-settings.test.mjs and browser-secret-vault.test.mjs — atomic private-mode writes and corruption recovery
- src/main/managed-process/reaper-journal.test.mjs — journal validation and legacy migration
