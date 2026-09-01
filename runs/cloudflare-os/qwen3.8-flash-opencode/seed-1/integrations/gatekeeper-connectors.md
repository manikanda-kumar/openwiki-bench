---
type: integration
title: Gatekeeper Connector Catalog
description: The shipped gatekeeper packages and their declared capabilities — OAuth sign-in vendors, auto-provisioned ambient singletons (Context Library, Scheduled Tasks), the Cloudflare triple-purpose connector, and the conventional OAuth resource connectors.
tags: [gatekeepers, connectors, oauth, ambient, catalog]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-9d44f971095fd6d92485975d
    resource: repo://packages/gatekeeper-cloudflare/src/oauth.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-f121fe144c5597957380d9b4
    resource: repo://packages/gatekeeper-email/src/email.ts
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-32ef90732960f956fe56c4e0
    resource: repo://packages/gatekeeper-google/src/google.ts
  - id: openwiki-source-f606afef36a530c5e115c160
    resource: repo://packages/gatekeeper-homeassistant/src/homeassistant.ts
  - id: openwiki-source-1df43ef8a4f36d744722bc36
    resource: repo://packages/gatekeeper-scheduler/README.md
  - id: openwiki-source-6e4b904940a56a0c9f48b90b
    resource: repo://packages/gatekeeper-scheduler/src/scheduler.ts
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Gatekeeper Connector Catalog

Sixteen `packages/gatekeeper-*` workers ship with the repo. What each *is* is established by the
flags it declares in its `VendorDescription`/`AccountDescription`, not by prose — this page reads
those declarations. The connect/approval machinery they all speak is in
[Gatekeeper Framework](../security/gatekeeper-framework.md); how admins enable/disable them is in
[Configuration](../operations/configuration-and-admin.md).

## Sign-in-capable connectors (`providesAuth: true`)

Only three vendors advertise authentication today — Google, GitHub, and Cloudflare
(packages/gatekeeper-google/src/google.ts#L364, packages/gatekeeper-github/src/github.ts#L1018,
packages/gatekeeper-cloudflare/src/cloudflare.ts#L184) — and each must return only a
provider-**verified** email (docs/oauth-signin.md#L17-L22). Being auth-capable is necessary but not
sufficient: the deployment must also allowlist the vendor via `AUTH_GATEKEEPERS`.

| Connector | Notable resource types (`suggestedBindingName`) |
| --- | --- |
| `gatekeeper-github` | `GITHUB_REPO`, `GITHUB_ISSUE`, `GITHUB_PULL_REQUEST` (github.ts#L3185-L3210) |
| `gatekeeper-google` | `GMAIL_INBOX`, `GMAIL_LABEL`, `GMAIL_SEARCH`, `GOOGLE_DOC`, `GOOGLE_SHEET` (google.ts#L1604-L1624, L1974, L2330) |
| `gatekeeper-cloudflare` | account- and worker-scoped observability: `CLOUDFLARE_OBSERVABILITY` / `WORKER_OBSERVABILITY` (cloudflare.ts#L544) |

### Cloudflare: three purposes from one connector

`gatekeeper-cloudflare` serves sign-in, **AI Gateway billing** linkage, and read-only **Workers
observability** resources (cloudflare.ts#L1-L30; the billing scope set is always persisted —
`persistentScopesForResources()` unions `BILLING_SCOPES` with the observability scopes the
requested resource patterns need, oauth.ts#L18-L28). This is why gatekeeper sign-in with Cloudflare
requests "full" scopes up front while other vendors request only `auth`
(packages/workshop-backend/src/server.ts#L664-L671).

## Auto-provisioned ambient connectors (`autoProvisionsAccount: true`)

These mint accounts with no OAuth flow via `createAccount()` and provide an **agent singleton**
plus a **management UI** at `/gatekeepers/<vendor-id>`:

- **Context Library (`gatekeeper-context`)** — declares
  `singleton: { tsType: "ContextLibrary" }` and `providesUi` (library-gatekeeper.ts#L135-L136);
  it *throws* if a connect flow is attempted (#L184) and exposes no URL-addressed resources
  (#L415). Collections are private or admin-curated public, all reads recorded as observations.
  All state is namespaced by a `sharingDomain` so multiple workshops sharing one instance stay
  isolated — a convenience boundary between *trusted* deployments, explicitly not a security
  boundary against malicious peer configs (packages/gatekeeper-context/src/domain.ts#L1-L12).
- **Scheduled Tasks (`gatekeeper-scheduler`)** — `singleton: { tsType: "ScheduleSession" }` and a
  read-only management UI (scheduler.ts#L321-L322). Registering a schedule creates a **disabled**
  hook; the user enables it in the Workshop Connections UI, and the app itself offers no
  editing/pausing/deleting (packages/gatekeeper-scheduler/README.md#L3-L15).

The Workshop's ambient provisioning respects the admin's three-state mode (**disabled / optional /
enabled**, default **optional** — ambient authority is never imposed on every user without an
explicit admin choice), enforced at the single chokepoint in
packages/workshop-backend/src/provisioning-policy.ts#L1-L34.

## Conventional OAuth connectors

The rest follow the Linear-shaped template (see
[How to Add a Gatekeeper](../guides/adding-a-gatekeeper.md)):

| Package | Service |
| --- | --- |
| `gatekeeper-linear` | Issues/projects/teams (linear.ts) |
| `gatekeeper-slack` | Slack messaging (slack.ts#L284) |
| `gatekeeper-notion` | Notion pages/databases (notion.ts#L293) |
| `gatekeeper-confluence` | Atlassian sites/spaces/pages: `CONFLUENCE_SITE`, `CONFLUENCE_SPACE`, `CONFLUENCE_PAGE` (confluence.ts#L581-L676) |
| `gatekeeper-spotify` | Player/playlists (spotify.ts#L462) |
| `gatekeeper-supabase` | Project + database capability (`getDatabase()` documented as pipelineable, types.d.ts#L115-L121) |
| `gatekeeper-zoominfo` | Contact/enrichment lookups (zoominfo.ts#L327) |
| `gatekeeper-homeassistant` | User-supplied HA URL + token in-app (no third-party OAuth app — hence `NO_DEFAULT_CRED_INPUTS`, scripts/release/manifest-lib.ts#L258-L266) |
| `gatekeeper-email` | Outbound email account plus an inbound receiver whose worker also declares an `email()` handler for Email Routing (email.ts#L263, L361; router/src/index.ts#L12-L15) |

The MCP endpoints (`gatekeeper-mcp`, `gatekeeper-mcp-portal`) share a library instead of a
template — see [MCP Connectors](./mcp-connectors.md).

## Deployment note

Which connectors exist at runtime is decided by service bindings, not code: the dev server
discovers `gatekeeper-*` packages and the router routes to them by scanning `GATEKEEPER_*`
bindings ([Workshop Backend Kernel](../architecture/workshop-backend.md#storage-and-bindings);
packages/router/src/index.ts#L24-L35).
