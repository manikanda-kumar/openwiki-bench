---
type: "Reference"
title: "MCP connectors: gatekeeper-mcp and gatekeeper-mcp-portal"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-b33f20246e487fc184ecf0ca
    resource: repo://packages/gatekeeper-mcp-portal/src/config.ts
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-cdfffde75f58b2afc9726ed2
    resource: repo://packages/gatekeeper-mcp/wrangler.jsonc
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-afb01d9ad4696e62ef39c85a
    resource: repo://packages/mcp-shared/src/account.ts
  - id: openwiki-source-5bd7c2938e839073c52d4497
    resource: repo://packages/mcp-shared/src/action-store.ts
  - id: openwiki-source-15e165b22a4159106d1b9063
    resource: repo://packages/mcp-shared/src/client.ts
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
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# MCP connectors: gatekeeper-mcp and gatekeeper-mcp-portal

Two gatekeepers speak the Model Context Protocol, sharing one implementation library
(`packages/mcp-shared`):

| Package | Endpoint comes from | Grant is scoped to |
| --- | --- | --- |
| `gatekeeper-mcp` | a URL the **user pastes** | the whole server, or named tools |
| `gatekeeper-mcp-portal` | a deployment var, `MCP_PORTAL_URL` | one upstream server behind the portal, or named tools |

`mcp-shared` is a library, not a Worker: code lives there when two copies would eventually disagree
in a way that would be a security bug — tool classification, the scope grammar, the OAuth
lifecycle, approval-queue wiring. A connector's own vendor entrypoint, DO classes, migrations, and
configurator stay in the connector package (`packages/mcp-shared/README.md:1-16`).

## The trust boundary: `tools.ts`

**Nothing outside `packages/mcp-shared/src/tools.ts` reads a tool's `annotations`** — that file is
the single place a server's self-description becomes a policy decision:

- A tool the server declares `readOnlyHint: true` (strictly `=== true`, matching MCP's own default
  of `false`) is classified `read` and runs as an observation.
- Anything else is an `action` that goes to the approval queue.
- **Auto-applying** a write needs more: the deployment must have vouched for the endpoint
  (`trust === "vetted"`) **and** the tool must declare `destructiveHint: false` **and**
  `idempotentHint: true`. Every test is a strict comparison, so an unannotated tool can never
  auto-apply on either tier (`tools.ts:17-80`).

Honouring `readOnlyHint` on `byo` endpoints is a knowing tradeoff (an unlabelled tool would have
been queued; a mislabelled one runs without approval), argued in the code and stated on the connect
form. Trust is **deployment configuration, not account state**, and is read afresh at each point of
use — withdrawing it takes effect without a reconnect (`tools.ts:20-33`).

The portal earns `vetted` only via `MCP_PORTAL_TRUST_ANNOTATIONS=true`; otherwise it is `byo`,
because a portal relays annotations written by upstream servers the administrator never reviewed
(`packages/gatekeeper-mcp-portal/src/config.ts:33-41`).

What an account records instead of a tier is **`provenance`** (`"user"` or `"deployment"`),
settled at connect time; it decides whether a server may rename itself over an administrator's
chosen label in an approval prompt — a question that should not move when an annotation setting
does (`packages/mcp-shared/src/account.ts:70`, `README.md:76-79`).

## The scope grammar

How much of an endpoint one binding may call is encoded in the resource-URL **fragment**, which is
what the user approved, what `describe()` shows, and what the facet enforces
(`packages/mcp-shared/src/scope.ts:1-16`):

- `<endpoint>` — every tool the endpoint offers, now and later
- `<endpoint>#server=github` — one portal upstream server (portal connector only; the generic
  connector refuses `#server=`)
- `<endpoint>#tool=a&tool=b` — exactly those tools, and nothing else

Endpoint identity is compared over the **whole URL** through `URL` (path and query are part of
which server is being spoken to — one host can front `/mcp` and `/mcp-v2` as unrelated endpoints),
and action-kind scope tags are namespaced by exactly that identity so an always-approve decision on
one host's `/mcp` cannot leak to its `/mcp-v2` (`scope.ts:30-72`).

