---
type: "Reference"
title: "The V8 JS runtime: isolates, the input gate, alarms, and WebSockets"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-e5ac10d305aff4ea0756b67b
    resource: repo://crates/logic/alarm.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-e65834f5c83ba76e348f4b8a
    resource: repo://crates/logic/schedule.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# The V8 JS runtime: isolates, the input gate, alarms, and WebSockets

This page covers how celld embeds V8 and executes Wrangler bundles, the
isolate pool, the input gate, alarms, the wake index, WebSocket hibernation,
and the V8 heap limit.

## ES module resolution and compilation

`crates/celld/js/modules.rs` holds ES module resolution: a specifier is either
a builtin (whose source this module holds) or an import of another worker,
resolved through the loader. Most builtins are lazy — a module compiles the
first time something reads its global (`crates/celld/js/modules.rs:3-8`). The
`ModuleRegistry` caches pre-compiled stubs per isolate slot, not per thread,
because under D1 several isolates are built and entered from the same tokio
worker; a registry shared between isolates would corrupt handles
(`crates/celld/js/modules.rs:38-47`).

The `celld` crate embeds `v8` (denoland/rusty_v8). The runtime exposes the 
Worker/Durable Object contract: fetches, RPC, alarms, WebSockets, service and
cell bindings, and storage.

## Isolate pools

celld runs JS on a set of isolates that grow and shrink with demand. An isolate
is not bound to a thread: `v8::Locker` installs the entering thread's
per-isolate state, so any worker can take an isolate and run a turn in it. What
an isolate is bound to is the JS state it holds (`crates/logic/isolate.rs:3-8`).

Two quantities matter (`crates/logic/isolate.rs:13-23`):

- **Turns** — turns in flight on an isolate (queued plus running): CPU demand.
  The isolate is released across an await, so this is what placement balances.
- **Requests** — requests affiliated with an isolate: memory. A request's
  promise lives in its first isolate's heap, so every later turn must come
  back there.

The core owns isolate selection as lifecycle policy: `Event::WorkerRequest`
reserves an idle resident isolate for a top-level Worker request, and the shell
falls back to the stateless pool when no resident is available
(`crates/logic/types.rs:482-488`). `Effect::CompleteWorker` returns the chosen
route (`crates/logic/types.rs:904-909`).

## The V8 heap limit and hibernatability

Each isolate has a V8 heap limit separate from node memory. The default is
128 MB, matching the Cloudflare Durable Object limit; `CELLD_V8_HEAP_LIMIT_MB`
changes it. Each hibernatable WebSocket client holds state in the heap, so the
limit decides how many clients a cell can carry (approximately 50,000 at the
default) (`docs/README.md:297-302`). An isolate above 90% of the limit refuses
a new hibernatable WebSocket, and an isolate that reaches the limit
also stops the materialization of a SQL result set (`docs/README.md:304-307`).

## The input gate (`blockConcurrencyWhile`)

`crates/logic/gate.rs` implements the input gate that a handler holds across
`blockConcurrencyWhile`. While the gate is held, no incoming event of any kind
is delivered to that cell except the event holding it (`crates/logic/gate.rs:3-15`).
In celld every storage path is local SQLite underneath, so a read or write
completes inside the turn that started it and never yields to another event
(`crates/logic/gate.rs:16-24`). `acquire` is synchronous with the JS call and
nested blocks are counted, not refused; `release` panics if the wrong event
releases, and `abandon` covers the holder dying mid-block
(`crates/logic/gate.rs:37-53`, `crates/logic/gate.rs:141-144`).

## Alarms

An alarm is carried in the cell's own SQLite (its row), so a cell that restores
from another node or wakes cold has an alarm the isolate has not re-armed yet;
`RestoreOutcome::alarm` reports it so the core's residency decisions are not
wrong in the direction of shedding a cell about to fire
(`crates/logic/types.rs:255-267`).

Alarm retry policy is a pure function in `crates/logic/alarm.rs`: after a
handler fails, celld persists an exponential backoff and abandons the alarm
once a bounded number of limit-counting failures accrue. Failures the caller
excuses (e.g. a shed under pressure) back off but never reach the ceiling
(`crates/logic/alarm.rs:3-34`). Retries wait `BACKOFF_BASE_MS (2000 ms) <<
min(retry, 6)`.

## The wake index

Alarms are made durable and found cold via a **wake index** in the bucket. The
key scheme lives in `crates/logic/wake.rs`: entries are `wake/<minute>/<cell>`
keyed at minute precision in UTC, lexicographically ordered so the waker lists
due buckets in order (`crates/logic/wake.rs:28-39`). `parse_entry_key` recovers
the due minute and cell scope; the scope is the one place a scope enters celld
without passing a route, and it still passes the same charset fence a request
does — a bad entry left by an older node is ignored rather than repaired
(`crates/logic/wake.rs:50-57`). The core emits `Effect::ReconcileWakeEntry`
wherever the alarm settles, so the bucket's wake entry stays in line with the
cell's alarm (`crates/logic/types.rs:794-803`).

## WebSocket hibernation

A WebSocket held by a cell is classified by `WebSocketKind`:

- **Hibernatable** — the cell can drop out of memory while the client stays
  connected; a warm wake re-establishes it.
- **Regular** — pins the cell resident; the final events must still run locally
  after a shutdown batch marks the cell quiescing.
- **Outbound** — a transport the cell opened itself with `new WebSocket(url)`;
  it is not hibernatable and pins its cell exactly as a regular one does, but
  it is budgeted because application code creates it at an application-chosen
  rate (`crates/logic/types.rs:390-399`).

A regular or outbound WebSocket pins its resident runtime; its final events
must still run locally after a shutdown batch marks the cell as quiescing
(`crates/logic/types.rs:471-474`). The node-wide outbound pin budget counts
pinned cells, not sockets — one socket is enough to pin a cell — and avoids
shedding the whole eviction pool: `may_pin_outbound` reserves at most 50% of
the ceiling (`crates/logic/pressure.rs:279-297`).

The WebSocket close-code logic (`crates/logic/schedule.rs`) is pure: an
application-selected close wins; a peer 1005 becomes the normal close code
1000; an abnormal transport end receives no frame
(`crates/logic/schedule.rs:23-35`).

---

## Related pages

- [Cells and the lifecycle state machine](/openwiki/concepts/cells.md)
- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Deploying applications and adopting generations](/openwiki/operations/deploying.md)
