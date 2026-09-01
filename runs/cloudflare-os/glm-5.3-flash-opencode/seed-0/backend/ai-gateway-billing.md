---
type: ai-gateway-billing
title: "AI Models, AI Gateway, and Usage Limits"
description: How model calls are configured, routed, attributed, and billed — per-user model records, the ModelHandle routing layer, Cloudflare AI Gateway transports, cost extraction from gateway logs, the per-user daily quota, and the BYOK path that bills a user's own Cloudflare account.
tags: [ai, gateway, billing, quota, models, cloudflare]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-12053c1634ad623a82bc542e
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/cloudflare/connection-service.ts
  - id: openwiki-source-03120a7a50ab1a65a98ca3ef
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/config.ts
  - id: openwiki-source-e5a9d4ba90863e0f110878c9
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/limits/config.ts
  - id: openwiki-source-f0b2422fede5f7256bbd25f0
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts
  - id: openwiki-source-6a95a1b63b54e429109822de
    resource: repo://packages/workshop-backend/src/ai-gateway.ts
  - id: openwiki-source-1544c1a3e8233e50ede0f06a
    resource: repo://packages/workshop-backend/src/ai-invoke.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# AI Models, AI Gateway, and Usage Limits

Inference is configured per user, routed through (optionally) a Cloudflare AI Gateway, attributed per call, and billed either to the platform's free tier or to the user's own connected Cloudflare account ("BYOK").

## Model configuration

A model is an `AiModelConfig`: provider (`openai` | `anthropic` | `google` | `cloudflare` | `ollama`), model id, and optional `apiToken`/`apiUrl` for direct access (packages/workshop-shared/src/api.ts:1140-1177). Users manage their model list through `AuthenticatedApi` (`listModels`, `addModel`, `deleteModel`, `setQuickModel`, `getPreferredModel` — packages/workshop-shared/src/api.ts:381-428), and the records live on the user Durable Object as `UserAiModelRecord` (profile + config), with a separate quick-model slot for cheap tasks (packages/workshop-backend/src/user.ts:69-78).

`SUGGESTED_MODELS` (in the shared API module) is the catalog the UI offers and the **authoritative source for token windows** — compaction budgets in `agent-compaction.ts` are computed from it and must not change (packages/workshop-shared/src/api.ts:1186-1214, packages/workshop-backend/src/ai-models.ts:141-143).

## ModelHandle: routing as a closed-over capability

`getModel(env, config, ...)` resolves a `ModelHandle` — a pi model descriptor plus a `stream` function that **closes over the routing** (endpoint, auth headers, gateway attribution metadata, session affinity), so callers never handle credentials themselves (packages/workshop-backend/src/ai-models.ts:72-104, 356+). Every gateway-bound request carries a `GatewayMetadata` attribution schema: the user id, an execution-context `source` (`chat`, `thread-title`, `gadget-title`, `model-binding`), optional `gadgetId`/`chatId`, and an `automated` flag for gadget-initiated calls (packages/workshop-backend/src/ai-models.ts:29-59, 106-115).

The handle also exposes `aiGatewayLogRoute` (the gateway and credentials needed to retrieve the request's cost log) and `lastResponse` (status and AI Gateway log id of the most recent HTTP response, reset per request; turns run sequentially so this is safe to read right after a request) (packages/workshop-backend/src/ai-models.ts:90-103).

## AI Gateway mode

AI Gateway mode activates when `CF_AI_GATEWAY` is set, and **requires** `CF_AI_GATEWAY_ACCOUNT_ID` (packages/workshop-backend/src/ai-gateway.ts:52-56, 148-155). Two transports are possible:

- **Workers AI binding** (`WORKERS_AI`), used whenever present unless `CF_AI_GATEWAY_USE_BINDING=false` opts out. Binding requests are pre-authenticated in-account, so no API token is needed — but they can only reach gateways in the Worker's own account, which the Worker cannot verify itself; deployments whose gateway lives in a different account must opt out and use the token. The binding is also what `webFetch`'s to-Markdown conversion uses, so it must not simply be unbound (packages/workshop-backend/src/ai-gateway.ts:30-51, 60-78).
- **HTTPS with `CF_AI_GATEWAY_API_TOKEN`** — required outright for "HTTPS-only" providers whose pi adapter refuses a custom fetch (currently `google`; the constructor fails startup if such a provider is enabled without a token) (packages/workshop-backend/src/ai-gateway.ts:9-27, 73-92).

Provider availability is gated by the `CF_AI_GATEWAY_PROVIDERS` allowlist. When gateway mode is on, per-config `apiToken`/`apiUrl` values are ignored and real values come from env (packages/workshop-backend/src/ai-gateway.ts:76-92, 116-133).

Routing always speaks each provider's **native API through the gateway root** (over `https://gateway.ai.cloudflare.com/v1/{accountId}/{gateway}` or the binding's `https://workers-binding.ai/ai-gateway/gateways/{gateway}`), and deliberately never uses AI Gateway's unified `/compat` OpenAI-translation layer, because it drops provider features pi relies on: extended thinking, Anthropic `cache_control` prompt caching, and the OpenAI Responses API (packages/workshop-backend/src/ai-models.ts:167-177).

