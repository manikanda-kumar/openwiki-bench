---
type: workflow
title: Message Channels
description: How WeChat, Telegram, and Feishu/Lark messages reach Pi sessions — adapter registry, inbound policy and pairing, media staging, secret redaction, the Pi session bridge, and credential storage.
tags: [channels, weixin, telegram, feishu, adapters, pairing, redaction, credentials]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-1d09e3a80b663dd5e8d46e42
    resource: repo://src/agent-host/channels/adapters/feishu/adapter-runtime.test.mjs
  - id: openwiki-source-f99f20c208d4c1fbc8ad5f2f
    resource: repo://src/agent-host/channels/adapters/feishu/api.ts
  - id: openwiki-source-3b76f43845bbec1d8b03174a
    resource: repo://src/agent-host/channels/adapters/telegram/adapter.ts
  - id: openwiki-source-a0dcc8383d962e98edd6cb73
    resource: repo://src/agent-host/channels/adapters/telegram/api.ts
  - id: openwiki-source-8f7408843c0c08e176c622a5
    resource: repo://src/agent-host/channels/adapters/weixin/adapter-runtime.test.mjs
  - id: openwiki-source-a88f7786aaa59423b70c2973
    resource: repo://src/agent-host/channels/adapters/weixin/api.ts
  - id: openwiki-source-94b5705630a80019fc3c838f
    resource: repo://src/agent-host/channels/adapters/weixin/media.test.mjs
  - id: openwiki-source-7e4f13d02a6124d1b507270f
    resource: repo://src/agent-host/channels/adapters/weixin/media.ts
  - id: openwiki-source-e9deb383a0af3f7a675e4a53
    resource: repo://src/agent-host/channels/channel-manager.test.mjs
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-336138f433d173abd9b68878
    resource: repo://src/agent-host/channels/lane-scheduler.ts
  - id: openwiki-source-e26f4ff537d17d17f171ae27
    resource: repo://src/agent-host/channels/media-store.test.mjs
  - id: openwiki-source-3e4d1fb5c1067cd950a6b181
    resource: repo://src/agent-host/channels/outbound-files.ts
  - id: openwiki-source-1eccbf7b37a129a17a372912
    resource: repo://src/agent-host/channels/pi-session-bridge.ts
  - id: openwiki-source-f9bf8075e930cd298a1ae269
    resource: repo://src/agent-host/channels/policy.ts
  - id: openwiki-source-0cbbd7f7984c9c7544030573
    resource: repo://src/agent-host/channels/redaction.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Message Channels

The Agent Host runs a `ChannelManager` that connects personal WeChat, Telegram bots, and Feishu/Lark apps to Pi sessions. All transports are outbound-only: WeChat and Telegram long-poll, Feishu/Lark uses the official SDK's outbound WebSocket, and nothing opens a webhook or local listening port (src/agent-host/channels/adapters/telegram/api.ts:106; src/agent-host/channels/adapters/feishu/api.ts:507-541; src/agent-host/channels/adapters/weixin/api.ts:136).

## Architecture

`ChannelManager` composes:

- `ChannelConfigStore` (`channels.json`: accounts + bindings) and `ChannelStateStore` (`channels.state.json`: cursors, context tokens, pairings, deliveries, activities) under `PI_CODING_AGENT_DIR/desktop` or `~/.pi/desktop` (src/agent-host/channels/channel-manager.ts:152-155).
- `ChannelMediaStore` (`channel-media/`) for staged inbound attachments (src/agent-host/channels/channel-manager.ts:155).
- `AdapterRegistry`, which constructs the WeChat, Telegram, and Feishu adapters (src/agent-host/channels/adapter-registry.ts:7-14).
- `PiSessionBridge` for session execution and a `SecretAccess` indirection that reads/writes credentials through Main's `CredentialVault` over parent RPC (src/agent-host/channels/channel-manager.ts:157-169).

Enabled accounts auto-start on Host initialization, and status/activity/binding/login/pairing changes stream to the Renderer as `channels.status`, `channels.activity`, `channels.binding`, `channels.login`, and `channels.pairing` events (src/agent-host/channels/channel-manager.ts:180-194, 204-220).

## Inbound policy and pairing

Every inbound envelope passes `evaluateInboundPolicy` before any work happens (src/agent-host/channels/policy.ts:5-18):

- Groups: disabled entirely by `groupPolicy: "disabled"`, otherwise require mention if configured, restrict to `groupIds` allowlist, and optionally restrict senders via `groupAllowFrom`.
- Direct messages: `dmPolicy: "open"` allows anyone, `allowFrom` entries are always allowed, and `pairing` mode issues a pairing flow; anything else is ignored.

Pairing generates a 6-digit code with a 10-minute TTL, sends it back over the channel, and waits for the user to approve it in the desktop settings; login successes are retained for only 60 seconds (src/agent-host/channels/channel-manager.ts:48-49, 802-835). Decisions and outcomes are recorded as activity entries (src/agent-host/channels/channel-manager.ts:843-866).

