---
type: integration
title: "MCP Connectors: mcp-shared, gatekeeper-mcp, gatekeeper-mcp-portal"
description: The two MCP gatekeepers and their shared library — endpoint-vs-portal provenance, the resource-URL scope grammar, the tools.ts annotation trust boundary with byo/vetted tiers, SDK OAuth behind sdkFetch, the at-most-once action store, and owner-only sharing.
tags: [mcp, gatekeeper, trust, oauth, ssrf]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-b33f20246e487fc184ecf0ca
    resource: repo://packages/gatekeeper-mcp-portal/src/config.ts
  - id: openwiki-source-d4385c817799db8e5553ecf0
    resource: repo://packages/mcp-shared/package.json
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-5bd7c2938e839073c52d4497
    resource: repo://packages/mcp-shared/src/action-store.ts
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
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# MCP Connectors: mcp-shared, gatekeeper-mcp, gatekeeper-mcp-portal

Two gatekeepers speak MCP against the same core contract ([Gatekeeper Framework](/openwiki/integrations/gatekeeper-framework.md)); the protocol machinery lives in `packages/mcp-shared` — "not a Worker: a library both of them import," where code moves there when "two copies of it would eventually disagree and the disagreement would be a security bug" (packages/mcp-shared/README.md:1-14):

- **`gatekeeper-mcp`** — endpoints a *user pastes* ("BYO");
- **`gatekeeper-mcp-portal`** — one admin-configured gateway (`MCP_PORTAL_URL`) aggregating named upstream servers.

## Endpoint validation and SSRF

A user-supplied endpoint must be HTTPS and passes a host blocklist (localhost variants, private/link-local/metadata hosts) defined once in `endpoint.ts`; the header notes enforcement is `global_fetch_strictly_public` (set in each connector's wrangler config) rather than DNS-rebinding-prone string checks alone, with `MCP_ALLOW_INSECURE` as an escape hatch (packages/mcp-shared/src/endpoint.ts:1-30, 67-70). **Every** outbound request — including the official SDK's OAuth hops — goes through `fetch.ts`, which caps response bodies at 1 MiB, bounds operations at 30 s, follows redirects *by hand* re-checking each hop, and exposes `sdkFetch(...)` to hand the SDK that same guarded fetcher (packages/mcp-shared/src/fetch.ts:16-103; README module table).

## OAuth via the official SDK

Auth uses `@modelcontextprotocol/client` 2.0.0 (packages/mcp-shared/package.json:35): `oauth.ts` is "a small adapter around the official MCP client's OAuth errors and token revocation gap," `account.ts` persists the SDK OAuth state in a Durable Object base (connect/refresh/revocation), and `connect-nonce.ts` gives connect links a single-use 10-minute nonce with half-built accounts self-deleting after an hour (packages/mcp-shared/README.md:107-131; src/oauth.ts).

## The scope grammar (resource-URL fragments)

How much of an endpoint one binding may call is encoded in the *fragment* of the resource URL — the fragment is what the user approved, what `describe()` shows them, and what the facet enforces (packages/mcp-shared/src/scope.ts:1-9):

```
<endpoint>                                  every tool, now and later
<endpoint>#server=github                    one portal upstream server
<endpoint>#tool=a&tool=b                    exact tool names only
<endpoint>#server=github&tool=github_a      both, enforced independently
```

`tools` holds exact wire names (not server-relative), so portal naming separators never need guessing and pre-portal grants still resolve (scope.ts:8-10). `scopeAllows` gates every call; tool-name selection requires a complete (untruncated) catalog (`requireCompleteCatalogForToolSelection`, scope.ts:129-160).

## The trust boundary: `tools.ts`

The library's invariant: **"Nothing outside `tools.ts` reads a tool's `annotations`"** (packages/mcp-shared/README.md:45; the tier docs in src/tools.ts:21-34). MCP annotations are the *server's claims* about itself, and MCP's own guidance is that clients must treat them as untrusted unless the server is trusted — hence two tiers, named by *provenance*, stored as deployment configuration, read fresh at each point of use so withdrawal takes effect immediately (tools.ts:21-34):

- **`byo`**: `readOnlyHint: true` classifies a tool as a read (which runs as an observation); nothing the server says may auto-apply a write.
- **`vetted`**: an administrator asserted the endpoint's annotations are reliable, so `destructiveHint === false && idempotentHint === true` (plus tier) may drive auto-approval (the `trust === "vetted"` conjunct in `classifyTool`, tools.ts:73-78).

**Why only the portal can reach `vetted` — and only explicitly**: configuring an endpoint is not by itself enough, because a portal aggregates upstream servers whose annotations nobody saw; `gatekeeper-mcp-portal` therefore *defaults to `byo`* and requires `MCP_PORTAL_TRUST_ANNOTATIONS=true` to become vetted (packages/mcp-shared/README.md:47-79; the env gate at packages/gatekeeper-mcp-portal/src/config.ts:40). Plain pasted-endpoint users can never earn the tier. Honouring `readOnlyHint` on `byo` is documented as a *knowing tradeoff* — a mislabelled tool runs unapproved, where an unlabelled one would be queued — accepted because prompting every read would make the connector unusable; auto-applying a write is explicitly *not* accepted on those terms. Every hint is compared with `=== true`/`=== false`, so an unannotated tool is an action, needs approval, and can never auto-apply on either tier (README "Trust tiers"; tools.ts:59-78).

What an *account* records instead of a tier is `provenance` (`"user"`/`"deployment"`), settled at connect time, governing only whether the server may rename itself over the admin's label in approval prompts (README.md:74-80).

## Applying approved actions: at-most-once

The action store's guarantee is "at most once, not exactly once" — MCP has no idempotency key or inverse operation, so the store prefers losing a result over repeating a write (packages/mcp-shared/README.md:81-106). Mechanically: claims are persisted *before* external I/O (packages/mcp-shared/src/action-store.ts:1-21: SQLite-backed staged rows with `claimed_at`), so concurrent `applyAction`s can't both reach the server; the record is settled *before* the result payload is attached, so no server-controlled body (huge, malformed) can erase the fact the write happened; and failure classification `callMayHaveTakenEffect` fails safe — only 401/403 prove pre-dispatch refusal, everything else closes as non-retryable "may or may not have taken effect," with expired claims timing out to the same state (packages/mcp-shared/src/action-store.ts:43-85; README). Retention is bounded (100 actions, 128 KB results, 50 awaiting-decision) because records exist to collect results, not to be an audit log (packages/mcp-shared/README.md:107-131).

## Session and sharing

`session.ts` is "the Gadget-facing capability, and the one path every tool call takes" — no bypassing route exists; `catalog.ts` fetches/caches classifies the tool list scoped to the grant; `schema-to-ts.ts` + `session-methods.ts` make the generated TypeScript surface real at runtime (the `.d.ts` the agent sees matches what `callTool` accepts), and `tool-search.ts` is the one query matcher so a search query can't mean two things (packages/mcp-shared/README.md:17-44). Sharing is deliberately owner-only: `addObserver` refuses unconditionally, because MCP has no per-record authorization to consult — a same-origin connection proves only *authentication*, not access to what the owner's credentials read; writes remain allowed since they disclose nothing new, and the refusal message suggests publishing a blueprint instead (packages/mcp-shared/src/sharing-policy.ts:1-17).

## Related

The `tools/list` page cap (50) truncating catalogs and failing search-discovery as a scan limit, and the other numeric bounds, are tabulated in packages/mcp-shared/README.md:107-131. Connector-specific connect forms and configurators live in each Worker per the README's split rationale.
