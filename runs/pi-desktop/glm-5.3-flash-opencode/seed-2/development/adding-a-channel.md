---
type: change-guide
title: Adding a Channel
description: Step-by-step guide to adding a new messaging channel (adapter, registry, shared types, config/policy, renderer UI) in Pi Agent Desktop's channel subsystem.
tags: [channels, adapters, change-guide, telegram, feishu, weixin]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

Pi Agent Desktop supports three messaging channels (WeChat, Telegram, Feishu/Lark) behind a single adapter abstraction. Adding a fourth is a bounded change with obligations in the shared type union, the Host-side adapter registry, the policy/redaction layer, and the Renderer configuration UI.

## The contract you must implement

`ChannelAdapter` in `src/agent-host/channels/types.ts` is the integration seam (repo://src/agent-host/channels/types.ts#L104-L132). A minimal adapter implements `id`, `start`, `send`, and `probe`; the optional hooks cover inbound media download, rich turn streaming (`beginTurn` returning an `AdapterTurnOutput` with `update`/`finish`/`cancel`), typing indicators, and the login lifecycle (`startLogin`/`pollLogin`/`submitLoginCode`/`cancelLogin`) (repo://src/agent-host/channels/types.ts#L93-L119, repo://src/agent-host/channels/types.ts#L120-L132).

Contract obligations baked into the interface documentation:

- `downloadInbound` may only be invoked after Channel Core has accepted the sender policy — media download is never a pre-policy operation (repo://src/agent-host/channels/types.ts#L109-L110).
- `AdapterTurnOutput.finish` returns a `DeliveryReceipt` so Channel State can de-duplicate deliveries across reconnects (repo://src/agent-host/channels/types.ts#L88-L91).
- Login flows return an `AdapterLoginPollResult` that can carry an exchanged `credential: ChannelSecret` and an optional `finalize` callback the manager calls to clear adapter-held one-time credentials (repo://src/agent-host/channels/types.ts#L95-L103).
- Outbound attachments are explicit and opt-in; a text-only adapter may simply ignore them (repo://src/agent-host/channels/types.ts#L42-L45).

## Exact touchpoints for a new channel id

Channel identity is a string union, `ChannelId = "weixin" | "telegram" | "feishu"` in `src/shared/channel-types.ts` (repo://src/shared/channel-types.ts#L1). A new channel touches at least:

1. **Union + account config** — add your id and any provider-specific fields to the account config schema next to the existing `dmPolicy`/`groupPolicy`/`groupIds`/`requireMention` fields (repo://src/shared/channel-types.ts#L4-L26).
2. **Adapter implementation** — a new directory under `src/agent-host/channels/adapters/<id>/` following the existing layout: `adapter.ts` (lifecycle), `api.ts` (provider calls), `protocol-types.ts`, and a `rich-renderer.ts` if you need streaming drafts/cards. The Telegram adapter is a good reference for long-polling (`POLL_TIMEOUT_SECONDS = 30`, capped retry backoff, edit-based drafts) (repo://src/agent-host/channels/adapters/telegram/adapter.ts#L17-L20); the Feishu adapter shows the SDK/long-connection variant, menu command mapping, and reconnect backoff bounds (repo://src/agent-host/channels/adapters/feishu/adapter.ts#L21-L37).
3. **Registry wiring** — `AdapterRegistry`'s constructor registers all three adapters; add yours there (repo://src/agent-host/channels/adapter-registry.ts#L6-L11). Lookup is fail-fast: an unknown id throws `Channel adapter is unavailable` (repo://src/agent-host/channels/adapter-registry.ts#L19-L21).
4. **Config-store normalization** — `normalizeChannel` must accept the new id and map it to a default display name, otherwise account persistence will drop it (repo://src/agent-host/channels/config-store.ts#L46-L58).
5. **Secret vault key space** — `CredentialVault.validateKey` only accepts `channel:(weixin|telegram|feishu):<id>`-shaped keys (repo://src/main/credential-vault.ts#L9-L15). The same regex is enforced for writes from the Renderer via `desktop:set-channel-credential` (repo://src/main/ipc.ts, `setChannelCredential` wiring at repo://src/main/main.ts#L583-L585). Extend that regex for your channel.
6. **Manager display names** — `channelDisplayName` in Channel Manager maps ids to display labels (repo://src/agent-host/channels/channel-manager.ts#L65-L69).
7. **Renderer UI** — `src/renderer/components/channels/ChannelsConfig.tsx` hard-codes login flows and labels per channel (e.g., WeChat QR login at `channel: "weixin"`, Feishu `domain: FeishuDomain` flows) (repo://src/renderer/components/channels/ChannelsConfig.tsx#L226-L237, repo://src/renderer/components/channels/ChannelsConfig.tsx#L119-L126). Add login/labels/quick-binding affordances there or users cannot onboard the account.

## Policy, pairing, and redaction obligations

- Your adapter **must not** implement its own access control. Inbound envelopes flow through `evaluateInboundPolicy`, which decides `allow | pair | ignore` from the account's DM policy (`pairing` | `allowlist` | `open`), `allowFrom`, group policy, group id allowlist, sender allowlist, and `requireMention` (repo://src/agent-host/channels/policy.ts#L5-L22).
- Secrets must stay inside `ChannelSecret` and reach you only via the manager's `secretAccess`, which proxies to the encryurveypted vault through `channelSecrets.get/set/delete` parent RPC (repo://src/agent-host/channels/channel-manager.ts#L66-L73, repo://src/agent-host/channels/channel-manager.ts#L157-L167). Display surfaces use `fingerprintSecret` (last-4 dots) for credential previews (repo://src/agent-host/channels/channel-manager.ts#L241-L245).
- Every error you surface must pass through `safeChannelError` (bounded, redacted), and any provider response you log should pass `redactChannelText`/`redactChannelValue` so tokens and QR contents are scrubbed (repo://src/agent-host/channels/redaction.ts#L3-L33). This is enforced at the gate level too: `scripts/check-desktop-security.mjs` reads each existing adapter's `api.ts` and the channel stores as part of its invariant battery (repo://scripts/check-desktop-security.mjs#L19-L30), so a new channel should expect the same scrutiny.
- Media you download must be staged through `ChannelMediaStore` (bounded attachment counts per `CHANNEL_MEDIA_MAX_ATTACHMENTS`) rather than kept in adapter memory (repo://src/agent-host/managed-process/../channels/media-store.ts import at repo://src/agent-host/channels/channel-manager.ts#L14).

## Verification

- Co-located unit tests are the norm: each existing subsystem has a `*.test.mjs` next to it (`adapter-runtime.test.mjs`, `api.test.mjs`, `rich-renderer.test.mjs`, `app-registration.test.mjs` per adapter, plus `channel-core`/`channel-manager`/`policy` tests) — mirror that layout for your adapter (see listings under repo://src/agent-host/channels).
- `npm run check:desktop-security` must pass with your new files included in its read-set; `npm run verify` covers it together with lint/typecheck/contract checks (repo://scripts/verify.mjs#L1-L60).

## Related pages

- [Messaging Channels](/openwiki/workflows/messaging-channels.md) — how the manager drives adapters at runtime.
- [Security Model](/openwiki/architecture/security-model.md) — vault and redaction invariants.
