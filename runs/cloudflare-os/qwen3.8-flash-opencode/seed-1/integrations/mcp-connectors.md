---
type: integration
title: MCP Connectors
description: gatekeeper-mcp and gatekeeper-mcp-portal share the mcp-shared library — the tools.ts trust boundary (byo vs vetted tiers), the resource-URL scope grammar, hand-checked redirects via sdkFetch, at-most-once action application, and the fixed limits.
tags: [mcp, trust-boundary, oauth, ssrf, scope, approval-queue]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-8ec72ad153f4034495a17669
    resource: repo://packages/gatekeeper-mcp-portal/README.md
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-afb01d9ad4696e62ef39c85a
    resource: repo://packages/mcp-shared/src/account.ts
  - id: openwiki-source-95506d34b663b99741998cc2
    resource: repo://packages/mcp-shared/src/endpoint.ts
  - id: openwiki-source-0e39679673922fc4ebc2eed7
    resource: repo://packages/mcp-shared/src/fetch.ts
  - id: openwiki-source-9a666bbf1286d7d1b7ff2553
    resource: repo://packages/mcp-shared/src/scope.ts
  - id: openwiki-source-1cd7f2c2d4fc486cd3495da5
    resource: repo://packages/mcp-shared/src/sharing-policy.ts
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# MCP Connectors

Two gatekeepers speak MCP: **`gatekeeper-mcp`** (users paste any MCP endpoint URL; one Worker
covers every server) and **`gatekeeper-mcp-portal`** (one administrator-configured
`MCP_PORTAL_URL`; org-approved upstream servers, no user-typed endpoints)
(packages/gatekeeper-mcp/README.md#L3-L14, packages/gatekeeper-mcp-portal/README.md#L3-L14).
Code that "two copies of would eventually disagree, and the disagreement would be a security bug"
lives in **`packages/mcp-shared`** — a library, not a Worker: tool classification, the scope
grammar, the OAuth lifecycle, the approval-queue wiring — while each connector keeps its own
vendor entrypoint, DOs, connect form, and configurator, varying shared behavior only through named
hooks like `staticToken`/`mintAccount` (packages/mcp-shared/README.md#L10-L15).

## tools.ts is the trust boundary

"The trust boundary: what an MCP server says about its own tools becomes what a Gadget may do.
**Nothing outside this file reads a tool's `annotations`**"
(packages/mcp-shared/src/tools.ts#L1-L3). Classification (`classifyTool`) yields per-tool
`mode: "read" | "action"`, `autoApprovable`, and a recorded `classifiedBy` so no consumer can
re-derive a different answer (packages/mcp-shared/src/tools.ts#L37-L56).

Two tiers, named by provenance and decided by the *deployment*, not the server describing itself
(packages/mcp-shared/README.md#L47-L66):

- **`byo`** — a user typed the URL. `readOnlyHint: true` classifies reads (recorded as
  observations); nothing else the server says matters. Mislabeling risk is an accepted tradeoff:
  prompting on every read would make the connector unusable.
- **`vetted`** — an administrator asserts the endpoint's annotations are reliable, so
  `destructiveHint === false && idempotentHint === true` may additionally drive auto-approval
  (packages/mcp-shared/src/tools.ts#L73-L80). Configuring an endpoint alone doesn't earn it: the
  portal defaults to `byo` and requires `MCP_PORTAL_TRUST_ANNOTATIONS=true`
  (packages/mcp-shared/README.md#L60-L65).

All comparisons are strict `=== true`/`=== false`: MCP hints are optional, so an unannotated tool
is an action, needs approval, and can never auto-apply on either tier. Trust governs annotations
only — an MCP binding is **owner-only for sharing regardless of tier**
(packages/mcp-shared/src/sharing-policy.ts; README "Neither tier can be shared").

## The scope grammar

Grant breadth is encoded in the **resource URL fragment** — the thing the user approved, what
`describe()` shows them, and what the facet enforces (packages/mcp-shared/src/scope.ts#L1-L10):

| Form | Meaning |
| --- | --- |
| `<endpoint>` | every tool the endpoint offers, now and later (`byo` connector only) |
| `<endpoint>#server=github` | every tool of one portal upstream server (portal only; `#server=` is refused on the `byo` connector) |
| `<endpoint>#tool=a&tool=b` | only these exact wire names |
| both keys | server *and* exact-tool constraints, enforced independently |

Tool names are exact wire names (not portal-relative), so grants issued before portals existed
resolve identically; endpoint comparisons go through `URL` so two spellings can't read as distinct
(packages/mcp-shared/src/scope.ts#L8-L11, L32-L40). Session type names carry a 4-hex tag derived
from the resource URL because two grants over one endpoint with different scope would otherwise be
indistinguishable to the agent (packages/gatekeeper-mcp/README.md#L24-L31,
packages/gatekeeper-mcp-portal/README.md#L22-L27).

## OAuth and outbound requests

OAuth uses the official `@modelcontextprotocol/client` (packages/mcp-shared/src/oauth.ts#L1-L8);
every SDK OAuth operation is given `sdkFetch(...)` so endpoint validation, the SSRF host blocklist
(single definition in `endpoint.ts`), and per-hop re-checking of hand-followed redirects survive
the SDK's own request path (packages/mcp-shared/src/account.ts#L527, L591, L774;
packages/mcp-shared/src/fetch.ts#L103; packages/mcp-shared/src/endpoint.ts#L1-L3).
Connect nonces are single-use, consumed on success, and expire in 10 minutes
(packages/mcp-shared/README.md#L130; `connect-nonce.ts`).

## Applying approved actions: at-most-once

The store's guarantee is *at most once*, not exactly once — MCP has no idempotency key and no
inverse operation, so a lost result beats a repeated write. Approvals are claimed in storage before
dispatch (stopping concurrent `applyAction` double-sends), settled in their own write *before* the
result is attached (server-controlled payloads can't lose the fact the write happened), and
failures are split by what the server is known to have done: only `401`/`403` prove refusal;
everything else (generic HTTP/JSON-RPC errors, dropped connections, malformed or oversized
replies, even a dead activation mid-call) closes as failed and **not retryable** because the
request may have executed (packages/mcp-shared/README.md#L79-L103).

## Fixed limits

The connectors' bounds are hard-coded rather than configurable — the shared README tabulates them
(packages/mcp-shared/README.md#L107-L130): e.g. 200 tools per server, 96 KiB catalogs (under the
DO's 128 KiB value limit), a 5,000-tool / 4 MiB discovery scan, 1 MiB buffered responses and a
30-second outbound deadline in `fetch.ts`, 3 redirect hops, 128 KiB retained results with at most
100 retained actions and 50 awaiting a decision, and prompt-clipping of server- and
agent-controlled text (600/4000 chars) that feeds a security decision.

Related: [Gatekeeper Framework](../security/gatekeeper-framework.md),
[Gatekeeper Connector Catalog](./gatekeeper-connectors.md).
