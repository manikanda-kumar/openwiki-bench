---
type: runtime-flow
title: Cell runtime and isolates
description: How V8 executes a cell — one isolate per cell, the runtime manager and stateless worker pools, the JS API surface over SQLite storage, the ingress listener and WebSocket pump, and hibernation.
tags: [runtime, v8, isolate, websocket, hibernation, storage]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-55ec5a6f535496955b66f4ff
    resource: repo://crates/celld/host_services.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-f9c6a0351651688a4250c0d4
    resource: repo://crates/celld/js/websocket.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-7e633e94ecee571362a75191
    resource: repo://crates/celld/main/websocket.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-0cf02de4c4ddf27a70ec8634
    resource: repo://crates/logic/sqlite.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Cell runtime and isolates

## The JS engine

The JS engine binds rusty_v8 directly, and its shape is stated in the
module doc:

> The JS engine: rusty_v8 directly. One isolate per cell.
>
> This slice runs actual Durable Objects: the worker's default-export
> `fetch` receives an `env` whose bindings are DO namespaces;
> `env.NS.get(id).fetch()` instantiates the exported DO class (once per id)
> with a `state` whose `storage` is backed by the cell's SQLite. DO storage
> is async in JS, synchronous underneath — the ops are sync Rust, wrapped
> in `async` by the JS harness.

