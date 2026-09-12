---
type: concept
title: Cloudflare Compatibility Surface
description: What celld implements of the Workers/Durable Objects API, how supported services are built as reserved runtime cells (D1, KV, Queues, Workflows) or direct bucket bindings (R2, assets), the rejection contract, known silent gaps, and the examples corpus.
tags: [cloudflare, compatibility, durable-objects, kv, d1, queues, workflows, r2, assets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d195a85fdc29d1ff9c9de33c
    resource: repo://crates/celld/js/r2_ops.rs
  - id: openwiki-source-71a9e960c45e5efe230ee7b5
    resource: repo://crates/celld/js/storage_ops.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Cloudflare Compatibility Surface

celld's JavaScript API follows Cloudflare Workers and Durable Objects (docs/README.md#L1-L7). `docs/cloudflare-compat.md` is the contract of record: **Yes** = complete applicable API, **Partial** = listed inputs/operations/behaviors missing, **No** = not implemented — and "celld must reject an unsupported configuration or API at deployment or first use. An unsupported feature that does not cause an error is a defect" (docs/cloudflare-compat.md#L3-L12).

## Supported and unsupported services

Of the Workers platform, celld supports Workers (partial), Durable Objects, static assets (Yes), cron, Worker Loader (experimental, `CELLD_WORKER_LOADER`), KV, Queues, D1, Workflows, and R2, each Partial with itemized gaps; Workers AI, Vectorize, Hyperdrive, Browser Rendering, Email Workers, and Python Workers are No (docs/cloudflare-compat.md#L14-L38). A handful of gaps are declared *silent by design*: other Node.js modules return inert stubs, `node:fs` returns `ENOENT` from reads, `connect()` is a stub, and EventSource/MessageChannel/BroadcastChannel are inert (docs/cloudflare-compat.md#L279-L303). Representative behavioral gaps: KV `cacheTtl` has no effect and values above 1 MiB require a fleet bucket; a queue retains messages four days with one consumer script; D1 results cap at 100,000 rows or 32 MiB; Workflows replay `run()` from the start; R2 bindings read/write the fleet bucket under `r2/<bucket_name>/` and multipart uploads cannot resume across nodes (docs/cloudflare-compat.md#L79-L158).

## Services are cells: the reserved classes

The supported managed services are not bolt-ons; each is a cell in a runtime-supplied Durable Object class, and these classes are refused as user class names because the harness registers them in every isolate (crates/celld/deploy.rs#L60-L81):

| Service | Class | Scope |
| --- | --- | --- |
| D1 database | `__D1Database` | fleet-wide on purpose: a database outlives any Worker that binds it, so several scripts naming one database mean the same cells (crates/celld/deploy.rs#L97-L105) |
| KV namespace | `__KvNamespace` | fleet-wide, shared across binding scripts (crates/logic/kv.rs#L35, crates/celld/deploy.rs#L73-L76) |
| Queue broker | `__Queue` | one reserved cell per queue owning SQL and dispatch (crates/logic/queue.rs#L5-L19) |
| Workflow instance | `__Workflow.<script>` | script-scoped because the instance's namespace key already carries the script; the old shared name made a second script collide the registry and stop the node (crates/celld/deploy.rs#L83-L101) |
| Cron trigger | `.cron` per script name | one reserved cell whose alarm re-arms at the next occurrence (crates/logic/cron.rs#L33-L42) |

The `.` separator is a set of constraints, not taste: a JS class name cannot contain one (no user-export collision), it is not `:` (the scope parser's class/id split), and it lies inside `valid_cell_scope`'s security charset (crates/celld/deploy.rs#L89-L96). Reserved classes are fenced off the unauthenticated `/do/` route by a single `is_reserved_scope` predicate, "because a forgotten refusal is not a missing feature, it is an unauthenticated route onto a cell whose whole surface is an operator protocol" (crates/celld/deploy.rs#L145-L157).

Each service splits the same way as everything else: policy sans-IO in `crates/logic`, execution in the harness and Rust adapters. A KV namespace holds in `logic/kv` "the parts of it that decide an address or publish a bound," with key/value/expiry bounds shipped to JavaScript as data (`__cell.kvLimits`) that the harness compares against, leaving one implementation of each check (crates/logic/kv.rs#L3-L16). A Queue broker keeps in `logic/queue` "the stable address, the public bounds, the alarm deadline, concurrency admission, retry timing, lease-generation advancement, settlement fencing, purge classification, and deploy-time configuration validation," and the lease generation rides inside `PlannedLease` so a late settlement cannot acknowledge a newer delivery (crates/logic/queue.rs#L5-L16). D1 and Workflows ride `ctx.storage.sql` on their cells' SQLite; the DO storage surface itself is exposed through pure conversion ops in `js/storage_ops.rs` — "Nothing here decides anything" (crates/celld/js/storage_ops.rs#L3-L9).

## R2 and assets: bindings without cells

R2 is served directly from the fleet bucket the node already holds credentials for, under the reserved `r2/<bucket_name>/` prefix — "celld does not run a blob service; it runs *on* one" — and a bucketless node answers every R2 op with an explicit refusal rather than pretending (crates/celld/js/r2_ops.rs#L3-L11). Static assets deploy as indexed blob objects resolved by `assets.rs` (crates/celld/assets.rs), supporting the assets binding, HTML handling, not-found, `RunWorkerFirst` routes, `_headers`, and `_redirects` (docs/README.md#L235-L240).

## Deployment and flags boundary

`celld deploy` accepts `wrangler.jsonc`/`wrangler.json` (not `wrangler.toml`) and a closed allowlist of top-level keys (`name`, `main`, `no_bundle`, `compatibility_date`, `compatibility_flags`, `durable_objects`, `migrations`, `assets`, `services`, `triggers`, `vars`, `d1_databases`, `kv_namespaces`, `queues`, `workflows`, `r2_buckets`); "each other top-level key, including `routes`, stops the deployment" (docs/cloudflare-compat.md#L319-L333, crates/celld/deploy.rs#L10-L14). Five compatibility flags change behavior (`delete_all_deletes_alarm`, `js_rpc`, `fetcher_no_get_put_delete`, `sqlite_vec`, `websocket_standard_binary_type`, plus the static-assets navigation flags); every other flag is accepted without effect, and `Cloudflare.compatibilityFlags` reports only the honored ones (docs/cloudflare-compat.md#L305-L317). Feature markers in the deployment manifest make mixed fleets fail at deploy time, not request time (docs/wasm.md#L26-L30, crates/celld/deploy.rs imports of FEATURE_* markers).

## The examples corpus

`examples/` is a progressive tour of the supported surface, each one a deployable Wrangler project: `hello` (stateless fetch), `webapi`, `counter` (SQLite-backed DO), `vectordb` (per-object `vec0` index via sqlite-vec), `d1`, `r2`, `kv`, `async`, `body`, `router`, `wsecho` (WebSocket hibernation), `wsclient` (outbound DO socket), `alarm`, `cron`, `workflow`, `rpc` (DO method calls), and `wasm` (workers-rs) (examples/README.md#L3-L24). Conformance beyond these fixtures is tested differentially against Cloudflare's `workerd` runtime, but that corpus and its harness live outside this repository snapshot (docs/testing.md#L17-L32).

Related: [Workers and V8 Runtime](/openwiki/concepts/workers-runtime.md), [Deploy and Local Development](/openwiki/operations/deploy-develop.md), [Operator CLIs](/openwiki/operations/operator-clis.md).
