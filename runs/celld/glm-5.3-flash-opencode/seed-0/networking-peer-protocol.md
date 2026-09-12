---
type: protocol
title: "Networking and peer protocol"
description: "How requests reach the right node: the two listeners, cell forwarding rules, the HMAC-authenticated peer tunnel, diagnostics probing, and WebSocket proxying."
tags: [networking, peer, tunnel, websocket, routing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-7e633e94ecee571362a75191
    resource: repo://crates/celld/main/websocket.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Networking and peer protocol

## Two listeners, two contracts

celld opens two HTTP listeners ([docs/security.md](../docs/security.md), "Separate
the listeners"): the **public** listener serves the deployed Worker (min port
8080 by default, `AUTO_LISTEN_START/END` in `crates/celld/startup.rs:14-15`),
and the **internal** listener serves "the peer protocol and the operator API"
(`crates/celld/main/peer_tunnel.rs`). The public listener reserves only
`/.well-known/celld/health` ([docs/security.md](../docs/security.md)); the
internal listener "does not pass an unknown path to the Worker. It returns a
404, so an operator request cannot become an application request"
([docs/security.md](../docs/security.md)).

The operational boundary is trust: "A trusted private network protects the
internal listener" and "Object storage credentials control the fleet"
([docs/security.md](../docs/security.md)). celld terminates no TLS itself.

## Forwarding and at-most-once

A cell runs on exactly one node; every other node forwards to the owner.
`crates/logic/routing.rs` answers the hard question — may a failed dispatch
be re-sent? — purely from how far the attempt got
(`Attempt::NotOwner | NeverConnected | Ambiguous`,
`crates/logic/routing.rs:23-34`): "A connection that was never established
carried no request bytes, so … a fresh attempt cannot double-apply. Every
other failure … leaves the outcome ambiguous … Re-sending those would break
at-most-once execution" (`crates/logic/routing.rs:3-14`). The use case is a
cold-activation burst where TCP handshakes stall
(`crates/logic/routing.rs:15-17`).

## The peer tunnel

`crates/celld/main/peer_tunnel.rs` is "an upgraded stream per peer, plain
HTTP inside". Establishment "is an h1 upgrade on `/peer/tunnel` — CONNECT
semantics with Upgrade mechanics"; after the 101 the connection is an opaque
duplex stream, and "the headers the cell must receive byte-faithful … are
data here, not metadata". Per-call control rides `x-cells-*` headers on the
inner request, "node A overwrites and node B strips them, so the reserved
names cannot be smuggled by an application in either direction"
(`crates/celld/main/peer_tunnel.rs:3-13`). Idle tunnels are pooled per peer
and reused for sequential calls — "plain h1 keep-alive inside the tunnel,
never multiplexing" — because without reuse "a loopback-speed caller
saturates the whole ephemeral-port range into TIME_WAIT within seconds"
(`crates/celld/main/peer_tunnel.rs:14-17`).

Tunnel-transported calls (cell fetch, RPC, WebSocket) carry "the fleet HMAC,
a clock limit, and replay protection" on the **establishment** request only;
"these inner calls are not signed" — the private network carries the rest
([docs/security.md](../docs/security.md), /peer/tunnel paragraph).

## Fleet HMAC authentication

`crates/celld/peer_auth.rs` implements the fleet-secret request signing:
protocol version 5 (`PROTOCOL_VERSION`, `peer_auth.rs:16`), the signing
domain string includes the version, method, path, and body hash
(`peer_auth.rs:258-266`), and responses advertise
`x-cells-peer-version` (`peer_auth.rs:159-163`). The freshness window is
`CLOCK_WINDOW_MS = 30_000` with replay retention twice that; "A nonce must be
retained at least as long as its signature stays acceptable"
(`peer_auth.rs:25-30`). The secret object is `fleet/peer-auth.json` in the
bucket (`peer_auth.rs:20`) — hence "Treat access to the bucket… as fleet
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
administrator access" ([README](README.md)).

## Peer probing

`crates/celld/peer_probe.rs` is "Challenge-bound proof that a diagnostic
reached the node named by a lease": a 32-byte challenge, a signed response
bounded to 4096 bytes, Ed25519 signing via `ed25519-dalek`
(`peer_probe.rs:3-15`). The probe signer can be re-exec'd into a dedicated
process through `CELLD_REEXEC_PROBE_SIGNING_KEY` (`peer_probe.rs:15`).

## Internal operator routes

([docs/security.md](../docs/security.md), "Use the internal operator API")

- Unauthenticated: `/state`, `/cell/<SCOPE>`, `/evict/<SCOPE>`, `/do/<ID>`,
  `POST /shutdown` (with a `handoff=preserve` same-node reload mode).
- **`/do/<ID>` refuses every reserved runtime class** (D1, Workflows, KV,
  Queues); those protocols "can access application data or change runtime
  state", so they use the HMAC-authenticated `/runtime/<SCOPE>` route.
- `/peer/probe` and other reserved paths must not be called by operators.

## WebSockets

`crates/celld/main/websocket.rs` handles ingress: "A socket outlives the
request that opened it, so each becomes its own task. Three shapes exist — a
local socket to a cell on this node, a socket proxied to the owning peer,
and a socket the worker opened outbound" (`crate doc, websocket.rs:6-8`).
The transport dependency is pinned exactly (`fastwebsockets =0.8.1` with
`unstable-split`), because a "WebSocket read is not cancel-safe, so a live
read future must survive while the same socket is written, and that is only
possible when the halves are not one borrow; a 0.8.x release can rename or
drop [the feature] without upstream calling that a break"
(`Cargo.toml` fastwebsockets entry).

## Process context

`crates/celld/machine.rs` reads "what the process can learn about where it
is running… the environment the operator set, and the machine underneath —
memory, CPU ticks, page size — which is per-platform and therefore
duplicated behind `cfg`" (`machine.rs:3-6`); this includes the advertise
safety check. `crates/celld/pool.rs` is the isolate pool shell — "One
multi-threaded tokio runtime owns every socket and timer. Isolates belong to
no thread" (`pool.rs:8-10`) — which is why a proxied call can enter any
isolate running the script.

## What the repo does not establish

- Replicated-log transport over the tunnel is described at the README level;
  the frame/ack budget lives in the durability page.
- Load-balancer-facing TLS patterns are operator policy, documented in
  [docs/security.md](../docs/security.md) as proxy requirements, not code.
