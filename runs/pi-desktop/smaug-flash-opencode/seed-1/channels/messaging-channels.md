---
type: reference
title: Messaging Channels (Weixin, Telegram, Feishu/Lark)
description: The messaging-channel subsystem in the Agent Host — Weixin/Telegram/Feishu adapters, inbound processing, pairing, bindings, per-session workspaces, outbound rendering, and media staging.
tags: [channels, weixin, telegram, feishu, messaging]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-9203e3386b847d8050a5709a
    resource: repo://src/agent-host/channels/adapters/feishu/adapter.ts
  - id: openwiki-source-b151cc6814cd829b4ccabe5a
    resource: repo://src/agent-host/channels/adapters/weixin/adapter.ts
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-0c5ad2ceefae629223df3182
    resource: repo://src/agent-host/channels/config-store.ts
  - id: openwiki-source-1eccbf7b37a129a17a372912
    resource: repo://src/agent-host/channels/pi-session-bridge.ts
  - id: openwiki-source-f9bf8075e930cd298a1ae269
    resource: repo://src/agent-host/channels/policy.ts
  - id: openwiki-source-0cbbd7f7984c9c7544030573
    resource: repo://src/agent-host/channels/redaction.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Messaging Channels (Weixin, Telegram, Feishu/Lark)

Pi Agent Desktop lets users talk to the Agent through personal Weixin, Telegram,
and Feishu/Lark. The subsystem lives entirely in the Agent Host under
`src/agent-host/channels` and drives the same in-process Pi agent sessions as
the desktop UI.

## Architecture

`ChannelManager` (`channel-manager.ts`) orchestrates accounts, credentials,
pairing, bindings, login flows, and inbound turn processing. It is constructed
by `registerHandlers` in the Host and exposed to the Renderer through the
`channels.*` RPC surface.

