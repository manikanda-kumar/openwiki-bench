---
type: integration
title: "Cloudflare Gatekeeper (Auth, Billing, Observability)"
description: The single Cloudflare OAuth account serving three purposes — sign-in, AI Gateway billing, and Workers Observability — plus the scope fail-closed behavior and the observability layering.
tags: [gatekeeper, cloudflare, oauth, billing, observability]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-9b6f6a87a13c3accb0afc329
    resource: repo://docs/ai-gateway-billing.md
  - id: openwiki-source-7c3a8d0a7ccea7201f2f73d4
    resource: repo://packages/gatekeeper-cloudflare/README.md
  - id: openwiki-source-9d44f971095fd6d92485975d
    resource: repo://packages/gatekeeper-cloudflare/src/oauth.ts
  - id: openwiki-source-97e30e98a169dad4c3d4ca6a
    resource: repo://packages/gatekeeper-cloudflare/src/resources.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Cloudflare Gatekeeper (Auth, Billing, Observability)

`packages/gatekeeper-cloudflare` is a single Cloudflare OAuth connection that serves **three
unrelated purposes** from one connected account (`AGENTS.md`):

1. **Sign-in** — when `cloudflare` is in `AUTH_GATEKEEPERS`, "Continue with Cloudflare" appears on
   the login page; the grant reads the *verified* account email (via `/user`), which becomes the
   user's identity (`README.md`).
2. **AI Gateway billing** — the billing scopes are requested on connect/sign-in and persist; the
   Workshop reads a usable access token (via `getUsableAccessToken`) to power the AI Gateway billing
   flow — reading the credit balance and routing BYOK inference through the account's "default" AI
   Gateway (`docs/ai-gateway-billing.md`).
3. **Workers Observability** — gadgets can get read-only access to logs, events, invocations,
   aggregates, and traces either across an account or restricted to one Worker.

## One scope, one app, many bindings

All three ride on a single OAuth app and the single indivisible
`workers-observability.read` scope (`src/resources.ts:3`). There are **two resource granularities**
(whole account, or one Worker) that both map to that one scope; the capability boundary is therefore
the **binding**, not the grant (since re-fetching a Worker's telemetry is the same `read` grant the
whole account requires). `src/resources.ts` declares the two `SupportedResource`s:

- `ACCOUNT_OBSERVABILITY_RESOURCE` — `https://dash.cloudflare.com/:accountId/workers-and-pages/observability`
- `WORKER_OBSERVABILITY_RESOURCE` — `.../:accountId/workers/services/view/:workerName/production/observability`

Suggested binding names are `CLOUDFLARE_OBSERVABILITY` (account) and `WORKER_OBSERVABILITY` (one
Worker). Workers telemetry is retained at most seven days; queries default to the last hour, and the
Worker picker searches the full retention window.

> Unresolved in the README: whether the `workers-observability.read` scope alone is accepted or
> whether Cloudflare requires the Workers Observability **Write** permission to read telemetry —
> not verified against a live token. If reads 403 on a correctly-scoped grant, that is the first
> thing to check.

## Fail-closed scopes and grant mapping

Scopes **fail closed to `BILLING_SCOPES`** (`src/oauth.ts:18`), and an **omitted**
`resourceUrlPatterns` ("all resource types") is distinct from `[]` ("none")
(`AGENTS.md`):

- A billing-only connection must **not** silently acquire telemetry access, and
- recording a wider grant than was made would make `ensureResources` short-circuit into a binding
  that 403s with no way to re-prompt.

`persistentScopesForResources(resourceUrlPatterns)` (`src/oauth.ts:26`) returns `BILLING_SCOPES`
plus the observability scope when patterns are present/non-empty, else just billing. `grantedObservabilityResourcePatterns(scopes)`
only reports the observability resource patterns when the scope is actually present
(`src/resources.ts:68`). On reconnect, `beginOAuthFlow` reloads the stored scopes, failing closed to
`BILLING_SCOPES` on missing/corrupt state (`src/cloudflare.ts:267`).

## Observability layering

