---
type: concept
title: Security and trust model
description: The security boundary — trusted application, private network, bucket credentials, listeners split, peer HMAC, cell scope and authority fences, and forwarded headers.
tags: [security, trust-model, hmac, fences, credentials]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-5139cf45e1183dbe26084038
    resource: repo://crates/logic/http.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---

# Security and trust model

celld is an alpha. It is not safe for hostile multi-tenant use, and security
fixes apply to the latest release only (`docs/security.md:3-4`). This page
grounds the trust boundary and each protection in source.

## The trust boundary

One fleet runs one application, and celld trusts the application code, the
fleet nodes, and the operators. Application code can use its configured
bindings and consume shared node resources; do not run code from mutually
distrusting tenants in one fleet (`docs/security.md:6-11`).

celld depends on two external security boundaries:

- A trusted private network protects the internal listener.
- Object storage credentials control the fleet.

Give each credential access to one fleet bucket only (`docs/security.md:13-18`).

## The two listeners

celld opens a public Worker listener (`--listen`) and an internal peer/operator
listener (`--internal-listen`, default `127.0.0.1:0`). The advertised address
must reach the internal listener and be routed there, never to the public one
(`docs/security.md:22-38`). Protect each surface differently
(`docs/security.md:47-53`):

- Public listener — terminate TLS and authenticate users in a proxy or the
  application.
- Internal listener — restrict to trusted operators and fleet nodes; use an
  encrypted overlay when the private network provides no confidentiality.
- Fleet bucket — restrict credentials to one fleet bucket.

## Peer authentication (the fleet HMAC)

The peer protocol shares one secret stored at `fleet/peer-auth.json`
(`crates/celld/peer_auth.rs:20`). Requests are signed with headers: source,
target, timestamp, nonce, body SHA-256, and signature
(`crates/celld/peer_auth.rs:31-36`). The HMAC binds each body and supplies a
clock limit (`CLOCK_WINDOW_MS` = 30 s) and replay protection via a nonce cache
(`crates/celld/peer_auth.rs:22-29`). `VerifyError` classifies unauthorized,
wrong-target, incompatible-version, replay, and capacity failures
(`crates/celld/peer_auth.rs:66-73`).

Cell fetch and RPC traffic has a protocol version but no content signature; the
private network and its code are the security boundary. Peer-control and
reserved-cell operator requests use the fleet HMAC
(`docs/README.md:419-421`). celld does not terminate TLS on either listener
(`docs/security.md:78-81`).

## The cell scope charset fence

A cell scope is used as a path component and an object-store key, so its
charset is a security fence. `valid_cell_scope` admits a non-empty value of at
most 255 bytes that is not `.` or `..`, with only ASCII alphanumerics plus
`_ - . : $` going into storage (`crates/logic/cell.rs:18`, `crates/logic/cell.rs:43-51`).
`/` and `\` are excluded so the scope can never be more than one path
component, which makes an embedded `..` inert; a bare `..` still clears the
charset because it is a single path component the filesystem resolves
(`crates/logic/cell.rs:20-34`).

## The authority / URL parsing fence

A Worker reads `request.url`, and celld builds it from a request header. The
shape of the authority is a security fence; the gate checks structure as well
as charset, because celld carries the URL to the Worker as a string and never
parses it, so a malformed authority would otherwise turn every request into an
application `TypeError` inside the isolate (`crates/logic/http.rs:3-25`).
`authority_decision` returns Reject / Use / NeedsUrlParser, so a caller cannot
use a partial syntax result as a validated value (`crates/logic/http.rs:43-50`).
celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` unless
`--trust-forwarded-headers` is set with a trusted proxy
(`docs/security.md:107-110`).

## Conditional-write and bucket trust

The bucket is the root of authority: it stores the deployments, cell state,
ownership records, node leases, and the shared peer secret
(`docs/security.md:139-145`). The conditional-write dialect (etag vs
generation) and the strict error contract that separates a clean rejection from
an ambiguity are described on the durability page; the CAS ambiguity must
surface as `Err` so the caller reconciles (`crates/celld/bucket.rs:20-24`).

## Body limits

The public Worker listener and `/do/<ID>` have a 1 GiB request body limit by
default, set by `CELLD_MAX_REQUEST_BODY_BYTES`; celld returns 413 for a
declared oversized body and when a Worker reads past the limit
(`docs/security.md:128-130`).

## Fleet ownership fencing

Each cell is a SQLite database with one writer; one node owns a cell at a time
and an ownership epoch fences each cell. A node that loses its lease cannot
modify the current cell state. This fencing protects storage consistency but
does not isolate hostile applications (`docs/security.md:147-155`). The full
fencing argument is on the durability page.

---

## Related pages

- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
- [The internal operator API and /state surface](/openwiki/operations/operator-api.md)
