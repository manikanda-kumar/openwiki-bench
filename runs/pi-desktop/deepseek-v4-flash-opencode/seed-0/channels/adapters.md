---
type: concept
title: WeChat, Telegram, and Feishu/Lark Adapters
description: The three messaging-channel adapters — WeChat QR login with long polling, Telegram Bot API long polling with rich previews, and Feishu/Lark WebSocket with Card rendering — and their media, reconnection, and security behavior.
tags: [channels, adapters, weixin, telegram, feishu]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-675f64abd9b8550ea33cde07
    resource: repo://src/agent-host/channels/adapter-registry.ts
  - id: openwiki-source-9203e3386b847d8050a5709a
    resource: repo://src/agent-host/channels/adapters/feishu/adapter.ts
  - id: openwiki-source-a754706fe11d14a9a593289a
    resource: repo://src/agent-host/channels/adapters/feishu/app-registration.ts
  - id: openwiki-source-bb24759dd0762b67bc93d5a9
    resource: repo://src/agent-host/channels/adapters/feishu/rich-renderer.ts
  - id: openwiki-source-3b76f43845bbec1d8b03174a
    resource: repo://src/agent-host/channels/adapters/telegram/adapter.ts
  - id: openwiki-source-b151cc6814cd829b4ccabe5a
    resource: repo://src/agent-host/channels/adapters/weixin/adapter.ts
  - id: openwiki-source-7e4f13d02a6124d1b507270f
    resource: repo://src/agent-host/channels/adapters/weixin/media.ts
  - id: openwiki-source-66df5ff9dbde17fb507df13d
    resource: repo://src/agent-host/channels/types.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# WeChat, Telegram, and Feishu/Lark Adapters

The `AdapterRegistry` (`src/agent-host/channels/adapter-registry.ts`) registers exactly three channel adapters that implement the `ChannelAdapter` interface defined in `src/agent-host/channels/types.ts:110`:

- `WeixinAdapter` — WeChat personal-bot transport.
- `TelegramAdapter` — Telegram Bot API.
- `FeishuAdapter` — Feishu/Lark self-built apps.

The `ChannelAdapter` contract requires `start`, `send`, and `probe`; optional capabilities are `downloadInbound`, `beginTurn`, `setTyping`, and the interactive login surface (`startLogin`, `pollLogin`, `submitLoginCode`, `cancelLogin`).

## Transport and reconnection differences

| Adapter | Transport | Login | Stream rendering |
| --- | --- | --- | --- |
| WeChat | HTTPS long polling (`getUpdates` with a persisted cursor) | QR code + device confirmation, optional verify code | none (`setTyping` via typing ticket) |
| Telegram | HTTPS long polling (`getUpdates` with `offset`) | BotFather token only | rich draft messages with a 400 ms interval, plain-text fallback |
| Feishu/Lark | Outbound WebSocket long connection (official SDK) | QR registration through `app-registration.ts` (creates the bot) or existing App ID/Secret | interactive Cards (`FeishuRichMessageBuilder`), streaming with reactions |

### WeChat (`weixin/adapter.ts`)

- Long polling: `getUpdates` with a persisted `get_updates_buf` cursor and server-negotiated timeout (bounded to 5–60 s). The cursor is persisted so restart resumes without replaying old messages (`src/agent-host/channels/adapters/weixin/adapter.ts:92`).
- A `context_token` per peer is stored and reused for outbound replies; without it, outbound text to that peer is refused by the core (`adapter.ts:130`).
- Credential staleness (code `-14`) raises a fatal error that stops the account rather than retrying (`adapter.ts:100`).
- Fatal credential invalidation short-circuits reconnection; other failures retry with backoff (`2 s` up to `30 s` after three consecutive failures) (`adapter.ts:148`).

### Telegram (`telegram/adapter.ts`)

- Long polling with `offset = max(update_id)+1`, persisted, so Telegram releases acknowledged updates (`adapter.ts:437`). `409` (conflict with another poller/webhook), `401`, and `403` are fatal and stop the account (`adapter.ts:177`); `429` rate limits respect `retry_after` with at most 2 retries (`adapter.ts:468`).
- On start the adapter syncs the command menu when `commandsEnabled` is true (`setTelegramCommands`) or clears it when false (`adapter.ts:388`).
- `mentionsTelegramBot` uses entity-level detection (`text_mention`, `mention`, `bot_command`) with a plain-text fallback, so group messages without a mention are not routed (`adapter.ts:212`).

### Feishu/Lark (`feishu/adapter.ts`)

- Uses the official SDK's outbound WebSocket connection. `dispatchInbound` guards redelivery with the state store's processed-message ids and an in-flight set, then marks processed only after the core accepted the envelope (`adapter.ts:499`).
- Fatal credential/scope errors (`isFatalFeishuConnectionError`) stop the account; transient errors reconnect with exponential backoff (`feishuReconnectDelay`, 1 s → 25 s + jitter), resetting after 60 s of stable connection (`adapter.ts:66`).
- Feishu message normalization handles text, post (rich text), image, file, audio, and media/video message types; `@bot` mentions are stripped from text (`adapter.ts:393`).

