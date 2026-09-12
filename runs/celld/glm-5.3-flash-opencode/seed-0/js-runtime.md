---
type: runtime
title: "JS runtime and Workers compatibility"
description: "The V8 engine host: one isolate per cell, the JS harness over synchronous Rust storage, module shims and lazy builtins, host services injection, and the Cloudflare compatibility boundary."
tags: [v8, javascript, workers, compatibility, storage]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-e0a9f7c0b5fac71c8c311121
    resource: repo://crates/celld/asyncrt.rs
  - id: openwiki-source-55ec5a6f535496955b66f4ff
    resource: repo://crates/celld/host_services.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# JS runtime and Workers compatibility

celld runs the actual Cloudflare Workers contract on real V8. `crates/celld/js.rs`
states the model up front: "The JS engine: rusty_v8 directly. One isolate per
cell… `env.NS.get(id).fetch()` instantiates the exported DO class (once per id)
with a `state` whose `storage` is backed by the cell's SQLite", and "DO storage
is async in JS, synchronous underneath — the ops are sync Rust, wrapped in
`async` by the JS harness" (`crates/celld/js.rs:9-15`).

## Execution model

- **One isolate per cell.** DO instances materialize once per id on demand
  through `env.NS.get(id)` (`crates/celld/js.rs:12-15`); stateless top-level
  Worker requests run in a "stateless isolate pool" instead of claiming a cell
  (`crates/celld/js.rs:258-259`).
- **Isolate-slot state, not thread-locals.** Builtin module stubs live in an
  `Arc<ModuleRegistry>` on the V8 isolate: "These are `Global<Module>` handles
  into *one* isolate's heap. Under D1 several isolates are built and entered
  from the same tokio worker, so a thread-local made them share one table"
  — which produced invalid handles, not wrong answers
  (`crates/celld/js/modules.rs:36-44`).
- **The JS harness** (`crates/celld/js/harness.js`, ~10k lines) implements the
  surface JS sees, including promise-chain serialization for storage blocks
  (`crates/celld/js.rs:1358`, `1428`).

## Storage: async JS over sync SQLite

`crates/celld/storage.rs` is explicit: "DO's `ctx.storage` is async in JS but
synchronous underneath (local SQLite). We expose synchronous Rust ops to V8
and wrap them in `async` in the JS harness — same contract, no thread-hopping.
Each cell is its OWN db file (its own replicated, epoch-fenced bucket
prefix)" (`crates/celld/storage.rs:5-12`). One SQLite connection per
resident cell, cached in a `scope -> Connection` map, opened on activate and
closed on evict.

## Determinism seams: asyncrt and host services

`crates/celld/asyncrt.rs` is "The production execution facade": it delegates
tasks and timers to Tokio and obtains nondeterministic process values from
the host; a cfg-gated build "can replace this module with another execution
backend" (`crates/celld/asyncrt.rs:5-8`). `crates/celld/host_services.rs`
carries "Process services that an engine incarnation can observe. Production
installs one service set. A deterministic domain installs one set per
simulated node, so co-hosted incarnations do not share counters or host
measurements" (`crates/celld/host_services.rs:3-6`) — the same seam behind
injection of Actor-reachable wake and WebSocket state (`crates/celld/js.rs:5-6`).

## Compatibility switches (`Compat`)

Per-worker behavior flags are derived from the manifest's compatibility date
and flags, mirroring workerd's compatibility-date capabilities
(`crates/celld/js.rs:1680-1708`): examples include `delete_all_deletes_alarm`,
`js_rpc` (RPC on DO classes not extending `DurableObject`),
`fetcher_get_put_delete` (deprecated stub helpers on/off by date threshold
2024-03-26), `sqlite_vec` (explicit, no date default), the
`websocket_standard_binary_type` blob-vs-arraybuffer default, and
`queue_json_messages` after 2024-03-18. Default is every switch off;
production derives real values in the binary.

## Builtin modules and shims

`crates/celld/js/modules.rs` resolves specifiers: a builtin's source lives in
the module, other imports resolve through the loader. "Most builtins are
lazy: a module compiles the first time something reads its global, so a
worker that never touches `node:zlib` never compiles it"
(`crates/celld/js/modules.rs:3-7`). External builtins are `node:*`,
`cloudflare:*`, and bare Node names (`crates/celld/js/modules.rs:56-60`).
The shims live as `.js` files in `crates/celld/js/`: Node-compat modules
(`node_assert`, `node_buffer`, `node_crypto`, `node_events`, `node_path`,
`node_stream`, `node_test`, `node_timers`, `node_util`, `node_async_hooks`,
`zlib`), Web/Workers APIs (`url`, `url_pattern`, `url_search_params`,
`headers`, `text_encoding`, `byte_streams`, `stream`s, compression +
transform streams, `writable_stream`, `crypto`, `websocket`s, `set_immediate`),
plus Rust-operated ops in `storage_ops.rs`, `r2_ops.rs`, `crypto.rs`,
`v8_strings.rs`.

## Compat contract

[docs/cloudflare-compat.md](../docs/cloudflare-compat.md) defines the policy celld
holds itself to: **Yes / Partial / No** per service, and "celld must reject an
unsupported configuration or API at deployment or first use. An unsupported
feature that does not cause an error is a defect" (that page). The
differential-testing page ties the contract to evidence.

## Known unknowns

- Exact lifecycle of isolate teardown, memory limits, and per-cell V8 heap
  budgets are enforced through the pressure path referenced elsewhere
  (`crates/celld/memory.rs`); this page does not quantify them because the
  limits are configuration-driven rather than intrinsic to the JS engine.
- Which individual shim `.js` modules map to which Cloudflare service table
  rows is documented in `docs/cloudflare-compat.md`, not in code comments.
