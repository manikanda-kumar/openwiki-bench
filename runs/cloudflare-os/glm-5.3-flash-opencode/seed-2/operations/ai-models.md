---
type: operations
title: AI model routing, gateway, and usage limits
description: How a chat's model is resolved and routed — BYOK through the user's own AI Gateway, the platform gateway free tier, or direct provider credentials — plus the LanguageModelGatekeeper binding, the usage/balance decision tree, and the pi-ai integration.
tags: [ai, gateway, billing, routing, models]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-9b6f6a87a13c3accb0afc329
    resource: repo://docs/ai-gateway-billing.md
  - id: openwiki-source-1dbc01f21b86e2fc8ca05a55
    resource: repo://docs/public-server.md
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-12053c1634ad623a82bc542e
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/cloudflare/connection-service.ts
  - id: openwiki-source-f0b2422fede5f7256bbd25f0
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts
  - id: openwiki-source-6a95a1b63b54e429109822de
    resource: repo://packages/workshop-backend/src/ai-gateway.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-407053357c815308038ae6a5
    resource: repo://packages/workshop-shared/src/limits.ts
  - id: openwiki-source-8a0ed3f1793eb7f5b05740d5
    resource: repo://plans/pi-impl.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# AI model routing, gateway, and usage limits

Users configure models in two shapes: their **own** model configs (provider + model + credentials,
stored in the user DO) and, when the platform has an AI Gateway configured, **gateway models**
offered by the deployment (`docs/ai-gateway-billing.md`). The user DO's `getChatContext` resolves
the requested model (gateway first) and the quick model used for titles
(`packages/workshop-backend/src/user.ts:694-727`).

## Three routing modes, in precedence order

`getModel(env, config, initiator, options)` picks one of three transports
(`packages/workshop-backend/src/ai-models.ts:350-376`):

1. **BYOK user gateway** (`options.userGateway`) — a connected user's own Cloudflare account pays
   for everything, routed through their account's auto-created "default" AI Gateway with
   `cf-aig-authorization` (authorized by the token's `aig.run` scope). Honored *regardless* of
   whether a platform gateway exists, so connected users are always billed correctly
   (`ai-models.ts:359-366`, `381-416`).
2. **Platform AI Gateway** (`getAiGatewayConfig(env)` non-null) — the platform-funded free tier.
   The config's own `apiToken`/`apiUrl` are ignored in this mode. Every provider — Workers AI
   included — rides the same gateway with the same log route and attribution metadata
   (`ai-models.ts:368-373`, `440-486`).
3. **Direct** — the config's own credentials against the provider (`getModelDirect`,
   `ai-models.ts:508-646`): Anthropic, OpenAI, Google, Workers AI (REST, account-scoped), and
   Ollama (with `supportsDeveloperRole: false` because some Ollama models silently drop the system
   prompt otherwise).

The handle carries an `aiGatewayLogRoute` when a gateway was involved, which is how per-request
cost is read back from the gateway's logs (`ai-models.ts:410-415`).

**The binding transport caveat**: the platform gateway can carry traffic over the `WORKERS_AI`
binding (pre-authenticated in-account, no API token) *only when the Gateway lives in the Worker's
own account* — the Worker can't verify that at runtime, so deployments whose gateway is elsewhere
must set `CF_AI_GATEWAY_USE_BINDING=false`. Unbinding `WORKERS_AI` is not an alternative: it also
backs webFetch's document-to-Markdown conversion. The Google provider's pi adapter refuses a custom
fetch entirely, so the API token is required whenever `google` is an enabled provider
(`ai-gateway.ts:10-23`, `51-95`; `docs/public-server.md:50-64`).

## The LanguageModelGatekeeper binding

Gadgets can bind an AI model like any resource: `LanguageModelGatekeeper` is a core-implemented
`Gatekeeper<LanguageModelBinding>` describing itself as `models.local/<provider>/<model>` with
suggested binding name `LLM`. Its session exposes `run(prompt, systemPrompt?)`; there are no
actions (reads only), and observers are accepted unconditionally because nothing read through a
model identifies the observer or leaks private data (`ai-models.ts:657-712`). A per-request
initiator + metadata ride the gatekeeper's props so gateway logs attribute costs to the right
gadget/chat.

## The usage/balance decision tree

With `ENABLE_CLOUDFLARE_LIMITS` unset (self-hosted default), `checkUsageAndBalance` returns
"unlimited" and never touches the user object (`usage-checker.ts:44-70`). When enabled, before
each user-initiated agent turn (`overseer.ts:5748-5773`):

1. Resolve the Cloudflare connection (token from the connected **Cloudflare gatekeeper** account
   via `getUsableAccessToken`; auto-select the billing account when the grant sees exactly one;
   read the credit balance, cached for 5 minutes) (`connection-service.ts:60-130`).
2. **Connected + balance ≥ minimum ($2 default)** → allowed, `shouldUseByok` — inference routes
   through the user's own gateway and the **daily counter is not consumed** (the platform free
   tier is reserved for everyone else).
3. **Otherwise** → the platform free tier, consuming one daily call (`consumeDailyLlmCall`,
   atomic per UTC day, no-op once exhausted so a blocked request never counts). When the counter
   is exhausted: blocked with a connect prompt (not connected) or a top-up prompt (connected but
   under-funded) (`usage-checker.ts:90-130`; `packages/workshop-shared/src/limits.ts:9-42`).

The user DO stores only lightweight billing state (selected account + cached balance + daily
counter) — never tokens (`docs/ai-gateway-billing.md:91-97`). The Cloudflare dashboard OAuth
endpoints/scopes are hardcoded in the gatekeeper (see
[the Cloudflare gatekeeper page](/openwiki/gatekeepers/cloudflare-gatekeeper.md)).

## pi-ai integration

The inference layer is `@earendil-works/pi-ai` + `pi-agent-core` (the migration is documented in
`plans/pi-impl.md`): the loop is `runAgentLoopContinue` with sequential tool execution and identity
`convertToLlm`; Anthropic prompt caching uses pi's automatic behavior. Providers are imported
per-provider (never `providers/all`, which would drag ~30 providers into the bundle), and model
metadata (context windows, output limits, compat flags) comes from pi's per-provider model
catalogs with `getModelTokenLimits` falling back to 128k for unknown models
(`plans/pi-impl.md`; `ai-models.ts:11-23`, `129-176`; `agent-compaction.ts:19-37`).
