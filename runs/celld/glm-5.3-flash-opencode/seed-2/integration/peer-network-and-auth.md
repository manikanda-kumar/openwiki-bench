---
type: integration
title: Peer network and fleet authentication
description: The internal listener's signed peer protocol — fleet HMAC with replay protection, tunnels, probes, node-log transport, and the authenticated operator routes.
tags: [peer-auth, hmac, tunnel, security, operator]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-6c4e31d2bf3e043b470c02ee
    resource: repo://crates/celld/operator_cell.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-d1f8171ced840731654fd4ea
    resource: repo://docs/limitations.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Peer network and fleet authentication

## Two transport groups on one listener

Peer HTTP and the operator API ride the internal listener (`--internal-
listen` / `CELLD_INTERNAL_ADDR`). The public ingress listener never speaks
the peer protocol. An explicit `--advertise` address must route to the
internal listener, and literal public IPs are refused without
`CELLD_UNSAFE_PUBLIC_ADVERTISE=1`; the recommended posture is a trusted
private network or an encrypted overlay such as WireGuard or Tailscale
(repo://README.md#L189-L200).

## The fleet HMAC

`PeerAuth` is the shared fleet signing/verifying scheme defined against a
fleet-wide secret stored at `fleet/peer-auth.json` (created by the first
current node; whatever it names is trusted by the whole fleet). The
protocol identification is:

- `x-cells-peer-version` — protocol version (`"5"` today,
  `PROTOCOL_VERSION = 5`, repo://crates/
  celld/peer_auth.rs#L18-L20).
- `x-cells-peer-source`, `x-cells-peer-target` — the signed identity pair
  (repo://crates/celld/peer_auth.rs#L33-L34).
- `x-cells-peer-timestamp` + `x-cells-peer-nonce` — replay protection
  parameters.
- `x-cells-peer-body-sha256`, `x-cells-peer-signature` — body binding and
  HMAC verification.

(repo://crates/celld/peer_auth.rs#L33-L41)

The canonical request binds method, path+query, body hash, source, target,
timestamp, and nonce; the verification path computes the same canonical
string with the shared secret and compares the HMAC (supplying
`x-cells-peer-signature`, repo://crates/celld/peer_auth.rs#L131-L171).

The replay window is explicit:

- `CLOCK_WINDOW_MS` — 30,000 ms (a signature timestamp must be within this
  window of the receiving node's wall clock).
- `REPLAY_RETENTION_MS` — exactly 2x the window, so a nonce is retained at
  least as long as it is acceptable; a compile-time `const _` assert
  guarantees the relationship so replay eviction can't lose an in-window
  entry (repo://crates/celld/peer_auth.rs#L24-L31).
- `MAX_REPLAY_ENTRIES` — 1,000,000 (an upper bound on memory consumed by
  the replay cache).

The replay cache is per-source key: a peer can hit the same node in
parallel with distinct entries per source+nonce pair; it must be retained
but is bounded.

## Peers and node records

Peer discovery is the bucket, not a join service: `nodes/<node>.json`
leases carry `addr` (where a peer POSTs) and `peer_public_key` (the signed
probe key). Discovery comes from these leases; `celld diagnose` and peer
routing use them (repo://crates/celld/ownership_store.rs#L27-L55). The
signed challenge loop `/peer/probe` is the liveness and identity handshake:
the node generates a random challenge, signs it with its private key
(installed via `install_signer` at boot), and a peer POST signs the
challenge alongside its fleet MAC, returning its advertise address
(repo://crates/celld/peer_probe.rs#L18-L60, L103-L135).

## Peer tunnels

Peer control and data travel as plain HTTP inside one upgraded stream per
peer:

> The peer tunnel: an upgraded stream per peer, plain HTTP inside.
> Establishment is an h1 upgrade on `/peer/tunnel` — CONNECT semantics with
> Upgrade mechanics... After the 101 the connection is an opaque duplex
> stream, and app requests cross as literal HTTP driven by hyper on both
> ends: the hop never interprets the inner bytes, so the headers the cell
> must receive byte-faithful (`Host`, `Content-Length`, `Upgrade`) are
> data here, not metadata. Per-call control (scope, cell name, request id,
> capacity handoff) rides `x-cells-*` headers on the inner request; node A
> overwrites and node B strips them, so the reserved names cannot be
> smuggled by an application in either direction.

(repo://crates/celld/main/peer_tunnel.rs#L3-L27)

Tunnels pool per peer and reuse sequential calls with h1 keep-alive inside
the tunnel — without which a loopback-speed caller saturates the ephemeral
port range within seconds at roughly 1000 calls/s
(repo://crates/celld/main/peer_tunnel.rs#L22-L33).

## Node-log transport

`/peer/log/` routes (`append`, `seal`, `tail`, `stream`) are the node
log tier's follower endpoints. Requests across them sign with the same
fleet HMAC and encode entries with the same base64-JSON codec used by the
in-tree simulator, so node_log routing can be exercised deterministically
(repo://crates/celld/node_log.rs#L52-L96). The route handling is uniform:
request comes signed with source/target nonce/timestamp, answer carries
the same response version header (repo://crates/celld/peer_auth.rs#L18-L22).

## Reserved-cell paths for operators

D1, KV, Queue, Workflow, and other reserved runtime classes are not
reachable on `/do/` (which refuses reserved scopes for safety: an
unauthenticated route must not drive a runtime class holding application
data). They ride the authenticated `/runtime/<scope>` route instead, in
two forms:

- **Peer-forwarded**: signed control and log-tier requests.
- **Operator CLIs** (celld d1/kv/queue): find an alive node from the
  bucket leases, sign with `PeerAuth`, and POST to
  `/runtime/<scope>` which the node forwards to the owner.

The reason a CLI cannot simply read the cell's SQLite from the bucket:

> The operator commands have to find a live node, sign a request with
> the fleet secret, and post it to `/runtime/<scope>`, which forwards to
> the cell's owner. Neither can open the object in the bucket instead:
> that writes behind the fence, and the owner's next flush overwrites it.
> Neither can name one node either, because an operator's internal
> listener has an ephemeral port by default.

(repo://crates/celld/operator_cell.rs#L5-L12)

## Security contract

The threat model in `docs/security.md` is concise: celld is an alpha not
safe for hostile multi-tenant use, a fleet trusts application code,
operators, and nodes; the *only* confidentiality boundary is the network
itself. Peer traffic is authenticated-hmac but plaintext; bucket
credentials control the fleet (repo://docs/security.md#L5-L11). Peer
requests also carry explicit limitation notes: no TLS termination at celld
(repo://docs/security.md#L14-L22). The replay/HMAC machinery upgrades are
tracked in `crates/celld/peer_auth.rs` comments, and mixing versions is
guarded because a node with an old protocol version is diagnosed rather
than trusted (peer_probe verifies `peer_protocol != 5` explicitly).