(repo://crates/celld/js.rs#L5-L14)

The adapter is intentionally *outside* the Actor execution domain: the raw
V8 adapter and all its child modules sit there, and Actor-reachable state
is injected through `HostServices` (repo://crates/celld/js.rs#L1-L3). This
keeps the decision core deterministic and the V8 adapter replaceable in
tests.

Child modules split the surface: ES module resolution and compilation
(`modules.rs`), WebSocket plumbing, `crypto`, `zlib`, `r2_ops`,
`storage_ops`, and `v8_strings`. Node builtins are lazy — a module compiles
the first time something reads its global, so a worker that never touches
`node:zlib` never compiles it (repo://crates/celld/js/modules.rs#L3-L8).

## Cell lifecycle

From the operator guide:

- A *resident* cell is in memory: *active* while working, *idle* when
  waiting.
- An idle resident is removed from memory. If it keeps its hibernatable
  WebSocket clients and stays on its node, it is *hibernated*; if no node
  holds it, it is *inactive* — which is how every cell starts.
- *No memory survives* these transitions: the constructor runs again on the
  next event. A hibernated cell wakes the same way a cold start does,
  except its WebSocket clients stay connected and it stays on its node
  (repo://docs/README.md#L20-L29).

`State::occupied` and the activation/eviction permit ceilings bound
residency; the actor's `Timer` machinery and the isolate pool's admission
enforce them (see [Configuration, limits, and memory
pressure](/operations/settings-and-pressure.md)).

## The runtime manager

`RuntimeManager` is the Actor's V8 arm of `CellHost` (a second Scripted arm
exists only under the internal-test cfg for the conformance simulator):
it owns a generation snapshot used to admit each incoming request, the
cell registry (isolate keyed by Durable Object id), the alarm observer and
reporter, wake flusher, replication, and remote-request cancellation state
for peer aborts (repo://crates/celld/runtime.rs#L469-L507). *(Note the*
`RemoteRequestRegistry` *serializes against a shared lock precisely so a*
peer abort cannot race an enqueue and lose cancellation.)*

## Stateless worker pool

Not everything is a Durable Object. `StatelessRuntime` handles stateless
Worker requests with a pool of isolates (`crates/celld/pool.rs`),
governed by `PoolLimits` from the decision core
(`celld_logic::isolate::{admit,place}`). Cell residency and worker-pool
admission share one pool so an isolate is an isolate, and placement is a
core decision, not shell policy (repo://crates/celld/runtime.rs#L323-L468).

## The ingress listener

Public requests enter the ingress path:

1. `/.well-known/celld/health` returns `ok:true` only when the node is not
   draining, fleet-ready, and healthy; otherwise `503` with `ok:false`
   (repo://crates/celld/main.rs#L2579-L2612).
2. Everything else is application ingress routed through
   `handle_ingress`, which resolves the route via the decision core: a
   stateless request lands on the pool, a cell request goes to the owning
   isolate, and a cell owned by another node forwards over the signed peer
   tunnel (repo://crates/celld/main.rs#L2613-L2618).
3. Reserved (runtime-internal) classes are *never* reachable on `/do/`;
   they are served on the internal-listener route `/runtime/` with the
   fleet HMAC attached. Its doc comment states why the mirror check exists
   *on both sides*: `/do/` refuses a reserved scope, and `/runtime/` must
   refuse a plain DO scope, so adding a reserved class automatically
   inherits both refusals with no separate widening needed
   (repo://crates/celld/main.rs#L2694-L2733).

## WebSockets and hibernation

Three socket shapes share the ingress plumbing — a local socket to a cell
on this node, a socket proxied to the owning peer, and an outbound socket
the Worker opened — differing only in what sits on the far end
(repo://crates/celld/main/websocket.rs#L1-L6). Two features make
hibernation real:

- **Auto-response short circuit.** A matched text frame is answered in the
  shell and *never* becomes a `webSocketMessage`: no routing, no activity,
  no wake — a hibernated cell stays hibernated, which is the feature.
  (repo://crates/celld/main/websocket.rs#L9-L22).
- **Socket tasks decoupled from the isolate.** A socket outlives the
  request that opened it, so each becomes its own task; a hibernated cell's
  clients stay connected while the isolate is evicted and wake it on the
  next unmatched message (repo://crates/celld/js/websocket.rs#L13-L34).

Each hibernatable client holds state in the V8 heap; the isolate-level heap
limit therefore decides how many clients a cell can carry — documented at
approximately 50,000 at the default 128 MB limit and ~512 MB for 100,000
(repo://README.md#L299-L303). An isolate above 90% of the limit refuses a
new hibernatable socket and resumes when under 90%; stopping SQL
materialization is the same threshold, and celld forces a collection when
the idle-heap measurement is above 75% (repo://README.md#L305-L312).

## Storage: SQLite per cell

The `storage.rs` module binds the per-cell SQLite, providing `open`/`open
with compat`, `sql_exec`/`sql_ingest`/cursor primitives, D1 request
handling, and write-position tracking:

- Each database is opened as one SQLite per cell, separately for
  `sqlite_vec` extension compat
  (repo://crates/celld/storage.rs#L642-L660, L610-L614).
- The D1 and DO-storage APIs sit on the same synchronous SQLite, so a
  Durable Object's async JS storage calls execute synchronously underneath
  (repo://crates/celld/js.rs#L5-L14).
- `write_position(scope)` reports the committed WAL position the
  durability layer then proofs and gates on
  (repo://crates/celld/storage.rs#L854-L854).

SQL behaviors `poisons_actor` (deterministic core decision: whether a
given SQLite failure poisons the cell, i.e. stops it) and a fault-injection
VFS (`open_with_fault_vfs_for_test`) exist to exercise the executor's
failure paths in the simulator (repo://crates/logic/sqlite.rs#L21-L21).

## Host services and JS-consumed resources

`HostServices` is the injection point between shell and isolate. It carries
scripted metrics for conformance tests and the real `LiveLoad` sample that
pressure decisions and `/state` expose, and it forwards node load data that
the core's shedding decisions consume
(repo://crates/celld/host_services.rs#L29-L96). JS-visible API surface
(needing exponential backoff or streaming behaviors) is gated through
helper traits (`QueueDispatchReq`, `AssetCallReq`, etc.) rather than
reaching into the actor mailbox directly
(repo://crates/celld/js.rs#L243-L315).
