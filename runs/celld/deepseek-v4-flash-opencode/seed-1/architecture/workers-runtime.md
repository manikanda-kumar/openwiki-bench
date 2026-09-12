---
type: architecture
title: V8 runtime and Cloudflare Workers compatibility
description: The in-process rusty_v8 runtime that executes Wrangler bundles, the isolate pool and its decision core, the JS prelude and harness, cell storage over per-cell SQLite, the reserved runtime classes (D1, KV, Queues, Workflows, cron), and the Cloudflare compatibility surface.
tags: [v8, workers, durable-objects, isolates, javascript]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-1c500760315c5c5d7423c257
    resource: repo://crates/celld/js/bootstrap.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# V8 runtime and Cloudflare Workers compatibility

celld embeds V8 and executes Wrangler bundles directly. The runtime surface
follows the Cloudflare Workers and Durable Objects API; the compatibility
boundary is documented in `docs/cloudflare-compat.md`. This page describes the
runtime machinery: isolates, module resolution, the harness, per-cell storage,
and the reserved runtime classes.

## The JS engine

The JS engine is rusty_v8 directly — `crates/celld/js.rs:8-15` states "The JS
engine: rusty_v8 directly. One isolate per cell." A worker's default-export
`fetch` receives an `env` whose bindings are Durable Object namespaces;
`env.NS.get(id).fetch()` instantiates the exported DO class (once per id) with
a `state` whose `storage` is backed by the cell's SQLite (`crate::storage`).
DO storage is async in JS and synchronous underneath — the ops are synchronous
Rust, wrapped in `async` by the JS harness.

## The isolate pool

The pool (`crates/celld/pool.rs:1-20`) is the shell around the pure isolate
decision core. One multi-threaded Tokio runtime owns every socket and timer;
isolates belong to no thread — `v8::Locker` installs the entering thread's
per-isolate state, so any worker can take an isolate and run a turn in it.
Every choice about which isolate, when to grow, what to shed and what to
retire is made by `celld_logic::isolate` and merely performed here.

The pure core (`crates/logic/isolate.rs:3-88`) tracks three quantities per
isolate because they answer different questions: **turns** (in-flight turns:
queued plus the one running — CPU demand, released across an await),
**requests** (requests whose JS state lives in that isolate's heap —
affiliation, which is memory), and **cells** (realms the isolate holds — what
cell placement balances). `PoolLimits` separates the bounds: `max_requests` is
node-wide (a suspended request costs the same wherever it landed), while
`max_cells` is per-isolate (a heap that holds too many cells is a single OOM
taking every cell in it down together, so spreading is the whole point). A
refusal maps to HTTP 503, because the node is the thing that is unavailable,
not the request that is wrong.

`schedule.rs` (in the logic core) rules that a cell isolate runs one event at
a time; a top-level Worker fetch takes the resident-isolate fast path only
when idle, and otherwise reschedules to the stateless Worker pool, never
running nested.

## Isolate bootstrap and module resolution

A fresh isolate needs a prelude and the harness before user code runs. The
prelude and harness compile once per process and are cached
(`crates/celld/js/bootstrap.rs:1-16`), so a new isolate pays for execution but
not for compilation; the bindings — `env`, the routing table, the
compatibility flags — differ per worker and are built every time. The cache
matters for cold-wake latency: every cell wake pays a fresh isolate, and
without the cache each one would re-parse and re-compile the same ~23k lines.

`harness.js` implements the Durable Object object model and the
Cloudflare-compatible runtime surface, run once per isolate by `js.rs` after
the Web-API prelude. Module resolution (`crates/celld/js/modules.rs:1-25`)
distinguishes builtins, whose source the runtime holds, from imports of
another worker, which resolve through the loader; most builtins are lazy, so a
worker that never touches `node:zlib` never compiles it.

## Cell storage: per-cell SQLite

`crate::storage` (`crates/celld/storage.rs:1-35`) is the SQLite backing for
the Durable Object storage API. Each cell is its own database file — its own
replicated, epoch-fenced bucket prefix — and the JS thread holds a
scope-to-connection map: open on activate, close on evict. The database opens
in WAL mode, and the harness models `ctx.storage` as async over synchronous
Rust. A dedicated alarm bookkeeping table records committed alarm mutations
that no turn has taken yet; the alarm move is a turn output that the drive
reports to the host (`crates/celld/storage.rs:37-43`).

