---
type: operations
title: AI Models and AI Gateway Billing
description: How AI models are configured, resolved, and billed — user-owned model configs, the LanguageModelGatekeeper binding, AI Gateway routing and cost accounting, and the optional free-tier/Cloudflare-credits flow with its decision table and env vars.
tags: [ai-models, ai-gateway, billing, byok, free-tier, env-vars]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-9b6f6a87a13c3accb0afc329
    resource: repo://docs/ai-gateway-billing.md
  - id: openwiki-source-9d44f971095fd6d92485975d
    resource: repo://packages/gatekeeper-cloudflare/src/oauth.ts
  - id: openwiki-source-f0b2422fede5f7256bbd25f0
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts
  - id: openwiki-source-6a95a1b63b54e429109822de
    resource: repo://packages/workshop-backend/src/ai-gateway.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# AI Models and AI Gateway Billing

## Model configuration: user-owned, workspace-independent

Users configure models on their `UserDurableObject` (`listModels`/`addModel`/`deleteModel`, plus a `quickModel` for cheap tasks like chat titles and a `preferredModel`). A model record (`UserAiModelRecord`) holds the display profile plus an `AiModelConfig`: `provider` (Anthropic/OpenAI/Google/Cloudflare Workers AI/...), `model` name, the provider `apiToken`, and (for the account-scoped Cloudflare provider) the account ID (src/user.ts:69-77; api.ts:1151-1166). Because the config lives on the user's DO, models are workspace-independent — "the list returned here could be different from a particular gadget's Overseer, especially if the gadget is owned by someone else" (api.ts:382-386) — and a collaborator's chat bills their own configured model, not the owner's (docs/sharing.md:22).

## Model resolution: `getModel` and `LanguageModelGatekeeper`

`getModel(env, config, initiator, options)` resolves a config into a `ModelHandle` that closes over the routing (endpoint, auth headers, AI Gateway attribution metadata, session affinity, optional BYOK gateway routing) so callers never handle credentials themselves (src/ai-models.ts:28-56, 356). pi-ai streams never reject for provider failures; failures surface as a final AssistantMessage with `stopReason: "error"/"aborted"` (src/ai-models.ts:52-55). One-shot calls (`completeText` — titles, binding names, compaction summaries, gadget model bindings) pass `thinking: false` to suppress the handle's per-API reasoning defaults (src/ai-models.ts:41-49).

Within a workspace, an AI-model binding is a gatekeeper: `LanguageModelGatekeeper` implements the `Gatekeeper<LanguageModelBinding>` contract with the model config in its `ctx.props` — `describe()` names the model, `startSession(approvalQueue)` resolves the model and returns a `LanguageModelBinding`, and it implements no actions (apply/reject/revert all throw "This gatekeeper implements no actions") since inference is read-like (src/ai-models.ts:657-703). Its binding props also carry the initiator and gateway metadata context (chat vs gadget-initiated attribution: `source: "chat" | "thread-title" | "gadget-title" | "model-binding"` plus gadgetId/chatId, src/ai-models.ts:31-45).

## AI Gateway routing

When the deployment sets `CF_AI_GATEWAY`, every provider — Workers AI included — routes through the platform's AI Gateway (src/ai-gateway.ts:22-96; docs/ai-gateway-billing.md:63-73). The config requires `CF_AI_GATEWAY_ACCOUNT_ID` whenever the gateway is set. Two transports:

- **Workers AI binding (`WORKERS_AI`)** — used as the gateway transport whenever present unless `CF_AI_GATEWAY_USE_BINDING=false`: binding requests are pre-authenticated in-account, so inference and cost-log reads need no API token. Binding requests only reach gateways in the Worker's own account and the Worker can't verify that itself, so a deployment whose Gateway lives in a *different* account must set the opt-out and use the token transport (src/ai-gateway.ts:39-52). The opt-out is a flag rather than an unbinding because the binding also backs webFetch's document-to-Markdown conversion (`env.ai.toMarkdown()`), so unbinding would break that too (docs/ai-gateway-billing.md:69-72).
- **`CF_AI_GATEWAY_API_TOKEN`** over HTTPS — required without the binding transport, and *always required for the `google` provider* regardless, because pi's Google adapter refuses a custom fetch ("HTTPS_ONLY_PROVIDERS", src/ai-gateway.ts:7-21).

Gateway requests carry Gadgets-owned attribution metadata (user, source, gadgetId, chatId, `automated`) for cost accounting (src/ai-models.ts:31-45).

## The free-tier / credits flow (optional; off by default)

When `ENABLE_CLOUDFLARE_LIMITS=true`, each user gets a free daily allowance of LLM calls per UTC day (default 100, `DAILY_LLM_CALL_LIMIT`), counted on their own User DO (`dailyLlmCount` singleton; a stale `day` implicitly resets) (src/user.ts:215-218; docs/ai-gateway-billing.md:9-10). Before each user-initiated agent turn the overseer calls `checkUsageAndBalance` (src/ai-gateway-billing/limits/usage-checker.ts:1-20, 76-110), whose decision table is:

- **Limits disabled** → always allowed, no counter touched (self-hosted/unlimited).
- **Connected + balance ≥ minimum (`MINIMUM_CLOUDFLARE_BALANCE`, default 2 USD)** → billed to the user's own gateway (BYOK); the daily counter is *not* consumed — "the platform free tier is reserved for everyone else".
- **Connected but balance below minimum (incl. $0), or not connected** → platform free tier; the counter is consumed and, once exhausted, the request is blocked with a prompt to connect or add credits.

The balance is read live from the Cloudflare AI Gateway billing endpoint and cached (5 minutes per docs/ai-gateway-billing.md:22-26); the connected Cloudflare account is auto-selected when the grant sees exactly one account, else the user chooses. The billing token comes from the Cloudflare *gatekeeper's* stored connection (`getUsableAccessToken`), and the User DO stores only lightweight billing state — no tokens (docs/ai-gateway-billing.md:29-33, 91-97). Topping up means adding credits in the Cloudflare dashboard; the platform never holds money.

## Cloudflare OAuth scopes

The Cloudflare gatekeeper hardcodes its dashboard OAuth endpoints and scopes (src/oauth.ts:1-37): auth/token at `dash.cloudflare.com/oauth2/{auth,token}`, billing scopes `offline_access aig.read aig.run user-details.read account-settings.read` (deliberately *not* `openid` — identity comes from `user-details.read` via the /user API; `offline_access` yields the refresh token; `account-settings.read` enumerates accounts), plus observability scopes only when observability resources are selected. Sign-in uses the minimal `AUTH_SCOPES` (`offline_access`, `user-details.read`) with a transient grant.

## Env vars (recap)

`CF_AI_GATEWAY`, `CF_AI_GATEWAY_PROVIDERS`, `CF_AI_GATEWAY_ACCOUNT_ID`, `CF_AI_GATEWAY_API_TOKEN`, `CF_AI_GATEWAY_USE_BINDING`, `ENABLE_CLOUDFLARE_LIMITS`, `DAILY_LLM_CALL_LIMIT`, `MINIMUM_CLOUDFLARE_BALANCE` (src/ai-gateway.ts:73-96; src/env.d.ts:72-87; docs/ai-gateway-billing.md:42-93). In dev, `WORKERS_AI` is added only with `pnpm run dev-server -- --use-workers-ai-binding`, and the frontend/backend dev proxying is handled by the dev scripts (docs/ai-gateway-billing.md:66-71).
