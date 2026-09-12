---
type: runtime
title: V8 Runtime, JS Embedding, and Application Execution
description: How celld embeds V8, runs Wrangler workers and Durable Objects, pools isolates, exposes the per-cell SQLite storage and Durable Object storage API, and runs WebSockets, cron, KV, Queues, D1, Workflows, R2, and Assets.
tags: [runtime, v8, isolates, durable-objects, sqlite, websockets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-7e633e94ecee571362a75191
    resource: repo://crates/celld/main/websocket.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-5c0cf604d5cf50b924c1c4d6
    resource: repo://crates/celld/ws_client.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# V8 Runtime, JS Embedding, and Application Execution

celld embeds V8 and executes Wrangler bundles with a Workers/Durable Objects
compatible surface. This page documents the runtime arm (`crates/celld`), which
owns "V8 runtime materialization behind core-authorized lifecycle effects"
(`crates/celld/runtime.rs`). It is deliberately the mechanical half: "The
manager owns handles and filesystem paths, never lifecycle policy. StartRuntime,
Publish, and StopRuntime decide when a cell handle moves from starting to
externally dispatchable to closed" (`crates/celld/runtime.rs` lines 7-12).

## The RuntimeManager lifecycle

A generation is "everything a node derives from a deployment: the compiled
Worker configurations, the isolate pools they run in, the Durable Object class
registry, the service-binding graph, the asset resolvers, and the cron
schedule" (`crates/celld/generation.rs` lines 1-8). A node serves exactly one
current generation and "reaches it through a snapshot, so a request that
started on one generation finishes on it even after the node adopts another".

Boot and reload construct a generation through the same two functions —
`DeploymentGraph::load` and `Generation::build` — so "a value a deployment
implies has one place it can be computed" and a reload cannot miss what a boot
did.

RuntimeManager drives the cell lifecycle that the actor core authorizes: a
runtime is started, published (made externally dispatchable), and stopped per
the actor's `Effect`s. This is the V8-side counterpart to the `Phase` state
machine described on the [architecture page](architecture.md).

## Isolate pooling

celld runs JS on "a set of isolates that grow and shrink with demand"
(`crates/logic/isolate.rs`). An isolate is deliberately **not bound to a
thread**: "`v8::Locker` installs the entering thread's per-isolate state, so any
worker can take an isolate and run a turn in it" (`crates/celld/pool.rs` lines
14-18). One multi-threaded tokio runtime owns every socket and timer.

Two quantities describe an isolate (`crates/logic/isolate.rs`): **turns** (CPU
demand, including the queue) and **requests** (affiliation/memory, which decides
admission and shedding). Isolates live in `crates/celld/pool.rs`, which owns the
isolates and the counters; "every choice about which isolate, when to grow,
what to shed and what to retire is made by `celld_logic::isolate` and merely
performed here" (lines 20-24).

Pooling disciplines matter for correctness:

- The shared Worker queue means a top-level Worker fetch takes "the
  resident-isolate fast path only when the isolate is idle"; if it is already
  pumping an actor event, the fetch "must reschedule to the stateless Worker
  pool — never run nested" (`crates/logic/schedule.rs` lines 3-16).
- `SharedIsolate::lock()` blocks until its holder releases, so "every path here
  takes the slot's async permit first, so that blocking lock is uncontended by
  construction" — a `lock()` reached without the permit "would park a tokio
  worker on V8, which is the one thing this runtime refuses to do"
  (`crates/celld/pool.rs` lines 26-31).

## Cell storage: per-cell SQLite

Each cell is backed by its own SQLite database. "DO's `ctx.storage` is async in
JS but synchronous underneath (local SQLite)... Each cell is its OWN db file
(its own replicated, epoch-fenced bucket prefix), so the JS thread holds a
`scope -> Connection` map: `open` on activate, `close` on evict"
(`crates/celld/storage.rs` lines 1-14).

The storage state belongs to the isolate, not the thread: "a turn holds the
isolate lock, so exactly one thread can reach these maps at a time. That is the
same guarantee the thread gave, obtained from the isolate instead"
(`crates/celld/storage.rs`). The Durable Object storage API exposes
synchronous Rust ops to V8 and wraps them in async in the JS harness — "same
contract, no thread-hopping" (line 10).

