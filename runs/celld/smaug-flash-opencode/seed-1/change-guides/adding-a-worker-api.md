---
type: change-guide
title: Change Guide — Adding a Cloudflare Worker API
description: Focused maintenance guide for extending the Workers/Durable Objects API surface — adding a JS op or binding, hooking it into install, adding compat flags, and adding conformance fixtures.
tags: [change-guide, v8, workers, api-surface, conformance]
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
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Change Guide: Adding a Cloudflare Worker API

This guide traces an existing binding end-to-end as a model for adding a new
one. It assumes you understand the host/decision-core split and the
compatibility surface described on the
[V8 isolate hosts](../architecture/v8-isolate-hosts.md) page and the
[testing](../testing.md) page.

## Trace an existing binding end-to-end

Take the DO blob storage op `__storage_get` (any of the `storage_ops`
handlers works the same way):

1. **The op handler.** `crates/celld/js/storage_ops.rs` implements
   `op_storage_get`, which converts the V8 arguments, calls into `crate::storage`
   (the "nothing here decides anything" rule), and converts the answer back to
   V8 (`crates/celld/js/storage_ops.rs:3-28`).

2. **The op installation table.** `install_ops` in `crates/celld/js.rs` registers
   every op onto the isolate global via the `ops!` macro, mapping the op name to
   its Rust handler (`crates/celld/js.rs:4820-4919`). For example
   `"__storage_get" => storage_ops::op_storage_get`.

3. **The JS prelude/harness.** The `bindings` are exposed to user code through
   the prelude and harness installed by `install_prelude` and `install_harness`
   (`crates/celld/js.rs:4439-4441`). Each per-isolate plant — the op table, the
   module resolution, `build_env`, `inject_*` calls — is built once into the
   harness and the worker module registers each exported DO class via
   `register_class` (`crates/celld/js.rs:4493-4507`).

4. **Bootstrap caching.** Because the op table and the prelude/harness are fixed
   per process, their compiled bytecode is cached in `BootstrapCache`
   (`crates/celld/js/bootstrap.rs:11-23`). A change to the op surface that is
   not mirrored in the cached scripts has no effect on isolates that reuse the
   cache, so keep the cached prelude/harness in sync with the Rust op table.

## Steps to add a new Worker API

1. **Pick the layer.** If the feature surfaces a new storage behavior, it
   belongs in `crate::storage` with a `storage_ops`-style adapter
   (`crates/celld/js/storage_ops.rs`). If it is a wholly new runtime service
   (an R2-style binding, a new WebSocket frame path), add a new module under
   `crates/celld/js/` mirroring `r2_ops.rs` or `websocket.rs`.

2. **Register the op.** Add the `"__op_name" => handler` entry to `install_ops`
   (`crates/celld/js.rs:4822`) so the fresh isolate exposes it.

3. **Expose it to JS.** Add the corresponding function/method in the prelude or
   harness that calls the op (e.g. `globalThis.__storage_get`), following the
   pattern already present. This is the code that the bootstrap cache compiles.

4. **Add compatibility wiring.** If the new API is gated by a
   `compatibility_date` threshold or a flag, extend `worker_compat`
   (`crates/celld/lib.rs:483`) and the `Compat` struct. The compatibility matrix
   switches listed in `docs/cloudflare-compat.md:305-317` are the ones celld
   honors; update the page and the Wrangler-subset keys in
   `docs/cloudflare-compat.md:319-333` if the deployment surface changes. A new
   feature that is not yet supported must be recorded as a gap there too, because
   celld must reject an unsupported configuration at deployment or first use
   rather than behave silently differently (`docs/cloudflare-compat.md:10-13`).

5. **Add a conformance fixture.** New API surfaces require fixtures that give
   equal output on workerd and on celld, run differentially. The corpus is
   described in `docs/testing.md:17-34` and lives in the conformance world test
   modules wired through `crates/celld/lib.rs:365-430`.

## Compatibility and D1/KV/Queue bindings

Binding types follow the same path: `build_env` (`crates/celld/js.rs:4517`)
constructs `env` from the worker config's binding declarations, so a new binding
type must be added to the config-declared binding surface and to `build_env`,
and made resolvable by the module `resolve_external` loader if it is a module
specifier (`crates/celld/js/modules.rs:34-66`). Most other top-level Wrangler
keys stop the deployment, so expanding the accepted config surface is a
deliberate, documented change.

## Verification

- `cargo test` in `crates/celld` exercises the JS and storage op layers.
- The per-commit ratchet is the deterministic simulation of the decision core —
  pure lifecycle and configuration logic must stay deterministic
  (`docs/testing.md:81-99`).
- Run the differential conformance fixtures to confirm workerd and celld give
  equal output.
