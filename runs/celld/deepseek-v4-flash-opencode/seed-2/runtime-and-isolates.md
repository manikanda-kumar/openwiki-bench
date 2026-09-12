---
type: concept
title: V8 isolates and the Workers runtime surface
description: The V8 isolate-per-cell execution model, the Workers and Durable Objects runtime API surface, SQLite-backed storage, WebSockets, WebAssembly, the Worker Loader, and the Cloudflare compatibility boundary.
tags: [v8, isolates, workers, durable-objects, wasm, compatibility]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-d1f8171ced840731654fd4ea
    resource: repo://docs/limitations.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-988163704c46e5140d5f9050
    resource: repo://docs/wasm.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# V8 isolates and the Workers runtime surface

celld embeds V8 directly and runs Wrangler bundles. "The JS engine:
rusty_v8 directly. One isolate per cell." A Worker's default-export `fetch`
receives an `env` whose bindings are Durable Object namespaces, and
`env.NS.get(id).fetch()` instantiates the exported DO class once per id with
a `state` whose `storage` is backed by the cell's SQLite
(crates/celld/js.rs#L8-L15).

## Storage: async in JS, synchronous underneath

A Durable Object's `ctx.storage` is async in JS but synchronous underneath,
because it is local SQLite. celld exposes synchronous Rust ops to V8 and
wraps them in `async` in the JS harness — the same contract with no
thread-hopping. Each cell is its own database file (its own replicated,
epoch-fenced bucket prefix), so the JS side holds a `scope -> Connection`
map that opens on activation and closes on eviction
(crates/celld/storage.rs#L6-L14).

The `Cells` state belongs to the isolate, not to a thread. It was
thread-local while a cell isolate was a thread; that is not correct once a
cell event is driven by a tokio task whose turns run on whatever worker holds
the isolate. A turn holds the isolate lock, so exactly one thread can reach
the maps at a time — the same guarantee the thread gave, obtained from the
isolate instead (crates/celld/storage.rs#L22-L33). The database connection
and the ownership epoch that authorized its activation are kept in one map
entry, so asynchronous object-store work cannot recover an epoch through a
later ownership lookup after a takeover
(crates/celld/storage.rs#L52-L60).

Storage includes a `PRAGMA schema_version` cookie cache: the pragma takes a
shared pager lock (an `fcntl` on the database file), and `write_position`
samples it twice per cell event, so the cookie is reused unless a statement
ran (crates/celld/storage.rs#L62-L80).

## Module resolution and builtins

A module specifier is either a builtin, whose source `crates/celld/js/modules.rs`
holds, or an import of another worker, which resolves through the loader.
Most builtins are lazy: a module compiles the first time something reads its
global, so a worker that never touches `node:zlib` never compiles it
(crates/celld/js/modules.rs#L3-L8). The module registry is an isolate slot,
not a thread-local, because its `Global<Module>` handles belong to one
isolate's heap; with several isolates built and entered from the same tokio
worker, a thread-local let a new isolate wipe a live one's stubs
(crates/celld/js/modules.rs#L35-L54).

The bare Node builtins the bundler leaves external are listed in
`BARE_NODE_BUILTINS` (crates/celld/js.rs#L29-L71). The implemented surface
includes `node:assert`, `node:async_hooks`, `node:buffer`, `node:events`,
`node:path`, `node:stream`, `node:timers/promises`, and `node:util`;
`node:crypto` does not implement Diffie-Hellman, streaming signatures,
ciphers, RSA-PSS, or DSA signatures and key generation; `node:zlib`
implements only the synchronous gzip and deflate functions; `node:fs` returns
`ENOENT` from each read. Each other Node.js module returns an inert stub,
which is a known silent gap (docs/cloudflare-compat.md#L279-L291).

## WebAssembly

A Worker bundle can import a `.wasm` file; the import gives the compiled
module, not the bytes — the same rule Wrangler applies, so a bundle that runs
on Cloudflare runs on celld unchanged (docs/wasm.md#L1-L18). `celld deploy`
finds each wasm import, uploads the file beside the bundle, and marks the
deployment with the `wasm-v1` feature; a node that predates the feature
refuses the deployment with a clear message, so a mixed fleet fails at deploy
time and not at request time (docs/wasm.md#L20-L24). celld compiles each wasm
module once for the whole process, and every isolate after the first reuses
the compiled module, so a cell activation does not pay the compilation again
(docs/wasm.md#L26-L28). The deployment object records the module kind as
`ModuleKind::Wasm` (crates/celld/protocol.rs#L305-L322).

## The Worker Loader

Worker Loader is experimental and requires `CELLD_WORKER_LOADER=LOADER`; a
Worker can then start isolates at runtime. A `globalOutbound` Fetcher is not
available, a loaded Worker cannot receive a capability stub in `env`, and
awaitable and pipelined properties are not available
(docs/cloudflare-compat.md#L70-L77). A dynamically loaded worker can carry
wasm by passing bytes in the `modules` map, where a `BufferSource` value
becomes a compiled-module import (docs/wasm.md#L57-L71). The concurrent
loaded-worker limit is `CELLD_MAX_LOADED_WORKERS` (default 256)
(docs/README.md#L684-L685).

## WebSockets

The three WebSocket kinds and their cell-pinning behavior are described on
the [cell lifecycle](cell-lifecycle.md) page. The runtime side is implemented
in `crates/celld/js/websocket.rs` for the server side and
`crates/celld/ws_client.rs` for outbound connections. The compatibility
boundary includes: `getTags()` is not available; a caller must call
`accept()` on a socket from a subrequest upgrade; an outbound Worker socket
closes after the response and `waitUntil` work end; celld rejects an upgrade
when the response status is not 101; celld removes Worker-supplied protocol
and connection headers from an upgrade response; an outbound upgrade combines
repeated values for one header name; and `acceptWebSocket()` throws when the
isolate uses more than 90 percent of its V8 heap limit
(docs/cloudflare-compat.md#L232-L245).

An outbound Durable Object WebSocket keeps its cell resident, and the
connection closes if the cell moves to another node, so the application must
store the connection intent and reconnect (docs/limitations.md#L38-L43).

## Compatibility flags

celld honors `delete_all_deletes_alarm`, `js_rpc`,
`fetcher_no_get_put_delete`, `sqlite_vec`, `websocket_standard_binary_type`,
and the static-assets navigation flags. It accepts each other compatibility
flag without effect, and `Cloudflare.compatibilityFlags` reports only the
flags celld honors (docs/cloudflare-compat.md#L305-L317). The flags are
resolved from the manifest's `compatibility_flags` and `compatibility_date`
by `worker_compat` (crates/celld/lib.rs#L483-L522). `sqlite_vec` enables the
`sqlite-vec` extension, pinned to the audited C amalgamation
(Cargo.toml#L116-L118).

## The compatibility boundary

celld implements the Cloudflare Workers APIs and documents only the gaps and
differences. **Yes** means the complete applicable API, **Partial** means a
listed input, operation, or behavior is missing, and **No** means the API is
not implemented (docs/cloudflare-compat.md#L3-L13). The service table marks
Static assets, Encoding, and WebAssembly as **Yes**; Workers, Durable
Objects, Cron Triggers, Worker Loader, KV, Queues, D1, Workflows, and R2 as
**Partial**; and Workers AI, Vectorize, Hyperdrive, Browser Rendering, Email
Workers, and Python Workers as **No**
(docs/cloudflare-compat.md#L17-L34). The runtime API table marks Encoding and
WebAssembly as **Yes**, most other APIs **Partial**, and Facets, Cache,
HTMLRewriter, TCP sockets, EventSource, MessageChannel, and BroadcastChannel
as **No** (docs/cloudflare-compat.md#L159-L183).

celld must reject an unsupported configuration or API at deployment or first
use. An unsupported feature that does not cause an error is a defect; the
compatibility page identifies each known exception, including the inert-stub
Node.js modules and TCP sockets (docs/cloudflare-compat.md#L11-L13).

## Per-cell request admission

The runtime admits a maximum of 64 concurrent fetch events for one Durable
Object or Queue broker (`CELLD_MAX_CELL_REQUESTS`), returning HTTP 503 with
`Retry-After: 1` and `X-Celld-Overload: cell` for the excess, and it writes a
`cell_overload_refused` log event when a target becomes saturated
(docs/README.md#L638-L657). A resident isolate is reserved for a top-level
Worker request through `Event::WorkerRequest`, and the shell falls back to
the stateless Worker pool when no resident is available
(crates/logic/types.rs#L483-L488).
