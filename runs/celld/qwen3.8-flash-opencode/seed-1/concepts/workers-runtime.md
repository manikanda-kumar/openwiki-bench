---
type: "Reference"
title: "Workers and V8 Runtime"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-1c500760315c5c5d7423c257
    resource: repo://crates/celld/js/bootstrap.rs
  - id: openwiki-source-523ed570426ab2f0808c1530
    resource: repo://crates/celld/js/crypto.rs
  - id: openwiki-source-2ea4abd833d1e17f4ec74f58
    resource: repo://crates/celld/js/harness.js
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-f9c6a0351651688a4250c0d4
    resource: repo://crates/celld/js/websocket.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-e65834f5c83ba76e348f4b8a
    resource: repo://crates/logic/schedule.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-988163704c46e5140d5f9050
    resource: repo://docs/wasm.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Workers and V8 Runtime

Every node embeds V8 and executes Wrangler bundles (README.md#L15-L17). The execution engine is `crates/celld/js.rs` plus its `js/` children: "The JS engine: rusty_v8 directly. One isolate per cell" in its original form — the modern shape generalizes to pooled isolates with cells placed on them (crates/celld/js.rs#L8-L14). Policy about *which* isolate and *when* lives in `celld_logic::isolate`; `pool.rs` is "the shell around" it and "owns the isolates and the counters" (crates/celld/pool.rs#L6-L16).

## Two execution scopes

There are two JS surfaces per deployment, and conflating them breaks scheduling:

- **Stateless Worker scope** — the default-export `fetch` (and `queued`, `scheduled`, workflow callbacks) run on the stateless Worker pool; a top-level Worker fetch takes a resident cell isolate only when that isolate is idle, otherwise the request "must reschedule to the stateless Worker pool — never run nested" (crates/logic/schedule.rs#L3-L9).
- **Cell (Durable Object) scope** — `env.NS.get(id)` instantiates the exported class once per id with `state.storage` backed by the cell's SQLite (crates/celld/js.rs#L10-L14, crates/celld/storage.rs); `ctx.storage` ops are the synchronous Rust conversions in `js/storage_ops.rs`, and one isolate may host several cells' storage under the isolate-owned `Cells` map (crates/celld/storage.rs#L19-L29).

## Bootstrap, harness, and modules

A fresh isolate runs a fixed bootstrap: the Web-API prelude (the `.js` files under `crates/celld/js/` — streams, headers, URL, text-encoding, compression, node:buffer/events/stream/util/timers/assert/path/test, WebSockets) plus `harness.js`, which carries "the DO object model and the Cloudflare-compatible runtime surface," and both "compile once per process and are cached" as bytecode because they are ~23k lines and re-parsing them is "the single largest slice of cold-wake latency" (crates/celld/js/bootstrap.rs#L3-L17, crates/celld/js/harness.js#L1-L4). Per-worker bindings (`env`, the routing table, compatibility flags) are built every time on top (crates/celld/js/bootstrap.rs#L5-L7).

Module resolution treats a specifier as either a builtin (whose source `modules.rs` holds) or a worker import resolved through the loader; most builtins compile lazily on first global access, "so a worker that never touches `node:zlib` never compiles it" (crates/celld/js/modules.rs#L3-L8). WebAssembly imports follow the Wrangler rule that the import gives the compiled module, not the bytes, and celld compiles each wasm module once per process with every later isolate reusing it (docs/wasm.md#L3-L22).

## The isolate pool and heap limits

Isolates "belong to no thread — `v8::Locker` installs the entering thread's per-isolate state, so any worker can take an isolate and run a turn in it"; one multi-threaded Tokio runtime owns every socket and timer (crates/celld/pool.rs#L8-L12). Safety rests on an admission discipline: "`SharedIsolate::lock()` blocks until its holder releases. Every path here takes the slot's async permit first, so that blocking lock is uncontended by construction. A `lock()` reached without the permit would park a tokio worker on V8, which is the one thing this runtime refuses to do" (crates/celld/pool.rs#L14-L19).

The pure scheduler in `celld-logic::isolate` tracks two quantities per isolate — **turns** in flight (CPU demand) and memory held — and decides `admit`, placement (balanced on fewest turns), growth (`grow_at`), shedding retirement, and draining retirement when "the rest of the pool can absorb the current turns" (crates/logic/isolate.rs#L11-L20, #L164-L320). Each isolate carries a V8 heap limit (default 128 MB, `CELLD_V8_HEAP_LIMIT_MB`) matching a Cloudflare DO (README.md#L297-L303). Hysteresis is explicit: `HEAP_ADMISSION_SHARE = 0.9` — above 90% a new hibernatable WebSocket is refused — and `HEAP_RECOVERY_SHARE = 0.75`, with a forced garbage collection because "an idle isolate holds a dead heap until something allocates" (js.rs constants around crates/celld/js.rs#L2111-L2123, README.md#L304-L311). A near-heap-limit callback is removed and re-added so the guard cannot read stale garbage (crates/celld/js.rs#L2031-L2064). The same 90% ceiling makes `acceptWebSocket()` throw and stops SQL result-set materialization (docs/cloudflare-compat.md#L244-L245, README.md#L304-L307).

## WebSockets inside the isolate

A hibernatable socket outlives the event that created it, so `js/websocket.rs` is the registry connecting JS-held ids to host-held sockets: "the host holds the socket in a task decoupled from the isolate (so the cell can hibernate while the socket lives)" (crates/celld/js/websocket.rs#L3-L16). Frames produced inside an output-gate region are captured and held until the gate opens — "emitting is not simply a send" — and a handler that wrote reports the commit position its frames must wait behind (crates/celld/js/websocket.rs#L8-L23). This is the cell-side of [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md).

## Crypto

`js/crypto.rs` is "the key formats and the primitives," with argument validation already done by the JS layer (`crypto.js`, `node_crypto.js`): it holds SPKI, PKCS#8, JWK, and raw encodings and touches V8 only in its ops (crates/celld/js/crypto.rs#L3-L9). The workspace supports the curve family the Workers key surface accepts — P-256 signing, P-384/P-521/X25519/Ed25519/RSA/DSA parse-or-agree only — with each narrowing documented at the dependency (Cargo.toml#L84-L100).

## Generations: adopting a deployment in place

A `Generation` is "everything a node derives from a deployment: the compiled Worker configurations, the isolate pools they run in, the Durable Object class registry, the service-binding graph, the asset resolvers, and the cron schedule"; a node serves exactly one current generation through a snapshot, so a request that started on one finishes on it even after adoption (crates/celld/generation.rs#L5-L12). Boot and reload build a generation through the same two functions (`DeploymentGraph::load`, `Generation::build`) so "a reload cannot miss what a boot did, because there is no second path for it to miss" (crates/celld/generation.rs#L13-L18). Resident cells move to the new generation through the core's `Event::GenerationChanged` pump: at a safe point per cell, or forced after `CELLD_DEPLOY_MAX_AGE_S` (default 60 s) by cancelling activity and closing regular WebSockets with code 1012, while reserved `eager_classes` cells are forced at once because they hold no application state worth waiting for (crates/logic/types.rs#L645-L655, docs/README.md#L245-L272). A drained generation reports `is_drained()` only when every service and cell isolate pool is empty (crates/celld/generation.rs#L397-L401).

Runtime materialization itself is gated by core effects: `RuntimeManager` owns handles and paths but never lifecycle policy — "StartRuntime, Publish, and StopRuntime decide when a cell handle moves from starting to externally dispatchable to closed" (crates/celld/runtime.rs#L8-L11).

Related: [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Cloudflare Compatibility Surface](/openwiki/concepts/cloudflare-compat.md), [Cells, Ownership, and Fencing](/openwiki/concepts/cells-ownership.md), [Deploy and Local Development](/openwiki/operations/deploy-develop.md).
