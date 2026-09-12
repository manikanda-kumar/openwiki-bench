---
type: concept
title: HTTP listeners and the peer network
description: celld exposes a public Worker ingress and an internal peer/operator listener; cell calls ride a pooled per-peer tunnel of plain HTTP established under an HMAC signature with replay and clock-window fences, and WebSocket ingress, proxying, and outbound connects share one framing implementation.
tags: [http, listeners, peer-tunnel, hmac, websockets, ingress]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-7e633e94ecee571362a75191
    resource: repo://crates/celld/main/websocket.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-5c0cf604d5cf50b924c1c4d6
    resource: repo://crates/celld/ws_client.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-5139cf45e1183dbe26084038
    resource: repo://crates/logic/http.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-d1f8171ced840731654fd4ea
    resource: repo://docs/limitations.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# HTTP listeners and the peer network

celld opens **two HTTP listeners and terminates no TLS on either**. The
public listener serves the deployed Worker plus only the reserved health path;
the internal listener carries the peer protocol and an operator API whose
default bind is `127.0.0.1:0`
([docs/security.md#L20-L45](repo://docs/security.md#L20-L45),
[crates/celld/startup.rs#L217-L255](repo://crates/celld/startup.rs#L217-L255)).
Both sockets are bound before storage or V8 work begins (see
[actor and execution boundary](../architecture/actor-execution.md)). The
internal listener does not pass unknown paths to the Worker: it 404s them, so
an operator probe cannot become application traffic
([docs/security.md#L44-L45](repo://docs/security.md#L44-L45)).

## Public ingress: identity, bodies, and drain

`handle_public` reserves exactly one path,
`/.well-known/celld/health` (200 `{"ok":true}` / 503 while draining), and
leaves every other path to the Worker
([docs/security.md#L40-L42](repo://docs/security.md#L40-L42),
[crates/celld/main.rs#L2572-L2597](repo://crates/celld/main.rs#L2572-L2597)).
Once draining begins, new public requests get 503 with `Retry-After: 1` and
`Connection: close`, while requests admitted before the drain finish and
versioned peer traffic keeps flowing to cells not yet handed off
([crates/celld/main.rs#L2576-L2597](repo://crates/celld/main.rs#L2576-L2597),
[docs/README.md#L429-L437](repo://docs/README.md#L429-L437)).

`request.url` construction is a security fence. Forwarded headers are
**ignored by default** (`--trust-forwarded-headers` /
`CELLD_TRUST_FORWARDED_HEADERS=1` opts in, and only the **last** value of a
multi-line or comma-joined header is taken, so a client value cannot sit after
the proxy's). The gate applies per source: a malformed `X-Forwarded-Host`
falls through to `Host` rather than discarding the chain, an invalid host
becomes `celld.local`, and the path/query always come from the request target
so an absolute-form request line cannot bypass the host policy
([crates/celld/main.rs#L1628-L1686](repo://crates/celld/main.rs#L1628-L1686),
[docs/security.md#L105-L124](repo://docs/security.md#L105-L124)). The shape
checks live in the core (`celld_logic::http`) because a broken authority
would otherwise make every Worker request throw inside `new URL(request.url)`
([crates/logic/http.rs#L3-L19](repo://crates/logic/http.rs#L3-L19)).

Bodies are capped at `CELLD_MAX_REQUEST_BODY_BYTES` (default 1 GiB;
`DEFAULT_MAX_REQUEST_BODY_BYTES = 1 << 30` — sized for large git-pack ingress)
([crates/celld/actor.rs#L1128-L1131](repo://crates/celld/actor.rs#L1128-L1131),
[docs/security.md#L126-L131](repo://docs/security.md#L126-L131)). Over
`/do/<ID>`, a non-GET/HEAD body of at least 1 MiB or of unknown length
**streams**; smaller bodies are collected before dispatch
([crates/celld/main.rs#L1353-L1355](repo://crates/celld/main.rs#L1353-L1355),
[docs/security.md#L133-L135](repo://docs/security.md#L133-L135)). Status 413
fires on a declared oversized body and when a Worker reads past the limit.

## The internal route table

`handle_internal` dispatches on exact paths and prefixes
([crates/celld/main.rs#L2624-L2692](repo://crates/celld/main.rs#L2624-L2692)):

- Peer protocol: `/peer/probe` (signed diagnostic
  ([crates/celld/peer_probe.rs#L3-L4](repo://crates/celld/peer_probe.rs#L3-L4))),
  `/peer/handoff` (signed successor adoption), `/peer/log/…` (node-log
  appends), `/peer/abort/…`, and `/peer/tunnel` (upgrade).
- Operator (unauthenticated, hence private-network-only): `GET /state`
  ([crates/celld/main.rs#L2635](repo://crates/celld/main.rs#L2635)),
  `POST /reload` (forced adoption,
  [crates/celld/main.rs#L2636-L2639](repo://crates/celld/main.rs#L2636-L2639)),
  `POST /shutdown[?handoff=preserve]`
  ([crates/celld/main.rs#L2642-L2654](repo://crates/celld/main.rs#L2642-L2654)),
  `/cell/<SCOPE>` (resolve/activate) and `/evict/<SCOPE>`
  ([crates/celld/main.rs#L2791-L2831](repo://crates/celld/main.rs#L2791-L2831)),
  and `/do/<ID>` for ordinary Durable Objects.
- `/runtime/<SCOPE>` is the **one** authenticated entrance for reserved
  runtime classes (D1, KV, Queues, Workflows). Its comment explains the
  single-route design: `/do/` refuses reserved classes and sends the caller
  here, `/runtime/` refuses everything that is *not* reserved, and one
  entrance plus one refusal means a class added to `RESERVED_CLASSES`
  inherits both — the pre-v5 `/__d1/` alias died with the v0.4.0 stop-the-world
  upgrade ([crates/celld/main.rs#L2658-L2712](repo://crates/celld/main.rs#L2658-L2712),
  [docs/security.md#L93-L99](repo://docs/security.md#L93-L99)).

Every scope entering these routes passes
`celld_logic::cell::valid_cell_scope` first, because the scope becomes a path
component and a bucket key ([crates/celld/main.rs#L2683-L2686](repo://crates/celld/main.rs#L2683-L2686),
[crates/logic/cell.rs#L3-L8](repo://crates/logic/cell.rs#L3-L8)).

## The peer tunnel: signed establishment, plain HTTP inside

Since v0.4.0 every proxied cell call — fetch, RPC, WebSocket — rides one
tunneled connection per peer. Establishment is an h1 `Upgrade` on
`/peer/tunnel` carrying the fleet HMAC ("CONNECT semantics with Upgrade
mechanics"); after the 101 the stream is an opaque duplex, and inner requests
are literal HTTP that the hop never interprets, so byte-faithful `Host`,
`Content-Length`, and `Upgrade` headers survive
([crates/celld/main/peer_tunnel.rs#L3-L14](repo://crates/celld/main/peer_tunnel.rs#L3-L14),
[docs/README.md#L537-L544](repo://docs/README.md#L537-L544)). Per-call control
(`x-cells-scope`, `x-cells-do-name`, `x-cells-request-id`,
`x-cells-capacity-handoff`) rides inner headers that the entry node
**overwrites** and the exit node **strips**, so reserved names cannot be
smuggled in either direction
([crates/celld/main/peer_tunnel.rs#L14-L18, L40-L52](repo://crates/celld/main/peer_tunnel.rs#L14-L18)).
Idle tunnels are pooled per peer with plain h1 keep-alive — no multiplexing —
because un-reused calls burned the ephemeral-port range into TIME_WAIT at
~1k calls/s ([crates/celld/main/peer_tunnel.rs#L19-L23](repo://crates/celld/main/peer_tunnel.rs#L19-L23)).

The security model is explicit about what the signature does and does not do:
establishment is HMAC'd, replay-protected, and clock-limited, but **inner
calls are not signed** — bodies stream, so per-call signing is impossible;
every path to a runtime class still demands the fleet secret
([docs/security.md#L60-L76](repo://docs/security.md#L60-L76)). Cell fetch and
RPC traffic itself carries a protocol version but no content signature: the
private network *is* the trust boundary
([README.md#L195-L199](repo://README.md#L195-L199),
[docs/README.md#L417-L424](repo://docs/README.md#L417-L424)).

### The HMAC itself

`PeerAuth` signs a canonical string —
`cells-peer-request-v1\n<version>\n<method>\n<path+query>\n<sha256(body)>\n<source>\n<target>\n<timestamp>\n<nonce>` —
with HMAC-SHA256 over the fleet key, and sends it as `x-cells-peer-*` headers
([crates/celld/peer_auth.rs#L136-L201](repo://crates/celld/peer_auth.rs#L136-L201),
[crates/celld/peer_auth.rs#L249-L270](repo://crates/celld/peer_auth.rs#L249-L270)).
Verification applies the pure fences from the core: a well-formed identity
charset (`/`-free, so `target` cannot smuggle a path), a **two-sided** 30 s
clock window, and a replay cache whose retention (60 s) is pinned at compile
time to be at least the clock window — "or the cache forgets a nonce while a
replay is still in-window"
([crates/logic/peer.rs#L3-L37](repo://crates/logic/peer.rs#L3-L37),
[crates/celld/peer_auth.rs#L21-L29](repo://crates/celld/peer_auth.rs#L21-L29)).
The 32-byte key lives at `fleet/peer-auth.json`; the first node creates it
with a conditional write and a lost race reads back the winner's
([crates/celld/peer_auth.rs#L272-L292](repo://crates/celld/peer_auth.rs#L272-L292)).
Protocol version 5 is exchanged on `x-cells-peer-version`, and the v0.4.0
tunnel "refuses a different version", which is why that upgrade is stop-all
([crates/celld/peer_auth.rs#L17-L19](repo://crates/celld/peer_auth.rs#L17-L19),
[docs/README.md#L537-L541](repo://docs/README.md#L537-L541)).

## Forwarding and retry

Routing to the owner is a core decision; retry after failure is *also* core
policy: `celld_logic::routing::Dispatcher` classifies the failed attempt
(`NotOwner` / `NeverConnected` / `Ambiguous`) via
`classify_remote_attempt` and permits a re-send only when the owner provably
never ran the request — one retry per failure class
([crates/logic/routing.rs#L20-L59](repo://crates/logic/routing.rs#L20-L59),
[crates/celld/main.rs#L315-L334](repo://crates/celld/main.rs#L315-L334)).
The overload contract lives here too: at `CELLD_MAX_CELL_REQUESTS` (64)
concurrent fetch events the target answers 503 with `Retry-After: 1` and
`X-Celld-Overload: cell` without starting the event
([docs/README.md#L638-L650](repo://docs/README.md#L638-L650)).

## WebSockets: accept, proxy, and dial

Ingress WebSockets become independent tasks in one of three shapes — local to
this node, proxied to the owner, or dialed outbound by the Worker — differing
only in what sits on the far end
([crates/celld/main/websocket.rs#L3-L9](repo://crates/celld/main/websocket.rs#L3-L9)).
A matched hibernation auto-response is answered in the shell and "never
becomes a `webSocketMessage`": no routing, no activity, no wake, so a
hibernated cell stays hibernated
([crates/celld/main/websocket.rs#L18-L27](repo://crates/celld/main/websocket.rs#L18-L27)).
Hibernatable writes that do run through a handler pass the per-cell output
gate, so a client never sees a frame trailing an unproven write (see
[durability and fencing](../concepts/durability-and-fencing.md)).

Outbound connects use `fastwebsockets` too — serving and dialing share one
framing implementation, so relayed frames are not translated between two
stacks — and celld hand-rolls the client handshake because the library's
discards the body of a non-101 response, which `new WebSocket()` must report
([crates/celld/ws_client.rs#L5-L15](repo://crates/celld/ws_client.rs#L5-L15)).
The workspace pins `fastwebsockets = "=0.8.1"` with the `unstable-split`
feature: a WebSocket read is not cancel-safe, so a live read future must
survive while the same socket is written, which requires separately owned
read/write halves; the exact pin makes the upgrade "a decision rather than a
surprise" ([Cargo.toml#L47-L59](repo://Cargo.toml#L47-L59)). An outbound DO
WebSocket pins its cell resident and dies if the cell moves — applications
must store the connection intent and reconnect ([docs/limitations.md#L38-L45](repo://docs/limitations.md#L38-L45)).

Related: [architecture hub](../architecture.md) ·
[cell lifecycle](../concepts/cell-lifecycle.md) ·
[durability and fencing](../concepts/durability-and-fencing.md) ·
[reserved classes](../platform/reserved-classes.md) ·
[node operations](../operations/node-operations.md)