## Login flows

- **WeChat**: `startLogin` requests a QR from the WeChat service and stores a login session (5-minute TTL). `pollLogin` walks statuses `wait` → `scaned` → `need_verifycode`/`confirmed`; a redirect host can switch the base URL; `submitLoginCode` accepts the on-phone numeric code. On success the bot token, provider account id, and (optionally) the owner user id are returned (`weixin/adapter.ts:247`).
- **Feishu/Lark**: `startLogin`/`pollLogin` run a registration state machine in `app-registration.ts` that creates the bot through the documented `/oauth/v1/app/registration` endpoint. The adapter hardens that endpoint on the SDK's HTTP instance (https-only, host allowlist, size/timeout limits, no redirects) (`feishu/app-registration.ts:33`). The returned App ID/domain are validated against the derived account id before a credential is saved (`feishu/adapter.ts:479`).
- **Telegram**: no interactive login; the user supplies a BotFather token directly (validated by `probe`/`getTelegramBot`).

All credentials are saved to Main's OS-encrypted vault (`channelSecrets.*`) and only the token fingerprint is exposed to the UI.

## Media download, staging, and outbound delivery

The core stages inbound attachments after policy acceptance (max 20 MiB each, bounded count via `CHANNEL_MEDIA_MAX_ATTACHMENTS`). The adapters differ in how media is fetched:

- **WeChat** (`weixin/media.ts`): downloads are URL-checked (only `novac2c.cdn.weixin.qq.com`, `*.weixin.qq.com`, `*.qq.com`, https-only), AES-ECB-decrypted, bounded at 20 MiB with streaming enforcement. Voice is SILK; `silk-wasm` decodes it to WAV (`pcmToWav`), and when the message already carries recognized speech text the audio is skipped so the agent does not re-transcribe (`media.ts:158`). Outbound attachments are AES-encrypted with a fresh key, uploaded via `getWeixinUploadUrl`, and sent as an encrypted media item.
- **Telegram**: `downloadInbound` resolves file ids through `getFile`/`downloadTelegramFile`; outbound sends `sendTelegramMedia` (photos, voice, documents, audio, video) with rate-limit retries (`telegram/adapter.ts:495`).
- **Feishu/Lark**: `downloadInbound` resolves `file_key`/`image_key` resources for image, file, audio (`.opus`), and video; outbound uses `sendMedia` with thread routing preserved via `replyToMessageId`/`replyInThread` (`feishu/adapter.ts:620`).

Staging happens in the core's `ChannelMediaStore` (`channels/media-store.ts`); generated agent files are delivered as attachments on the same channel after a turn.

## Rich / streaming rendering and reactions

- **Telegram**: `TelegramTurnOutput` streams drafts over the Telegram Business-like draft API (`sendTelegramRichMessageDraft`/`sendTelegramMessageDraft`) at a 400 ms interval with a stable draft id, then replaces them with a final rich message. Rich rendering falls back to plain text when the draft exceeds `TELEGRAM_RICH_SAFE_LIMIT` or the API returns `400`/`404` (`telegram/adapter.ts:200`). Reaction emojis (`👀` → `👍`/`👎`) are set on the original user message.
- **Feishu/Lark**: `FeishuTurnOutput` streams a Card via `startRichCard`/`session.update` at a 400 ms interval, then finalizes it. If finalizing the streaming card fails it sends a second durable final Card or falls back to plain text (`feishu/adapter.ts:337`). The rich renderer (`feishu/rich-renderer.ts`) enforces byte budgets (card JSON ≤ 28 000 B, streaming content ≤ 18 000 B, thinking ≤ 4 000 B, tool input ≤ 900 B, tool output ≤ 1 800 B, ≤ 8 tool details) and marks answers truncated instead of dropping them. Reactions (`THINKING` → `DONE`/`ERROR`) are queued on the source message.
- **WeChat**: no rich streaming; typing indicator uses a per-peer typing ticket (`weixin/adapter.ts:213`).

## Security-relevant differences

- **WeChat**: outbound requires a stored `context_token` (the peer must have messaged the bot first); media URLs are host-allowlisted and https-only; secrets in log/error text are redacted by `redaction.ts` (`fingerprintSecret`, `safeChannelError`).
- **Telegram**: the token is only used against the configured `baseUrl`; bot identity is verified against the saved `providerAccountId` at start (`telegram/adapter.ts:385`).
- **Feishu/Lark**: app registration is restricted to the documented endpoint on an allowlisted host; the App ID/domain must match the derived account id (`feishu/adapter.ts:479`); SDK-initiated events that carry credentials are validated before persistence.

## Tests

- `src/agent-host/channels/adapters/weixin/api.test.mjs`, `media.test.mjs`, and `adapter-runtime.test.mjs`.
- `src/agent-host/channels/adapters/telegram/api.test.mjs` and `adapter-runtime.test.mjs`.
- `src/agent-host/channels/adapters/feishu/api.test.mjs`, `app-registration.test.mjs`, `rich-renderer.test.mjs`, and `adapter-runtime.test.mjs`.
