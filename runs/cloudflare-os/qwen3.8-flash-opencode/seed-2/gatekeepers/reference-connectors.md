---
type: integration
title: Service Gatekeeper Connectors
description: Inventory and shared patterns of the first-party service connectors — what resources each offers, how they wire OAuth accounts, resource facets, action simulation, observers, and the email receive path.
tags: [gatekeeper, oauth, connectors, email, simulation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-eb485a712bca97d9dba098ea
    resource: repo://packages/gatekeeper-confluence/src/confluence-observers.ts
  - id: openwiki-source-11e5ee4327f378ec217b28a6
    resource: repo://packages/gatekeeper-confluence/src/confluence.ts
  - id: openwiki-source-f121fe144c5597957380d9b4
    resource: repo://packages/gatekeeper-email/src/email.ts
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-32ef90732960f956fe56c4e0
    resource: repo://packages/gatekeeper-google/src/google.ts
  - id: openwiki-source-999ae089f9e3e9b80cb3832a
    resource: repo://packages/gatekeeper-homeassistant/src/simulation.ts
  - id: openwiki-source-ac6d3e749556bf7eba6d099a
    resource: repo://packages/gatekeeper-slack/src/slack.ts
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Service Gatekeeper Connectors

These connectors implement the protocol from [Gatekeeper Framework](framework.md) against specific services. This page maps the territory and highlights mechanisms in their most instructive exemplar; exact OAuth scope strings, method APIs, and action catalogs live in each package — read the package you're touching.

## Inventory

| Package | Service | Grantable resources (representative) |
|---|---|---|
| `gatekeeper-github` | GitHub | Repository, Issue, Pull Request (packages/gatekeeper-github/src/github.ts#L287-L303) |
| `gatekeeper-google` | Google | Gmail Inbox, Google Doc/Sheet/Slide, Drive, Calendar, BigQuery (packages/gatekeeper-google/src/google.ts#L364, #L1572) |
| `gatekeeper-slack` | Slack | Conversation (channel/DM), Thread (packages/gatekeeper-slack/src/slack.ts#L866, #L1095) |
| `gatekeeper-notion` | Notion | Page/database items (packages/gatekeeper-notion/src/notion.ts#L695) |
| `gatekeeper-linear` | Linear | Workspace, Team, Issue (packages/gatekeeper-linear/src/linear.ts#L951) |
| `gatekeeper-confluence` | Confluence | Site, Space, Content (packages/gatekeeper-confluence/src/confluence.ts#L569-L664) |
| `gatekeeper-homeassistant` | Home Assistant | Instance, Area, Device, Entity, Label (packages/gatekeeper-homeassistant/src/homeassistant.ts#L405) |
| `gatekeeper-spotify` | Spotify | Playlists/library/playback (packages/gatekeeper-spotify/src/spotify.ts#L980) |
| `gatekeeper-supabase` | Supabase | Projects, schemas, tables, edge functions, storage (packages/gatekeeper-supabase/src/supabase.ts#L373, #L919) |
| `gatekeeper-zoominfo` | ZoomInfo | Account (packages/gatekeeper-zoominfo/src/zoominfo.ts#L363, #L615) |
| `gatekeeper-email` | Workshop-hosted mailboxes | `…/mailbox/:user` (packages/gatekeeper-email/src/email.ts#L78) |

Each package follows the same layout: the vendor entrypoint + `UserAccount` + resource-facet classes in `src/<service>.ts`, a `<service>-api.ts` for HTTP, `src/configurator/` UI modules compiled by the shared builder, `github-configurators.ts`-style glue, and `types.d.ts` shipped to the agent through `getTypeScriptTypes()` — the `.txt` sibling is the same source embedded as a text module at build time (packages/gatekeeper-github/src/github.ts#L68, #L1040-L1041).

## Patterns worth knowing

**Multi-facet resources.** When one service has nested resources, each level gets its own facet class so the grant granularity is structural: Slack separates `SlackWorkspaceGatekeeperImpl` (channel/DM) from `SlackThreadGatekeeperImpl` (one thread) (slack.ts#L866, #L1095); Confluence goes three deep — `ConfluenceSiteGatekeeperImpl`, `ConfluenceSpaceGatekeeperImpl`, `ConfluenceContentGatekeeperImpl` (confluence.ts#L569-L664).

**Auth-capable connectors.** GitHub and Google set `providesAuth: true` (github.ts#L1018; google.ts#L364) and can therefore drive sign-in alongside Cloudflare (see [Authentication and User Accounts](../backend/auth-and-users.md)). One OAuth app serves both sign-in and capabilities per provider.

**Simulation as an overlay.** Home Assistant is the clearest simulation implementation: because approval-queued actions may sit for a while, an agent that writes and immediately reads must not see stale state, so reads start from real HA state and apply an *overlay of pending actions* at read time (`simulation.ts`), with `approvals.ts` classifying service calls (packages/gatekeeper-homeassistant/src/simulation.ts#L1-L10). The framework only *suggests* simulation; this connector shows the pattern done seriously.

**Observers with per-record exclusion.** Confluence's shared observer layer demonstrates the `excludeObservers` mechanism concretely: site/space/content facets run the access check, register via `addObserver`, and stamp observations with the observers that must *not* see them (packages/gatekeeper-confluence/src/confluence-observers.ts#L133, #L150-L215) — the inbox-style example given in the framework docs, implemented.

**Typed per-package logging.** Connectors with an `observability.ts` (github, linear, slack, email, supabase, context…) define their own `LogFields` vocabulary and a module logger carrying `component` + `vendorId` (packages/gatekeeper-github/src/observability.ts; see [Logging and Error Reporting](../operations/logging-and-error-reporting.md)).

## Email: the inbound path

`gatekeeper-email` is the one connector that *receives* rather than calls out. The mailbox resource URL is `<baseUrl>/mailbox/<user>` (email.ts#L78, #L128). Delivery rides Workers email routing: the Worker's `email(message)` handler parses the recipient's local part and routes the message to the `EmailAddress` Durable Object **named by that local part** (email.ts#L190-L210; packages/router/src/index.ts#L11-L21 keeps the `GATEKEEPER_EMAIL` binding "dormant until custom domains + Email Routing exist — the handler ships anyway"). The address DO enforces first-claim ownership — the first account to claim an address owns it permanently, foreign claims are rejected — and stores the hook `Fetcher` forwarded from the mailbox gatekeeper's `HookController`, dispatching each inbound message through `HookInitiator.startHook()` like any other hook delivery (email.ts#L532-L640). That's how "wake this gadget when mail arrives at this address" closes the loop without the gatekeeper ever storing a live stub.

## Where to look per task

- Adding a connector → [How to Add a Gatekeeper](../guides/adding-a-gatekeeper.md)
- Binding/listing/connecting mechanics on the Workshop side → [Gatekeeper Framework](framework.md), [The Overseer Workspace Object](../backend/overseer-workspace.md)
- MCP-served tools instead of hand-written APIs → [MCP Gatekeepers](mcp-connectors.md)