`AGENTS.md` sets the layering contract: `observability-api.ts` is the only place that talks HTTP;
`observability-parse.ts` validates every response (no blind casts); `observability-session.ts` is
the agent-facing session where **every read funnels through one `#observe`** so no path returns data
unaudited; `observability-discovery.ts` derives field names/values from a sampled events query.

Three provider behaviours return wrong-but-plausible data and are therefore not trusted (each
verified against a live account):

- `telemetry/keys`/`values` **ignore** the `filters` they accept, so a constrained discovery call is
  answered from a filtered `telemetry/query` sample or it would disclose the whole account.
- An unknown filter key matches nothing; a log's fields are returned nested under `source` but
  **indexed under their bare name** (`{event:"x"}` → `source.event`, queried as `event`), so
  `observabilityFieldKey` accepts the `source.` alias.
- `/accounts` pages at 20 by default, so it must be walked to the end.

**Worker-scoped bindings** prepend an immutable `$metadata.service` filter *and* re-filter the
response, because a filter the provider accepted is not evidence it applied it. A dropped event
proves the filter was dropped: the provider's own `count` is then withheld (it would count the whole
account's telemetry) and the drop is logged at `error`; `statistics` is kept (it describes the
query's cost). Trace *summaries* are account-only; a Worker binding can still fetch its own events
for a known trace id. `calculate()` rests solely on the injected filter (no second line of defense),
documented on the method with group-by fixed as a follow-up.

A provider error message can quote a caller-supplied filter value back, so only its numeric `codes`
are logged — filter *values* stay out of the audit trail (`summarizeFilter`).

## Sharing and observers

A binding is not transferable. When a gadget with an observability binding is shared, each
collaborator is admitted only if **their own** connected Cloudflare account can read that resource
(`addObserver` checks against their credentials, not the owner's); a failure for any reason (refusal,
5xx, transport error) is a refusal. Resource-specific observer strategy is **B** (ACL check) for both
granularities — there is no finer per-table tracking, matching the whole-account/one-Worker bindings.

## Billing details

`docs/ai-gateway-billing.md` is the billing narrative. Key points:

- Free tier: each user gets a daily LLM-call allowance (default 100 per UTC day), counted on the
  user's `UserDurableObject`; before each user-initiated agent turn the overseer calls
  `checkUsageAndBalance`. Connected users with balance ≥ `$2` are routed through their own account
  (BYOK) even while free-tier allowance remains; otherwise they get the free tier until exhausted,
  then a prompt to connect or add credits.
- The OAuth tokens live in the connected Cloudflare *gatekeeper* account — never in the Workshop;
  each `UserDurableObject` stores only lightweight billing state (selected account id + cached
  balance + the daily counter). The balance shown is read live from the AI Gateway
  `/ai-gateway-billing/credit_balance`, cached 5 minutes.
- Configuration: `ENABLE_CLOUDFLARE_LIMITS=true`, `AUTH_GATEKEEPERS=cloudflare` (plus others),
  `CF_AI_GATEWAY`, `CF_AI_GATEWAY_PROVIDERS`, `CF_AI_GATEWAY_ACCOUNT_ID`, and a transport —
  `WORKERS_AI` binding (pre-authenticated, gateway in the same account) or
  `CF_AI_GATEWAY_API_TOKEN`; a gateway in a different account sets `CF_AI_GATEWAY_USE_BINDING=false`.
  `DAILY_LLM_CALL_LIMIT` (100) and `MINIMUM_CLOUDFLARE_BALANCE` (2 USD) are optional.
- The dashboard OAuth endpoints and scopes are hardcoded in `src/oauth.ts`:
  `offline_access aig.read aig.run aig.write user-details.read account-settings.read` for billing.
  Redirect URI `${PUBLIC_BASE_URL}/gatekeeper/cloudflare/oauth`.

## Capability boundary and security

Because billing and observability both ride the Cloudflare connected account, the account
(the `GatekeeperUser`/`CloudflareGatekeeperUser` from `src/vendor.ts`/`cloudflare.ts`) is the
capability. The Workshop's `listGatekeeperVendors`/connect flows treat it as an ordinary connected
account (with a `CLOUDFLARE_VENDOR_ID = "cloudflare"` literal keyed in several places,
`src/user.ts:67`); `ensureResources` drives the incremental observability grant.
