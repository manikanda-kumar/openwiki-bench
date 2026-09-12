---
type: security
title: Security Boundary
description: celld's security model — the trust boundary, the public and internal listeners, the fleet HMAC peer authentication with clock limit and replay protection, operator API authentication, request-body limits, and bucket credential handling.
tags: [security, trust-boundary, hmac, peer-auth, operator-api]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Security Boundary

celld's security posture is that of an alpha: it "is not safe for hostile
multi-tenant use. Security fixes apply to the latest release only"
(`docs/security.md` lines 3-4). This page documents the model so operators
deploy inside it knowingly.

## Trust model

One fleet runs one application, and celld "trusts the application code, the
fleet nodes, and the operators" (`docs/security.md` lines 7-8). Application
code may use its configured bindings and consume shared node resources; do not
run mutually distrusting tenants in one fleet.

celld depends on two **external** security boundaries (`docs/security.md` lines
13-18):

1. **A trusted private network** protects the internal listener; use an
   encrypted overlay when the private network does not provide confidentiality.
2. **Object storage credentials** control the fleet; give each credential
   access to one fleet bucket only.

celld does not terminate TLS on either listener (lines 82-85).

## Two separate listeners

The public Worker listener and the internal peer/operator listener are distinct
(`docs/security.md` lines 21-45):

- **`--listen`** — public listener serving the deployed Worker. Expose it
  through a load balancer, reverse proxy, or a public firewall rule.
- **`--internal-listen`** — peer protocol and operator API. Its default is
  `127.0.0.1:0`, so celld selects an available loopback port at each start.
  `--advertise` gives peers an address reaching it.

An explicit advertised address requires an explicit internal-listener address,
and celld rejects an explicit non-loopback public listener without an explicit
internal listener "to prevent an obsolete one-listener configuration" (lines
32-35). celld cannot verify a hostname or translated port: "you must route the
advertised address to the internal listener, and you must not route it to the
public listener" (lines 36-38).

The public listener reserves only `/.well-known/celld/health`. A healthy node
returns 200 `{"ok":true}`; unhealthy returns 503. "The deployed Worker owns
`/health` and every other public path" (lines 40-43). The internal listener
does not pass an unknown path to the Worker — it returns 404, so "an operator
request cannot become an application request" (lines 44-45).

## The fleet HMAC and replay protection

The peer protocol authenticates control and tunnel-establishment requests with
a shared fleet HMAC. The implementation in `crates/celld/peer_auth.rs`:

- The secret is stored at the well-known bucket key `fleet/peer-auth.json`
  (`SECRET_KEY`, line 22), created by the first current node.
- A signed request carries version, source, target, timestamp, nonce,
  body-sha256, and signature headers (lines 155-174).
- Verification returns fine-grained `VerifyError` variants (`Unauthorized`,
  `WrongTarget`, `IncompatibleVersion`, `Replay`, `ReplayCapacity`) with
  matching HTTP statuses (lines 66-95).
- The HMAC binds each body; a clock limit and replay protection bound
  staleness.

The **clock limit and replay retention** are reified as pure predicates in the
decision core, `crates/logic/peer.rs`, because each is a security fence:

- `valid_identity` — non-empty, ≤128 bytes, ASCII alphanumerics plus `_ - .`.
  "Admit `/` and a `target` could carry a path segment" (lines 30-34).
- `within_clock_window` — a TWO-sided window; "a check that accepted
  arbitrarily old timestamps would let a captured signature replay forever"
  (lines 37-41).
- `replay_entry_expired` — retention must be at least the clock window, or a
  nonce is forgotten while a signature bearing it is still acceptable,
  reopening the replay hole (lines 44-48).

`CLOCK_WINDOW_MS` is 30,000 and replay retention is twice that;
`MAX_REPLAY_ENTRIES` caps the cache (`crates/celld/peer_auth.rs` lines 25-30).

## The peer tunnel

