---
type: guide
title: The internal operator API and /state surface
description: The internal-listener operator routes (/state, /reload, /shutdown, /cell, /evict, /do, health), the peer and runtime HMAC-authenticated routes, and what /state reports.
tags: [operator-api, /state, internal-listener, hmac]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-6c4e31d2bf3e043b470c02ee
    resource: repo://crates/celld/operator_cell.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---

# The internal operator API and /state surface

The internal listener serves the peer protocol and the operator API. Reach it
only from a trusted private network — it carries an unauthenticated operator
API and must not reach the public internet (`docs/README.md:424-425`). The
operator API is an alpha interface: a release can change its paths or response
formats, so keep operator tooling and the celld release together
(`docs/README.md:551`).

## Unauthenticated operator routes

These routes do not authenticate the caller (`docs/security.md:86-94`):

- **`/state`** — reports node state, including the deployment it serves, the
  deployments it still drains, the objects that are moving, and the deployment
  each resident object runs (`docs/README.md:271-272`).
- **`/cell/<SCOPE>`** — resolves or activates a cell.
- **`/evict/<SCOPE>`** — evicts a resident cell.
- **`/do/<ID>`** — sends a direct request to an ordinary Durable Object. It
  refuses every reserved runtime class (D1, Workflows, KV, Queues)
  (`docs/security.md:96-100`).
- **`POST /shutdown`** — starts a graceful ownership handoff.
  `POST /shutdown?handoff=preserve` prepares a clean same-node reload and keeps
  the ownership records (`docs/README.md:549-550`).

The public listener reserves only `/.well-known/celld/health`; a healthy node
returns `{"ok":true}`, an unhealthy one a 503. The deployed Worker owns `/health`
and every other public path. The internal listener does not pass an unknown
path to the Worker; it returns a 404 so an operator request cannot become an
application request (`docs/security.md:40-45`).

## Reload

`POST /reload` on the internal listener makes a node adopt the deployment
pointer now (`docs/README.md:247`). It is forced, so an unchanged pointer still
builds a new generation and a vars-file edit takes effect
(`crates/celld/main.rs:751-755`). The response reports `adopted`, `unchanged`,
`failed`, or `unavailable` with the generation/version/prefix and error
(`crates/celld/main.rs:764-813`).

## HMAC-authenticated peer and runtime routes

The internal-listener requests fall into three groups (`docs/security.md:55-68`):

- **Most operator routes** let an operator inspect or control a node without
  request authentication.
- **`/peer/tunnel`** establishes a tunnel for cell fetch, RPC, and WebSocket
  calls. Establishment carries the fleet HMAC, a clock limit, and replay
  protection, so only a holder of the fleet secret can open the tunnel; each
  call then crosses inside the tunnel as plain HTTP with the cell scope in a
  reserved header, and these inner calls are not signed.
- **Peer-control and reserved-cell routes** coordinate fleet nodes and access
  runtime state; they use the fleet HMAC.

The peer protocol uses a shared 32-byte secret stored at `fleet/peer-auth.json`
(`crates/celld/peer_auth.rs:20`). Requests are signed with headers for source,
target, timestamp, nonce, body SHA-256, and signature
(`crates/celld/peer_auth.rs:31-36`). The HMAC binds each body and supplies a
clock limit (`CLOCK_WINDOW_MS` 30 s) and replay protection via a nonce cache
(`crates/celld/peer_auth.rs:22-29`).

Because the tunnel permits a request body to stream to the owner, the fleet HMAC
cannot sign an individual call; the establishment signature decides who can open
the tunnel, and a tunneled call can address an application class or a runtime
class, so every path to a runtime class demands the fleet secret. The signature
does not authenticate the bytes after establishment and does not encrypt
traffic — the private network must stay trusted
(`docs/security.md:70-76`).

## Reaching reserved cells from outside

Operator commands (d1, kv, queue) reach a reserved-class cell through
`crates/celld/operator_cell.rs`: find a live node through the node leases, sign
a request with the fleet secret, and post it to `/runtime/<scope>`, which
forwards to the cell's owner. Neither the command nor a node opens the object in
the bucket instead, because that would write behind the fence and the owner's
next flush would overwrite it (`crates/celld/operator_cell.rs:3-16`). The
`Subject` carries the noun for operator errors and a source label for the log
(`crates/celld/operator_cell.rs:26-36`).

## Peer diagnostics and `/state`

`/peer/probe` returns a signed diagnostic response; the peer protocol uses other
reserved internal paths that an operator must not call directly
(`docs/security.md:101-103`). `/state` continues to accept requests during a
graceful drain and reports the handoff and restore counters
(`docs/README.md:505-506`).

---

## Related pages

- [Security and trust model](/openwiki/security/trust-model.md)
- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
