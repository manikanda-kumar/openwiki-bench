---
type: "Reference"
title: "Messaging Channels (WeChat, Telegram, Feishu/Lark)"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-675f64abd9b8550ea33cde07
    resource: repo://src/agent-host/channels/adapter-registry.ts
  - id: openwiki-source-f99f20c208d4c1fbc8ad5f2f
    resource: repo://src/agent-host/channels/adapters/feishu/api.ts
  - id: openwiki-source-a0dcc8383d962e98edd6cb73
    resource: repo://src/agent-host/channels/adapters/telegram/api.ts
  - id: openwiki-source-b151cc6814cd829b4ccabe5a
    resource: repo://src/agent-host/channels/adapters/weixin/adapter.ts
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-336138f433d173abd9b68878
    resource: repo://src/agent-host/channels/lane-scheduler.ts
  - id: openwiki-source-41a356100781a582ef1924a1
    resource: repo://src/agent-host/channels/media-store.ts
  - id: openwiki-source-1eccbf7b37a129a17a372912
    resource: repo://src/agent-host/channels/pi-session-bridge.ts
  - id: openwiki-source-f9bf8075e930cd298a1ae269
    resource: repo://src/agent-host/channels/policy.ts
  - id: openwiki-source-fd0c084d772701f9985e43c7
    resource: repo://src/agent-host/channels/state-store.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---


# Messaging Channels (WeChat, Telegram, Feishu/Lark)

Messaging channels let users talk to the agent from personal WeChat, Telegram, or Feishu/Lark. The framework lives in the Agent Host (`src/agent-host/channels/`) and is driven by `ChannelManager`, which owns accounts, adapters, policy, bindings, media, and Pi-session bridging. All transports are **outbound only** — no webhook or local listener is opened.

## Components and stores

`ChannelManager` composes (`src/agent-host/channels/channel-manager.ts:127-178`):

- `ChannelConfigStore` — accounts and bindings persisted to `channels.json` (atomic, mode `0600`) (`src/agent-host/channels/config-store.ts:13-32`);
- `ChannelStateStore` — polling cursors, context tokens, processed-message ids, pairings, delivery receipts, and activity, persisted to `channels.state.json` with bounded retention (5 000 processed / 7 days, 500 deliveries, 100 activities) (`src/agent-host/channels/state-store.ts:5-18`);
- `ChannelMediaStore` — staged inbound attachments under `channel-media/`;
- `AdapterRegistry` — registers `WeixinAdapter`, `TelegramAdapter`, and `FeishuAdapter` (`src/agent-host/channels/adapter-registry.ts:7-25`);
- `LaneScheduler` — per-route serialization with a global concurrency of 4 (`src/agent-host/channels/lane-scheduler.ts:1-52`);
- `PiSessionBridge` — creates/opens agent sessions for channel turns.

Credentials are **not** stored in the Host: `secretAccess` calls Main's `channelSecrets.get/set/delete`, which use the encrypted `CredentialVault` (`channel-manager.ts:158-169`, `src/main/credential-vault.ts`).

## Account lifecycle

- `initialize` starts every enabled account (`channel-manager.ts:180-194`).
- `upsertAccount` saves the account and, if the default tool list changed, propagates the new `toolNames` to every bound session (`channel-manager.ts:267-288`).
- `connectAccount` probes the provider, derives the provider account id/username, stores the secret, and starts the runtime; failure rolls the account and secret back (`channel-manager.ts:290-322`).
- `startAccount`/`stopAccount`/`restartAccount` manage adapter runtimes with `AbortController`s and a 2 s stop grace (`channel-manager.ts:334-412`).
- Interactive login (`startLogin`/`waitLogin`/`submitLoginCode`/`cancelLogin`) supports QR/device flows; a successful login validates provider identity (Feishu account id is derived from domain + app id) and persists the account and secret (`channel-manager.ts:422-626`).

## Inbound policy and pairing

`evaluateInboundPolicy` decides `allow`/`pair`/`ignore` (`src/agent-host/channels/policy.ts:5-18`):

