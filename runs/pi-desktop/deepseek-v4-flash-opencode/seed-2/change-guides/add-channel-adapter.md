---
type: "Reference"
title: "Change guide: add a channel adapter"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T15:27:00.466Z
---


# Change guide: add a channel adapter

This guide walks through adding a new messaging channel to the channel framework. The framework lives in `src/agent-host/channels/` and is driven by `ChannelManager`; the three existing adapters are WeChat (`weixin`), Telegram, and Feishu/Lark (`feishu`).

## 1. Understand the contract

The adapter contract is `ChannelAdapter` in `src/agent-host/channels/types.ts`. Every adapter must implement:

- `id: ChannelId` — the stable channel identifier.
- `start(context: AdapterStartContext)` — long-running runtime that pumps inbound messages and reports status. It receives an `AbortSignal`, a `ChannelStateStore` (for processed-event dedupe and cursors), `onInbound(envelope)`, and `onStatus(patch)`.
- `send(context: AdapterSendContext): Promise<DeliveryReceipt>` — deliver text (and optional outbound attachments) to a peer, honoring `contextToken`, `threadId`, and `replyToMessageId`.
- `probe(account, secret): Promise<ChannelProbeResult>` — validate credentials before an account is persisted.

Optional capabilities (implement only if supported):

- `downloadInbound(context)` — download provider media after Channel Core has accepted the sender policy; returns `DownloadedInboundAttachment[]`.
- `beginTurn(context): AdapterTurnOutput` — progressive/streaming output with `update(progressEvent)` + `finish(text)` + `cancel()`.
- `setTyping(context)` — typing indicator.
- `startLogin` / `pollLogin` / `submitLoginCode` / `cancelLogin` — interactive login (QR, token, app registration).

Reference implementations: `src/agent-host/channels/adapters/weixin/adapter.ts` (long-poll + QR login), `telegram/adapter.ts` (BotFather token), `feishu/adapter.ts` (official SDK WebSocket + Card rendering). Each also has an `api.ts` (provider REST calls), `protocol-types.ts` (raw provider types), and `rich-renderer.ts` (message formatting).

## 2. Register the adapter

`AdapterRegistry` (`adapter-registry.ts`) constructs the three adapters in its constructor. Add yours there:

```ts
import { MyAdapter } from "./adapters/mychannel/adapter";
this.register(new MyAdapter());
```

`ChannelManager` resolves adapters only through `this.registry.get(account.channel)` (`channel-manager.ts:360`), so registration is the single wiring point.

## 3. Extend the shared channel type unions

The `ChannelId` union lives in `src/shared/channel-types.ts`:

```ts
export type ChannelId = "weixin" | "telegram" | "feishu"; // add "mychannel"
```

`ChannelLoginStartRequest` (also in `channel-types.ts`) is a discriminated union keyed by channel — add a variant if the new channel has an interactive login. The RPC surface in `src/contract/api.ts` uses these types (`channels.loginStart` etc.), so the typed contract follows automatically. The credential vault key validator in `src/main/credential-vault.ts:12` restricts keys to `channel:(weixin|telegram|feishu):...` — extend that regex for new channels or credential writes will be rejected.

## 4. Implement inbound handling

`ChannelManager.handleInbound` (`channel-manager.ts:837-996`) drives every inbound message:

1. Per-route serialization via `LaneScheduler.run(routeKey, ...)` — messages from the same peer/thread are processed in order.
2. `evaluateInboundPolicy(account, envelope)` from `policy.ts` returns `allow` | `ignore` | `pair`, gating DMs, group allowlists, and `@mention` requirements.
3. Empty text with no attachments gets a "message content empty" reply.
4. Attachments (when present and the adapter implements `downloadInbound`) are downloaded then staged through `ChannelMediaStore.stage`; failures reply with a media error and are recorded as ignored activity. Attachment count is capped at `CHANNEL_MEDIA_MAX_ATTACHMENTS`.
5. The turn is dispatched either to a slash command (`parseChannelCommand` when `commandsEnabled`) or to `PiSessionBridge.runTurn`, which binds/creates a Pi session. After the turn, the session change is re-emitted so the desktop chat updates.

Your adapter's `start` loop must therefore: connect, handle reconnects, dedupe already-processed events via `state.isProcessed(account.id, eventId)` and advance `state.getCursor`/`setCursor`, and translate provider messages into the `InboundEnvelope` shape (`src/shared/channel-types.ts` `InboundEnvelope`).

## 5. Outbound rendering

Text is split to channel limits with `splitChannelText` from `outbound-renderer.ts`. For streaming-capable channels implement `beginTurn` to render progressive agent events (message/tool_start/tool_update/tool_end) — see `ChannelTurnProgressEvent` in `types.ts`. Telegram streams previews and Feishu uses interactive Cards; adapters that do not support streaming can fall back to a single final `send`.

## 6. Login flows and secrets

Login is interactive per channel:

- WeChat: QR (`startQrLogin`/`pollQrLogin`), with `localTokens` from existing accounts passed to avoid duplicate sessions (`channel-manager.ts:426-433`).
- Telegram: token-based via `probe`; no interactive login.
- Feishu: app registration + QR scan (`app-registration.ts`), with the returned appId validated against the account id and domain.

Credentials are stored as `ChannelSecret` (`types.ts`) through the OS-encrypted vault (`callMain("channelSecrets.set", ...)`), never in plaintext config. `pollLogin` returns a `finalize` hook to clear one-time credentials after `ChannelManager` handles the result.

## 7. Config and state

- `ChannelConfigStore` (`channels.json`) holds accounts and bindings; `ChannelStateStore` (`channels.state.json`) holds cursors, processed ids, pairings, deliveries, and activities.
- `ChannelManager.initialize` starts every enabled account; `connectAccount` probes then persists, and failure rolls back secret, config, state, and status (`channel-manager.ts:290-322`).
- Tool-permission sync: when an account's `toolNames` change, all its bound sessions are re-synced via `bridge.syncTools` (`channel-manager.ts:267-284`).

## 8. Validate

Every channel has adapter-runtime tests and an API test, e.g. `src/agent-host/channels/adapters/weixin/adapter-runtime.test.mjs` and `api.test.mjs`, plus core tests in `channel-core.test.mjs` and `channel-manager.test.mjs`. Run:

```bash
npm test
```

Contract coverage (`npm run check:contract`) will not pass until any new API method/handler pairs are covered. If you add a channel to `ChannelId`, also extend the credential-vault key regex and add a runtime test proving the adapter's start loop, dedupe, policy handling, and media staging behave.