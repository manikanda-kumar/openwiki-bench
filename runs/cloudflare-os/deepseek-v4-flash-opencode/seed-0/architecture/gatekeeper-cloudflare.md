---
type: subsystem
title: Cloudflare gatekeeper
description: The Cloudflare gatekeeper serves three unrelated purposes from one OAuth connection — sign-in, AI Gateway billing, and Workers Observability read-only telemetry — with resource granularities, strict response-validation layering, worker-scoped filter guarantees, and scopes that fail closed.
tags: [gatekeeper, cloudflare, observability, oauth, billing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-9d44f971095fd6d92485975d
    resource: repo://packages/gatekeeper-cloudflare/src/oauth.ts
  - id: openwiki-source-10ac6e23496c97073a8dc923
    resource: repo://packages/gatekeeper-cloudflare/src/observability-api.ts
  - id: openwiki-source-cf2d4b8577895131a73f5824
    resource: repo://packages/gatekeeper-cloudflare/src/observability-discovery.ts
  - id: openwiki-source-1142111760e2bffeafc6d0ab
    resource: repo://packages/gatekeeper-cloudflare/src/observability-parse.ts
  - id: openwiki-source-ec66469620db1901154db9c1
    resource: repo://packages/gatekeeper-cloudflare/src/observability-session.ts
  - id: openwiki-source-97e30e98a169dad4c3d4ca6a
    resource: repo://packages/gatekeeper-cloudflare/src/resources.ts
  - id: openwiki-source-552d0a9f1d26b2131ddadd4e
    resource: repo://packages/gatekeeper-cloudflare/src/vendor.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Cloudflare gatekeeper

`packages/gatekeeper-cloudflare` is one connected account that serves **three unrelated purposes**:
sign-in (`providesAuth`), AI Gateway billing / BYOK top-up, and Workers Observability read-only
telemetry. The three share a single OAuth app; what distinguishes them is the **scope set** requested
and the **resource binding** created later. Scopes fail closed to the billing set, and the
observability capability boundary is the *binding*, not the grant.

## One OAuth app, three purposes

The OAuth client is a minimal authorization-code + PKCE client against the Cloudflare dashboard
(`oauth.ts`), with hardcoded endpoints
(`https://dash.cloudflare.com/oauth2/auth`, `/oauth2/token`), HTTP Basic client auth, and a PKCE
verifier stored in the per-connection `UserAccount` Durable Object.

Three scope sets (`oauth.ts`):

- **`AUTH_SCOPES`** — `offline_access user-details.read`, the minimal set for sign-in. Sign-in
  requests `scopes: "auth"`; the grant is **transient** and the `UserAccount` self-destructs shortly
  after the email is read (`cloudflare.ts:318-320`, alarm handler).
- **`BILLING_SCOPES`** — `offline_access aig.read aig.run user-details.read account-settings.read`,
  used for AI Gateway billing. Deliberately no `openid` (the dashboard client isn't permitted it);
  identity comes from `user-details.read`.
- **`persistentScopesForResources()`** — billing scopes plus the observability scope
  (`workers-observability.read`) when any observability resource is requested.

Scopes fail closed in two places (`cloudflare.ts`): `beginOAuthFlow` falls back to exactly the
billing set when the stored `scopes` key is missing (never silently asking for observability the
user didn't choose), and `acceptAuthCode` records `tokens.scopes ?? stored ?? billing` as
`grantedScopes` — so a provider response that omits `scope` cannot advertise an observability grant
that was never made, which would otherwise short-circuit `ensureResources` into a binding that 403s
with no way to repair it. `getGrantedScopes` also treats legacy pre-resource accounts as
billing-only.

### The billing / BYOK flow

The workshop backend reads a usable token through the vendor-specific
`CloudflareGatekeeperUser.getUsableAccessToken()` (`cloudflare.ts:423`, implemented by
`GatekeeperUserImpl`), which delegates to `UserAccount.getAccessToken()` — a cached access token with
an expiry safety margin, refreshed from the stored refresh token as needed. On refresh failure the
gatekeeper notifies the workshop via `callback.credentialsExpired()`. Account selection
(`listCloudflareAccounts` / `selectCloudflareAccount`) and the 5-minute balance cache live on the
workshop's User DO; billing state there is just the chosen account id + cached balance, never tokens.

## Observability: two resource granularities, one indivisible scope

The gatekeeper offers two `SupportedResource`s (`resources.ts`):

- **Account observability** — the whole account's Workers telemetry
  (`.../:accountId/workers-and-pages/observability`).
- **Worker observability** — a single named Worker
  (`.../:accountId/workers/services/view/:workerName/production/observability`).

Both map to the **same indivisible scope** `workers-observability.read`, so a grant either includes
observability or does not. What distinguishes the two granularities is the **binding**: the resource
URL parsed by `parseObservabilityResourceUrl` determines whether a `CloudflareObservabilityGatekeeper`
DO facet is constructed with a `workerName` (`getGatekeeperClassFor`, `cloudflare.ts:431-442`). The
capability boundary is therefore the binding, not the grant.

## Observability layering

The observability code is strictly layered; each layer has one job:

- **`observability-api.ts`** — the only module that talks HTTP. It POSTs to
  `https://api.cloudflare.com/client/v4/.../workers/observability/telemetry/<path>`, bounds responses
  (2 MiB), timeframes (7 days), limits, and filter nesting (depth 3, 100 nodes), retries once (429/
  502/503/504, honoring `Retry-After` within budget), and scopes worker-bound reads.
- **`observability-parse.ts`** — validates every provider response before anything downstream touches
  it. This is the trust boundary the worker-scope filter depends on: `parseEvent` requires the
  load-bearing fields (`dataset`, `timestamp`, `$metadata.id`, string-or-absent `$metadata.service`)
  so the scope filter never throws a raw `TypeError` out of a security check. Provider text is
  surfaced to the caller but withheld from logs (`CloudflareObservabilityApiError.fromProvider`).
- **`observability-session.ts`** — the agent-facing read session. Every method funnels through
  `#observe`, which records the read on the approval queue *before returning* — a read that reaches
  the agent but not the queue would be an unaudited disclosure. Queue entries are built by
  `summarizeFilter`, which shows only field names/operations and keeps **filter values out of the
  audit trail** (values are caller text that a provider error could echo back).
- **`observability-discovery.ts`** — derives field names and values from an events sample instead of
  the `/keys`/`/values` endpoints whenever the request must be constrained, because those two
  endpoints **ignore the `filters` they are sent** (verified against the live API). Deriving from a
  service-filtered sample is correct by construction. It also handles the indexing quirk: a log's own
  fields are returned nested under `source` but indexed under their *bare* name, so
  `observabilityFieldKey()` accepts the `source.` alias and discovery reports the filterable name.

## Worker-scoped bindings: the filter guarantees

A Worker-scoped binding prepends an immutable `$metadata.service` filter (`scopeObservabilityFilters`)
and **re-checks the result** (`#scopeEvents`): a single event from another Worker proves the provider
ignored the filter, which is logged as an operational error and invalidates every other value on that
response that can't be re-derived. Concretely:

- The provider's own `count` is **withheld** when anything was dropped — an unscoped count of the
  whole account is exactly the volume the binding must not disclose. `statistics` is kept, since it
  describes what the query cost, not how much matched.
- Pagination cursors come from the provider's **raw** events, not the surviving ones, so a
  fully-foreign page can't stall pagination and hide the caller's own older data.
- Trace *summaries* are account-only (their shape describes a whole cross-service trace); a Worker
  binding can still fetch its own events for a known trace id (`getTrace` re-scopes every page).
- `calculate()` is the one read with no second line of defence — an aggregate can't be un-mixed — so
  it rests solely on the injected filter; that asymmetry is accepted and documented on the method,
  with the group-by fix left as a follow-up.

## Failure and sharing behavior

`deniesAccess()` maps 400/401/403/404 to "the credential lacks access"; anything else (5xx,
transport) is the gatekeeper's problem and must never be reported as a denial — mapping a failure to
"allowed" would admit an unauthorized reader. The read session is read-only: no actions are ever
submitted (`applyAction`/`rejectAction`/`revertAction` throw). Sharing uses observer strategy **B**
(single-unit ACL check): `addObserver` calls the prospective collaborator's own
`CloudflareVerifier.hasObservabilityAccess`, which probes the telemetry API with the *observer's* own
credentials and throws if it can't read the bound resource; `removeObserver` retains no state.