The Durable Object contract that celld preserves: a cell runs one event at a
time under an input gate, and storage operations are synchronous and never
interleave so "the data in a cell stays consistent" (`docs/README.md` lines
12-14). The gate semantics (what `blockConcurrencyWhile` needs) are reified in
`crates/logic/gate.rs`, including the rule that "**no incoming event of any kind
is delivered** to that cell except the event holding it".## The JS harness and Worker features

The Workers surface is implemented by a JavaScript harness installed once per
isolate. `crates/celld/js.rs` provides `install_harness`, `install_prelude`,
`populate_cf_exports`, `register_class`, and `register_entrypoints`
(`crates/celld/js.rs` lines 8824-8830). Compatibility switches feed the harness
through `worker_compat` (`crates/celld/lib.rs` lines 483-521).

The supported binding/service feature set (Durable Objects, services,
variables, assets, D1, KV, Queues, Workflows, R2) and their exact gaps are
recorded on the [compatibility page](compatibility.md).

## Reserved cells for one-writer services

D1, KV, Queues, Workflows, and cron are each implemented as a **reserved
Durable Object class** — a single writer with its own storage:

- `__D1Database` (`crates/celld/deploy.rs` line 64)
- `__Workflow` (`crates/celld/deploy.rs` line 68)
- `__KvNamespace` (`crates/logic/kv.rs` line 35)
- `__Queue` (`crates/logic/queue.rs` line 19)
- `.cron` (`crates/logic/cron.rs` line 33)

The generation registers these classes ("cron, queue, workflow, D1, KV",
`crates/celld/generation.rs` lines 350-369), and their cells hold no
application state worth waiting for, "so an adoption moves them at once — and
the cron cell must run the new schedule before the adoption arms it". The cron
cell is derived from the registered class "rather than plumbed separately, so
it cannot disagree with what `start_cell` will accept" (lines 336-344).

## WebSockets

WebSockets have three shapes on the ingress (`crates/celld/main/websocket.rs`):
a local socket to a cell on this node, a socket proxied to the owning peer, and
a socket the worker opened outbound. "A socket outlives the request that opened
it, so each becomes its own task."

- **Inbound websockets** are accepted, proxied to the owner, and pumped by
  dedicated tasks. There is an auto-response short-circuit: a matched text
  frame is answered in the shell and never becomes a `webSocketMessage`, so "a
  hibernated cell stays hibernated, which is the feature".
- **Outbound WebSockets** use `fastwebsockets` on both the connected and served
  sides, "so a frame relayed from a client to the cell's owner is framed,
  masked, and closed by one implementation on both sides rather than translated
  between two" (`crates/celld/ws_client.rs`). celld owns the TLS setup, the
  handshake headers, and the non-101 response handling so `new WebSocket()`
  returns the declined-upgrade detail.

An outbound Worker socket closes after the response and `waitUntil` work end
(`docs/cloudflare-compat.md` lines 238-239), and an outbound Durable Object
WebSocket keeps its cell resident (`docs/limitations.md` lines 42-44).

## Assets and static content

Static assets are fully supported. The asset resolver and asset functions (the
assets binding, HTML handling, not-found handling, worker-first routes,
`_headers`, `_redirects`) back both asset-with-worker and asset-only projects
(`docs/cloudflare-compat.md` lines 236-243). celld refuses a symlink or special
file in an asset directory, and `.assetsignore` requires Wrangler (lines
332-333).

## SQL integration (sqlite-vec)

celld bundles the SQLite extension `sqlite-vec` (pinned exactly to
`=0.1.9`, `Cargo.toml`), which provides the vector-search SQL functions the
Cloudflare Vectorize-compatible queries use. The `sqlite_vec` compatibility
flag controls whether it is loaded.

## The peer tunnel and remote dispatch

Cell fetch, RPC, and WebSocket calls to cells owned by a different node travel
over a peer tunnel: "an upgraded stream per peer, plain HTTP inside"
(`crates/celld/main/peer_tunnel.rs`). After the 101 the connection is an opaque
duplex stream and application requests cross as literal HTTP driven by hyper on
both ends, so "the hop never interprets the inner bytes". Per-call control
(scope, cell name, request id, capacity handoff) rides `x-cells-*` headers;
node A overwrites and node B strips them, so "the reserved names cannot be
smuggled by an application in either direction". Idle tunnels are pooled per
peer and reused for sequential calls with plain keep-alive.
