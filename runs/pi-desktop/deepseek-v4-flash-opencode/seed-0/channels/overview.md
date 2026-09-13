---
type: concept
title: Messaging Channels Architecture
description: The channel core in the Agent Host — account lifecycle, inbound policy, pairing, bindings, per-session tool permissions, media staging, delivery receipts, slash commands, and the PiSessionBridge external-turn integration.
tags: [channels, agent-host, inbound-policy, bindings, media]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-712f53a8b8159723ec70e072
    resource: repo://src/agent-host/channels/channel-commands.ts
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-0c5ad2ceefae629223df3182
    resource: repo://src/agent-host/channels/config-store.ts
  - id: openwiki-source-336138f433d173abd9b68878
    resource: repo://src/agent-host/channels/lane-scheduler.ts
  - id: openwiki-source-41a356100781a582ef1924a1
    resource: repo://src/agent-host/channels/media-store.ts
  - id: openwiki-source-1eccbf7b37a129a17a372912
    resource: repo://src/agent-host/channels/pi-session-bridge.ts
  - id: openwiki-source-f9bf8075e930cd298a1ae269
    resource: repo://src/agent-host/channels/policy.ts
  - id: openwiki-source-0cbbd7f7984c9c7544030573
    resource: repo://src/agent-host/channels/redaction.ts
  - id: openwiki-source-fd0c084d772701f9985e43c7
    resource: repo://src/agent-host/channels/state-store.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Messaging Channels Architecture

The messaging-channels subsystem lives in `src/agent-host/channels/` and runs inside the Agent Host. `ChannelManager` (`channel-manager.ts:127`) is the core: it owns account configs and state, starts/stops adapter runtimes, evaluates inbound policy, resolves bindings, stages media, and hands messages to Pi sessions through `PiSessionBridge`.

## Account lifecycle

- **Config**: accounts and bindings persist in `channels.json` (`ChannelConfigStore`, `config-store.ts:106`). The store normalizes every account/binding on read (trim, validate channel, coerce policies) and writes atomically with `0o600` (`config-store.ts:13`).
- **State**: `channels.state.json` (`ChannelStateStore`, `state-store.ts:32`) persists poll cursors, per-peer WeChat context tokens, processed provider event ids (pruned to 5000 with a 7-day TTL), pairings, delivery receipts (last 500), and activity entries (last 100). Corrupt files are moved aside (`*.corrupt-*`) rather than silently reused (`state-store.ts:60`).
- **Connect flow**: `connectAccount` probes the credential with the adapter, derives the provider account id/username, persists the secret via Main's vault, upserts the account (enabled), and restarts its runtime. Any failure removes the provisional account and secret (`channel-manager.ts:290`).
- **Runtime**: `startAccount`/`stopAccount`/`restartAccount` control adapter runtimes, each tracked with an `AbortController` and a run task. `startAccountRuntime` requires a saved secret and emits `starting`/`running`/`reconnecting`/`error` statuses (`channel-manager.ts:334`).
- **Login**: interactive logins (`channels.loginStart`/`loginWait`) are delegated to the adapter (`startLogin`/`pollLogin`); on success the manager validates the returned credential, persists it via the vault, upserts the account, probes it, and restarts (`channel-manager.ts:466`). Successful login events are retained for 60 s so the UI can settle.

## Inbound policy

`evaluateInboundPolicy` (`policy.ts:5`) decides `allow` / `pair` / `ignore` per envelope:

- **Groups**: disabled unless `groupPolicy` allows; `requireMention` must be satisfied unless the account is open; `groupIds` (allowlist) and `groupAllowFrom` (sender allowlist) are applied.
- **DMs**: `open` allows everyone; allowlisted senders (`allowFrom`) are allowed; `pairing` policy sends a pairing code to unknown senders; otherwise the message is ignored.

WeChat group chat is not enabled (groups are `disabled` by default); Feishu/Lark and Telegram support the group policy matrix. Unknown-sender handling routes to `handlePairing`, which issues a 6-digit code with a 10-minute TTL and asks the user to approve in the desktop UI (`channel-manager.ts:802`).

## Bindings and tool permissions