Turns are serialized per route with a `LaneScheduler` (per-key FIFO, bounded global concurrency, default 4) so messages from the same conversation are processed in order (src/agent-host/channels/lane-scheduler.ts:1-47; src/agent-host/channels/channel-manager.ts:132, 837-838).

## Media handling

Inbound attachments are downloaded by the adapter only after policy acceptance, then staged by `ChannelMediaStore`, which caps attachments per message (a 20 MiB size limit is enforced by the WeChat/Telegram downloaders), randomizes disk names, sanitizes display names, uses `0600` permissions, refuses symlinked roots, and cleans up expired files by TTL (src/agent-host/channels/channel-manager.ts:884-913; src/agent-host/channels/media-store.test.mjs:23-107). Images are passed to the session as multimodal inputs; other attachments are described to the Agent as staged file paths and treated as untrusted input (src/agent-host/channels/pi-session-bridge.ts:127-139). WeChat SILK voice is decoded to WAV (src/agent-host/channels/adapters/weixin/media.ts:116).

## Pi session bridge

`PiSessionBridge` decides how a channel turn maps to a session:

- A binding with a `sessionId` reuses the live in-memory session, or reopens it from disk via `SessionManager.open`; otherwise it creates a fresh independent session with a unique `__channel__` lock key (src/agent-host/channels/pi-session-bridge.ts:55-84).
- The binding's workspace is created and registered with `allowFileRoot` so tools can read staged attachments (src/agent-host/channels/pi-session-bridge.ts:50-53, 125-126).
- `runTurn` forwards message/tool progress events to the adapter for streaming previews and reactions (src/agent-host/channels/pi-session-bridge.ts:164-205).

Outbound files follow a strict authorization model: `collectOutboundFiles` scans the final answer for Markdown links to local files, and only sends files that exist, are non-empty, are inside the session workspace after realpath resolution (symlink escapes never qualify), are at most 20 MiB, and at most 4 per message; unauthorized links are rewritten to "📎 …（未发送）" placeholders (src/agent-host/channels/outbound-files.ts:6-7, 42-79).

Tool permissions are per Pi Session: the account's configured `toolNames` are used for newly created independent channel sessions, and `syncTools` applies saved changes to live sessions so multiple channel entries sharing one session share one permission set (src/agent-host/channels/pi-session-bridge.ts:96-104; src/agent-host/channels/channel-manager.test.mjs:294).

## Redaction and credentials

`redaction.ts` recursively replaces sensitive keys (token, secret, authorization, QR content, context tokens, verification URLs) with `[REDACTED]`, redacts Bearer headers, credential-bearing query parameters, Telegram bot URLs, and JSON secret fields in text, truncates safe errors to 500 characters, and shows credential fingerprints as only the last four characters (src/agent-host/channels/redaction.ts:4-46). All channel errors that leave the Host pass through `safeChannelError` (src/agent-host/channels/channel-manager.ts:893).

Credentials never touch the channel config file. They are stored by Main in `CredentialVault`, encrypted with Electron `safeStorage`, written atomically with `0600` modes, keyed by validated `channel:<channel>:<id>` keys, and refused entirely when OS key storage is unavailable; snapshots only expose a fingerprint (src/main/credential-vault.ts:10-50; src/agent-host/channels/channel-manager.ts:236-249).

## Channel-specific behavior

- **WeChat**: QR-code login with polling (`get_bot_qrcode` → `get_qrcode_status`), long-poll `getUpdates` with cursor checkpointing and duplicate suppression, CDN media with AES-128-ECB decryption restricted to Tencent origins, and fail-closed handling of stale login tokens (src/agent-host/channels/adapters/weixin/api.ts:107-136; src/agent-host/channels/adapters/weixin/adapter-runtime.test.mjs:92-264; src/agent-host/channels/adapters/weixin/media.test.mjs:28-89).
- **Telegram**: BotFather token login, long-poll `getUpdates` with a 30-second timeout and retry backoff capped at 30 s, streaming draft previews, and a polling-conflict error that tells the user to disable other pollers/webhooks (src/agent-host/channels/adapters/telegram/adapter.ts:39-41, 183).
- **Feishu/Lark**: official SDK WebSocket long connection with bounded reconnect jitter; credential and permission errors are terminal while transient errors rebuild the connection; Card-based rendering with streaming thinking/tool display and native `/help`, `/status`, `/new`, `/compact`, `/reload` menus in direct chats (src/agent-host/channels/adapters/feishu/api.ts:507-610; src/agent-host/channels/adapters/feishu/adapter-runtime.test.mjs:345-392).

## Representative tests

- src/agent-host/channels/channel-manager.test.mjs — policy integration, binding persistence, tool sync, activity events
- src/agent-host/channels/channel-core.test.mjs — pairing policy matrix and lane scheduling
- src/agent-host/channels/redaction.test.mjs and outbound-files.test.mjs — redaction coverage and attachment authorization
- src/agent-host/channels/adapters/*/adapter-runtime.test.mjs — per-channel login, polling, reconnect, and media behavior
