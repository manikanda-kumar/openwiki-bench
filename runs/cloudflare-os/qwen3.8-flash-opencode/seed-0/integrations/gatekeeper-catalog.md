---
type: reference
title: Gatekeeper Implementations Catalog
description: Survey of the shipped gatekeeper workers grouped by genuinely different implementation shapes — OAuth multi-resource proxies, whole-account OAuth connectors, credential-paste and non-OAuth services, the email service-as-gatekeeper, and auto-provisioned singletons — plus each connector's vendor-app setup requirements.
tags: [gatekeepers, oauth, catalog, deployment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-009d1b6e9557be2e98c62e62
    resource: repo://packages/gatekeeper-confluence/README.md
  - id: openwiki-source-e05f8b94d8d9d2cf95ea13a2
    resource: repo://packages/gatekeeper-email/README.md
  - id: openwiki-source-7ebd3fe59ef5e6c4ca3515db
    resource: repo://packages/gatekeeper-github/deploy-inputs.json
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-32ef90732960f956fe56c4e0
    resource: repo://packages/gatekeeper-google/src/google.ts
  - id: openwiki-source-dbe3b8204a7d4c1878471508
    resource: repo://packages/gatekeeper-homeassistant/README.md
  - id: openwiki-source-a46570f032cde8af61474d40
    resource: repo://packages/gatekeeper-linear/src/linear-api.ts
  - id: openwiki-source-49fdc37939779c941196f051
    resource: repo://packages/gatekeeper-notion/README.md
  - id: openwiki-source-39184a1d94fa40cc708d33bf
    resource: repo://packages/gatekeeper-slack/README.md
  - id: openwiki-source-c995793f09b7109e7544f777
    resource: repo://packages/gatekeeper-spotify/README.md
  - id: openwiki-source-5180814e08a5626043c27d93
    resource: repo://packages/gatekeeper-supabase/README.md
  - id: openwiki-source-47aa9b165d457faf21bc1f50
    resource: repo://packages/gatekeeper-zoominfo/README.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Gatekeeper Implementations Catalog

Every connector in `packages/gatekeeper-*` implements the same Vendor→User→Instance contract ([Gatekeeper Framework](/openwiki/integrations/gatekeeper-framework.md)) and is auto-discovered by the backend and router from its `GATEKEEPER_<NAME>` binding (e.g. `packages/gatekeeper-notion/README.md:5-6`). What differs is the *shape* of what they bridge. The root README lists the user-documented connectors and links each package's own README, which is the setup guide for that vendor's OAuth app (README.md:202-218).

## Shape 1: OAuth proxies with multiple resource granularities

**`gatekeeper-github`** resolves `github.com` URLs into repo / issue / pull-request bindings — `getGatekeeperClassFor` parses the path and bakes `{owner, repo, resourceKind, issueNumber}` into the facet props (packages/gatekeeper-github/src/github.ts:1232-1269). Full-scope connections request repo capability scopes; `"auth"` mode requests only email-verification scopes (packages/gatekeeper-github/src/github.ts:281-282, 1018). Configurator UIs exist per resource kind.

**`gatekeeper-google`** is the widest example: six grantable resources (Gmail, Docs, Sheets, Drive, Calendar, BigQuery), each with its own API wrapper, `.txt` types file, and configurator. The OAuth grant's scope set is *derived from the requested resource patterns* — connecting "full" asks the patterns of `SUPPORTED_RESOURCES`, and the account stores which patterns were granted to decide later `ensureResources` upgrades (packages/gatekeeper-google/src/google.ts:364, 376-393, 448, 778-795). It also advertises `providesAuth` (google.ts:364), as do github (:1018) and cloudflare (packages/gatekeeper-cloudflare/src/cloudflare.ts:184) — the three sign-in vendors named in `docs/oauth-signin.md`.

**`gatekeeper-supabase`** fronts the Supabase *Management* API with two granularities — Project (hosted Postgres + auth/storage/edge functions; read-only and approval-gated mutating SQL, schema introspection) and Organization (discover/act across all projects) (packages/gatekeeper-supabase/README.md:1-10).

## Shape 2: single-account connectors

- **`gatekeeper-slack`** is deliberately **read-only** (never sends or modifies), and authenticates with a *user* token (`xoxp-…`, via `user_scope`, not a bot token) "so the agent sees exactly what the connecting user can see — including private channels, DMs, and search" (packages/gatekeeper-slack/README.md:1-15).
- **`gatekeeper-zoominfo`** exposes one whole-account resource (`https://app.zoominfo.com/`) over OAuth Authorization Code + PKCE; entitlements are discovered dynamically (lookup of controlled filter values, enrich-field discovery) (packages/gatekeeper-zoominfo/README.md:1-12).
- **`gatekeeper-spotify`** offers account-wide (search, library, follows, playback `getPlayer()`) plus per-playlist granularity (packages/gatekeeper-spotify/README.md:3-11).
- **`gatekeeper-confluence`** is Atlassian *Cloud* only (OAuth 3LO), converting page/blog bodies to and from Markdown around its REST API (packages/gatekeeper-confluence/README.md:1-8).
- **`gatekeeper-notion`** uses a Notion *public integration* — configure `CLIENT_ID`/`CLIENT_SECRET` on the worker; dev seeds them from `NOTION_*` shell vars (packages/gatekeeper-notion/README.md:7-11).
- **`gatekeeper-linear`** wraps Linear's GraphQL API + OAuth token endpoints (packages/gatekeeper-linear/src/linear-api.ts:1-40). Note: it ships code but is *not* among the README-documented connectors (README.md:208-218) and has no `deploy-inputs.json` — treat it as less-documented than the rest.

## Shape 3: no static OAuth app — user-pasted credentials

**`gatekeeper-homeassistant`** skips OAuth by design: each HA instance has a different URL (no central directory), long-lived access tokens don't expire, LLAT is what every HA-adjacent tool uses, and it works for both Nabu Casa and LAN self-hosts. Users connect URL + token in-app (packages/gatekeeper-homeassistant/README.md:5-14), so the deploy wizard must not demand credentials — it's in `NO_DEFAULT_CRED_INPUTS` (scripts/release/manifest-lib.ts:260-266).

## Shape 4: the gatekeeper *is* the service

**`gatekeeper-email`** implements a Cloudflare Email Worker receiving `name@host` mailboxes: the gadget binds a mailbox URL, connects it to a hook via `setBindingHook`, and inbound mail (parsed with postal-mime into structured data) invokes the gadget's hook through the DO keyed by username (packages/gatekeeper-email/README.md:1-18). It ships in releases but is `NOT_INSTALLABLE` for customer instances because Email Routing needs a zone, which workers.dev-hosted instances lack (scripts/release/manifest-lib.ts:268-271). The `GatekeeperLoopback` entrypoint comment in the router notes it "dormant until custom domains + Email Routing exist; the handler ships anyway" (packages/router/src/index.ts:12-18).

## Shape 5: MCP endpoints (see dedicated page)

`gatekeeper-mcp` (user-pasted endpoints, dynamic client registration — also in `NO_DEFAULT_CRED_INPUTS`) and `gatekeeper-mcp-portal` share `packages/mcp-shared`; their trust boundary is detailed in [MCP Connectors](/openwiki/integrations/mcp-connectors.md) (scripts/release/manifest-lib.ts:260-266).

## Shape 6: auto-provisioned singletons

`gatekeeper-context` and `gatekeeper-scheduler` take no third-party credentials at all, mint accounts with `createAccount()`, and are in the deploy service's `PREINSTALL` set — installed server-side on every fresh core deploy, which is allowed precisely because "a preinstall has nobody to ask" (they must take no inputs of any kind) (scripts/release/manifest-lib.ts:273-275). Their internals: [Context Library and Scheduler](/openwiki/integrations/context-library-scheduler.md).

## Common setup surface

For a vendor-OAuth connector the install recipe is uniform: create the provider app with redirect URI `{PUBLIC_BASE_URL}/gatekeeper/<name>/oauth` (the pattern the deploy wizard surfaces via `deploy-inputs.json`, e.g. `packages/gatekeeper-github/deploy-inputs.json:15-18`), set the resulting `CLIENT_ID`/`CLIENT_SECRET` secrets on the gatekeeper worker, and bind it into the backend/router — local dev seeds them from `GITHUB_*`/`GOOGLE_*`/`CLOUDFLARE_OAUTH_*`/`NOTION_*` shell vars (scripts/run-dev-server.ts:408-420; docs/oauth-signin.md:54-62). The cloudflare connector is the exception that needs no app registration of its own kind since it uses Cloudflare's fixed dashboard OAuth endpoints (docs/ai-gateway-billing.md:60-64).

## Uncertainty

- Session-API details per connector (methods, caching, simulation) were not enumerated here beyond the README claims; read each package's `src/` and `types.txt`.
- `gatekeeper-linear`'s intended deployment status (internal-only vs. unfinished docs) is not established in-repo.
