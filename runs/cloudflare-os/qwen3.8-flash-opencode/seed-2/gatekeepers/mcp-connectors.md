---
type: connector
title: MCP Gatekeepers
description: The two MCP connectors and the shared mcp-shared library — the tools.ts trust boundary over server-provided annotations, the byo/vetted tiers, the fragment-grammar resource scope, queued-action durability, and the always-revalidating fetch layer.
tags: [mcp, gatekeeper, trust, oauth, ssrf]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-b33f20246e487fc184ecf0ca
    resource: repo://packages/gatekeeper-mcp-portal/src/config.ts
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-dbf641c42dd1947ca20337a8
    resource: repo://packages/gatekeeper-mcp/src/mcp.ts
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-afb01d9ad4696e62ef39c85a
    resource: repo://packages/mcp-shared/src/account.ts
  - id: openwiki-source-5bd7c2938e839073c52d4497
    resource: repo://packages/mcp-shared/src/action-store.ts
  - id: openwiki-source-0e39679673922fc4ebc2eed7
    resource: repo://packages/mcp-shared/src/fetch.ts
  - id: openwiki-source-9a666bbf1286d7d1b7ff2553
    resource: repo://packages/mcp-shared/src/scope.ts
  - id: openwiki-source-150fb16afae636493441eb23
    resource: repo://packages/mcp-shared/src/session.ts
  - id: openwiki-source-1cd7f2c2d4fc486cd3495da5
    resource: repo://packages/mcp-shared/src/sharing-policy.ts
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# MCP Gatekeepers

Two connectors speak MCP: **`gatekeeper-mcp`**, whose endpoint a user pastes in, and **`gatekeeper-mcp-portal`**, one admin-configured portal (`MCP_PORTAL_URL`) fronting many upstream servers. Their shared machinery lives in **`packages/mcp-shared`** — not a Worker, a library — under the rule that code is shared "when two copies of it would eventually disagree and the disagreement would be a security bug" (classification, scope grammar, OAuth lifecycle, approval wiring), while vendor entrypoints, DO classes, connect forms, and configurators stay per-connector, varying through named hooks (`staticToken`, `mintAccount`), never private forks (packages/mcp-shared/README.md#L1-L19).

## The trust boundary: `tools.ts`

*"Nothing outside this file reads a tool's `annotations`"* (packages/mcp-shared/src/tools.ts#L1-L2). A `ServerTrust` tier — deployment configuration, not account state, read fresh at each point of use so withdrawing it takes effect immediately — governs how far a server's self-description is believed:

- **`byo`** (a user typed the URL): `readOnlyHint === true` classifies a tool as a read (an *observation*, running with no approval); nothing the server says can auto-apply a write (tools.ts#L10-L33).
- **`vetted`** (an administrator vouched for the endpoint): additionally, `destructiveHint === false && idempotentHint === true` makes an action auto-*approvable* (tools.ts#L74-L80). The portal defaults to `byo` even when configured, requiring the explicit `MCP_PORTAL_TRUST_ANNOTATIONS=true` — a portal aggregates upstream servers whose annotations the admin never saw (packages/gatekeeper-mcp-portal/src/config.ts#L40).

Honouring `readOnlyHint` on `byo` is a *knowing* tradeoff documented at the decision: a mislabeled read-only tool runs unapproved where an unannotated one would queue, accepted because prompting every read makes the connector unusable and the owner chose the server — while auto-applying writes is explicitly not accepted on those terms (tools.ts#L26-L29, #L63-L70). Every hint is compared with `=== true`/`=== false`, so unannotated tools are actions, queued, never auto-applied — matching the MCP spec's defaults. Tool *catalogs* fingerprint each tool's claims (a `ClassificationSource` records whether the server or the default decided), so a grant's basis survives review (tools.ts#L36-L37, #L125-L142). `MAX_TOOLS_PER_SERVER = 200` bounds generated types and catalogs (tools.ts#L39-L40).

## The session and the scope grammar

`session.ts` is "the capability a Gadget actually holds": one session per MCP binding, one path every tool call takes, identical rules for both connectors — the per-connector differences (which server, how to reach it) arrive through the `McpSessionHost` interface, and the base never touches DO storage, the account, or credentials (packages/mcp-shared/src/session.ts#L1-L5).

The grant's shape is encoded in the **resource URL fragment** — what the user approved, what `describe()` shows, and what the facet enforces (packages/mcp-shared/src/scope.ts#L1-L10):

```
<endpoint>                              every tool, now and later
<endpoint>#server=github                one portal upstream server
<endpoint>#tool=a&tool=b                exact tool names only
<endpoint>#server=github&tool=github_a  both, enforced independently
```

Tool names are exact wire names (not server-relative) so pre-portal grants resolve identically. And **every MCP binding is owner-only**: `addObserver` refuses unconditionally — authenticating to the same origin proves *who* someone is, not that they may read what this gadget read on the owner's credentials; writes still work because sending data back to its source discloses nothing new (packages/mcp-shared/src/sharing-policy.ts#L1-L5).

## Durability: the queued-action store

`action-store.ts` gives approval-gated calls a Durable lifecycle in the owning facet's **isolated SQLite**: claims are persisted *before* external I/O so an interrupted write is never replayed, results are bounded (`MAX_RESULT_BYTES = 128 KiB`, `MAX_ARGUMENT_BYTES = 64 KiB`), and retention is capped (`MAX_RETAINED_ACTIONS = 100`, `MAX_PENDING_ACTIONS = 50`) (packages/mcp-shared/src/action-store.ts#L1-L10). The store's claim mechanism is what makes one approval never double-send.

## Network discipline

`fetch.ts` is every outbound request: validating the URL up front is insufficient because `fetch` follows redirects by default — a validated server could 307 to a host the blocklist exists to refuse *after* every check ran — so redirects are followed manually, **each hop re-validated**, with `Authorization` dropped on any cross-origin hop, unconditionally rather than opt-in (packages/mcp-shared/src/fetch.ts#L1-L8). OAuth uses the official `@modelcontextprotocol/sdk` client, and every SDK operation is given `fetchFn: sdkFetch(...)` so SDK requests *and their redirect chains* retain endpoint and SSRF checks (packages/mcp-shared/src/account.ts#L43, #L527, #L591). `endpoint.ts` owns the single definition of the user-supplied-endpoint host blocklist; an admin-configured portal URL has no untrusted input to validate (packages/mcp-shared/src/endpoint.ts#L1-L12).

## The two connectors

| | endpoint from | grant scoped to | tier |
|---|---|---|---|
| `gatekeeper-mcp` | user-pasted URL (validated, blocklisted) | whole server or named tools | always `byo` |
| `gatekeeper-mcp-portal` | `MCP_PORTAL_URL` (unset ⇒ connector hides itself) | one upstream server behind the portal, or named tools | `byo` unless `MCP_PORTAL_TRUST_ANNOTATIONS=true` |

The portal adds gateway detection, tool-name→upstream-server mapping, and server listing (`portal.ts`); both share the connect-flow HTML "so both connectors look like one product" and the same http routing for OAuth callbacks under their `/gatekeeper/<name>` prefix (packages/mcp-shared/README.md#L20-L45; packages/gatekeeper-mcp-portal/src/config.ts#L40-L68; see [Gatekeeper Framework](framework.md) for the protocol these sit on).
