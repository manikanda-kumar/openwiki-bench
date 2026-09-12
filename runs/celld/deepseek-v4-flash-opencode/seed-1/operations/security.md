---
type: operations
title: Security and networking boundaries
description: The public and internal listeners, the fleet HMAC peer authentication and replay protection, the peer tunnel, challenge-bound probing, advertised addresses, forwarded-header policy, the operator API, and the threat model.
tags: [security, networking, peer-auth, hmac, operator-api]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-5139cf45e1183dbe26084038
    resource: repo://crates/logic/http.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Security and networking boundaries

celld is an alpha and is not safe for hostile multi-tenant use: one fleet runs
one application, and celld trusts the application code, the fleet nodes, and
the operators (`docs/security.md:3-11`). It depends on two external security
boundaries: a trusted private network protecting the internal listener, and
object-storage credentials controlling the fleet.

## Two listeners

celld opens two HTTP listeners (`docs/security.md:20-35`):

- The **public listener** (`--listen`) serves the deployed Worker. Expose it
  through a load balancer, a reverse proxy, or a public firewall rule. It
  reserves only `/.well-known/celld/health`; the deployed Worker owns every
  other public path.
- The **internal listener** (`--internal-listen`) serves the peer protocol and
  the operator API. Its default address is `127.0.0.1:0`, so celld selects an
  available loopback port at each start, and `--advertise` gives peers an
  address that reaches it. It does not pass an unknown path to the Worker — it
  returns 404, so an operator request cannot become an application request.

An explicit advertised address requires an explicit internal-listener address,
and celld also rejects an explicit non-loopback public listener without an
explicit internal listener. celld cannot verify a hostname or a translated
port: you must route the advertised address to the internal listener and must
not route it to the public listener. `bind_internal_listener` rejects a literal
public IP unless `--unsafe-public-advertise` is set
(`crates/celld/startup.rs:221-255`).

celld does not terminate TLS on either listener. Put the advertised addresses
on a private network you trust, or use an encrypted overlay such as WireGuard
or Tailscale.

## The fleet HMAC

Peer-control and reserved-cell operator requests use the fleet HMAC. The
secret is stored at `fleet/peer-auth.json` in the bucket; the first current
node creates it with a conditional write (`load_or_create`,
`crates/celld/peer_auth.rs:272-292`), and it is versioned. A signed request
carries `x-cells-peer-source`, `x-cells-peer-target`, `x-cells-peer-timestamp`,
`x-cells-peer-nonce`, `x-cells-peer-body-sha256`, and `x-cells-peer-signature`
(`crates/celld/peer_auth.rs:31-36`). The signature is HMAC-SHA256 over a
canonical string of the method, path, body hash, source, target, timestamp,
and nonce (`crates/celld/peer_auth.rs:247-269`). Verification
(`crates/celld/peer_auth.rs:178-245`) enforces:

- a well-formed identity (the charset is a security fence: a widened charset
  lets a `target` smuggle a path segment — `crates/logic/peer.rs:1-13`);
- a timestamp within a 30-second clock window;
- a body hash that matches the actual body;
- the protocol version header;
- a per-nonce replay cache that retains entries at least as long as their
  signatures stay acceptable and is bounded at one million entries.

The clock limit and replay protection bind every body. The MAC never
authenticates the peer response body stream — the peer protocol depends on the
trusted private network, and the fleet HMAC does not replace that boundary.

## The peer tunnel

Since protocol version 5, every proxied cell call — the fetch, the RPC, and
the WebSocket — crosses inside one tunneled connection per peer that carries
plain HTTP (`crates/celld/main/peer_tunnel.rs:3-21`). Establishment is an h1
upgrade on `/peer/tunnel`; the establishment request carries the fleet HMAC, so
only a holder of the fleet secret can open a tunnel. After the 101 the
connection is an opaque duplex stream: the hop never interprets the inner
bytes, so headers the cell must receive byte-faithful (`Host`,
`Content-Length`, `Upgrade`) are data. Per-call control rides `x-cells-scope`,
`x-cells-do-name`, `x-cells-request-id`, and `x-cells-capacity-handoff` inner
headers; node A overwrites and node B strips them, so the reserved names cannot
be smuggled by an application in either direction
(`crates/celld/main/peer_tunnel.rs:40-70`). Idle tunnels are pooled per peer
and reused for sequential calls — plain h1 keep-alive, never multiplexing.

The inner calls are not signed, and the tunnel permits a request body to
stream to the owner, so the fleet HMAC cannot sign an individual call: the
establishment signature decides who can open a tunnel, and a tunneled call can
address an application class or a runtime class. Every path to a runtime class
demands the fleet secret (`docs/security.md:70-76`).

## Challenge-bound peer probes

`celld diagnose` sends a signed direct probe to each live peer. The probe is
challenge-bound: `celld diagnose` generates a 32-byte challenge, and the node
responds with an ed25519 signature over it (`crates/celld/peer_probe.rs:6-50`).
Each node advertises its probe public key in its lease record, so the
diagnostic proves it reached the exact node the lease names.

## The internal operator API

The internal operator API is available in the released binary but is an alpha
interface. Most operator routes inspect or control a node without request
authentication: `/state`, `/cell/<SCOPE>`, `/evict/<SCOPE>`, `/do/<ID>`, and
`POST /shutdown` (`docs/security.md:82-99`). The `/do/<ID>` route refuses
every reserved runtime class (D1, Workflows, KV, Queues) because their
operator protocols can access application data or change runtime state; they
use the HMAC-authenticated `/runtime/<SCOPE>` route instead. The route dispatch
is in `crates/celld/main.rs:2631-2831`: `/peer/probe`, `/peer/handoff`,
`/peer/log/*`, `/peer/abort/*`, `/peer/tunnel`, `/runtime/*`, `/do/*`,
`/cell/*`, and `/evict/*`.

Because the internal listener also serves an unauthenticated operator API, it
must not reach the public internet.

## Forwarded-header policy and request host

celld ignores `X-Forwarded-Host` and `X-Forwarded-Proto` by default; set
`--trust-forwarded-headers` (or `CELLD_TRUST_FORWARDED_HEADERS=1`) only when a
trusted proxy replaces both headers, and celld uses the last value in each
header (`docs/security.md:105-125`). celld always takes the path and query from
the request target and ignores the scheme and authority in an absolute-form
target. The `Host` header controls the hostname in `request.url`; celld accepts
a hostname, IPv4, or bracketed IPv6 with an optional port, rejects malformed
and noncanonical values, and uses `celld.local` when no source gives a valid
host. The pure predicate lives in `crates/logic/http.rs`. An application must
not use an unchecked hostname for an authorization decision.

## Request body limits

The public Worker listener and `/do/<ID>` have a 1 GiB request body limit by
default (`CELLD_MAX_REQUEST_BODY_BYTES`), returning 413 for a declared
oversized body and when a Worker reads past the limit. For a method other than
GET or HEAD, `/do/<ID>` streams a body when its declared length is at least
1 MiB or unknown; smaller bodies are collected before dispatch
(`docs/security.md:126-136`).

## Related pages

- [Operating a node and a fleet](fleet-operations.md) — the operational lifecycle behind the listeners.
- [The fleet bucket and object storage](fleet-bucket.md) — the credential boundary and reserved prefixes.
- [Durability, fencing, and the output gate](../architecture/durability-protocol.md) — the fencing that peer authority relies on.
