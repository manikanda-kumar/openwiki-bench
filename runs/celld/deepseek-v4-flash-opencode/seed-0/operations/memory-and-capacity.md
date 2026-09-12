---
type: operations
title: Memory Pressure and Capacity
description: How a node decides it can and cannot hold more work — the resident-cell cap and activation limits, the memory-pressure classifier with hysteresis latches, cgroup versus RSS measurement, V8 heap limits, and hot-cell overload admission.
tags: [memory, pressure, capacity, shedding, v8-heap, overload]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Memory Pressure and Capacity

A node must decide both whether it can hold another cell and whether it is
running out of memory. These are two different questions, and the code
splits them: residency is a hard cap enforced at admission, while memory
pressure is a resource-aware classifier that walks the node back down
(crates/logic/pressure.rs#L3-L14).

## Resident and activation limits

- `CELLD_MAX_RESIDENT_CELLS` — the hard cap on resident cells, enforced at
  admission. A cell that cannot be admitted waits behind the capacity gate
  and the core sheds a victim to make room
  (crates/logic/types.rs#L63-L66).
- `CELLD_ACTIVATIONS` — the limit on concurrent nonresident cold routes
  (ownership resolution, restore, and publish), so a storm of cold starts
  cannot swamp the node (crates/logic/types.rs#L64-L71).

The isolate pool adds a per-isolate ceiling (`max_cells`): cells share one
V8 heap, and a heap that holds too many of them is a single OOM taking
every cell in it down together, so the bound has to be per-isolate
(crates/logic/isolate.rs#L77-L87).

## The memory measurement

Process RSS and cgroup memory answer different questions. RSS describes
the process, while `memory.current` is the complete charge the kernel
constrains, and `memory.stat` identifies inactive file pages the kernel can
reclaim, so the ordinary pressure measurement does not treat that cache as
a cell working set (crates/celld/memory.rs#L3-L10).

- The **ordinary** measurement is the greater of allocator-adjusted RSS
  and the allocator-adjusted active cgroup working set (`memory.current`
  minus `inactive_file`). The allocator adjustment subtracts the pages
  jemalloc keeps but no cell uses (`stats.resident` less `stats.allocated`),
  so a node that sheds its whole working set is not latched on an RSS
  number the allocator controls (crates/celld/memory.rs#L164-L178,
  crates/logic/pressure.rs#L95-L108).
- The **hard** measurement is the complete `memory.current` charge, with
  process RSS as the fallback when no cgroup is readable
  (crates/logic/pressure.rs#L110-L114).

## The pressure classifier

`PressureConfig` is built from the machine and `CELLD_MAX_RSS_MB`:
`high_bytes` is the ordinary ceiling (default 80% of the available
memory), and `rss_hard_bytes` is an absolute cap at 95% of the available
memory — never derived from the ceiling, because a derived cap either
lands above the machine (never fires) or below the ceiling (fires first on
every sample). When the machine size is unknown, the cap falls back to
125% of an explicit ceiling (crates/logic/pressure.rs#L133-L177).
`CELLD_MAX_RSS_MB=0` disables pressure shedding altogether, and the node
reports when a ceiling sits at or above the cap so the cap becomes the
effective limit (crates/logic/pressure.rs#L179-L190).

The classifier folds each sample into two hysteresis **latches**, each
engaging at its own ceiling and releasing at its own low watermark of 80%
of that ceiling. Keeping the latches separate means one crossing cannot
hold the node against the other's watermark. The hard cap is reported
first because it is the more serious of the two
(crates/logic/pressure.rs#L192-L230).

## Shedding

When a latch holds, the node stops growing its isolate pool, refuses
nothing it must answer, and walks down: the core evicts least-recently
used idle cells after proving their replicas durable and fencing them,
publishes them unowned without resetting their epochs, and refuses to
reacquire new unowned cells (README.md#L288-L295). The walk has a stopping
condition — it targets 80% of the latched ceiling (`resume_line`) and
releases at the low watermark — so a ceiling below the process's memory
floor cannot cut the working set to zero (crates/logic/lib.rs#L4696-L4730).

A node over its memory ceiling may keep serving on the isolates it already
has, but must not build another; growth is still allowed when there is
nothing to place onto, because an isolate the node cannot build is a
request it cannot answer at all (crates/logic/isolate.rs#L144-L163).

## V8 heap limits

Each isolate also has a V8 heap limit, separate from the memory of the
node. The default is 128 MB, matching the limit of a Durable Object on
Cloudflare; set `CELLD_V8_HEAP_LIMIT_MB` to change it. Each hibernatable
WebSocket client holds state in the heap, so the limit decides how many
clients a cell can carry: approximately 50,000 at the default
(README.md#L297-L302).

An isolate above 90% of this limit refuses a new hibernatable WebSocket
and stops materializing a SQL result set; both errors name the heap. celld
measures the heap before each event, and the isolate serves again when the
use falls under 75% of the limit; an idle isolate's dead heap is forced to
collect when a measurement is above that share
(README.md#L304-L311).

## Hot-cell overload

celld admits a maximum of 64 concurrent fetch events for one Durable
Object or Queue broker (`CELLD_MAX_CELL_REQUESTS`). It returns HTTP 503
when the target reaches this limit and does not start the excess event;
the response carries `Retry-After: 1` and `X-Celld-Overload: cell` so the
application can retry or reject the work, and a local or remote Queue
owner uses the same status and headers when it refuses producer admission
(docs/README.md#L638-L651). The runtime writes a `cell_overload_refused`
log event with the cell scope, node, region, in-flight count, and limit
(docs/README.md#L653-L656).

## The outbound-WebSocket pin budget

An outbound socket is not hibernatable, so eviction refuses its cell for
as long as it is open — every pinned cell is removed from the eviction
pool. The pin budget is node-wide, counted in pinned *cells* (one socket
is enough to pin), and capped at 50% of the resident ceiling so a resource
walk down always has something to nominate
(crates/logic/pressure.rs#L279-L297).
