---
type: concept
title: Listeners and Peer Networking
description: The two HTTP listeners a celld node runs, the routes each serves, the pooled plain-HTTP peer tunnel, the fleet HMAC that signs control and operator requests, protocol versioning, and the three WebSocket transport shapes.
tags: [networking, http, peer-protocol, websockets, hmac, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-7e633e94ecee571362a75191
    resource: repo://crates/celld/main/websocket.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-5c0cf604d5cf50b924c1c4d6
    resource: repo://crates/celld/ws_client.rs
  - id: openwiki-source-5139cf45e1183dbe26084038
    resource: repo://crates/logic/http.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-d1f8171ced840731654fd4ea
    resource: repo://docs/limitations.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Listeners and Peer Networking

A node opens two HTTP listeners. The **public listener** (`--listen`, auto ports 8080–8099) serves the deployed Worker plus two direct-access paths; the **internal listener** (`--internal-listen`, default `127.0.0.1:0`) serves peer traffic and the operator API (crates/celld/startup.rs#L17-L29, docs/security.md#L18-L28). celld does not terminate TLS anywhere: peer traffic crosses the internal network as plaintext HTTP, and the network layer (private network, WireGuard/Tailscale) must provide confidentiality (docs/limitations.md#L19-L27).

## Public listener routes

`handle_ingress` (crates/celld/main.rs#L2090-L2115) processes:

- **Static assets** first for `GET`/`HEAD`: one generation snapshot feeds the asset resolver so "a deployment adopted mid-request cannot serve the new generation's index with the old generation's Worker"; `RunWorkerFirst` routes and asset-only handling decide between asset response and Worker.
- **`/do/<scope>`** — direct unauthenticated Durable Object fetches. It deliberately refuses every reserved class (`is_reserved_scope` → 403 with a per-class operator hint) because a reserved cell's fetch surface *is* an operator protocol and "its scope is an HMAC over names that sit in the project's config rather than a secret" (crates/celld/main.rs#L2750-L2780).
- **`/cell/<scope>`** — the inter-node cell fetch/RPC path, gated by `valid_cell_scope` before the scope is used (crates/celld/main.rs#L2791-L2794).
- **`/.well-known/celld/health`** — the only reserved public path; it reports 503 while the node drains so a load balancer stops routing (docs/security.md#L35-L40, docs/README.md#L429-L435).
- Everything else runs the Worker with `request.url` rebuilt from the Host header, which is client-controlled unless `CELLD_TRUST_FORWARDED_HEADERS` is set, hence the authority shape gate in `logic/http` (crates/logic/http.rs#L3-L11, crates/celld/env_vars.rs#L16-L26).

## Internal listener routes

`handle_internal` serves (crates/celld/main.rs#L2624-L2660):

| Route | Purpose | Signed? |
| --- | --- | --- |
| `/peer/probe` | signed diagnose probe returning node stats | yes |
| `/peer/handoff` | capacity/handoff acquisition request | yes |
| `/peer/tunnel` | the cell-call tunnel (h1 upgrade) | establishment |
| `/peer/abort/<scope>` | cancel work on a cell this node routed elsewhere | yes |
| `/peer/log/*` | node-log append/stream/tail/seal RPC | yes |
| `/runtime/<scope>` | reserved-cell operator access (d1/kv/queue CLIs) | yes |
| `/state` | node snapshot (drain continues to serve it) | no |
| `POST /reload` | adopt the deployment pointer now | no |
| `POST /shutdown[?handoff=preserve]` | begin graceful handoff or same-node preserve | no |

Cell fetch and RPC traffic carries a protocol version but **no content signature** — the trusted private network and its code are the security boundary — while peer-control and reserved-cell operator requests use the fleet HMAC (README.md#L189-L200). The internal listener also carries an unauthenticated operator API, so it "must not reach the public internet" (docs/README.md#L417-L425).

## The peer tunnel

Since v0.4.0, every proxied cell call — fetch, RPC, and WebSocket — rides one tunneled connection per peer carrying plain HTTP. Establishment is an h1 `Upgrade` on `/peer/tunnel` ("CONNECT semantics with Upgrade mechanics, because CONNECT's authority-form target fits this use badly"); after the 101 the connection is an opaque duplex stream driven by hyper on both ends, so byte-faithful headers (`Host`, `Content-Length`, `Upgrade`) cross as data, not metadata. Per-call control (`x-cells-scope`, cell name, request id, `x-cells-capacity-handoff`) rides reserved `x-cells-*` headers that node A overwrites and node B strips, "so the reserved names cannot be smuggled by an application in either direction"; idle tunnels are pooled per peer and reused for sequential calls (crates/celld/main/peer_tunnel.rs#L3-L16, #L44-L50). The peer protocol refuses a different version outright, which is why a v0.3.0→v0.4.0 upgrade cannot be rolling — but establishment carries the version so a later change can negotiate instead of refuse (docs/README.md#L535-L544).

## Fleet HMAC and versioning

The shared secret lives in `fleet/peer-auth.json`; "the first current node creates" it, and reading it requires bucket credentials — "Treat access to the bucket and its credentials as fleet administrator access" (README.md#L196-L200). Signing is HMAC-SHA256 with domain separation (`cells-peer-request-v1`), binding method, path, body SHA-256, source/target identities, a timestamp, and a nonce in `x-cells-peer-*` headers; verification enforces a 30-second clock window and retains nonces for 60 seconds (twice the window, so a signature cannot outlive its replay cache entry), and the response echoes `x-cells-peer-version` with the process's `PROTOCOL_VERSION = 5` (crates/celld/peer_auth.rs#L17-L26, #L31-L36, #L115-L190). The pure predicates — identity well-formedness (≤128 chars), a *two-sided* clock window, and retention ≥ window — are security fences in `celld-logic::peer`, deliberately separated so the signing stays in production but the gates can be tested as data (crates/logic/peer.rs#L3-L12).

## WebSockets

WebSockets arrive as their own tasks because a socket outlives the request that opened it, in three shapes — local to a cell on this node, proxied to the owning peer, and worker-opened outbound — differing only in what sits on the far end (crates/celld/main/websocket.rs#L3-L9). celld uses `fastwebsockets` for both serving and connecting so a relayed frame is "framed, masked, and closed by one implementation on both sides," and it pins the crate exactly with its `unstable-split` feature because a WebSocket read is not cancel-safe: a live read future must survive while the same socket is written, which requires the split read/write halves (Cargo.toml#L50-L59). The outbound client owns its TLS setup, handshake headers, and the non-101 response — `fastwebsockets::handshake::client` is avoided because it discards the declined-upgrade body the `new WebSocket()` error must report (crates/celld/ws_client.rs#L5-L14). Hibernatable inbound sockets hold state in the isolate heap and survive cell eviction with the runtime (see [Cells, Ownership, and Fencing](/openwiki/concepts/cells-ownership.md)); an outbound cell WebSocket pins its cell and is budgeted per cell by `max_outbound_websockets` (crates/logic/types.rs#L88-L94, #L389-L399, docs/limitations.md#L33-L35).

Related: [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Cells, Ownership, and Fencing](/openwiki/concepts/cells-ownership.md), [Fleet Operations](/openwiki/operations/fleet-operations.md), [Observability and Control Plane](/openwiki/operations/observability.md).
