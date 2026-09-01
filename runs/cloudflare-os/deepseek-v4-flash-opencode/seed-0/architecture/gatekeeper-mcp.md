---
type: "Reference"
title: "MCP gatekeepers"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-8ec72ad153f4034495a17669
    resource: repo://packages/gatekeeper-mcp-portal/README.md
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-afb01d9ad4696e62ef39c85a
    resource: repo://packages/mcp-shared/src/account.ts
  - id: openwiki-source-5bd7c2938e839073c52d4497
    resource: repo://packages/mcp-shared/src/action-store.ts
  - id: openwiki-source-95506d34b663b99741998cc2
    resource: repo://packages/mcp-shared/src/endpoint.ts
  - id: openwiki-source-9a666bbf1286d7d1b7ff2553
    resource: repo://packages/mcp-shared/src/scope.ts
  - id: openwiki-source-1cd7f2c2d4fc486cd3495da5
    resource: repo://packages/mcp-shared/src/sharing-policy.ts
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---


# MCP gatekeepers

Two gatekeepers connect Model Context Protocol (MCP) servers to Gadgets, sharing one library so the
security-critical logic cannot drift into two copies:

- **`gatekeeper-mcp`** — the user pastes an endpoint URL; each tool becomes a typed method.
- **`gatekeeper-mcp-portal`** — an administrator configures one portal URL; a grant always names one
  upstream server behind the portal.

The shared logic lives in **`@gadgets/mcp-shared`**: the bounded Streamable HTTP client, the OAuth
chain, the tool classification trust boundary, the scope grammar, the action store, the connect-flow
pages, and the account DO base. Each connector keeps its own vendor entrypoint, Durable Object
classes, migrations, env, connect form, and configurator UI; where a connector varies shared behavior
it does so through a named hook (`staticToken`, `mintAccount`), never a private copy. The trust
boundary is `tools.ts`, and **nothing outside it reads a tool's `annotations`**.

## Trust tiers

MCP's own guidance is that a client must treat tool annotations as untrusted unless they come from a
trusted server. The tier records which servers those are, and it is deployment configuration read at
each point of use (so withdrawing it takes effect at once):

- **`byo`** — a user typed the URL in. `readOnlyHint` classifies reads; nothing the server says can
  auto-apply a write. This is the default for both connectors — even a portal, because its upstreams'
  annotations were never reviewed by the administrator who chose it.
- **`vetted`** — a deployment has asserted this endpoint's annotations are reliable, so
  `destructiveHint: false` plus `idempotentHint: true` may drive auto-approval. Only the portal
  connector can produce a vetted endpoint, and only with `MCP_PORTAL_TRUST_ANNOTATIONS=true`.

