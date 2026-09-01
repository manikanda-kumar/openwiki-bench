---
type: connector
title: Cloudflare Gatekeeper
description: The Cloudflare connector's three jobs from one connection — sign-in, AI Gateway billing, Workers Observability — its fail-closed scope model, per-binding capability enforcement against a provider that returns wrong-but-plausible data, and its layered module/test design.
tags: [gatekeeper, cloudflare, oauth, observability, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-1164d3d92447a95dd8fd3615
    resource: repo://packages/gatekeeper-cloudflare/__tests__/configurator-url.test.ts
  - id: openwiki-source-3f5b9cd2faa3bc1cceda94ff
    resource: repo://packages/gatekeeper-cloudflare/__tests__/worker.ts
  - id: openwiki-source-24766d6f832d32891f14e460
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare-api.ts
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-f54432c4f12c5ccb0500f999
    resource: repo://packages/gatekeeper-cloudflare/src/configurator/cloudflare-worker-configurator-ui.tsx
  - id: openwiki-source-9d44f971095fd6d92485975d
    resource: repo://packages/gatekeeper-cloudflare/src/oauth.ts
  - id: openwiki-source-10ac6e23496c97073a8dc923
    resource: repo://packages/gatekeeper-cloudflare/src/observability-api.ts
  - id: openwiki-source-1142111760e2bffeafc6d0ab
    resource: repo://packages/gatekeeper-cloudflare/src/observability-parse.ts
  - id: openwiki-source-ec66469620db1901154db9c1
    resource: repo://packages/gatekeeper-cloudflare/src/observability-session.ts
  - id: openwiki-source-97e30e98a169dad4c3d4ca6a
    resource: repo://packages/gatekeeper-cloudflare/src/resources.ts
  - id: openwiki-source-8d326f2424e61af99d5566db
    resource: repo://packages/gatekeeper-cloudflare/vite.config.ts
  - id: openwiki-source-62952ecf32bd44cc2bf96c8e
    resource: repo://packages/workshop-shared/src/cloudflare-gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Cloudflare Gatekeeper

`packages/gatekeeper-cloudflare` is one connected Cloudflare account serving three unrelated purposes: **sign-in** (`providesAuth`, allowlisted via `AUTH_GATEKEEPERS` — see [Authentication and User Accounts](../backend/auth-and-users.md)), **AI Gateway billing** (the Workshop's BYOK path obtains a usable API token from the account), and **Workers Observability** read-only telemetry. OAuth is plain authorization-code + PKCE against the dashboard endpoints, with client credentials via HTTP Basic (packages/gatekeeper-cloudflare/src/oauth.ts#L1-L9).

## One capability interface, three tiers

The billing piece is a Workshop-only extension of the generic account contract: `CloudflareGatekeeperUser.getUsableAccessToken()` returns a refreshed token or null for the billing flow, and is *never* exposed to gadgets or agents (packages/workshop-shared/src/cloudflare-gatekeeper.ts#L1-L18). Telemetry, by contrast, is exposed to gadgets/agents as ordinary scoped resources, and it has **two resource granularities — whole account, or one Worker — that both map to the single, indivisible `workers-observability.read` scope** (packages/gatekeeper-cloudflare/src/resources.ts#L3-L25). The consequence: **the capability boundary is the *binding*, not the grant** — a Worker-scoped binding must itself enforce that its answers only ever describe its own Worker.

Scopes fail closed. `BILLING_SCOPES` (`offline_access`, `aig.read`, `aig.run`, `user-details.read`, `account-settings.read` — deliberately no `openid`, identity comes from `/user`) is the floor, and observability scopes are appended only for explicitly selected resource patterns (oauth.ts#L11-L29). When the token response omits the granted `scope` list, the account records the *requested* list — never the full superset — because advertising an observability grant that was never made would make `ensureResources` short-circuit into a binding that 403s with no way to re-prompt (packages/gatekeeper-cloudflare/src/cloudflare.ts#L296-L302). Related: sign-in requests transient `AUTH_SCOPES` except for Cloudflare itself, whose billing scopes persist at login (packages/workshop-backend/src/server.ts#L670-L673; docs/ai-gateway-billing.md#L1-L5).

## Layered defense against a chatty provider

Module layering is the design: `observability-api.ts` is the *only* place talking HTTP; `observability-parse.ts` validates every response shape (a refusal never echoes the body — `parse` failures say only "something we refuse to interpret"); `observability-session.ts` is the agent-facing layer where **every** read funnels through one `#observe` that records the observation on the approval queue before returning data — no path exists that returns telemetry unaudited (packages/gatekeeper-cloudflare/src/observability-session.ts#L1-L10, #L95; observability-parse.ts#L46).

Three provider behaviours — each **verified against a live account** — return wrong-but-plausible data with no error, so none is trusted:

1. **`telemetry/keys` and `telemetry/values` ignore the `filters` they accept.** A constrained discovery call (Worker scope or caller filter) must therefore be answered from a *sample of a filtered `telemetry/query`* instead — that is why `observability-discovery.ts` exists — otherwise a "constrained" field listing would disclose the whole account (observability-api.ts#L462-L471, #L479-L512).
2. **An unknown filter key matches nothing — silently.** Because a log's own structured fields are *returned* nested under `source.` but *indexed* under their bare name, copying a path from a result into a filter would match nothing and report success; `observabilityFieldKey()` accepts both spellings, which can only ever narrow a query, never widen it, since the binding's own `$metadata.service` term is a separate, never-rewritten `AND` condition (observability-api.ts#L80-L98).
3. **`/accounts` paginates at 20 by default**, so one unpaginated GET would invisibly hide every account past the 20th; `listAccounts` walks pages (50/page, capped at 500 accounts) and leaves name matching to the caller because the endpoint's `name` parameter semantics are undocumented (packages/gatekeeper-cloudflare/src/cloudflare-api.ts#L78-L93).

For Worker-scoped bindings, the injected `$metadata.service` filter is paired with **re-filtering the response** (`#scopeEvents`): one surviving foreign event proves the filter was ignored — logged at `error` as an operational alarm — and the consequences are asymmetric. The provider's whole-account `count` is then *withheld* rather than reported (it would count telemetry the binding must not disclose), `statistics` are kept (they describe what the query cost, not what matched), and pagination cursors derive from the provider's *raw* events so a fully foreign page can't stall pagination and hide the caller's own older data (observability-api.ts#L377-L406, #L418-L437, #L520-L533). `listInvocations` additionally re-groups by request id and filters empty groups (observability-api.ts#L545-L560).

**`calculate()` is the one read with no second line of defence** — an aggregate cannot be re-checked or un-mixed — so it rests solely on the injected filter. The code documents this as accepted, not overlooked: `query` honoring filters is live-verified and load-bearing elsewhere, refusing aggregates to Worker bindings would remove their most valuable capability, recomputing from a sample would be confidently wrong, and the scopable-but-unverifiable group-by fix is deliberately deferred (observability-api.ts#L630-L649).

Provider *error text* is treated as hostile too: Cloudflare can echo a caller-supplied filter value back in an error message, so only the numeric provider `codes` (or a bare status) reach the audit log; the message itself travels only to the caller who caused it (observability-api.ts#L348-L365; `summarizeFilter` at #L39). Requests retry once on timeout/transport failure, honoring provider backoff hints for retryable statuses (observability-api.ts#L366-L373).

## Resource URL grammar and the configurator duplication

Resource URLs are `https://dash.cloudflare.com/<32-hex-accountId>/workers-and-pages/observability` (account) or `.../workers/services/view/<worker>/production/observability` (Worker); parsing validates and normalizes the account id at every boundary (`assertCloudflareAccountId`) (resources.ts#L29-L63). The `src/configurator/*.tsx` UI modules **must** re-implement that grammar rather than import it: the configurator build transpiles each file standalone, stripping only `@gadgets/configurator-ui` and type imports, so runtime helpers are unreachable (see [Gatekeeper Framework](framework.md)); `__tests__/configurator-url.test.ts` exists precisely to keep the copies in step (packages/gatekeeper-cloudflare/__tests__/configurator-url.test.ts#L1-L4).

## Testing shape

This package runs **two vitest projects**: `vitest.config.ts` for pure logic under Node, and `vitest.worker.config.ts` for the `RpcTarget`/Durable Object suite under workerd (the latter reaches the gatekeeper through a `TestHooks` Durable Object, because a `DurableObjectClass` carrying `ctx.props` is only instantiable via `ctx.facets` — the same way the overseer builds gatekeeper facets) (packages/gatekeeper-cloudflare/vite.config.ts#L1-L14; __tests__/worker.ts#L4-L6, #L38; see [Testing Approach](../development/testing.md)). The two passes are separate cached commands so one replays when only the other's inputs move.