## At-most-once action application

The guarantee for approved MCP writes is **at most once, not exactly once**
(`README.md:83-105`). Mechanics in `packages/mcp-shared/src/action-store.ts`:

- An approval is **claimed in SQLite before the call is sent**, which stops two concurrent
  `applyAction` calls from both reaching the server.
- Once the call returns, the record is settled in its own small write **before the result is
  attached**, so nothing about handling a server-controlled payload can lose the fact that the
  write happened.
- A **fresh DO activation closes every `applying` claim as `failed`/non-retryable** with an
  outcome-unknown message — the call was dispatched but its outcome was never observed, so it may
  or may not have taken effect (`action-store.ts:48-55`).
- Failure classification (`callMayHaveTakenEffect`, `client.ts:208-218`) fails safe: only a
  not-dispatched error or a 401/403-class `McpAuthRequiredError` proves the server refused before
  dispatch; session-expiry responses and protocol errors that are not provably "declined", and
  everything else, count as possibly performed — so they are closed as `failed` and **not
  retryable**.

The cost of a network blip is a call someone must stage again, deliberately: an approval is never
spent twice without a person saying so.

## Outbound fetch: SSRF-safe by construction

Every outbound request goes through `packages/mcp-shared/src/fetch.ts`:

- Redirects are **followed by hand and re-checked at every hop** (max 3 hops), with `Authorization`
  dropped when a hop leaves the original origin — unconditional, because "a caller forgetting to
  opt in is the failure mode" (`fetch.ts:3-14`, `171-178`).
- One 30-second default deadline covers redirects, pagination, body streaming, and session retry;
  multi-page operations share an absolute deadline (`fetch.ts:16-27`).
- Every response body is buffered whole under a 1 MiB cap, since a `tools/call` result is otherwise
  unbounded (`fetch.ts:45-53`).
- `MCP_ALLOW_INSECURE=true` is the single, one-definition escape hatch permitting plain HTTP and
  private hosts for local development; both connectors' wrangler configs default it to `"false"`
  (`fetch.ts:43-51`; `gatekeeper-mcp/wrangler.jsonc:33`).

SDK OAuth operations are given `sdkFetch(...)` so the official `@modelcontextprotocol/client`'s
requests and redirects retain the same endpoint and SSRF checks (`README.md` conventions;
`fetch.ts:103`).

## The owner-only sharing rule

An MCP binding is **owner-only**: `addObserver` refuses unconditionally, with a message explaining
that there is no way to check whether anyone else may see what the gadget read on its owner's
credentials — and suggesting publishing a blueprint instead, so each person connects their own
account (`packages/mcp-shared/src/sharing-policy.ts:1-19`). Writes are still allowed after such a
read, since writing back to the server the data came from discloses it to nobody new.

## The session surface

`McpSessionBase` is the gadget-facing capability every tool call passes through: reads authorize
via `authorizeObservation`, writes stage into the action store and `submitAction` to the approval
queue (`packages/mcp-shared/src/session.ts:108`, `127-165`, `225`). The connector generates a
TypeScript session type per grant (`schema-to-ts.ts`) with runtime methods installed by
`session-methods.ts`, so the generated types are not a fiction; per-binding type names embed a
four-hex tag of the resource URL so two grants that differ in what they may call present distinct
type surfaces to the agent (`packages/gatekeeper-mcp/README.md`).

## Limits

Fixed rather than configurable (`README.md:107-131`); highlights: 200 described or granted tools
per server; 96 KiB catalog; 50 `tools/list` pages; 1 MiB response bodies; 128 KiB retained result;
100 retained actions; 50 awaiting decision; 600-char tool descriptions and 4000-char arguments in
a prompt; 3 redirect hops; 10-minute single-use connect links; 1-hour unfinished-connect cleanup;
30-second outbound deadline.
