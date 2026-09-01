---
type: gatekeeper-connectors
title: "Shipped Gatekeeper Connectors"
description: Survey of the gatekeepers shipped in this repo — the OAuth service connectors, Home Assistant (LLAT), Email (a gatekeeper that is the service), Cloudflare (sign-in + billing + observability), the auto-provisioned Context Library and Scheduled Tasks, and the two MCP connectors sharing mcp-shared's trust machinery.
tags: [gatekeepers, connectors, oauth, mcp, integrations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-ec66469620db1901154db9c1
    resource: repo://packages/gatekeeper-cloudflare/src/observability-session.ts
  - id: openwiki-source-52ab503bbb8e3296d63507cc
    resource: repo://packages/gatekeeper-context/src/context-collection.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-e05f8b94d8d9d2cf95ea13a2
    resource: repo://packages/gatekeeper-email/README.md
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-dfe1129bd3544ea2750bd709
    resource: repo://packages/gatekeeper-google/src/bigquery-api.ts
  - id: openwiki-source-e9bab16fa9305ab4f0a00de7
    resource: repo://packages/gatekeeper-google/src/calendar-api.ts
  - id: openwiki-source-dbe3b8204a7d4c1878471508
    resource: repo://packages/gatekeeper-homeassistant/README.md
  - id: openwiki-source-b33f20246e487fc184ecf0ca
    resource: repo://packages/gatekeeper-mcp-portal/src/config.ts
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-1df43ef8a4f36d744722bc36
    resource: repo://packages/gatekeeper-scheduler/README.md
  - id: openwiki-source-3cf1b245c90ed07be18f4946
    resource: repo://packages/gatekeeper-scheduler/src/schedule-driver.ts
  - id: openwiki-source-6e4b904940a56a0c9f48b90b
    resource: repo://packages/gatekeeper-scheduler/src/scheduler.ts
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Shipped Gatekeeper Connectors

Every connector lives in its own Worker package under `packages/gatekeeper-*`, discovered by the backend and router from `GATEKEEPER_*` service bindings. They fall into four families:

## OAuth service connectors

`gatekeeper-github`, `-google`, `-linear`, `-notion`, `-slack`, `-confluence`, `-spotify`, `-supabase`, `-zoominfo` follow the same shape: a vendor entrypoint, an OAuth connect flow (with the nonce pattern from the shared contract), per-user account Durable Objects, a typed API client, resource configurators (`src/configurator/`) for narrowing a grant to a specific resource, and a `.d.ts` types file the agent reads (packages/gatekeeper-github/src, packages/gatekeeper-google/src). Google is the largest, spanning several services (Calendar, Drive, Gmail, BigQuery…) as separate resource types (packages/gatekeeper-google/src/calendar-api.ts, bigquery-api.ts).

**Home Assistant** (`gatekeeper-homeassistant`) is the exception among user-connected gatekeepers: there is **no OAuth flow** — the user pastes an instance URL plus a **long-lived access token (LLAT)**, which the gatekeeper validates and stores. It exposes five resource granularities (whole instance, area, label, device, entity), each with its own configurator, and all device actions go through the standard approval queue; on Cloudflare-hosted deployments the HA instance must be publicly reachable, while self-hosted deployments can address LAN URLs (packages/gatekeeper-homeassistant/README.md:1-47).

**Email** (`gatekeeper-email`) is not a client of an external service — it *is* the service: it implements a Cloudflare Email Worker receiving mail at `<name>@<host>`, stores the gadget's hook reference in a DO keyed by mailbox name, and invokes the hook with content parsed by postal-mime (from/to/subject/text/html/attachments) (packages/gatekeeper-email/README.md:1-28).

## Cloudflare: one account, three purposes

`gatekeeper-cloudflare` serves three unrelated purposes from one connected account: **sign-in** (`providesAuth: true`, making it eligible for `AUTH_GATEKEEPERS` sign-in with AI-Gateway billing linking on login), **AI Gateway billing** (BYOK routing — see [AI Models, AI Gateway, and Usage Limits](/openwiki/backend/ai-gateway-billing.md)), and **read-only Workers Observability** telemetry (packages/gatekeeper-cloudflare/src/cloudflare.ts:170-198).

The observability side is layered defensively: `observability-api.ts` is the only HTTP surface, `observability-parse.ts` validates every response (no blind casts), and the agent-facing session funnels **every read through one `#observe`** so no path returns data unaudited (packages/gatekeeper-cloudflare/src/observability-session.ts:1-10, 95+). Two resource granularities (whole account, or one Worker) both map to the single indivisible `workers-observability.read` scope, so the capability boundary is the binding, not the grant; Worker-scoped bindings inject an immutable service filter *and* re-filter responses because the provider has been shown to silently ignore filters (AGENTS.md, packages/gatekeeper-cloudflare/src/resources.ts).

## Auto-provisioned singletons

**Context Library** (`gatekeeper-context`) auto-provisions accounts exposing a **read-only agent singleton and a management UI**. It owns three Durable Objects (`ContextCollectionDurableObject` for content, `UserLibraryDurableObject` for private collections, `LibraryRegistryDurableObject` for the domain's public set) plus a KV namespace, all namespaced by a `sharingDomain` from the binding's props so multiple workshops sharing one gatekeeper stay isolated. Its vendor declares `autoProvisionsAccount: true` with no connect flow — the account is the authority (packages/gatekeeper-context/src/library-gatekeeper.ts:122-135, 347-415; packages/gatekeeper-context/src/context-collection.ts:132-193).

**Scheduled Tasks** (`gatekeeper-scheduler`) auto-provisions an ambient singleton for registering persistent workspace callbacks (intervals, wall-clock recurrences, one-time runs). One account-scoped `ScheduleDriver` Durable Object stores enabled schedules and delivers them from a shared **alarm**; hook enablement stays in the Workshop's Connections UI — the management app at `/gatekeepers/scheduler` is deliberately read-only (packages/gatekeeper-scheduler/README.md:1-20, packages/gatekeeper-scheduler/src/schedule-driver.ts:82, 237-247; packages/gatekeeper-scheduler/src/scheduler.ts:411-412).

## The MCP pair and mcp-shared

`gatekeeper-mcp` connects any MCP server the user pastes (OAuth discovery chain, each tool becoming a typed session method; two grant breadths: whole server or `#tool=` named tools), while `gatekeeper-mcp-portal` takes one admin-configured `MCP_PORTAL_URL` and scopes a grant to one upstream server behind the portal (packages/gatekeeper-mcp/README.md:1-24, packages/mcp-shared/README.md:3-13, packages/gatekeeper-mcp-portal/src/config.ts:64-70).

`mcp-shared` is the library both import — not a Worker — holding the MCP client, OAuth chain, account DO base, the resource-URL scope grammar, and the queued-action store; code lives there when two copies would eventually disagree in a way that would be a security bug. Varying shared behavior goes through named hooks (`staticToken`, `mintAccount`), never a private copy (packages/mcp-shared/README.md:1-27).

Its **trust boundary is `tools.ts`**, and nothing outside it reads a tool's annotations (packages/mcp-shared/README.md, packages/mcp-shared/src/tools.ts:14-42):

- `ServerTrust` is deployment-decided, not server-asserted: **`vetted`** (an administrator asserted the endpoint's annotations are reliable — only the portal can produce this, via `MCP_PORTAL_TRUST_ANNOTATIONS=true`) may drive auto-approval; **`byo`** (a user-typed URL) honors `readOnlyHint` for classification only — nothing it says can auto-apply a write.
- Classification: a tool declared `readOnlyHint === true` runs as an **observation** (immediate, recorded); everything else is **queued for approval**; auto-*applying* a write additionally requires a vetted endpoint plus `destructiveHint === false` and `idempotentHint === true`. All tests are strict `===`, so an unannotated tool always lands as a non-auto-approvable action.
- The scope grammar (`scope.ts`) and endpoint validation (`endpoint.ts`, including a host blocklist) gate every call, and all outbound requests — including SDK OAuth fetches — funnel through `fetch.ts`, following redirects by hand and re-checking each hop (packages/mcp-shared/README.md:15-27).

## Related pages

- [Gatekeeper Contract](/openwiki/gatekeepers/contract.md) — the interfaces all of these implement.
- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md) — provisioning modes and the connect flow.
- [Authentication and Sign-In](/openwiki/architecture/authentication.md) — the Cloudflare gatekeeper's auth role.
