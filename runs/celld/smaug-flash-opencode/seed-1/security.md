---
type: security
title: Security Model
description: Peer HTTP on the internal listener, the fleet HMAC and peer-auth signing, the node-log recovery interlock, credential handling, storage preconditions, and the trusted-network requirements.
tags: [security, peer-auth, hmac, networking, threats]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Security Model

## The alpha boundary

celld is an alpha and is not safe for hostile multi-tenant use. Security fixes
apply to the latest release only, so older alpha builds do not receive fixes
(`docs/security.md:3-4`). One fleet runs one application, and celld trusts the
application code, the fleet nodes, and the operators; do not run code from
mutually distrusting tenants in one fleet (`docs/security.md:8-11`).

celld depends on two external security boundaries: a trusted private network
that protects the internal listener (use an encrypted overlay when the private
network does not provide confidentiality), and object-storage credentials that
control the fleet, each restricted to one fleet bucket (`docs/security.md:13-18`).

## Two listeners, separated

celld opens two HTTP listeners (`docs/security.md:20-46`):

- The **public listener** (`--listen`) serves the deployed Worker and
  reserves only `/.well-known/celld/health`. Terminate TLS and authenticate
  users in a proxy or the application.
- The **internal listener** (`--internal-listen`) serves the peer protocol and
  the operator API. Its default address is `127.0.0.1:0`, so celld selects an
  available loopback port at each start; use `--advertise` to give peers an
  address that reaches it. The internal listener does not pass an unknown path
  to the Worker; it returns a 404, so an operator request cannot become an
  application request.

An explicit advertised address requires an explicit internal-listener address,
and an explicit non-loopback public listener without an explicit internal
listener is rejected; these checks prevent an obsolete one-listener
configuration (`docs/security.md:32-34`, `crates/celld/main/cli.rs:236-246`).
celld cannot verify a hostname or a translated port — you must route the
advertised address to the internal listener and must not route it to the public
listener (`docs/security.md:36-38`).

## The internal listener's three request groups

The internal listener has three request groups (`docs/security.md:55-80`):

1. **Most operator routes** let an operator inspect or control a node without
   request authentication (`/state`, `/cell/<SCOPE>`, `/evict/<SCOPE>`,
   `/do/<ID>`, `POST /shutdown`).
2. **The `/peer/tunnel` route** establishes a tunnel for cell fetch, RPC, and
   WebSocket calls. The *establishment* request carries the fleet HMAC, a clock
   limit, and replay protection, so only a holder of the fleet secret can open a
   tunnel. Each call then crosses inside the tunnel as plain HTTP with the cell
   scope in a reserved header, and these inner calls are not signed.
3. **The peer-control routes** coordinate fleet nodes, and the reserved-cell
   routes access runtime state. Both use the fleet HMAC for request
   authentication, a clock limit, and replay protection.

All three groups require the trusted private network. The tunnel permits a
request body to stream to the owner, so the fleet HMAC cannot sign an individual
call; the establishment signature decides who can open a tunnel, and a tunneled
call can address an application or a runtime class. The signature does not
authenticate the bytes after establishment and does not encrypt traffic, so the
private network stays trusted and the HMAC does not replace that boundary
(`docs/security.md:70-80`). celld does not terminate TLS on either listener.

The `/do/<ID>` route refuses every reserved runtime class (D1, Workflows, KV,
Queues); their operator protocols can access application data or change runtime
state, so they use the HMAC-authenticated `/runtime/<SCOPE>` route instead
(`docs/security.md:96-103`).

## The fleet HMAC and peer auth

`PeerAuth` (`crates/celld/peer_auth.rs:60`) implements the HMAC. A canonical
request binds the method, path-and-query, body SHA-256 hash, source node id,
target node id, a near-current timestamp, and a fresh 16-byte nonce
(`signed_headers_parts`, `crates/celld/peer_auth.rs:136-174`). HMAC-SHA256 is
keyed by the shared 32-byte fleet secret. Verification applies a 30 s clock
window and a replay cache of up to one million entries, retaining nonces longer
than the clock window so a replay cannot slip back in-window. The verify failure
paths (`VerifyError`) map to distinct HTTP statuses: wrong target → CONFLICT,
incompatible version → UPGRADE_REQUIRED, replay → CONFLICT, replay-cache full →
SERVICE_UNAVAILABLE (`crates/celld/peer_auth.rs:66-95`).

`PROTOCOL_VERSION` is 5, carried in the `x-cells-peer-version` header, and cell
fetch/RPC requests depend on the trusted private network independently of the
HMAC (`peer_auth.rs:16-18`). The node-log recovery interlock is decided in the
decision core as `Effect::RecoverNodeLog`; peer-control coordination of that
recovery uses the same signed peer transport.

The approval boundaries and exact trust of the HMAC are described in
`docs/security.md:55-103`; this is the authority on who may open a tunnel or
reach a runtime class.

## Forwarded-header policy

celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` by default. Set
`--trust-forwarded-headers` / `CELLD_TRUST_FORWARDED_HEADERS=1` only when a
trusted proxy replaces both headers; celld uses the last value in each header.
Without a trusted proxy the `Host` header controls the hostname in `request.url`
and is validated against malformed/noncanonical values, falling back to
`celld.local`. These checks keep path and query valid but the hostname is not
trustworthy for authorization without a trusted proxy (`docs/security.md:105-124`).

## Request-body limits

The public Worker listener and `/do/<ID>` have a 1 GiB request body limit by
default (`CELLD_MAX_REQUEST_BODY_BYTES`), returning 413 for a declared
oversized body or when a Worker reads past the limit. Bodies of at least 1 MiB
or unknown length stream for methods other than GET/HEAD (`docs/security.md:126-136`).

## Protecting the fleet bucket

The fleet bucket is the root of authority: it stores the deployments, the cell
state, the ownership leases, the node leases, and the shared peer-authentication
secret. A person who holds the bucket credentials controls the fleet
(`docs/security.md:137-145`). celld additionally depends on the storage
preconditions for correctness: a store must implement conditional create,
conditional overwrite, and read-after-write consistency, or two nodes can both own a cell (`docs/guarantees.md:16-58`).

## Cell ownership and fencing

Each cell is a SQLite database with one writer, and an ownership epoch fences
each cell; a node that loses its lease cannot modify the current cell state. This
fencing protects storage consistency, but it does not isolate hostile
applications (`docs/security.md:147-155`).

## Uncertainty note

celld does not terminate TLS on either listener and provides no built-in
content encryption for tunneled calls; the exact wire protections and the
assurance one can place on the HMAC are exactly as documented on this page and
in `docs/security.md`. Where an operator chooses a network that itself provides
confidentiality, celld makes no additional claim about that transport.
