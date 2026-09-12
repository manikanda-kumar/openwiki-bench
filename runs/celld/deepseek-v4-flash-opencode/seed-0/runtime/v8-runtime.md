---
type: runtime
title: V8 Runtime and Worker Execution
description: How celld executes Workers and Durable Objects in V8 — the isolate pool and turn scheduling, isolate bootstrap and module loading, worker/DO/RPC invocation, the async runtime facade, WebAssembly, and the Worker Loader.
tags: [v8, runtime, isolates, javascript, wasm, worker-loader]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-e0a9f7c0b5fac71c8c311121
    resource: repo://crates/celld/asyncrt.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-1c500760315c5c5d7423c257
    resource: repo://crates/celld/js/bootstrap.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-e65834f5c83ba76e348f4b8a
    resource: repo://crates/logic/schedule.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-988163704c46e5140d5f9050
    resource: repo://docs/wasm.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# V8 Runtime and Worker Execution

celld embeds V8 through `rusty_v8` directly and runs one isolate per cell.
The worker's default-export `fetch` receives an `env` whose bindings are
DO namespaces; `env.NS.get(id).fetch()` instantiates the exported DO class
once per id with a `state` whose `storage` is backed by the cell's
SQLite. DO storage is async in JS but synchronous underneath — the ops are
sync Rust, wrapped in `async` by the JS harness
(crates/celld/js.rs#L1-L8).

## The isolate pool

One multi-threaded tokio runtime owns every socket and timer. Isolates
belong to no thread: `v8::Locker` installs the entering thread's
per-isolate state, so any worker can take an isolate and run a turn in it.
The pool module owns the isolates and the counters; every choice about
which isolate, when to grow, what to shed, and what to retire is made by
`celld_logic::isolate` and merely performed here
(crates/celld/pool.rs#L7-L14).

The turn scheduler serializes work per lane (a stateless lane or one lane
per cell), so a cell isolate runs one event at a time and a stateless
isolate drains one turn before the next. The gate exists so nothing
blocks: every path takes the slot's async permit before the blocking
`v8::Locker` lock, so that lock is uncontended by construction — a `lock()`
reached without the permit would park a tokio worker on V8, which is the
one thing this runtime refuses to do (crates/celld/pool.rs#L16-L20,
crates/celld/pool.rs#L67-L120).

## Bootstrap and module loading

Isolate bootstrap compiles the prelude and the JS harness once per process
and caches them, so a new isolate pays for execution but not for
compilation; on top of those go the bindings — `env`, the routing table,
the compatibility flags — which differ per worker and are therefore built
every time (crates/celld/js/bootstrap.rs#L3-L7).

A module specifier is either a builtin, whose source the loader holds, or
an import of another worker, which resolves through the loader. Most
builtins are lazy: a module compiles the first time something reads its
global, so a worker that never touches `node:zlib` never compiles it
(crates/celld/js/modules.rs#L3-L8).

## Runtime materialization

The `RuntimeManager` is the V8 cell-host arm. It owns handles and
filesystem paths, never lifecycle policy: `StartRuntime`, `Publish`, and
`StopRuntime` decide when a cell handle moves from starting to externally
dispatchable to closed, in response to the decision core's effects
(crates/celld/runtime.rs#L7-L12).

Per-cell fetch concurrency is capped: a target may hold
`DEFAULT_MAX_CELL_REQUESTS` (64) cell fetches before celld refuses excess
work, a limit chosen because the last unsaturated Queue step held
approximately 40 requests by Little's Law and 64 keeps the step below the
gate while preventing one target from consuming hundreds of client slots
after its throughput stops increasing (crates/celld/runtime.rs#L38-L45).

## The async runtime facade

`celld::asyncrt` is the production execution facade: it delegates tasks
and timers to Tokio and obtains nondeterministic process values from the
host, and a cfg-gated build can replace the whole module with another
execution backend — which is how the deterministic simulator drives the
same core logic (crates/celld/asyncrt.rs#L1-L7). The actor's `select!`
macro is a re-export of Tokio's select machinery, documented so a Tokio
bump re-checks the facade (crates/celld/lib.rs#L11-L29).

## WebAssembly

A Worker bundle can import a `.wasm` file, and the import gives the
compiled module, not the bytes — the same rule Wrangler applies
(docs/wasm.md#L3-L7). `celld deploy` finds each wasm import, uploads the
file beside the bundle, and marks the deployment with the `wasm-v1`
feature, so a node that predates the feature refuses the deployment with a
clear message and a mixed fleet fails at deploy time rather than at
request time (docs/wasm.md#L20-L24).

celld compiles each wasm module once for the whole process; every isolate
after the first reuses the compiled module, so a cell activation does not
pay the compilation again (docs/wasm.md#L26-L28). A wasm module that does
not compile fails the importing module with a `WebAssembly.CompileError`
that names the file (docs/wasm.md#L76-L77).

## The Worker Loader

A Worker Loader (Code Mode) binding is experimental and off unless
`CELLD_WORKER_LOADER=<env name>` is set. The `__loader_load` op builds a
`WorkerConfig` from the supplied modules and registers its asynchronous
load state, so a Worker can start isolates at runtime
(crates/celld/js.rs#L5736-L5748, docs/README.md#L685). A dynamically
loaded worker can carry wasm: a `BufferSource` value in the `modules` map
becomes a compiled-module import in the loaded worker (docs/wasm.md#L59-L71).
A `globalOutbound` Fetcher, capability stubs in `env`, and awaitable and
pipelined properties are not available (docs/cloudflare-compat.md#L70-L77).

## Worker execution surfaces

- A top-level Worker fetch takes the resident-isolate fast path only when
  the isolate is idle; if it is pumping an actor event, the fetch is
  rescheduled to the stateless Worker pool, never run nested, carrying its
  request identity so the reply still lands
  (crates/logic/schedule.rs#L3-L10).
- Queue producer work is capped per cell at
  `MAX_QUEUE_PRODUCER_EVENTS_PER_CELL` (2), so one producer event can
  execute while one successor waits, and producer work cannot hide the
  alarms and settlements that drain the durable backlog
  (crates/celld/pool.rs#L39-L42).
- A suspended request re-reads its cancellation flag on a 10 ms tick, and
  the isolate pool reaps what it no longer needs on a 30 s interval
  (crates/celld/runtime.rs#L51-L55).
