---
type: concept
title: Memory management and pressure shedding
description: How celld samples memory (RSS, jemalloc slack, cgroup working set), the two independent pressure latches and their watermarks, the shedding walk down, V8 heap limits, and resident-cell admission caps.
tags: [memory, pressure, shedding, v8-heap, cgroup]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Memory management and pressure shedding

celld must decide when a node is out of memory and must give cells back.
Residency is a separate question: the resident-cell count is a hard cap
enforced at admission, while the pressure classifier answers only "is this
node out of memory and must give cells back to recover?" — "Conflating the
two produced the placement churn and the admission wedge; splitting them is
what keeps each decision small" (crates/logic/pressure.rs#L3-L14).

## Memory sampling

`crates/celld/memory.rs::sample` obtains four measurements in one sampling
turn, because RSS and cgroup memory answer different questions
(crates/celld/memory.rs#L3-L31):

- **RSS** — the resident set size of the process, read from `/proc/self/statm`
  on Linux and `proc_pidinfo` on macOS (crates/celld/memory.rs#L122-L157).
- **in_use_bytes** — RSS minus the pages jemalloc keeps but nothing uses
  (`stats.resident` less `stats.allocated` after advancing the allocator
  epoch) (crates/celld/memory.rs#L164-L178). This is the ordinary pressure
  fallback when no cgroup working set is readable.
- **cgroup_working_set_bytes** — `memory.current` less `inactive_file` from
  `memory.stat`, for a readable Linux memory cgroup
  (crates/celld/memory.rs#L39-L99). It includes active kernel charges that
  process RSS does not report, and it excludes file pages and allocator pages
  that celld cannot return by shedding a cell.
- **cgroup_current_bytes** — the complete `memory.current` charge, the number
  the cgroup limit constrains.

The allocator is tuned at startup: jemalloc's background thread is enabled so
freed pages return even when a node that just shed its working set does not
allocate again. On macOS the thread is unavailable, so the absolute cap is
"the only thing between the process and a kill by the operating system"
(crates/celld/memory.rs#L188-L196).

## Pressure configuration and watermarks

`PressureConfig` (crates/logic/pressure.rs#L19-L44) carries two ceilings,
built once from the environment by the caller — the core never reads the
environment itself:

- **high_bytes** — the ordinary ceiling on the memory the cells hold,
  set by `CELLD_MAX_RSS_MB`. The default is 80% of the available memory
  (`total_memory_bytes / 5 * 4`); `CELLD_MAX_RSS_MB=0` disables it
  (crates/logic/pressure.rs#L151-L177).
- **rss_hard_bytes** — an absolute ceiling of 95% of the available memory on
  the complete cgroup charge, or process RSS when no cgroup is readable. It
  is a fixed share of the machine and never derived from the ceiling — a
  first attempt placed it "at least 125% of the ceiling", which put it at
  exactly 100% of the machine for the default ceiling of 80%, so the floor
  did not exist in the configuration that ships (crates/logic/pressure.rs#L37-L42).
  When the machine size is unknown, the cap falls back to 125% of an
  explicit ceiling (crates/logic/pressure.rs#L148-L150).

A `CELLD_MAX_RSS_MB` value at or above 95% makes the cap the effective
limit, and the node reports that decision at startup because it gives up the
recovery property (crates/logic/pressure.rs#L179-L190;
README.md#L277-L287).

## Two independent latches

Pressure shedding uses two booleans rather than a reported reason
(crates/logic/pressure.rs#L46-L58). Each ceiling engages at its own ceiling
and releases at its own low watermark of 80% of that ceiling
(`low_watermark(ceiling) = ceiling * 4 / 5`; crates/logic/pressure.rs#L228-L230).
The `classify` function folds a sample into the latches and reports the
reason — `memory` or `rss-hard` — with the hard cap reported first because
it is the more serious (crates/logic/pressure.rs#L192-L219).

The two latches are deliberately independent: "a crossing of one limit does
not hold the node against the other" (README.md#L293-L295). Deriving one
latch from the other would let a crossing of the ordinary ceiling hold the
node on a resident-set watermark, or a hard-cap crossing hold it on a ceiling
it never crossed (crates/logic/pressure.rs#L194-L202).

The **resume line** a walk down must reach is 80% of the ceiling for the
metric being walked, and the walk chooses `Metric::InUse` whenever the
ordinary ceiling is latched, because eviction relieves the ordinary ceiling
and may do nothing at all for the cap (crates/logic/pressure.rs#L248-L269).
The shedding target is a proportion of what was measured: the node sheds
about one tenth of its resident cells per pass
(`release_target`, crates/logic/pressure.rs#L271-L277).

## The shedding walk down

Under pressure, celld durably replicates and fences the least-recently-used
idle cells, publishes them as unowned without resetting their epochs, and
refuses to reacquire new unowned cells. It does not shed a cell with active
work or a live host WebSocket. A spare node receives no assignment; it
acquires a released cell through the same bucket protocol when normal traffic
reaches it. Each limit releases separately at 80% of its value
(README.md#L288-L295).

`max_evictions` bounds how many evictions may hold a durability proof in
flight at once. A proof is a round trip to the bucket, so draining a node one
cell at a time would refuse admission for minutes while it walks down; the
bound is what makes the walk down finish in a time anyone can reason about
(crates/logic/types.rs#L74-L80).

The `/state` route reports all four input measurements
(README.md#L275).

## Resident-cell admission caps

`Config::max_resident` (`CELLD_MAX_RESIDENT_CELLS`) is a hard cap on
resident cells plus activation reservations, enforced at admission
(crates/logic/types.rs#L63-L67; crates/logic/pressure.rs#L8-L12). Residency
deliberately has no watermark — it is capped at admission. When the node is
below the watermarks again, `has_headroom` is the stricter state a rollout
uses: a node can be below the high watermark without enough room to absorb a
donor (crates/logic/pressure.rs#L232-L242).

## The V8 heap limit

Each isolate also has a V8 heap limit, separate from the memory of the node.
The default is 128 MB and matches the limit of a Durable Object on
Cloudflare; set `CELLD_V8_HEAP_LIMIT_MB` to change it
(README.md#L297-L299). Each hibernatable WebSocket client holds state in the
heap, so the limit decides how many clients a cell can carry: approximately
50,000 at the default. An isolate above 90% of the limit refuses a new
hibernatable WebSocket, an isolate at the limit stops materializing a SQL
result set, and an isolate serves again when heap use falls under 75% of the
limit; celld forces a collection for an idle isolate that holds a dead heap
(README.md#L304-L311). The environment validator rejects a
`CELLD_V8_HEAP_LIMIT_MB` whose byte size overflows
(crates/celld/env_vars.rs#L82-L86).

## Outbound WebSocket pin budget

The memory system also bounds the cells that an outbound WebSocket can pin
resident, because a pinned cell is removed from the eviction pool: at most
50% of the resident cap, counted in pinned cells rather than sockets, and
never rounded below one (crates/logic/pressure.rs#L279-L296).