Each transport is a `ChannelAdapter` (Weixin / Telegram / Feishu). The
`AdapterRegistry` maps a `ChannelId` to its adapter. A channel runtime is an
`AbortController`-supervised long-poll loop or WebSocket-facing task (Weixin
long-polls `get_updates`; Telegram long-polls `getUpdates`; Feishu uses the
official SDK's outbound WebSocket long connection).

Channel operations are **outbound-only** — no webhook and no local listening
port: Weixin and Telegram long-poll, Feishu opens an outbound WebSocket.

## Configuration, secrets, and state

- **Config** (`ChannelConfigStore`, `channels.json`): accounts and bindings,
  written atomically with mode `0o600`.
- **State** (`ChannelStateStore`, `channels.state.json`): per-account cursors,
  processed-message ids, context tokens, pairings, activities, deliveries.
- **Secrets** (`ChannelManager` → Main `CredentialVault`): tokens and provider
  identities, `safeStorage`-encrypted; never stored in the config/state files.
  Channel secrets are accessed only via the Main-process `channelSecrets.*`
  bridge, so tokens never cross the Renderer RPC surface.

## Login flows

Three interactive login schemes:

- **Weixin (QR)**: `startLogin` requests a QR, `pollLogin` polls the service
  (`wait`/`scaned`/`need_verifycode`/`binded_redirect`/`expired`), and
  `submitLoginCode` accepts a verification code. A confirmed login yields a bot
  token plus `providerAccountId` and `baseUrl`; the session key expires after
  the QR TTL (5 min) (`weixin/adapter.ts:247-329`).
- **Telegram (BotFather)**: a token is provided directly; `probe` verifies it.
- **Feishu/Lark (scan)**: `startLogin` drives `FeishuAppRegistration` to create
  a self-built app with the official SDK; account identity is derived from
  `domain` + `appId` (hash `feishu-<sha256(domain\0appId)>`), the App Secret is
  stored encrypted, and the account is rejected if the app info is invalid
  (`channel-manager.ts:479-493`).

A `<login success retention>` note: successful login events are kept cached
briefly for the renderer; a confirmed login that fails to persist restores the
previous secret/account (`channel-manager.ts:444-463`).

## Inbound processing

`handleInbound` runs each inbound envelope inside a **lane** (`LaneScheduler`)
keyed on the channel's `routeKey` (`channel:account:peer.kind:peer.id:thread`),
serializing turns for a given conversation so messages are processed in order.

For each envelope it:

1. Looks up a live/disabled account and its secret.
2. Runs `evaluateInboundPolicy` (`policy.ts`):
   - Group messages are ignored unless `groupPolicy` is enabled; they require
     `@mention` when `requireMention` is set, and respect `groupIds` / `groupAllowFrom`.
   - DM messages are allowed when `dmPolicy === "open"` or the sender is in
     `allowFrom`; if the sender is unknown and `dmPolicy === "pairing"`, a
     pairing request is created (see below); otherwise ignored.
3. An empty text+attachment message replies with a notice.
4. Attachments are downloaded and staged via `ChannelMediaStore` (bounded to
   `CHANNEL_MEDIA_MAX_ATTACHMENTS`, with a 20 MiB size limit and validation).
5. It resolves/creates a **binding** (the conversation ↔ workspace ↔ Pi session
   link), then runs the turn through `PiSessionBridge`.

`PiSessionBridge` (`pi-session-bridge.ts`) either opens the bound Pi session
(resume) or creates a fresh one under a per-conversation workspace, stages
non-image attachments into the attachment context (marked untrusted), injects
images as multimodal `image` blocks, and streams progress. Tool-permission
scoping: external conversations default to a separate Pi Session; a binding can
pin the UI session and share context.

## Pairing

When a DM is not allowed and `dmPolicy === "pairing"`, `handlePairing` creates a
6-digit pairing record with a 10-minute TTL. The app sends the pairing code and
emits a `channels.pairing` request; the user approves (or rejects) it in the
Settings → Messaging Channels UI (`channel-manager.ts:802-835`). On approval the
peer's id is added to `allowFrom` and a confirmation is sent.

## Bindings and workspaces

A `ChannelBinding` (`shared/channel-types.ts`) records the conversation
(`channel`, `accountId`, `peerKind`, `peerId`, optional `threadId`), its Pi
`sessionId`, the `cwd` workspace, and the enabled `toolNames`. Bindings
auto-create with a deterministic id from a hash of the route key, and the
workspace defaults to
`<data-dir>/channel-workspaces/<channel>/<account>/<hash>` unless
`account.defaultCwd` is set (`channel-manager.ts:687-735`).

Each channel account carries an enabled `toolNames` list and a default DM policy
(pairing by default for Weixin/Telegram DM; Feishu defaults to `allowlist` when
an owner user id is known). Saving an account's tool names syncs them to every
already-bound session (`channel-manager.ts:267-288`).

## Channels-to-session lifecycle

- Slash commands (`/help`, `/status`, `/new`, `/compact`, `/reload`) are handled
  before normal agent routing when `commandsEnabled` is set
  (`channel-manager.ts:750-800`).
- `/new` starts an independent Pi session and rebinds; `/compact` compacts the
  bound session; `/reload` reloads extensions/Skills/Prompts/tools.
- Every completed external turn emits a `sessions.changed` so the desktop UI can
  refresh the bound session transcript even if the live stream was idle.

## Outbound rendering and media

- Telegram uses private-DM rich cards (streaming draft updates, then a final
  message) and plain messages for groups; it reacts with emoji status on the
  original message (`telegram/adapter.ts:77-90`).
- Feishu renders Markdown cards, streams thinking/tool progress, then collapses
  to a final card, and supports native menu triggers for the slash commands
  (`feishu/adapter.ts`).
- Weixin splits long text into chunks and sends via `sendText`/`sendWeixinAttachment`.

Model-visible user text is only the IM's actual text; the desktop uses
per-channel colors (black/Weixin-green/Telegram-blue/Feishu-orange) for
message bubbles in the shared UI.

Outbound generated files discovered from the final answer are attached and sent
per channel, subject to the file-send limits in
`OUTBOUND_FILE_CONTEXT` (`pi-session-bridge.ts:23-27`).

## Failure handling

- A stale Weixin token (`-14`) aborts the account with a "re-login" error rather
  than retrying (`weixin/adapter.ts:101-104`).
- Channel errors are redacted (`safeChannelError`) so credentials never leak
  into logs or UI.
- A failed inbound turn still records the activity + a confident error reply
  and rethrows so the lane/session still sees the failure.
- Deleted or renamed accounts stop the runtime and remove secrets/stores
  (`channel-manager.ts:324-332`).

## Related pages

- Agent Sessions and Project Workflows
- Configuration, Models, and Credentials
- RPC Contract and System API
- Built-in Browser Service
