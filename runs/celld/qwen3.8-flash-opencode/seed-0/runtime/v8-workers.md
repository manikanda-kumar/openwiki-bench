---
type: subsystem
title: V8 runtime and the Workers JS layer
description: celld executes Wrangler bundles on rusty_v8 directly, one isolate per cell behind a core-authorized runtime manager; a cached prelude plus a 23k-line JS harness build the Workers/DO environment over synchronous Rust ops for SQLite storage, SQL, sockets, crypto, and wasm modules compiled once per process.
tags: [v8, isolate, harness, bindings, storage, websocket, wasm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-1c500760315c5c5d7423c257
    resource: repo://crates/celld/js/bootstrap.rs
  - id: openwiki-source-523ed570426ab2f0808c1530
    resource: repo://crates/celld/js/crypto.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-d195a85fdc29d1ff9c9de33c
    resource: repo://crates/celld/js/r2_ops.rs
  - id: openwiki-source-71a9e960c45e5efe230ee7b5
    resource: repo://crates/celld/js/storage_ops.rs
  - id: openwiki-source-f9c6a0351651688a4250c0d4
    resource: repo://crates/celld/js/websocket.rs
  - id: openwiki-source-7c8cfe78d4b8ae5d78ad0b6f
    resource: repo://crates/celld/js/zlib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
  - id: openwiki-source-988163704c46e5140d5f9050
    resource: repo://docs/wasm.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# V8 runtime and the Workers JS layer

The engine is `rusty_v8` used directly — "The JS engine: rusty_v8 directly. One
isolate per cell" — running actual Durable Objects: the Worker's default-export
`fetch` receives an `env` of DO namespaces, and `env.NS.get(id).fetch()`
instantiates the exported class once per id with a `state.storage` backed by
the cell's SQLite ([crates/celld/js.rs#L8-L16](repo://crates/celld/js.rs#L8-L16),
[crates/celld/storage.rs#L6-L14](repo://crates/celld/storage.rs#L6-L14)).
The V8 dependency follows deno's pinned line (v8 = 152.1) precisely because
shared isolates need `v8::Locker` and `Send` globals — the two upstream issues
that made pooling ordinary again
([Cargo.toml#L136-L140](repo://Cargo.toml#L136-L140)).

## Layering and what each half owns

- **`runtime.rs`** is the V8 arm of the actor's lifecycle effects: the
  `RuntimeManager` "owns handles and filesystem paths, never lifecycle policy;
  StartRuntime, Publish, and StopRuntime decide when a cell handle moves from
  starting to externally dispatchable to closed"
  ([crates/celld/runtime.rs#L7-L11](repo://crates/celld/runtime.rs#L7-L11)).
- **`pool.rs`** owns the isolate set on one multi-threaded Tokio runtime:
  isolates belong to no thread (`v8::Locker` installs the entering thread's
  per-isolate state), which an async permit before every `SharedIsolate::lock()`
  keeps uncontended by construction — "parking a tokio worker on V8 ... is the
  one thing this runtime refuses to do"
  ([crates/celld/pool.rs#L7-L20](repo://crates/celld/pool.rs#L7-L20)).
  Which isolate, when to grow, what to shed: decided by
  [the core's pool policy](../architecture/decision-core.md), performed here.
- **`js/bootstrap.rs`** installs the environment: prelude and harness compile
  once per process and are cached, so a new isolate "pays for execution but not
  for compilation," while per-worker bindings (`env`, the routing table,
  compatibility flags) are built each time
  ([crates/celld/js/bootstrap.rs#L3-L8](repo://crates/celld/js/bootstrap.rs#L3-L8)).
  The harness is a ~23,000-line script (`js/harness.js`) that implements the
  Workers/DO surface in JS — including the `__D1Database`, `__Workflow`, and
  KV classes ([crates/celld/js/bootstrap.rs#L11-L15](repo://crates/celld/js/bootstrap.rs#L11-L15),
  [crates/celld/js/harness.js#L6966](repo://crates/celld/js/harness.js#L6966)).
- **`js/modules.rs`** resolves ES module specifiers: a specifier is either a
  builtin whose source the runtime holds — most lazily, so "a worker that never
  touches `node:zlib` never compiles it" — or an import of another worker, via
  the loader ([crates/celld/js/modules.rs#L3-L7](repo://crates/celld/js/modules.rs#L3-L7)).
  Bare Node builtins the bundler leaves behind are an explicit list
  ([crates/celld/js.rs#L30-L50](repo://crates/celld/js.rs#L30-L50)).
- The whole V8 arm lives outside the actor execution domain and says so with
  an allow + comment; Actor-reachable wake and WebSocket state is injected
  through `HostServices` ([crates/celld/js.rs#L3-L6](repo://crates/celld/js.rs#L3-L6)).

## Storage: sync Rust under async JS

DO `ctx.storage` is async in JS and synchronous underneath: Rust exposes sync
SQLite ops and the JS harness wraps them in `async`, so "same contract, no
thread-hopping," and each cell is its own database file — its own replicated,
epoch-fenced bucket prefix
([crates/celld/storage.rs#L6-L12](repo://crates/celld/storage.rs#L6-L12)).
`js/storage_ops.rs` is the conversion layer with the stated discipline that
"nothing here decides anything": semantics live in `storage.rs`, serialization
here ([crates/celld/js/storage_ops.rs#L3-L7](repo://crates/celld/js/storage_ops.rs#L3-L7)).
D1 SQL shares the same surface with typed request/response modes (prepared
statement, exec, migration) and two explicit ceilings that respect the heap —
100,000 rows and 32 MiB of result bytes, because a result exists in two 128 MiB
isolate heaps during delivery
([crates/celld/storage.rs#L1600-L1615](repo://crates/celld/storage.rs#L1600-L1615),
[crates/celld/js/storage_ops.rs#L431-L442](repo://crates/celld/js/storage_ops.rs#L431-L442)).

## Other bindings

- **WebSockets inside the isolate**: a registry maps the ids JS holds to
  sockets that outlive their events; frames emitted inside an output-gate
  region are held there ([crates/celld/js/websocket.rs#L3-L8](repo://crates/celld/js/websocket.rs#L3-L8));
  hibernatable clients keep their state in the isolate heap, which is what
  decides how many a cell can carry ([README.md#L299-L302](repo://README.md#L299-L302)).
  Ingress/proxy/egress shapes are on [listeners and peers](../networking/listeners-and-peers.md).
- **Crypto**: `js/crypto.rs` holds key formats (SPKI, PKCS#8, JWK, raw) and
  primitives, reached only after the JS layer (`crypto.js`, `node_crypto.js`)
  has validated arguments; the Node crypto KDFs (pbkdf2, hkdf) and the wider
  curve surface are workspace-pinned dependencies
  ([crates/celld/js/crypto.rs#L3-L8](repo://crates/celld/js/crypto.rs#L3-L8),
  [Cargo.toml#L64-L69](repo://Cargo.toml#L64-L69)).
- **zlib**: one-shot `__zlib` op plus a streaming flate2 backend for
  `CompressionStream`/`DecompressionStream`, drained chunk by chunk
  ([crates/celld/js/zlib.rs#L3-L7](repo://crates/celld/js/zlib.rs#L3-L7)).
- **R2**: no blob service is run — a binding is served from the fleet bucket
  under the reserved `r2/<bucket_name>/` prefix, "the same durability, the same
  store, no second set of credentials"
  ([crates/celld/js/r2_ops.rs#L3-L8](repo://crates/celld/js/r2_ops.rs#L3-L8),
  [crates/celld/main.rs#L3316-L3322](repo://crates/celld/main.rs#L3316-L3322)).
- **KV/D1/Queue/Workflow** bindings land in reserved-class cells — see
  [reserved classes](../platform/reserved-classes.md).
- **Worker Loader (Code Mode)** is experimental, off unless
  `CELLD_WORKER_LOADER` names the binding, with a `CELLD_MAX_LOADED_WORKERS`
  cap (default 256)
  ([docs/README.md#L684-L685](repo://docs/README.md#L684-L685),
  [crates/celld/js.rs#L5870-L5871](repo://crates/celld/js.rs#L5870-L5871)).

## Heap limits per isolate

Each isolate has its own V8 heap limit, default 128 MB (Cloudflare's DO limit),
set by `CELLD_V8_HEAP_LIMIT_MB` ([README.md#L297-L299](repo://README.md#L297-L299),
[crates/celld/js.rs#L2362-L2365](repo://crates/celld/js.rs#L2362-L2365)).
The response curve is a three-level machine
([crates/celld/js.rs#L2115-L2135](repo://crates/celld/js.rs#L2115-L2135)):

1. At 90% of the limit (`HEAP_ADMISSION_SHARE`) a new **hibernatable**
   WebSocket is refused — deliberately below the near-limit callback, "this
   refuses one hibernatable socket while the isolate still works, where the
   callback fires once it no longer does."
2. At the limit itself, SQL result-set materialization stops and the near-limit
   callback guards execution; both errors name the heap
   ([README.md#L304-L308](repo://README.md#L304-L308)).
3. Recovery re-admits only under 75% (`HEAP_RECOVERY_SHARE`), and because an
   idle isolate "holds a dead heap until something allocates," celld forces a
   garbage collection past that share — rate-limited to one nudge per second,
   since a full GC of a 128 MB heap costs tens of milliseconds
   ([README.md#L309-L312](repo://README.md#L309-L312),
   [crates/celld/js.rs#L2127-L2131](repo://crates/celld/js.rs#L2127-L2131)).

A restart of the process is never the remedy; the isolate serves again when
use falls under the recovery share.

## Wasm

A Worker bundle imports `.wasm` files as compiled modules, not bytes — the
same rule Wrangler applies (`CompiledWasm` module kind), so a bundle that runs
on Cloudflare runs unchanged
([crates/celld/js.rs#L1714-L1717](repo://crates/celld/js.rs#L1714-L1717),
[docs/wasm.md#L3-L21](repo://docs/wasm.md#L3-L21)). `celld deploy` finds each
wasm import, uploads it beside the bundle, and marks the deployment with the
`wasm-v1` feature so a mixed fleet fails at deploy time rather than at request
time ([docs/wasm.md#L23-L27](repo://docs/wasm.md#L23-L27)). Compilation is
process-wide: "celld compiles each wasm module once for the whole process. Every
isolate after the first one reuses the compiled module"
([docs/wasm.md#L29-L33](repo://docs/wasm.md#L29-L33)). `examples/wasm` carries
the workers-rs recipe ([examples/README.md#L21-L23](repo://examples/README.md#L21-L23)).

## Conformance boundary

The JS surface's contract is differential: the same program must give equal
output on workerd and on celld ([docs/testing.md#L17-L33](repo://docs/testing.md#L17-L33)),
and per-API gaps are recorded in [docs/cloudflare-compat.md](repo://docs/cloudflare-compat.md#L3-L13)
— including the RPC limitation that a DO stub cannot cross an isolate boundary
([docs/cloudflare-compat.md#L47-L50](repo://docs/cloudflare-compat.md#L47-L50)).
The conformance fixtures and the workerd comparison harness are external to
this snapshot (see [change guide](../development/change-guide.md)).

Related: [actor and execution boundary](../architecture/actor-execution.md) ·
[cell lifecycle](../concepts/cell-lifecycle.md) ·
[reserved classes](../platform/reserved-classes.md) ·
[listeners and peers](../networking/listeners-and-peers.md)
