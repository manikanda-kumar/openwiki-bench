---
type: "Reference"
title: "Shipped Gatekeepers: Package Catalog"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-7c3a8d0a7ccea7201f2f73d4
    resource: repo://packages/gatekeeper-cloudflare/README.md
  - id: openwiki-source-10ac6e23496c97073a8dc923
    resource: repo://packages/gatekeeper-cloudflare/src/observability-api.ts
  - id: openwiki-source-1142111760e2bffeafc6d0ab
    resource: repo://packages/gatekeeper-cloudflare/src/observability-parse.ts
  - id: openwiki-source-ec66469620db1901154db9c1
    resource: repo://packages/gatekeeper-cloudflare/src/observability-session.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-4f77f1b4388c32281959852d
    resource: repo://packages/gatekeeper-context/src/index.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-94be4934a936052cc3dc4682
    resource: repo://packages/gatekeeper-github/README.md
  - id: openwiki-source-ed3afbf33bf78ae03fcc06d8
    resource: repo://packages/gatekeeper-homeassistant/src/approvals.ts
  - id: openwiki-source-999ae089f9e3e9b80cb3832a
    resource: repo://packages/gatekeeper-homeassistant/src/simulation.ts
  - id: openwiki-source-1df43ef8a4f36d744722bc36
    resource: repo://packages/gatekeeper-scheduler/README.md
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Shipped Gatekeepers: Package Catalog

Every package under `packages/gatekeeper-*` implements the same three-tier contract ([Gatekeeper Architecture](/openwiki/gatekeepers/architecture.md)). This page catalogs what each one connects to and what is distinctive inside it. Per-package setup instructions live in each package's README (linked from README.md:206-218).

## OAuth-account connectors

These vendors mint accounts through an OAuth flow (`connectAccount`), with credentials stored in the vendor's own account DO:

| Package | Connects to | Notes |
| --- | --- | --- |
| `gatekeeper-github` | Repos, issues, PRs | Also a sign-in vendor (`providesAuth`; primary verified email via `read:user user:email` on sign-in, `repo read:user user:email` on connect). README warns: use a GitHub **OAuth App**, not a GitHub App — only OAuth Apps honor the `scope` parameter that makes minimal-on-login/full-on-connect work (gatekeeper-github/README.md:1-14). Modules: `github-api.ts`, `github-search.ts`, `github-configurators.ts`. |
| `gatekeeper-google` | Docs, Sheets, Calendar, Gmail, BigQuery | Split per-product API clients (`docs-api.ts`, `calendar-api.ts`, `bigquery-api.ts`, ...) with a shared `auth-retry.ts` (AccessTokenCache). The broad bindings (Workspace, BigQuery, `allVisible` calendar availability) use data-set tracking per docs/observers.md §9.2. |
| `gatekeeper-cloudflare` | Sign-in + AI Gateway billing + Workers Observability | One connected account serves three unrelated purposes (gatekeeper-cloudflare/README.md:1-22): sign-in (verified account email, also establishing the billing-only connection), billing (`getUsableAccessToken` powers the BYOK flow), and read-only telemetry (`workers-observability.read`; account-wide or one-Worker bindings). See below. |
| `gatekeeper-supabase` | Projects, orgs (read-only SQL) | `supabase-api.ts`, `supabase-introspection.ts`. |
| `gatekeeper-notion` | Pages/databases | `notion-api.ts`, `notion-actions.ts`. |
| `gatekeeper-confluence` | Sites, spaces, pages | `confluence-observers.ts` implements its data-set tracking. |
| `gatekeeper-linear` | Teams, issues | `linear-api.ts`. |
| `gatekeeper-slack`, `gatekeeper-spotify`, `gatekeeper-zoominfo` | Messaging / music / B2B intelligence | Conventional OAuth shape; zoominfo is private-only (A strategy) per docs/observers.md §9.2. |
| `gatekeeper-email` | Inbound email | A WorkerEntrypoint vendor with an optional `email()` handler; the router forwards inbound mail to it (router/src/index.ts:62-68). Listed as **not installable** on customer instances because Email Routing needs a zone (manifest-lib.ts:270-272). |
| `gatekeeper-homeassistant` | Home Assistant instance/entities | Users paste a long-lived token; strategy D (no ACL oracle to check against). Distinctive modules: `simulation.ts` and `approvals.ts` for its action simulation. |

## The MCP pair (`gatekeeper-mcp`, `gatekeeper-mcp-portal`)

Both are thin connectors over the shared library `packages/mcp-shared` — "code lives here when two copies of it would eventually disagree and the disagreement would be a security bug: tool classification, the scope grammar, the OAuth lifecycle, the approval-queue wiring" (mcp-shared/README.md:5-10). The difference is where the endpoint comes from (mcp-shared/README.md table):

- **`gatekeeper-mcp`**: the user pastes an MCP endpoint URL; the grant is scoped to the whole server or named tools. `connect-form.ts` is its one user-facing page.
- **`gatekeeper-mcp-portal`**: the endpoint is deployment configuration (`MCP_PORTAL_URL`); the grant covers one upstream server behind the portal or named tools. `config.ts` reads the admin-configured endpoint.

