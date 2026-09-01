---
type: "Reference"
title: "Cloudflare gatekeeper: sign-in, billing, and telemetry"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-7c3a8d0a7ccea7201f2f73d4
    resource: repo://packages/gatekeeper-cloudflare/README.md
  - id: openwiki-source-24766d6f832d32891f14e460
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare-api.ts
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-9d44f971095fd6d92485975d
    resource: repo://packages/gatekeeper-cloudflare/src/oauth.ts
  - id: openwiki-source-10ac6e23496c97073a8dc923
    resource: repo://packages/gatekeeper-cloudflare/src/observability-api.ts
  - id: openwiki-source-ec66469620db1901154db9c1
    resource: repo://packages/gatekeeper-cloudflare/src/observability-session.ts
  - id: openwiki-source-97e30e98a169dad4c3d4ca6a
    resource: repo://packages/gatekeeper-cloudflare/src/resources.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Cloudflare gatekeeper: sign-in, billing, and telemetry

`packages/gatekeeper-cloudflare` is one connected account serving three unrelated purposes
(`packages/gatekeeper-cloudflare/README.md:1-19`):

1. **Sign-in** — when `cloudflare` is in the deployment's `AUTH_GATEKEEPERS` allowlist, it
   authenticates the user by the provider-verified account email (via the `/user` API with
   `user-details.read`). Sign-in with Cloudflare *also* establishes a persistent **billing-only**
   connection (`server.ts:636-655` passes `{scopes: "full", resourceUrlPatterns: []}` for
   Cloudflare specifically, unlike other auth gatekeepers' transient `scopes: "auth"` grants).
2. **AI Gateway billing** — the Workshop pulls a usable token via
   `GatekeeperUser.getUsableAccessToken()` to read the credit balance and route BYOK inference
   through the account's default AI Gateway (see
   [AI models & usage limits](/openwiki/operations/ai-models.md)).
3. **Workers Observability** — read-only telemetry bindings (account-wide or per-Worker) for logs,
   events, invocations, metrics, and traces.

## OAuth

Endpoints and scopes are **hardcoded** in `src/oauth.ts` (`dash.cloudflare.com/oauth2/auth` and
`/oauth2/token`, overridable via env for staging):

- `BILLING_SCOPES = offline_access, aig.read, aig.run, user-details.read, account-settings.read`
  (`oauth.ts:18-25`). `openid` is deliberately **not** requested — the dashboard OAuth client is
  not permitted it; identity comes from `/user` (`README.md:87-88`).
- `AUTH_SCOPES = offline_access, user-details.read` for the transient sign-in grant
  (`oauth.ts:35-39`).
- Persistent connections request billing scopes **plus** whatever the caller's
  `resourceUrlPatterns` select: `observabilityScopesForResources(undefined)` (omitted) and a
  non-empty array both yield `[workers-observability.read]`, while an **empty array yields no
  scopes at all** — the "empty means none" rule that keeps a billing-only connection from
  silently acquiring telemetry access (`resources.ts:68-75`; `gatekeeper.ts:440-443` documents the
  same distinction).
- The connect flow stores a nonce plus PKCE verifier in the `UserAccount` DO; the returned URL is
  `<base>/<userObjectId>/<initiationNonce>` (`cloudflare.ts:188-198`). The redirect URI is
  `${BASE_URL}/oauth`, i.e. `${PUBLIC_BASE_URL}/gatekeeper/cloudflare/oauth` (`README.md:118-136`).

`getAuthenticatedEmail()` fails open to `null` when there is no usable token or the identity read
fails (`cloudflare.ts:405-410`) — sign-in requires a *verified* email, which Cloudflare's `/user`
provides.

## Resource granularity vs. one scope

Two `SupportedResource`s are offered — account-wide observability
(`dash.cloudflare.com/:accountId/workers-and-pages/observability`) and single-Worker observability
(`.../services/view/:workerName/production/observability`) — but both map to the **single
indivisible** `workers-observability.read` scope (`resources.ts:7-25`). The OAuth grant cannot
express the difference; the **binding** is the capability boundary after connection: a
Worker-scoped gatekeeper injects its own `$metadata.service` filter and re-filters results.

Because scopes and resources are decoupled, `AccountDescription.grantedResourceUrlPatterns` is
derived from the granted scopes — either both patterns or none
(`cloudflare.ts:389-401`, `resources.ts:77-81`), and `ensureResources` expands the grant (a new
OAuth round trip) only when a requested pattern isn't already granted (`cloudflare.ts:412-417`).

## The observability session: one funnel, one audit invariant

