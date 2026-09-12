---
type: security
title: Security Model
description: The celld trust boundary and threat model — one fleet runs one application — the listener separation, fleet-HMAC peer authentication with clock and replay limits, forwarded-header policy, body limits, and the bucket as the root of authority.
tags: [security, trust-boundary, hmac, listeners, threat-model]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Security Model

celld is an alpha. It is **not safe for hostile multi-tenant use**: one
fleet runs one application, and celld trusts the application code, the
fleet nodes, and the operators. Application code can use its configured
bindings and can consume shared node resources; do not run code from
mutually distrusting tenants in one fleet (docs/security.md#L3-L10).

celld depends on two external security boundaries:

- a **trusted private network** protects the internal listener — use an
  encrypted overlay when the private network does not provide
  confidentiality; and
- **object-storage credentials** control the fleet — give each credential
  access to one fleet bucket only (docs/security.md#L13-L18).

## Listener separation

The public listener serves the deployed Worker; expose it through a load
balancer, a reverse proxy, or a public firewall rule. The internal
listener serves the peer protocol and the operator API; its default
address is `127.0.0.1:0`, so celld selects an available loopback port at
each start, and `--advertise` gives peers an address that reaches it
(docs/security.md#L20-L31). An explicit advertised address requires an
explicit internal-listener address, and an explicit non-loopback public
listener without an explicit internal listener is rejected as an obsolete
configuration (docs/security.md#L32-L34).

celld cannot verify a hostname or a translated port: you must route the
advertised address to the internal listener and not to the public
listener. The internal listener has an unauthenticated operator API, so it
must not reach the public internet (docs/security.md#L36-L38,
docs/README.md#L421-L425).

The internal listener has three request groups (docs/security.md#L55-L76):

- Most operator routes let an operator inspect or control a node without
  request authentication.
- `/peer/tunnel` establishes the tunnel for cell fetch, RPC, and WebSocket
  calls. The establishment request carries the fleet HMAC, a clock limit,
  and replay protection, so only a holder of the fleet secret can open a
  tunnel. Each call then crosses inside the tunnel as plain HTTP with the
  cell scope in a reserved header, and these inner calls are not signed.
- The peer-control routes and the reserved-cell `/runtime/<SCOPE>` routes
  use the fleet HMAC for request authentication, a clock limit, and
  replay protection.

The tunnel permits a request body to stream to the owner, so the fleet
HMAC cannot sign an individual call; the establishment signature decides
who can open a tunnel, and the private network must stay trusted. The
signature does not authenticate the bytes after the establishment and
does not encrypt any traffic (docs/security.md#L70-L76).

celld does not terminate TLS on either listener
(docs/security.md#L78-L80).

## Fleet-HMAC authentication

Peer-control and reserved-cell requests authenticate with an HMAC-SHA256
over a canonical request: the method, path and query, body hash, source,
target, timestamp, and a 16-byte random nonce
(crates/celld/peer_auth.rs#L38-L63). The fleet secret lives in the bucket
at `fleet/peer-auth.json`, created by the first current node
(README.md#L196-L200).

Three security fences are enforced as pure predicates
(crates/logic/peer.rs#L3-L10):

- A peer identity (`source`/`target`) must be non-empty, at most 128
  bytes, and only ASCII alphanumerics plus `_ - .` — a widened charset
  would let a `target` smuggle a path segment past the wrong-target check
  (crates/logic/peer.rs#L14-L23).
- A request timestamp must be within a **two-sided** clock window of 30 s
  — a check that accepted arbitrarily old timestamps would let a captured
  signature replay forever (crates/logic/peer.rs#L25-L30,
  crates/celld/peer_auth.rs#L23).
- Replay-cache retention is pinned at twice the clock window, and a
  compile-time assertion keeps it at least the clock window, because a
  nonce forgotten while its signature is still acceptable reopens the
  replay hole (crates/celld/peer_auth.rs#L24-L28,
  crates/logic/peer.rs#L32-L37).

## Forwarded-header policy

celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` by default; set
`--trust-forwarded-headers` only when a trusted proxy replaces both
headers, and celld uses the last value in each header so an earlier client
value cannot override the proxy value. celld always takes the path and
query from the request target and ignores the scheme and authority in an
absolute-form target, so a client cannot bypass the host policy through
the request line. The hostname checks keep the path and query valid, but
they do not make the hostname trustworthy: an application must not use an
unchecked hostname for an authorization decision
(docs/security.md#L105-L124).

## Body limits

The public Worker listener and `/do/<ID>` have a 1 GiB request body limit
by default (`CELLD_MAX_REQUEST_BODY_BYTES`); celld returns 413 for a
declared oversized body and when a Worker reads past the limit
(docs/security.md#L126-L132).

## The bucket is the root of authority

The fleet bucket stores the deployments, the cell state, the ownership
leases, the node leases, and the shared peer-authentication secret. A
person who holds the bucket credentials controls the fleet; give each
credential access to one fleet bucket only and replace a credential after
a suspected disclosure (docs/security.md#L137-L145).

## Cell ownership as protection

Each cell is a SQLite database with one writer: one node owns a cell at a
time, an ownership epoch fences each cell, and a node that loses its lease
cannot modify the current cell state. This fencing protects storage
consistency, but it does not isolate hostile applications
(docs/security.md#L147-L155).