- group messages: ignored when groups are disabled, when a mention is required but missing, when the group is not in the allowlist, or when the sender is not in `groupAllowFrom`;
- direct messages: allowed when `dmPolicy` is `open` or the sender is in `allowFrom`; otherwise `pair` for the pairing policy, else ignored.

Unknown DM senders receive a 6-digit pairing code (10-minute TTL) and appear as `channels.pairing` events; approving adds them to `allowFrom` and sends a confirmation (`channel-manager.ts:802-835`, `channel-manager.ts:628-657`). Access policy is evaluated **before** any provider media download (`check-desktop-security.mjs:451-454`).

## Inbound turn flow

`handleInbound` (`channel-manager.ts:837-1077`) runs inside the lane for its route key:

1. look up the enabled account and secret, evaluate policy;
2. if attachments exist and the adapter supports `downloadInbound`, enforce the 4-attachment limit, download, and stage them (failures reply with a size/format message);
3. resolve a binding (exact thread match, else peer-level, else create one) and emit `channels.binding`;
4. when commands are enabled, parse `/help`, `/status`, `/new`, `/compact`, `/reload`; otherwise call `bridge.runTurn` with progress callbacks;
5. save the session id on the binding, emit `sessions.changed` so the desktop chat reloads, and send the final text (or finish a progressive message);
6. deliver any files the agent linked in its reply, then emit activity/status events.

Typing indicators are best-effort and always cleared in `finally` (`channel-manager.ts:935-1074`).

## Bindings and Pi-session bridging

- A binding key is `channel:accountId:peerKind:peerId:threadId`; the binding id is the first 32 hex chars of its SHA-256 (`channel-manager.ts:79-87`). Bindings store a `cwd`, `toolNames`, and optional `sessionId`.
- Without `defaultCwd`, a binding workspace is created under `userData/channel-workspaces/<channel>/<account>/<route hash>` and added to the allowed file roots (`channel-manager.ts:707-728`, `pi-session-bridge.ts:50-53`).
- `PiSessionBridge.runTurn` opens the bound session (or creates one), passes channel images as multimodal input and other attachments as tool-accessible paths, and returns the final text plus generated files (`src/agent-host/channels/pi-session-bridge.ts:116-214`). The bridge adds an explicit context telling the agent it may attach requested workspace files as Markdown links.
- Channel turns are marked so that browser/managed-process tools can distinguish channel sessions (`runExternalTurn` in `src/agent-host/rpc-manager.ts:449-510`).

## Media staging

`ChannelMediaStore` enforces 4 attachments and 20 MiB per message, a 24-hour TTL with hourly cleanup, MIME sniffing for images, sanitized names, symlink rejection, and `0600` staged files (`src/agent-host/channels/media-store.ts:7-10`, `media-store.ts:48-70`). WeChat SILK voice is converted to WAV before staging.

## Adapters and transports

- **WeChat** — outbound long-polling via `getUpdates` with a server-provided long-poll timeout (clamped 5–60 s) (`src/agent-host/channels/adapters/weixin/adapter.ts:92-107`).
- **Telegram** — outbound `getUpdates` long polling; supports streaming previews and collapsing thinking/tool details (`src/agent-host/channels/adapters/telegram/api.ts:106`, rich-renderer).
- **Feishu/Lark** — outbound WebSocket via the official SDK (`connectFeishuWebSocket`) (`src/agent-host/channels/adapters/feishu/api.ts:507`); uses Card rendering for Markdown and streams thinking/tool calls.

The security check asserts none of the three adapters opens a local listener (`check-desktop-security.mjs:442-444`).

## Secret handling and outbound rendering

- The RPC contract never exposes raw `botToken`/`appSecret`, and the renderer channel-credential bridge is write-only (`check-desktop-security.mjs:482-488`).
- Outbound Markdown/attachments are rendered per adapter (`rich-renderer.ts`), and linked files are resolved only inside the actual bound workspace (`check-desktop-security.mjs:462-468`).
- Channel errors are redacted through `safeChannelError` and secret fingerprints before being shown or logged (`src/agent-host/channels/redaction.ts`).

## Related pages

- [Agent Host Runtime](../architecture/agent-host-runtime.md)
- [Security Model](../architecture/security-model.md)
- [Sessions and Project Files](./sessions-and-project-files.md)