`CloudflareObservabilitySessionImpl` routes **every** read through `#observe`, which fetches the
data first and then records the read (with a bounded description) on the approval queue before
returning anything — a read that reaches the agent but not the queue would be an unaudited
disclosure, so the wrapper is the invariant worth testing
(`observability-session.ts:1-6`, `95-107`).

Approval-queue entries are deliberately **value-free**: `summarizeFilter` renders filter keys and
operations but not filter *values* (they are caller text), capped at 5 conditions
(`observability-session.ts:32-56`).

## What the provider does that is never trusted

Three provider behaviours return wrong-but-plausible data with no error, verified against a live
account (`README.md:34-60`, `81-109`; enforced in `observability-api.ts`):

1. **`telemetry/keys` and `telemetry/values` ignore the `filters` they accept.** A Worker-scoped
   binding therefore never uses them when the call must be constrained — discovery is derived from
   a *filtered* `telemetry/query` events sample instead (`observability-api.ts:500-505` routes
   constrained discovery through `deriveKeys`/`deriveValues`).
2. **An unknown filter key matches nothing, silently.** A log's own structured fields are returned
   nested under `source` but indexed under their *bare* name, so
   `observabilityFieldKey()` accepts both spellings wherever a caller names a field — the rewrite
   cannot widen a query because the binding's own `$metadata.service` condition is a separate AND
   term that is never rewritten, and extra conditions only narrow
   (`observability-api.ts:83-118`).
3. **`/accounts` pages at 20 by default.** A single unpaginated GET hides every account past the
   first page, so the account walk is paginated to the end (bounded at 500 accounts; a mid-walk
   failure yields the partial list) (`cloudflare-api.ts:78-107`).

### The Worker binding's second line of defence

The scope filter is *prepended* to every query, but a filter the provider *accepted* is not
evidence it *applied* it. So Worker-scoped results are **re-filtered on the way out**
(`#scopeEvents` drops anything whose `$metadata.service` isn't the bound Worker). A single dropped
event is proof the filter was not applied, and the response is degraded rather than trusted:

- The provider's `count` is **withheld** — it would count the whole account's matching telemetry —
  and the drop is logged at `error` (`observability-api.ts:379-406`, `500-527`).
- `statistics` is **kept**, because it describes what the query cost, not how much matched
  (`observability-api.ts:520-524`).
- The pagination cursor is derived from the provider's **raw** events, not the surviving ones, so a
  fully-foreign page cannot stall pagination and hide the caller's own older data
  (`observability-api.ts:516-518`).

The re-check is deliberately *not* a hard failure: the events that survive are filtered and safe,
and turning a hypothetical disclosure into a guaranteed outage would be the worse trade
(`README.md:43-50`).

**`calculate()` is the known exception**: an aggregate cannot be un-mixed, so it has no second
line of defence and rests entirely on the injected filter — accepted and documented, with the
group-by fix recorded as a follow-up (`README.md:52-56`).

**Trace summaries are account-only**: their names, timing, services, and counts describe the whole
cross-service trace, so a Worker binding can fetch its own events for a known trace ID but not the
summary (`README.md:20-22`).

## Sharing a telemetry-reading gadget

A binding is not transferable. `addObserver` verifies each collaborator against **their own**
connected Cloudflare account's credentials; a verification failure for *any* reason is a refusal.
`deniesAccess()` classifies 400/401/403/404 as "credential lacks access", while anything else (5xx,
transport) must never be reported as a denial — mapping a 5xx to "denied" would be a silent
authorization decision and mapping it to "allowed" would admit an unauthorized reader
(`README.md:24-32`; `observability-api.ts:36-47`).

## Audit hygiene: error text never reaches the log

A provider error message can quote a caller-supplied filter value straight back, so logging the
message would readmit through the error path exactly what the audit path excludes.
`CloudflareObservabilityApiError` therefore carries Cloudflare's numeric `codes`; the request log
names the codes, and the message travels only to the caller who caused it. Because Cloudflare can
return a message with no numeric code at all, the error separately records whether the message is
the provider's or ours — only ours is logged, and an uncoded provider failure is logged as a bare
status (`README.md:90-101`).

## Setup

The OAuth client id/secret are configured on the gatekeeper (per-package `.env`, or seeded in dev
from `CLOUDFLARE_OAUTH_CLIENT_ID`/`CLOUDFLARE_OAUTH_CLIENT_SECRET` via `run-dev-server.ts`);
`workers-observability.read` must be on the client's scope allowlist whenever the deployment
offers observability resources (`README.md:111-166`).