**Trust tiers** live in `mcp-shared`'s `tools.ts` — the trust boundary; "nothing outside tools.ts reads a tool's annotations" (mcp-shared/README.md:57). `byo` (user-typed URL): only `readOnlyHint` classifies reads, nothing can auto-apply a write. `vetted` (deployment-asserted): `destructiveHint: false` + `idempotentHint: true` may drive auto-approval — but configuring a portal endpoint is not enough to earn it, so the portal defaults to `byo` and requires `MCP_PORTAL_TRUST_ANNOTATIONS=true` (mcp-shared/README.md:11-27). Unannotated tools are always actions needing approval on either tier, matching MCP's spec defaults. MCP bindings are owner-only regardless of tier (`sharing-policy.ts`).

Applied calls are **at-most-once, not exactly-once**: the approval is claimed in storage before the call is sent, settled before the result is attached, and any failure not positively identifiable as a server-side refusal (only 401/403 proves refusal) is closed as failed and *not* retryable, since the write may already have happened (mcp-shared/README.md:29-57).

## Auto-provisioned ("ambient") connectors

- **`gatekeeper-context` (Context Library)** — the vendor declares `autoProvisionsAccount: true`; each account declares `singleton: { tsType: "ContextLibrary" }` and `providesUi` ("Context & Skills", library-gatekeeper.ts:122-136). It owns three Durable Objects (`ContextCollectionDurableObject`, `UserLibraryDurableObject`, `LibraryRegistryDurableObject`, src/index.ts:1-5) plus a KV namespace, all namespaced by a `sharingDomain` from the binding's props so multiple workshops sharing one gatekeeper instance stay isolated (src/domain.ts:1-8). Collections are private (single account) or public (admin-created, auto-enabled for all users). There is deliberately **no connect flow** — "The Context Library is a singleton gatekeeper; it has no connect flow" (library-gatekeeper.ts:184). Its singleton is a broad binding over public and private collections, so it uses data-set tracking (C strategy, library-gatekeeper.ts:347; docs/observers.md §9.2).
- **`gatekeeper-scheduler` (Scheduled Tasks)** — ambient gatekeeper for persistent workspace callbacks: elapsed intervals, wall-clock recurrences (IANA timezone), one-time runs. One account-scoped `ScheduleDriver` Durable Object stores enabled schedules and delivers from a shared alarm; hook enablement stays in the Workshop's Connections UI, and its management app at `/gatekeepers/scheduler` is deliberately read-only (gatekeeper-scheduler/README.md:1-16). Its ambient singleton is exposed to agents as `ScheduleSession` (src/types.d.ts).

## `gatekeeper-cloudflare`'s layered telemetry defences

The observability half is deliberately paranoid, because three provider behaviors return plausible-but-wrong data (verified against a live account; gatekeeper-cloudflare/README.md and its source layout):

- **Layering**: `observability-api.ts` is the only place that talks HTTP; `observability-parse.ts` validates every response (no blind casts); `observability-session.ts` is the agent-facing session where every read funnels through one `#observe`; `observability-discovery.ts` derives field names/values from a sampled events query.
- **Untrusted provider behavior**: `telemetry/keys`/`values` *ignore* the `filters` they accept, so constrained discovery is answered from a filtered `telemetry/query` sample; an unknown filter key matches nothing (log fields are returned nested under `source` but indexed under their bare name, hence `observabilityFieldKey` accepting the `source.` alias); `/accounts` pages at 20 by default and must be walked to the end (AGENTS.md's gatekeeper-cloudflare section; the behaviors are re-stated in code comments in observability-session.ts/observability-discovery.ts).
- **Worker-scoped bindings** prepend an immutable `$metadata.service` filter *and* re-filter the response — a dropped event proves the filter was not applied, so the provider's own `count` is withheld and logged at `error` rather than reported; `statistics` is kept because it describes query cost, not matches. Pagination cursors come from raw events so a fully-foreign page can't stall pagination. Trace *summaries* are account-only; a Worker binding may fetch its own events for a known trace id. `calculate()` (aggregates) is the one read with no second line of defense — an aggregate can't be un-mixed — so it rests solely on the injected filter and documents that (AGENTS.md).
- **Error hygiene**: provider error messages can quote caller-supplied filter values back, so only numeric `codes` are logged — filter *values* stay out of the audit trail (`summarizeFilter`), and the message travels to the caller who caused it.
- **Two vitest projects**: Node for pure logic, workerd for `RpcTarget`/`RpcStub`/Durable Object coverage (vitest.worker.config.ts).
- **Scope semantics fail closed to `BILLING_SCOPES`**, and account vs. Worker resource granularities both map to the single indivisible `workers-observability.read` scope, so "the capability boundary is the *binding*, not the grant" (gatekeeper-cloudflare/README.md:24-28).

## Observer strategies (repository-established)

docs/observers.md §9 fixes the strategy **per resource type**, with a "broad binding" lens (strategy C only when sub-resources have distinct ACLs *and* there is a per-observer access oracle): GitHub repo → B; Google Docs/Sheets/Calendar(selected) → B; Google Calendar(allVisible)/BigQuery → C; Gmail mailbox → A; Linear team → B, workspace → C; Notion page → B, workspace → C; Supabase project → B, org → C; Confluence site/space/page → C; Spotify, email, Home Assistant → D; Cloudflare → N/A (no resources); ZoomInfo → A; Context Library → C (docs/observers.md:504-529). That document is marked as a historical implementation plan; where a gatekeeper's current code diverges (e.g. `confluence-observers.ts` exists and implements tracking), the code is authoritative.

*Uncertain:* per-package runtime behavior details beyond what the READMEs, entrypoint files, and the observer table establish are not individually verified here; treat each package's README and source as the authority for specifics.
