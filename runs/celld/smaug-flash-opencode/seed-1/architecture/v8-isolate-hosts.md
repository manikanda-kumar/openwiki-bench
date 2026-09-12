---
type: architecture
title: V8 Isolate Hosts and the Workers/DO API
description: How celld embeds rusty_v8 directly to run Wrangler bundles — one isolate per cell, the lazy/bootstrap code cache, JS bindings and compat flags, storage/R2/WebSocket/crypto ops, module resolution, and the runtime materialization seam.
tags: [architecture, v8, isolates, workers, durable-objects, javascript, cloudflare-compat]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-1c500760315c5c5d7423c257
    resource: repo://crates/celld/js/bootstrap.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-71a9e960c45e5efe230ee7b5
    resource: repo://crates/celld/js/storage_ops.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# V8 Isolate Hosts and the Workers/DO API

`crates/celld/js.rs` embeds `rusty_v8` directly. celld runs actual Durable
Objects: the worker's default-export `fetch` receives an `env` whose bindings
are DO namespaces, and `env.NS.get(id).fetch()` instantiates the exported DO
class (once per id) with a `state` whose `storage` is backed by the cell's
SQLite. DO storage is async in JS but synchronous underneath — the ops are sync
Rust wrapped in `async` by the JS harness (`crates/celld/js.rs:8-15`). One
isolate is created per cell.

The isolate boots by compiling prelude and harness scripts that expose the
bindings, then loads the worker bundle. This page covers the bootstrap, the JS
surface modules, the runtime materialization seam, and the Cloudflare
compatibility surface.

## Isolate bootstrap and the code cache

`crates/celld/js/bootstrap.rs` is what a fresh context needs before user code
runs. Because every cell wake pays a fresh isolate, and re-parsing and
re-compiling the ~23k lines of prelude + harness was the single largest slice of
cold-wake latency, celld keeps a per-process compiled-bytecode cache
(`BootstrapCache`, `crates/celld/js/bootstrap.rs:11-23`). The first isolate
compiles eagerly and publishes the cache; every later isolate consumes it and
only executes. On top of the cached prelude and harness go the bindings — `env`,
the routing table, and the compatibility flags — which differ per worker and
are therefore built every time (`crates/celld/js/bootstrap.rs:3-8`).

## JS surface modules

The JS engine is split into focused modules under `crates/celld/js/`:

- `modules.rs` — ES module resolution and compilation. A specifier is either a
  builtin, whose source this module holds, or an import of another worker,
  which resolves through the loader. Most builtins are lazy: a module compiles
  the first time something reads its global, so a worker that never touches
  `node:zlib` never compiles it (`crates/celld/js/modules.rs:5-8`). The module
  registry is an isolate slot, not a thread-local, so handles do not leak across
  isolates (`crates/celld/js/modules.rs:40-54`).
- `storage_ops.rs` — the V8 surface over `crate::storage`: key-value, SQL, and
  the value encoding shared by both. Nothing here decides anything; each op
  converts V8 values to Rust, calls into `storage`, and converts the answer
  back (`crates/celld/js/storage_ops.rs:3-9`).
- `crypto.rs` — the Web Crypto and `node:crypto` surface (P-256 signing, X25519,
  PKCS#8 keys, HKDF/PBKDF2, CRC digests).
- `websocket.rs` — the WebSocket bindings and hibernatable-socket frames.
- `r2_ops.rs` — the R2 binding, which uses the fleet bucket under
  `r2/<bucket_name>/`.
- `zlib.rs` — the synchronous gzip/deflate surface.
- `v8_strings.rs` — interned V8 string identities.

## Cross-node dispatch and proxying

When an isolate hits `env.NS.get(id)` for a cell this node does not own, the op
hands the request to the tokio runtime, which resolves the owner and
HTTP-proxies the fetch, replying on an async oneshot — the JS thread is never
blocked. `DoCallReq` (`crates/celld/js.rs:87`) carries the request id, an
optional cancellation receiver, and the explicit JavaScript AbortSignal that
must reach the target handler.

## Runtime materialization seam

`crates/celld/runtime.rs` is the V8 cell-host arm. `RuntimeManager` owns handles
and filesystem paths, never lifecycle policy: `StartRuntime`, `Publish`, and
`StopRuntime` decide when a cell handle moves from starting to externally
dispatchable to closed (`crates/celld/runtime.rs:7-11`). Placement happens in
the shell; the decision core learns which isolate and generation took a cell via
`Event::RuntimeStarted`.

## Compatibility surface and compat flags

The authoritative compatibility matrix is `docs/cloudflare-compat.md`. celld
implements a **Partial** subset of Cloudflare Workers, Durable Objects, Cron
Triggers, Worker Loader, KV, Queues, D1, Workflows, R2, and the runtime APIs;
Static assets, Encoding, and WebAssembly are **Yes**; Workers AI, Vectorize,
Hyperdrive, Facets, Cache, HTMLRewriter, TCP sockets, EventSource,
MessageChannel, and BroadcastChannel are **No** (`docs/cloudflare-compat.md:15-183`).

celld honors a small set of compatibility switches, computed from the worker's
`compatibility_date` and `compatibility_flags` metadata by
`worker_compat` (`crates/celld/lib.rs:483`): `delete_all_deletes_alarm`,
`js_rpc`, `fetcher_no_get_put_delete`, `sqlite_vec`,
`websocket_standard_binary_type`, and the static-assets navigation flags. Each
other compatibility flag is accepted without effect, and
`Cloudflare.compatibilityFlags` reports only the flags celld honors
(`docs/cloudflare-compat.md:305-317`).

`celld deploy` accepts `wrangler.jsonc` or `wrangler.json` (not `wrangler.toml`)
with a defined subset of top-level keys; each other top-level key, including
`routes`, stops the deployment (`docs/cloudflare-compat.md:319-333`).

## The host relation to the decision core

The raw V8 adapter and its child modules remain outside the Actor execution
domain; the Actor-reachable wake and WebSocket state is injected through
`HostServices` (`crates/celld/js.rs:3-6`). This split lets the deterministic
simulator drive the lifecycle core while V8 stays out of simulation, because
V8 is not deterministic (`docs/testing.md:94-95`).
