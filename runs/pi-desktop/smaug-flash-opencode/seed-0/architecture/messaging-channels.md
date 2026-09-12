---
type: architecture
title: Messaging Channels (Feishu / Telegram / WeChat)
description: The external messaging-channel subsystem in the Agent Host that adapts WeChat, Telegram, and Feishu/Lark, enforces DM/group policiescars, schedules outbound turns per lane, and bridges inbound messages to Pi agent sessions.
tags: [architecture, channels, feishu, telegram, wechat, integration]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-675f64abd9b8550ea33cde07
    resource: repo://src/agent-host/channels/adapter-registry.ts
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-0c5ad2ceefae629223df3182
    resource: repo://src/agent-host/channels/config-store.ts
  - id: openwiki-source-336138f433d173abd9b68878
    resource: repo://src/agent-host/channels/lane-scheduler.ts
  - id: openwiki-source-1eccbf7b37a129a17a372912
    resource: repo://src/agent-host/channels/pi-session-bridge.ts
  - id: openwiki-source-f9bf8075e930cd298a1ae269
    resource: repo://src/agent-host/channels/policy.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-06d3c1ddaa04cfe2e426b662
    resource: repo://src/shared/channel-types.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Messaging Channels (Feishu / Telegram / WeChat)

The channel subsystem lets a configured chat account route messages to and from
Pi agent sessions. It lives inside the Agent Host and is surfaced to the
renderer through the `channels.*` RPC methods and `channels.status` /
`channels.activity` / `channels.pairing` / `channels.binding` / `channels.login`
streams.

## Adapter model and registry

`AdapterRegistry` (`src/agent-host/channels/adapter-registry.ts`) registers
three `ChannelAdapter` implementations for WeChat (`weixin`), Telegram, and
Feishu/Lark. Each adapter owns provider-specific transport (WebSocket / long
polling), rich-card / media rendering, login (including Feishu scan-login and
QR pairing), and outbound sends. `ChannelAdapter.start` receives the account,
the stored secret, an `AbortController` signal, a `ChannelStateStore` for
checkpoints, and an `onInbound` callback; it reports status via `onStatus`.
Feishu additionally supports the China (`feishu`) and international (`lark`)
domains.

## Account config, policies and secrets

`ChannelAccountConfig` (`src/shared/channel-types.ts`) carries the channel
id, credentials references, DM policy (`pairing | allowlist | open`), group
policy (`disabled | allowlist | open`), `allowFrom` / `groupAllowFrom` peer
lists, `requireMention`, opt-in slash commands, the default workspace `cwd`,
and the tool set allowed for that account.

Secrets are never stored in config. The manager's `secretAccess` calls the main
process (`channelSecrets.get/set/delete`), which stores them in the OS-backed
`CredentialVault` (`src/main/credential-vault.ts`, keyed
`channel:<channel>:<accountId>`). `ChannelConfigStore` persists account +
binding config to `channels.json`, `ChannelStateStore` persists state / activity
to `channels.state.json`, and `ChannelMediaStore` stages inbound media under
`channel-media/`.

`evaluateInboundPolicy` (`src/agent-host/channels/policy.ts`) computes the
inbound decision: for group messages it requires the group policy be enabled,
`requireMention` (when on) to be satisfied, and allowlist matches; for DMs it
allows `open`, allows listed senders, `pair`s for unknown senders under the
`pairing` policy, or `ignore`s otherwise.

## Inbound routing and pairing

On inbound (`ChannelManager.handleInbound`, serialized per route key by
`LaneScheduler`) the manager re-fetches the account and secret, evaluates the
policy, and routes: policy `ignore` is recorded as activity and dropped; policy
`pair` shows an approval (code + UI pairing prompt, `PAIRING_TTL_MS` = 10 min,
approval adds the peer to `allowFrom`); allowed inbound messages are routed to
binding resolution and then to the Pi session bridge. Empty inbound text
with no attachments gets a brief reply.

## Lane scheduling of outbound turns

`LaneScheduler` (`src/agent-host/channels/lane-scheduler.ts`) keys per-route
tails so messages from the same peer conversation execute strictly in order,
while allowing up to `maxConcurrent` (default 4) unrelated lanes in parallel.
Inbound chatter that arrives while a previous turn for the same route is still
running is queued behind it. Outbound agent turns and direct sends are also
scheduled through this scheduler, so fan-out stays fair across conversations
without reordering a single conversation's messages.

## Pi session bridge

`PiSessionBridge` (`src/agent-host/channels/pi-session-bridge.ts`) drives Pi
agent runs for channel turns. It binds an account to a workspace; messages in
a peer conversation open (or resume) an agent `AgentSessionWrapper` in that
binding's `cwd`, passing the account's `toolNames`. `open` first tries a live
session, then a session file on disk via `SessionManager.open`, else creates a
new `__channel__*` session. Communication uses the existing RPC session
machinery (`startRpcSession` / `getRpcSession`), and the bridge persists the
tool set per session. The channel prompt (`channelPromptText`) tells the agent
about the transport; outbound files are collected via
`collectOutboundFiles` with an explicit request check and size/count limits
(20 MiB, four files, outside-workspace/symlink guards).

## Slash commands and opt-in features

Commands enabled per account (`commandsEnabled`) are parsed by
`channel-commands.ts`; other messages flow to normal agent routing. Tool name
changes on an account propagate to its bindings and (through
`bridge.syncTools`) to open sessions.

## Persistence and failure model

Account, binding, state, and media-data stores use atomic temp-file + rename
writes with `0o600` modes. Channel status (`starting | running | reconnecting |
stopped | error`) and activity records are checkpointed in `ChannelStateStore`
and pushed to the renderer. Login flows (`channels.loginStart` / `loginWait` /
`loginSubmitCode` / `loginCancel`) and pairing approvals (`pairingApprove` /
`pairingReject`) route through the manager, and `channels.probe` validates
credentials before an account is activated. `connectAccount` enforces that the
credential already exists in the OS vault before probing and starting.