- A **binding** maps a peer (DM or group, optionally thread) to a workspace (`cwd`) and a Pi session. `resolveBinding` matches the most specific binding first (channel+account+peer+thread), then the peer-level binding, else it auto-creates one with a default workspace under the channel data dir or the account's `defaultCwd` (`channel-manager.ts:687`).
- **Tool permissions are per Pi session**: `toolNames` on the account/binding are applied through `PiSessionBridge.syncTools` (live `set_tools` or persisted for later restore). Saving an account's `toolNames` propagates to every binding that shares that account, and shared sessions share the same permission set (`channel-manager.ts:267`).
- The default tool set for newly created independent channel sessions comes from the account's `toolNames`.

## Turn processing and delivery

`handleInbound` (`channel-manager.ts:837`) serializes each route through a `LaneScheduler` (max 4 concurrent tasks, per-route FIFO ordering, `lane-scheduler.ts:24`):

1. Look up the account + secret; evaluate policy.
2. Download/stage inbound media (`adapter.downloadInbound` → `ChannelMediaStore.stage`), enforcing ≤ 4 attachments and ≤ 20 MiB each (`media-store.ts:7`).
3. Detect a built-in slash command (only when `commandsEnabled`); otherwise begin a streaming turn (`adapter.beginTurn`), run it through `PiSessionBridge.runTurn`, then `finish` the adapter turn output (or send plain text) and record the delivery receipt.
4. Emit `channels.status`, `channels.activity`, `channels.binding`, and a `sessions.changed` notification so the desktop UI stays in sync.
5. After a turn, generated agent files are delivered as channel attachments (WeChat/Telegram/Feishu) and failures are logged (`channel-manager.ts:1008`).

## Slash commands

Only the explicit built-in set is parsed (`channel-commands.ts:28`): `/help`, `/status`, `/new`, `/compact [note]`, `/reload`. Unknown commands return `null` so normal Agent prompt routing stays backward compatible. `/new` starts an independent session; `/compact` and `/reload` go through `PiSessionBridge.runCommand` (`channel-manager.ts:750`).

## PiSessionBridge and external turns

`PiSessionBridge` (`pi-session-bridge.ts:38`) is the glue to `AgentSessionWrapper`:

- `open` reuses a live session, restores a persisted one from its file, or creates a new session whose id is a `__channel__<uuid>` placeholder, always ensuring the workspace dir exists and is an allowed file root (`pi-session-bridge.ts:50`).
- `runTurn` feeds the channel text (`channelPromptText`), inline images (base64), non-image attachment paths (as untrusted context), and an `onProgress` mapper that converts agent events (`message_start/update/end`, `tool_execution_*`) into `ChannelTurnProgressEvent`s for streaming (`pi-session-bridge.ts:116`).
- Outbound file collection (`collectOutboundFiles`) extracts absolute local file links from the final text, enforcing workspace containment, symlink checks, ≤ 20 MiB, and ≤ 4 files, and appends the OUTBOUND_FILE_CONTEXT prompt so the agent links files only when asked (`pi-session-bridge.ts:23`).
- `runCommand` maps `/compact` and `/reload` to `ExternalSessionCommand`s.

## Redaction and secrets

`redaction.ts` provides `fingerprintSecret` (`••••last4`), `redactChannelValue` (recursive key-based redaction of token/secret/qr/code fields), `redactChannelText`, and `safeChannelError` (redacted, ≤ 500 chars). Secrets live only in Main's OS-encrypted vault; the Host requests them via `channelSecrets.*` parent-RPC (`channel-manager.ts:158`).

## Media staging

`ChannelMediaStore` (`media-store.ts:81`) writes staged attachments under `<data>/channel-media/<hash(accountId)>/<hash(envelopeId)>/<uuid>.<ext>` with `0o700` directories and `0o600` files, MIME-sniffs images, sanitizes file names (no control chars, ≤ 160 chars), and cleans up stale files older than 24 h on an hourly timer.

## Tests

- `channel-core.test.mjs`, `channel-manager.test.mjs`, `config-store.test.mjs`, `state-store.test.mjs`, `media-store.test.mjs`, `redaction.test.mjs`, `pi-session-bridge.test.mjs`, `outbound-files.test.mjs`, `channel-session-scheduler.test.mjs`, and `channel-commands`-related tests cover the core behavior.
