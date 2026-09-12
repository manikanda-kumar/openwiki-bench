---
type: guide
title: Change Guide — MCP & Share-Sensitive Services
description: A representative security-focused change guide for packages/mcp-shared and packages/gatekeeper-cloudflare, where trust boundaries and scopes fail closed, including the cloudflare observability layering and concretely-scoped example changes.
tags: [mcp, cloudflare, security, change-guide, observability]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-10ac6e23496c97073a8dc923
    resource: repo://packages/gatekeeper-cloudflare/src/observability-api.ts
  - id: openwiki-source-ec66469620db1901154db9c1
    resource: repo://packages/gatekeeper-cloudflare/src/observability-session.ts
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-1cd7f2c2d4fc486cd3495da5
    resource: repo://packages/mcp-shared/src/sharing-policy.ts
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---

# Change Guide: MCP & Share-Sensitive Services

Some of the most security-sensitive code lives in `packages/mcp-shared` (behind the two MCP
gatekeepers) and `packages/gatekeeper-cloudflare` (its Workers Observability telemetry). This guide
spells out the invariants to preserve and gives two representative changes.

## The MCP trust boundary

`packages/mcp-shared/src/tools.ts` is the **single trust boundary** for what an MCP server says about
its own tools becoming what a Gadget may do. Nothing outside this file reads a tool's `annotations`.

The classification rules, in order of effect:

- **`byo`** — a user typed the URL in. `readOnlyHint: true` still classifies a tool as a read
  (observation); this is a *knowing, documented* departure from treating annotations as wholly
  untrusted, stated on the connect form. Nothing else a `byo` server says can auto-apply a write.
- **`vetted`** — a deployment has asserted the endpoint's annotations are reliable, so
  `destructiveHint: false` plus `idempotentHint: true` may drive auto-approval. Only the portal
  (`gatekeeper-mcp-portal`) can produce a vetted endpoint, via `MCP_PORTAL_TRUST_ANNOTATIONS`. The
  portal itself defaults to `byo`, because the admin never saw the upstream servers' annotations.

Summary of what "trust tier" governs: it is deployment configuration (read afresh at each point of
use, so withdrawing it takes effect immediately), not account state, and neither tier can be shared
(`sharing-policy.ts`).

### Queued-action store and sdkFetch

Side-effecting calls are queued for approval via the shared queued-action store
(`mcp-shared/src/action-store.ts`), with a claim so one approval is never sent twice and a bound on
what is retained. OAuth uses the official `@modelcontextprotocol/client`, and every SDK OAuth
operation must be given `sdkFetch(...)` so every request and redirect retains the endpoint and SSRF
checks. `mcp-shared/src/fetch.ts` is the single outbound-request path, following redirects by hand and
re-checking each hop.

## The Cloudflare observability gatekeeper

`gatekeeper-cloudflare` serves three unrelated purposes from one connected account — sign-in
(`AUTH_GATEKEEPERS`), AI Gateway billing, and Workers Observability read-only telemetry. For
observability there are two resource granularities (whole account, or one Worker), both mapping to the
single indivisible `workers-observability.read` scope — so the **capability boundary is the binding,
not the grant**.

### Layering (where each thing happens)

- **`observability-api.ts`** is the *only* place that talks HTTP to the telemetry provider.
  `deniesAccess(error)` maps only `400/401/403/404` to "credential lacks access"; anything else
  (5xx, transport) is the gatekeeper's problem, never reported as a denial — mapping a generic
  failure to "denied" would be a silent authorization decision, and mapping it to "allowed" would
  admit an unauthorized reader.
- **`observability-parse.ts`** validates every response (`isRecord`, `parseEventsContainer`,
  `parseTraceSummaries`, …) — no blind casts from the provider.
- **`observability-session.ts`** is the agent-facing session. Every read funnels through one
  `#observe` helper that records the read on the approval queue *before* returning it. That is the
  capability-audit guarantee: a read that reaches the agent but not the queue would be an unaudited
  disclosure, so the wrapper is the invariant to test rather than any individual method.
- **`observability-discovery.ts`** derives field names/values from a sampled events query.

### Fail-closed scopes and worker-scoped re-checking

- Scopes fail closed to `BILLING_SCOPES`, and an omitted `resourceUrlPatterns` ("all resource types")
  is distinct from `[]` ("none") — a billing-only connection must not silently acquire telemetry
  access.
- Worker-scoped bindings prepend an immutable `$metadata.service` filter **and** re-filter the
  response, because three provider behaviours return wrong-but-plausible data with no error:
  `telemetry/keys`/`values` ignore the filters they accept; an unknown filter key matches nothing (and
  log fields are returned nested under `source` but indexed under their bare name); and `/accounts`
  pages at 20 by default.
- A dropped event proves the provider filter was not applied, so the provider's own `count` is then
  withheld (it would count the whole account) and the drop is logged at `error`; `statistics` is kept,
  since it describes what the query cost rather than how much matched. Pagination cursors come from
  the provider's raw events rather than the surviving ones.
- **Audit of filter *values*:** a provider error message can quote a caller-supplied filter value
  back, so only the filter's numeric/known-fixed `codes` are logged — filter *values* stay out of the
  audit trail (`summarizeFilter`, in `observability-session.ts`), preventing a queue entry from
  becoming an exfiltration channel.

## Representative change A: add a tool to the MCP session

**Scenario:** a new upstream MCP server exposes a tool the Gadget should be able to call.

Work entirely inside `mcp-shared`. The invariant to preserve: *a tool's read/action classification is
decided only by the classifier in `tools.ts`.* Do not add policy elsewhere that reads `annotations`
directly — route through `classifyTool` and `ClassifiedTool`. Decision points:

1. If the tool is read-only, the server's `readOnlyHint: true` makes it a read (observation). Keep
   any other annotation inert for `byo`; grant `vetted` only for a portal endpoint the deployment
   vouched for.
2. Add the tool's typed method to the generated session method list (`session-methods.ts` installs
   them at runtime, and `schema-to-ts.ts` builds strict `callTool` overloads from the server's input
   schema).
3. Wrap the call so side-effecting tools go through the queued action store and reads go through
   `authorizeObservation`, always with `sdkFetch` (via `fetch.ts`) so SSRF/endpoint checks survive hop
   to hop.

## Representative change B: add a telemetry query to the Cloudflare observability session

**Scenario:** the agent needs a new Workers Observability read (e.g. a new aggregate).

The rules to follow:

1. **`observability-api.ts`** is the only place HTTP happens; add the wire call there.
2. **Parse, don't cast** — parse the response with a `parse*` helper in `observability-parse.ts`, and
   surface failure distinctly via `CloudflareObservabilityApiError` so `deniesAccess` can classify
   400/401/403/404 as denials and everything else as gatekeeper-side trouble.
3. Weigh worker-scoping: for a Worker binding, prepend the immutable `$metadata.service` filter and
   re-filter the response (a dropped event ⇒ withhold `count`, keep `statistics`, log at `error`).
4. Funnel the read through the session's single `#observe` wrapper so it is always recorded as an
   observation before data returns, and keep filter *values* out of the audit entry.
5. `calculate()` is the one read with no second line of defence (an aggregate can't be un-mixed), so
   it rests solely on the injected filter — if you add a new aggregate, document that constraint on
   the method and, where possible, leave group-by as a stated follow-up rather than pretending it is
   enforced.