`/peer/tunnel` establishes a tunnel for cell fetch, RPC, and WebSocket calls
(`docs/security.md` lines 59-77). "The establishment request carries the fleet
HMAC, a clock limit, and replay protection, so only a holder of the fleet
secret can open a tunnel." Each call then crosses inside the tunnel as plain
HTTP with the cell scope in a reserved header, "and these inner calls are not
signed." The signature "does not authenticate the bytes after the
establishment, and it does not encrypt any traffic", so the private network
must stay trusted. Inner calls can address an application class or a runtime
class, and "every path to a runtime class demands the fleet secret"
(`docs/security.md` lines 70-76).

## Operator API routes and their authentication

The internal listener has three request groups (`docs/security.md` lines
55-68):

1. **Unauthenticated operator routes** — inspect/control a node without
   request authentication:
   - `GET /state`
   - `/cell/<SCOPE>` — resolve or activate a cell
   - `/evict/<SCOPE>` — evict a resident cell
   - `/do/<ID>` — direct request to an ordinary Durable Object
   - `POST /shutdown` — graceful handoff; `?handoff=preserve` prepares a
     same-node reload.
   The `/do/` route refuses every reserved runtime class ("D1, Workflows, KV,
   and Queues"), because their protocols can access application data or change
   runtime state; those go through the HMAC-authenticated `/runtime/<SCOPE>`
   route (lines 88-99).
2. **HMAC-authenticated peer and reserved-cell routes** — peer-control routes
   and the `/runtime/<SCOPE>` reserved-cell operator route use the fleet HMAC
   with a clock limit and replay protection (lines 62-66).
3. **Signed peer probe** — `/peer/probe` returns a signed diagnostic response
   (peer_probe.rs).

All three groups require the trusted private network (line 68). The operator
API is alpha: "a release can change its paths or response formats"
(`docs/README.md` line 551).

## Forwarded-header policy

celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` by default; set
`--trust-forwarded-headers` / `CELLD_TRUST_FORWARDED_HEADERS=1` only when a
trusted proxy replaces both headers. "celld uses the last value in each header,
so an earlier client value does not override the proxy value" (`docs/security.md`
lines 107-114).

The hostname used to build `request.url` comes from the `Host` header without a
trusted proxy. celld accepts a hostname, an IPv4 address, or a bracketed IPv6
address with an optional port, and rejects malformed and noncanonical values,
falling back to `celld.local` (lines 116-120). These checks "do not make the
hostname trustworthy"; an application "must not use an unchecked hostname for
an authorization decision" (lines 121-124).

## Request-body limits

The public Worker listener and `/do/<ID>` have a 1 GiB default body limit,
changed by `CELLD_MAX_REQUEST_BODY_BYTES`. celld returns 413 for a declared
oversized body and when a Worker reads past the limit (`docs/security.md` lines
133-135). For a method other than GET/HEAD, `/do/<ID>` streams a body when its
declared length is at least 1 MiB. One GiB is the bound the runtime adopts for
routing a proxied call inside the tunnel. (For the peer tunnel the larger
allowance is bounded by the runtime's request-body budget.)

## Bucket credentials and the root of authority

"The fleet bucket is the root of authority for the fleet. It stores the
deployments, the cell state, the ownership leases, the node leases, and the
shared peer-authentication secret" (`docs/security.md` lines 139-145). A person
who holds the bucket credentials controls the fleet. Treat access to the bucket
and its credentials as fleet administrator access (`README.md` lines 199-200).

## Validator inputs as security fences

Beyond transport and protocol, the decision core treats input shape as a
security fence because these values become path components, object keys, and
URLs:

- **Cell scope** (`crates/logic/cell.rs`) — `valid_cell_scope` restricts the
  charset to ASCII alphanumerics plus `_ - . : $`, rejects `.` / `..`, and
  bounds at 255 bytes. "Admit `/` and a scope carries its own path segments: it
  escapes the data directory through `..` and escapes the bucket prefix the
  same way." The bound is also "the minimum `NAME_MAX` that celld accepts for a
  data filesystem, so a scope that passes this gate fits every node in the
  fleet."
- **Peer identity** (`crates/logic/peer.rs`) — as above.

These gates "live here, and the callers that accept a scope from the network
apply it before the scope reaches storage" (`crates/logic/cell.rs`).
