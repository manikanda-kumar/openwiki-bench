---
type: architecture
title: Fleet model — nodes, listeners, and discovery
description: How celld organizes processes into a fleet, the two-listener topology, how nodes discover each other and claim cells through the bucket, and how peer traffic moves between nodes.
tags: [architecture, fleet, discovery, listeners, peering]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Fleet model — nodes, listeners, and discovery

## Node and fleet

A **node** is one `celld` process on one machine; the nodes that share one
bucket form a **fleet** and run one application. The README states this
directly: "A node is one `celld` process, and you run one on each machine.
Every node embeds V8 and executes Wrangler bundles. The nodes that share one
bucket are a fleet" [README.md](repo://README.md#L16-L19). Every node can serve
any cell, so capacity is added by starting another node against the same
bucket [docs/README.md](repo://docs/README.md#L17-L20). There is no join
command or fixed membership list: "a node finds the other nodes through the
bucket" [README.md](repo://README.md#L139-L141).

## Two listeners

A fleet node binds two TCP listeners, and they carry different traffic:

- The **public Worker listener** (`--listen`, default worker listener) serves
  ingress HTTP and Worker requests. It is bound by
  `celld::startup::bind_ingress_listener(&settings.listen)`
  [crates/celld/main.rs](repo://crates/celld/main.rs#L3095-L3097).
- The **internal peer/operator listener** (`--internal-listen`,
  `--advertise`) serves peer tunnels, peer probes, log transport, and the
  operator API. It is bound by
  `celld::startup::bind_internal_listener(&InternalListenerSettings { listen,
  advertise, unsafe_public_advertise, .. })`
  [crates/celld/main.rs](repo://crates/celld/main.rs#L3096-L3102).

The main dispatch distinguishes the two surfaces explicitly: requests on the
internal surface go to `handle_internal`, which routes `/peer/probe`,
`/peer/handoff`, `/peer/log/…`, `/peer/tunnel`-related peer traffic, and the
operator routes `/state`, `/reload`, `/shutdown`
[crates/celld/main.rs](repo://crates/celld/main.rs#L2624-L2657).

Routing rules at startup are strict, and `startup::bind_internal_listener`
enforces them:

- A literal public IP in `--advertise` is rejected unless
  `--unsafe-public-advertise` was supplied:
  `if advertise.is_public_ip() && !settings.unsafe_public_advertise { ... }`,
  producing an error that names `--unsafe-public-advertise` as the escape
  hatch [crates/celld/startup.rs](repo://crates/celld/startup.rs#L241-L246).
- The README adds the operator-side contract: an explicit advertised address
  requires an explicit internal-listener address, the advertised address must
  route to the internal listener (celld cannot verify a hostname or a
  translated port), and a non-loopback public listener without an explicit
  internal listener is rejected as an obsolete one-listener shape
  [README.md](repo://README.md#L189-L196)
  [docs/README.md](repo://docs/README.md#L399-L403).
- The listener share of a loopback address is described as "same host only",
  and an address that is neither loopback nor classified is not treated as
  public by default so a private overlay (e.g. WireGuard-style range) is not
  spuriously rejected
  [crates/celld/startup.rs](repo://crates/celld/startup.rs#L61-L91).

## Discovery from the bucket

The bucket is both the authority and the directory. Two kinds of JSON records
carry the fleet state:

- **Node leases** at `nodes/<node>.json`. The lease record carries the node
  id, `expires_ms`, the advertised address `addr`, a signed-probe public key,
  the peer protocol version, a `paced_handoff` capability flag, a process
  `generation`, a `load` sample (resident cells, host WebSockets, RSS,
  in-use bytes, pressure, memory headroom, restoring count), and the folded
  node-log state
  [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L442-L455).
- **Cell ownership records** at `cells/<cell>/own.json`, writing a node name
  and epoch. Reading them is `read_owner`, and claiming them is a
  conditional (CAS) write — `cas_owner` with a `CasGuard::Absent` (create) or
  `CasGuard::Match(etag)` (compare-and-swap) guard
  [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L288-L420).
  This is the mechanism by which "a conditional bucket write gives a node the
  ownership of a cell, so exactly one node owns a cell at a time — no
  membership protocol, no failure detector, no consensus service"
  [README.md](repo://README.md#L17-L22).

Placement reads the fleet through `OwnershipStore::read_capacity_peers()`,
which lists `nodes/`, skips records "rewritten in [no] lease lifetime" so
dead members do not keep costing listing reads on every unowned cell, and
then loads each live lease with bounded concurrency of 16
[crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L313-L377).

Lease traffic is isolated from bulk bucket traffic: the store holds a second
bucket client dedicated to leases, opened with the user agent
`celld-lease`, so lease renewals "must not queue behind ordinary ownership,
deployment, [and] replication" traffic
[crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L120-L130).

## Peer transport: the tunnel

All proxied cell calls (fetch, RPC, WebSocket) between nodes cross one
tunneled connection per peer. `crates/celld/main/peer_tunnel.rs` documents
its shape:

- Establishment is an `h1` upgrade on `/peer/tunnel` — CONNECT-style
  semantics with Upgrade mechanics. After the 101 the connection is an
  opaque duplex stream; inner requests are literal HTTP driven by hyper on
  both ends, so hop headers such as `Host`, `Content-Length`, `Upgrade` are
  preserved byte-faithfully
  [crates/celld/main/peer_tunnel.rs](repo://crates/celld/main/peer_tunnel.rs#L1-L15).
- Per-call control (cell scope, cell name, request id, capacity handoff)
  rides reserved `x-cells-*` headers on the inner request; node A overwrites
  them inbound and node B strips them outbound, so an application cannot
  smuggle commands in either direction
  [crates/celld/main/peer_tunnel.rs](repo://crates/celld/main/peer_tunnel.rs#L10-L27).
- Idle tunnels are pooled per peer and reused with plain h1 keep-alive —
  never multiplexing. The doc comments explain why: without reuse, a
  loopback-speed caller saturates the ephemeral-port range into `TIME_WAIT`
  within seconds (~1k calls/s is the OS ceiling)
  [crates/celld/main/peer_tunnel.rs](repo://crates/celld/main/peer_tunnel.rs#L16-L20).

## Peer protocol version and refusal

The tunnel carries a `TUNNEL_PROTOCOL = "celld-tunnel"` with
`TUNNEL_VERSION = "5"` in the `x-cells-tunnel-version` header
[crates/celld/main/peer_tunnel.rs](repo://crates/celld/main/peer_tunnel.rs#L34-L38).
`peer_auth.rs` declares `PROTOCOL_VERSION = 5` and answers with the
`x-cells-peer-version` response header
[crates/celld/peer_auth.rs](repo://crates/celld/peer_auth.rs#L16-L18). The
docs note that "the peer protocol refuses a different version, so the two
versions cannot proxy calls to each other" — historically the reason the
v0.3.0 → v0.4.0 upgrade could not roll — and that "the tunnel establishment
carries the version, so a later protocol change can negotiate instead of
refuse" [docs/README.md](repo://docs/README.md#L535-L544).

## Diagnose and fleet health

`celld diagnose` performs read-only fleet inspection: it enumerates every
node lease with `node_lease_ids(bucket)`, then probes each live peer
directly, skipping expired leases and reporting them distinctly
[crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L330-L384). `live_node_lease`
validates the advertised address and bails when a lease is expired or has no
address [crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L481-L501). The
command takes no lease and changes no ownership
[docs/README.md](repo://docs/README.md#L555-L556).

## What the fleet model is not

- There is **no membership protocol of celld's own** beyond conditional
  bucket writes and expiry: two nodes cannot both claim one cell because the
  bucket enforces the CAS guard
  [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L401-L420).
- celld **does not terminate TLS**; peers are reached on a trusted private
  network or an encrypted overlay, and peer-authenticated control traffic
  uses the fleet HMAC rather than TLS
  [README.md](repo://README.md#L189-L200)
  [docs/README.md](repo://docs/README.md#L417-L425). Details are covered in
  [Security boundary](/openwiki/architecture/security-boundary.md).
- The repository does not document TTL renewal mechanics in `fleet.rs`
  itself; the lease expiry semantics are enforced and documented via
  `ownership_store.rs` and the guarantees page (see
  [Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md)).