The **quick model** used for titles is pinned to Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) — chosen in the code as fast/cheap/good-enough (packages/workshop-backend/src/ai-gateway.ts:6-15, 138-145).

## Cost accounting

Costs come from AI Gateway logs, not estimates: after a turn step, the overseer passes the gateway log id and route; `getAiGatewayLogCost` reads the authoritative cost asynchronously, with pi's catalog-priced `estimatedCost` as the fallback when no log route exists (packages/workshop-backend/src/agent.ts:357-378, packages/workshop-backend/src/ai-gateway.ts:157-186). Cost values are validated (`validateLogCost` rejects non-numeric or negative values) and unavailability is a retryable error, since the log may not exist yet (packages/workshop-backend/src/ai-gateway.ts:165-173).

Provider failures are never exceptions in pi — they surface as an assistant message with `stopReason "error"` — so `AgentTurnError` converts that shape back into an exception (carrying the HTTP status when observed) for callers that need one (packages/workshop-backend/src/ai-invoke.ts:21-33).

## Usage limits and the BYOK path

The whole limits flow is opt-in: `ENABLE_CLOUDFLARE_LIMITS=true` enables it; otherwise usage is unlimited and no balance checks occur (packages/workshop-backend/src/ai-gateway-billing/config.ts:20-28). When enabled:

- The **daily free-tier counter** lives on the user Durable Object (`consumeDailyLlmCall` / `checkDailyLlmCount`), keyed by UTC day, resetting at next UTC midnight; the limit comes from `DAILY_LLM_CALL_LIMIT` env (falling back to the shared `DEFAULT_DAILY_LLM_CALL_LIMIT`; non-positive/unparseable values also fall back) (packages/workshop-backend/src/ai-gateway-billing/limits/config.ts:1-40).
- `checkUsageAndBalance` implements the billing rule (packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts:1-15, 57-126):
  - **Connected + balance ≥ minimum → BYOK.** The request bills the user's own gateway; the daily counter is *not* consumed, reserving the platform free tier for everyone else. Routing (`accountId` + access token) is resolved here so the caller needn't decrypt the token twice.
  - **Otherwise → platform free tier.** One call is consumed per request; once exhausted, requests are blocked. A blocked request never increments the counter (`consumeDailyLlmCall` no-ops past the limit).
  - An unreadable/absent balance is treated as "not funded", falling back to the free tier rather than attempting a BYOK call that would fail.
- The Cloudflare OAuth tokens live in the user's connected Cloudflare **gatekeeper account**; the connection service obtains a usable token from it, resolves which account to bill (with a 5-minute balance cache and a `needsAccountSelection` prompt when the grant sees multiple accounts), and routes BYOK inference through the account's auto-created "default" AI Gateway via Unified Billing. The access token is sensitive and never sent to the client (packages/workshop-backend/src/ai-gateway-billing/cloudflare/connection-service.ts:1-58).

`getUsageInfo` is the read-only variant the UI uses to render usage banners — it never counts a call and reads quota and connection status in parallel (packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts:128-168).

## Models as a gatekeeper resource

`LanguageModelGatekeeper` is a Durable Object implementing the `Gatekeeper<LanguageModelBinding>` contract, so gadgets can bind an AI model as a resource: `describe()` advertises suggested binding name `LLM` and the `LanguageModelBinding` type; `startSession()` returns a binding whose `run(prompt, systemPrompt)` performs one-shot completion through the routed model. It declares no actions (apply/reject/revert all throw), and `addObserver` is a no-op because nothing read through a model identifies an observer or leaks private data (packages/workshop-backend/src/ai-models.ts:650-729).

## Related pages

- [Gatekeeper Contract](/openwiki/gatekeepers/contract.md) — the `Gatekeeper` interface `LanguageModelGatekeeper` implements.
- [AI Agent System](/openwiki/backend/agent-system.md) — where quota checks and cost accounting attach to turns.
- [Shipped Gatekeeper Connectors](/openwiki/gatekeepers/connectors.md) — the Cloudflare gatekeeper that stores the BYOK OAuth tokens.
