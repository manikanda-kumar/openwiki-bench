---
type: integration
title: "MCP Gatekeepers and Trust Tiers"
description: The two MCP connectors and their shared library — endpoint discovery, tool classification, the byo/vetted trust tiers, the at-most-once approval guarantee, auto-approval eligibility, and shared limits.
tags: [mcp, gatekeeper, trust, approvals, portal]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-8ec72ad153f4034495a17669
    resource: repo://packages/gatekeeper-mcp-portal/README.md
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# MCP Gatekeepers and Trust Tiers

There are two MCP-speaking gatekeepers that share one implementation library:

| Package | Endpoint comes from | Grant scoped to |
|---|---|---|
| `gatekeeper-mcp` | a user pastes a URL | the whole server, or named tools |
| `gatekeeper-mcp-portal` | a deployment var `MCP_PORTAL_URL` | one upstream server behind the portal, or named tools |

The shared code lives in `packages/mcp-shared` (a library, not a Worker). Code moves there "when two
copies of it would eventually disagree and the disagreement would be a security bug": tool
classification, the scope grammar, the OAuth lifecycle, the approval-queue wiring (`mcp-shared/README.md`).
Each connector keeps its own vendor entrypoint, Durable Object migrations, `Env`, connect form, and
configurator UI, varying shared behaviour through named hooks (`staticToken`, `mintAccount`).

## Trust tiers: how far a server's self-description is believed

`mcp-shared/src/tools.ts:1` is the **trust boundary** — nothing outside it reads a tool's
`annotations`. A **tier** governs how far an endpoint's own claims about its tools are believed
(`src/tools.ts:15`):

- **`byo`** — a user typed the URL in. `readOnlyHint` still classifies reads as observations, but
  nothing the server says can auto-apply a write.
- **`vetted`** — a deployment has asserted this endpoint's annotations can be relied on, so
  `destructiveHint: false` plus `idempotentHint: true` may drive auto-approval.

Auto-applying a write additionally requires a `vetted` endpoint. `classifyTool` (`src/tools.ts:73`)
is the single place a server self-description becomes a policy decision: a tool is `read` if
`readOnlyHint === true`, an `action` otherwise, and `autoApprovable` only when it is a non-read
action on a **vetted** endpoint with `destructiveHint === false && idempotentHint === true`. Every
test is `=== true`/`=== false`, so an unannotated tool is an action that can never auto-apply.

Honouring `readOnlyHint` on `byo` is a knowing departure (a mislabelled tool runs with no approval);
it is accepted because prompting on every read would make the connector unusable, while auto-applying
a write is not accepted on those terms. The catalog is fingerprinted (`catalogRevision`,
`src/tools.ts:144`) over each tool's name and every policy-relevant claim so an endpoint changing
under us is detected.

## The two connectors

**`gatekeeper-mcp`** — the user pastes an endpoint URL; `endpoint.ts` validates it against a host
blocklist (no private/loopback/metadata hosts, HTTPS required unless `MCP_ALLOW_INSECURE`), the
gatekeeper opens a Streamable HTTP session and calls `initialize`, and a `401` begins the official
MCP client OAuth flow. The endpoint is fixed at first connect. Tools are surfaced as per-tool typed
methods wrapping `callTool`, with reads (recorded as observations) resolving immediately and writes
queued for approval. A binding offers two grant breadths: **server-wide** (`<endpoint>`) and **named
tools** (`<endpoint>#tool=a&tool=b`); the breadth is asked outright because "all 14 ticked" vs "these
14 by name" diverge as soon as the server publishes a fifteenth. Tools named `portal_*` are never
grantable on a portal-identifying endpoint. A server-wide grant can cover more tools than the bounded
catalog, discovered on demand via `listTools({ search })` / `listTools({ name })` under explicit scan
limits.

**`gatekeeper-mcp-portal`** — an admin configures one `MCP_PORTAL_URL`; everyone reaches the servers
behind it without typing an endpoint. A grant always names **one** upstream server via
`<endpoint>#server=<id>` (or named tools of that server) — "everything the portal offers" is not
offered. The `<tag>` in the session type name derives from the resource URL, mattering most here
because two grants pinning different tools of one upstream server share name and endpoint. Changing
`MCP_PORTAL_URL` on a deployment with connected accounts is a **repoint**: existing bindings fail
closed at once retries (\the minting path checks facet props against current config and the account
refuses to issue credentials for a moved endpoint); reconnecting is the one accepted endpoint change.

## Trust annotations and the portal

A portal aggregates upstream servers whose annotations the administrator never saw, so
`gatekeeper-mcp-portal` defaults connectors to `byo` and requires
`MCP_PORTAL_TRUST_ANNOTATIONS=true` to drive auto-approval (`mcp-shared/README.md`). Annotations are
optional in MCP and most servers publish none; every hint is `=== true`/`=== false`.

Neither tier can be **shared**: a Gadget bound to any MCP endpoint is owner-only, since being able to
authenticate to a server is not evidence of being allowed to see what the owner read from it. What an
account records instead of a tier is `provenance` (`"user"` or `"deployment"`), which decides whether
a server may rename itself over an administrator's label in an approval prompt.

## The at-most-once approval guarantee

`mcp-shared` guarantees **at most once**, not exactly once, for a write — MCP has no idempotency key
and no inverse operation, so where they conflict the store prefers losing the result over repeating
the write (`mcp-shared/README.md` §"Applying an approved call").

- An approval is **claimed in storage before the call is sent**, which stops two concurrent
  `applyAction` calls both reaching the server.
- Once the call returns, the record is settled in its own small write **before** the result is
  attached, so nothing about handling a server-controlled payload can lose the fact the write already
  happened.
- Failures are split by what the server is known to have done: only a `401`/`403` proves the tool
  was refused before dispatch. Generic HTTP/JSON-RPC errors, dropped connections, malformed replies,
  and oversized bodies leave the outcome unknown and are closed as **failed and not retryable**
  (`callMayHaveTakenEffect` fails safe). An activation dying between sending the call and recording
  the reply releases no claim; after `APPLY_CLAIM_TIMEOUT_MS` the action closes the same way.

The cost of a network blip is a call someone has to stage again, deliberately — an approval is never
spent twice without a person saying so.

## Shared limits

`mcp-shared/README.md` §"Limits" fixes a table of hard limits (rather than deployment settings).
Highlights: described/individually-granted tools per server **200**; catalog size 96 KiB; filtered
discovery scan 5,000 tools / 4 MiB; search query 200 chars / 20 results; hydrated tool definitions
200 tools / 1 MiB; tool description 4 KB; input schema 20 KB (dropped rather than clipped);
`tools/list` pages 50; response body 1 MiB (every response buffered whole); bounded outbound
operation 30 s; retained result 128 KB / 100 rows; actions awaiting decision 50; tool description in
a prompt 600 chars; tool arguments in a prompt 4000 chars; server name 60 chars (stripped of
Markdown); redirect hops 3; connect link 10 min single-use; unfinished connect 1 hour.

## Uncertainty

Tool-list changes are **adopted, not pinned**: a changed list is taken and logged (`catalog.changed`),
since refusing to see new tools would break working Gadgets; a tool-scoped binding cannot widen this
wayler, which is why "Choose tools" is preferred for anything that writes. SSRF is enforced after DNS
by the `global_fetch_strictly_public` compatibility flag, not by the host blocklist (which cannot see
through a public hostname that resolves/rebinds to a private address).