Every annotation test is `=== true` or `=== false`, so an unannotated tool is an action that needs
approval and can never auto-apply (matching the spec's own defaults). Honouring `readOnlyHint` on
`byo` is a deliberate tradeoff (a mislabeled tool runs without a prompt) — accepted because prompting
on every read would make the connector unusable and a dishonest server can act on any approved call
anyway. What the tier guarantees is that no BYO server gets a write *auto-applied*, and every call
trusted on the server's word is recorded as such (`McpToolInfo.classifiedBy`). The action-kind tag
namespaces approval policy by endpoint (`actionKindFor`), and approval prompts render server-chosen
text safely: descriptions are block-quoted and fenced, arguments are capped, and both are flattened
of Markdown structure.

## The scope grammar

A grant's breadth is encoded in the **resource URL fragment**
(`scope.ts`):

- `<endpoint>` — every tool the endpoint offers, now and later;
- `<endpoint>#server=github` — every tool of one portal upstream server;
- `<endpoint>#tool=a&tool=b` — only these exact tools;
- `<endpoint>#server=github&tool=github_a` — both, enforced independently.

`tools` holds exact wire names (never names relative to a server), so no code guesses at the portal's
separator. Parsing fails closed: a `tool` key that yields nothing usable, or the obsolete `tools`
key, produces an **empty** restriction rather than whole-endpoint access — only the absence of both
keys grants everything. `scopeAllows` enforces per-call membership (and excludes `portal_*` tools on
a detected portal, since they let a session change which upstream servers it can reach), and a grant
can name at most `MAX_TOOLS_PER_SERVER` (200) tools.

## The OAuth chain and endpoint checks

Connect runs the official MCP client against the endpoint: `initialize` first; a `401` starts the
discovery chain (protected-resource metadata -> authorization server metadata -> dynamic client
registration -> authorization code + PKCE, with resource indicator), falling back to conventional
`/authorize` `/token` `/register` paths. Tokens live in the connector's `McpAccount` Durable Object
and are refreshed proactively before the recorded expiry; a `401` mid-session is *not* a refresh
trigger (it means a revoked/repudiated grant) — the account is marked as needing attention and the
user reconnects. Every SDK OAuth operation is given `sdkFetch(...)` so every request and redirect
retains the endpoint and SSRF checks.

Endpoint validation (`endpoint.ts`) rejects non-`https` URLs and blocked hosts (localhost, private,
link-local, cloud-metadata, `.internal`) at connect time, and refuses URLs carrying credentials. The
blocklist is a legible refusal, not the boundary: the real SSRF boundary is the
`global_fetch_strictly_public` compatibility flag in each connector's `wrangler.jsonc`, which makes
workerd reject reserved IP ranges after DNS resolution on every request and redirect hop.
`MCP_ALLOW_INSECURE=true` disables these checks for local development.

## At-most-once action application

The `ActionStore` (`action-store.ts`) gives the connector's **at most once** guarantee — not exactly
once, since MCP has no idempotency key and no inverse. The discipline:

- An action is **claimed in storage** (`state = 'applying'`) *before* the call is sent, which stops
  two concurrent `applyAction` calls from both reaching the server.
- Once the call returns, the record is settled in its own small write *before* the result is
  attached, so nothing about handling a server-controlled payload can lose the fact that the write
  happened.
- Failures are split by what the server is known to have done: only a `401`/`403` proves the tool was
  refused before dispatch. Generic HTTP/JSON-RPC errors, dropped connections, malformed replies, and
  oversized bodies leave the outcome **unknown** — those close as failed and non-retryable
  (`callMayHaveTakenEffect` fails safe: anything it can't positively identify as declined counts as
  possibly performed). A stale `applying` claim from an interrupted activation is closed the same way
  ("may or may not have taken effect") rather than released for another attempt.
- Pending actions are capped (50 awaiting a decision) and results are bounded (128 KiB retained, 100
  rows kept), since the store is for collecting a result, not an audit log.

The `McpAccount` records `provenance: "user" | "deployment"` instead of a tier; provenance decides
whether a server may rename itself over an administrator's chosen label in an approval prompt.

## Sharing: owner-only

Neither tier can be shared: an MCP binding is **owner-only** (`sharing-policy.ts`). `addObserver`
refuses unconditionally, because authenticating to a server is not evidence of being allowed to see
what the *owner* read from it — the gadget runs on the owner's credentials throughout. Writes still
work (writing back to the same server discloses nothing new); to share the work, publish the gadget
as a blueprint so each person connects their own server.

## The connectors

- **gatekeeper-mcp** — one resource type ("Any MCP server") at two breadths (whole server, or named
  tools). The binding is named after the endpoint's host; the session type appends a four-hex tag
  derived from the resource URL so grants that differ in scope get different type names. Each tool
  becomes a typed method (generated from the server's `inputSchema`) that delegates to `callTool`,
  keeping the scope check, approval queue, and observation record in one place; tools whose names the
  RPC layer can't deliver remain callable by wire name. There is no simulation (queued calls set
  `awaitDecision`, suspending the agent), no revert, and no hooks.
- **gatekeeper-mcp-portal** — one deployment-configured URL. A grant always names exactly one
  upstream server (whole-server or named tools); "everything the portal offers" is not offered.
  Upstream servers are recovered from the portal's documented contract: every tool is named
  `{server_id}_{name}` (membership is a pure string test needing no network), and
  `portal_list_servers` lists the upstreams. Detection is a capability probe, not a hostname match,
  and a truncated listing still counts as a portal so the `portal_*` exclusion can't fail open. The
  configurator surveys large portals with a name-only tool index (up to 1,000 entries) when the
  server list is unavailable. A changed `MCP_PORTAL_URL` is a **repoint**: existing bindings fail
  closed at once (the account refuses credentials for an endpoint other than its recorded one) and
  the account advances a persisted generation so late-returning refreshes/sessions under the old
  generation are ignored.

Both connectors share the same session API — a typed method per described tool, plus `callTool`,
`getActionResult`, and `listTools` with progressive search/name discovery bounded by the shared limits
(200 described tools, 96 KiB catalog, 5,000-tool/4 MiB scan, 20 search results, 4 KiB descriptions,
20 KiB schemas, 30-second bounded operations, 3 redirect hops, 1 MiB response bodies).