The `sqlite_vec` compatibility flag registers the `sqlite-vec` extension
(`vec0` virtual tables) on each cell connection (`crates/celld/storage.rs:600-659`),
and the extension's use is validated against an allowlist so user code cannot
attach a different SQLite extension.

## V8 heap limits

Each isolate has a V8 heap limit, separate from the memory of the node. The
default is 128 MB (`CELLD_V8_HEAP_LIMIT_MB`, validated in
`crates/celld/env_vars.rs:82-86`), matching the limit of a Durable Object on
Cloudflare. A `near_heap_limit` callback
(`crates/celld/js.rs:1993-2064`) latches a flag and recovers by forcing
collections. An isolate above 90% of the limit refuses a new hibernatable
WebSocket and stops materializing SQL result sets; the isolate measures the
heap before each event and serves again when use falls under 75%. Each
hibernatable WebSocket client holds state in the heap, so the limit decides
how many clients a cell can carry.

## The reserved runtime classes

D1 databases, KV namespaces, Queues, Workflows, and the cron cell are not
application code: they are runtime-supplied Durable Object classes that celld
installs in every isolate, and a user configuration is refused if it names
them (`crates/celld/deploy.rs:58-80`).

- **D1** (`__D1Database`) — one reserved cell per database; the class is
  supplied by the runtime and refused as a user class name.
- **KV** (`__KvNamespace`) — a namespace is a cell. The pure core
  (`crates/logic/kv.rs:3-60`) owns the stable address, the public bounds
  (`MAX_KEY_BYTES` 512, `MAX_VALUE_BYTES` 25 MiB, `MIN_EXPIRATION_TTL_MS`),
  and the large-value split: values above `MAX_INLINE_VALUE_BYTES` (1 MiB, the
  measured latency crossover) go to the fleet bucket while the row names them,
  because an inline value is paid twice — in SQLite and on the wire — on every
  write. The namespace class is fleet-wide, not script-scoped, because a
  namespace is a resource several Workers bind.
- **Queue** (`__Queue`) — a queue is one reserved cell
  (`crates/logic/queue.rs:3-37`). The core owns the public bounds
  (`MAX_MESSAGE_BYTES` 128 KB, `MAX_RETRIES` 100, `MAX_BATCH_MESSAGES` 100),
  retention of four days (`RETENTION_MS`), and the durable single alarm chosen
  from every batch deadline. One consumer script can attach per queue.
- **Workflow** (`__Workflow`) — one reserved cell per workflow instance,
  script-scoped.
- **Cron** — a deployment's `triggers.crons` drive a reserved cron cell whose
  alarm is armed at the next occurrence; `crates/logic/cron.rs` is the pure
  schedule logic (Cloudflare's cron dialect, one-minute resolution, UTC).

## The compatibility surface

`docs/cloudflare-compat.md` is the authoritative boundary: which services and
runtime APIs are `Yes`, `Partial`, or `No`, and the known gaps. Two mechanisms
make the surface concrete in code:

- `worker_compat` (`crates/celld/lib.rs:483-522`) maps the deployment's
  `compatibility_flags` and `compatibility_date` to the runtime's `Compat`
  switches (for example `delete_all_deletes_alarm`, `js_rpc`,
  `fetcher_no_get_put_delete`, `sqlite_vec`,
  `websocket_standard_binary_type`, and the Queue JSON message flag).
- Deployment manifests name required features so an older node refuses a
  deployment it cannot serve (see the [deployments page](deployments.md)).

The compatibility rule is that an unsupported configuration or API must be
rejected at deployment or first use — an unsupported feature that does not
cause an error is a defect (`docs/cloudflare-compat.md:11-13`).

## Related pages

- [Cell lifecycle and ownership](cell-lifecycle.md) — how resident cells enter and leave isolates.
- [Deployments and in-place code adoption](deployments.md) — how a Generation materializes into isolate pools and class registries.
- [Durability, fencing, and the output gate](durability-protocol.md) — how a cell's writes become durable before any output reveals them.
