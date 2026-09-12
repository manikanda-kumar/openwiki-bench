---
type: runtime
title: Resident capacity, pressure shedding, and overload
description: The three separate resource decisions — a hard resident-cell cap at admission, a memory-pressure classifier with hysteresis that sheds idle cells, and per-cell request admission — plus the V8 heap limit.
tags: [pressure, memory, admission, shedding, capacity]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Resident capacity, pressure shedding, and overload

One node holds three resource decisions, and the code deliberately
**separates** them:

## Resident-cell limit: a hard cap at admission

`crates/logic/pressure.rs` states the ownership: "Residency is
deliberately *not* here... A node's cell count is a hard cap enforced at
admission, self-limiting and known exactly; it is not a resource that
needs a proactive walk down." Conflating the cap with a shed decision
"produced the placement churn and the admission wedge; splitting them is
what keeps each decision small"
[crates/logic/pressure.rs](repo://crates/logic/pressure.rs#L3-L18).

The cap is `CELLD_MAX_RESIDENT_CELLS`: "The hard limit for resident
cells, enforced at admission" — set via
`CELLD_MAX_RESIDENT_CELLS=1000 celld --bucket ...`
[docs/README.md](repo://docs/README.md#L686-L689)
[README.md](repo://README.md#L259-L264).

## Pressure classification: threshold, hysteresis, and a cap

`crates/celld/memory.rs` is the measurement. Its doc: "Process RSS and
cgroup memory answer different questions. RSS describes the process,
while `memory.current` is the complete charge the kernel constrains.
`memory.stat` identifies inactive file pages the kernel can reclaim, so
the ordinary pressure measurement does not treat that cache as a cell
working set." One sampling turn returns an intact relationship of
`rss_bytes`, `in_use_bytes` (RSS minus allocator slack,
allocator-adjusted), `cgroup_working_set_bytes`, and `cgroup_current_bytes`
[crates/celld/memory.rs](repo://crates/celld/memory.rs#L3-L49).

The Linux cgroup read covers both cgroup v1 and v2 layouts —
`/sys/fs/cgroup/memory.current` + `memory.stat`'s `inactive_file`, or the
v1 paths `memory.usage_in_bytes` + `total_inactive_file`; on a
non-Linux OS there is no cgroup measurement
[crates/celld/memory.rs](repo://crates/celld/memory.rs#L41-L64).

The classifier itself (`crates/logic/pressure.rs`, sans-I/O) is pure —
"no I/O, no clock" — configured once from the environment at the edge:
[crates/logic/pressure.rs](repo://crates/logic/pressure.rs#L3-L15)

- `high_bytes`: "The ceiling on the memory the cells hold. This is the
  ordinary limit, and `CELLD_MAX_RSS_MB` sets it." It applies to
  allocator-adjusted RSS and to the active cgroup working set after the
  same adjustment "so a node can recover after a free."
- The **absolute cap**: 95% of available memory (or process RSS when no
  readable cgroup exists). "It is a fixed share of the machine and is
  never derived from `high_bytes`." The docs record the bug history: a
  first attempt placed it at "at least 125% of the ceiling", which put it
  above anything the kernel would let the process reach for the default
  80% ceiling [crates/logic/pressure.rs](repo://crates/logic/pressure.rs#L30-L40).

## The documented memory-pressure behavior

From the README's operating section
[README.md](repo://README.md#L267-L311):

- Default threshold: 80% of available memory; `CELLD_MAX_RSS_MB` sets
  it; `0` disables both the threshold and the cap. In a Linux cgroup the
  threshold uses the greater of allocator-adjusted RSS and the active
  cgroup working set ("memory.current less inactive_file from
  memory.stat, then [it] removes the measured allocator slack"),
  including kernel charges RSS does not report and excluding pages
  shedding cannot return. `/state` reports all four measurements.
- A separate cap applies at 95% of available memory, using process RSS
  when a cgroup charge cannot be read; it protects the node "when
  shedding cannot return a kernel charge"; the node logs a warning when
  the cap applies.
- **Hysteresis**: shedding releases at 80% of the threshold's value, and
  the cap releases at 80% of its value, "so a crossing of one limit does
  not hold the node against the other."
- Shed targets: under pressure, celld "durably replicates and fences the
  least-recently used idle cells, publishes them as unowned without
  resetting their epochs, and refuses to reacquire new unowned cells".
  It does not shed a cell with active work or a live host WebSocket.
- When the available memory cannot be measured, a cap of 125% of an
  explicit threshold applies.
- Readiness inherits the same pressure low waters (see
  [first-readiness](/openwiki/operations/node-cli.md)).

## Per-cell request admission (overload)

A separate limit protects one hot cell from hoarding the node
[docs/README.md](repo://docs/README.md#L640-L655):

- "celld admits a maximum of 64 concurrent fetch events for one Durable
  Object or Queue broker. Set `CELLD_MAX_CELL_REQUESTS` to use a
  different positive limit."
- Reaching the limit returns HTTP **503** **without starting** the
  excess event, with `Retry-After: 1` and `X-Celld-Overload: cell`. A
  Queue owner refuses producer admission with the same status and
  headers, body `{"error":"cell admission refused"}` — a fixed-rate
  client must count it as **rejected work**, so an immediate retry does
  not increase the configured offered rate.
- The runtime emits a `cell_overload_refused` structured event (cell
  scope, node, region, in-flight count, limit), which must be counted
  separately from transport errors and application failures.

## V8 heap limit (per isolate)

Separate from node memory, each isolate has a **V8 heap limit**:

- Default 128 MB, "it matches the limit of a Durable Object on
  Cloudflare"; `CELLD_V8_HEAP_LIMIT_MB` changes it.
- It decides hibernatable WebSocket capacity: approximately 50,000
  clients at 128 MB, approximately 512 MB for 100,000.
- Above 90% of the limit an isolate refuses a new hibernatable
  WebSocket, and re-accepts when under 90%; at the limit it also stops
  materializing a SQL result set ("both errors name the heap").
- celld measures the heap before each event and re-serves when under
  75% of the limit; an idle isolate holding a dead heap forces a
  collection above that share, so a restart is unnecessary
  [docs/README.md](repo://docs/README.md#L297-L311).

## Why terrain is a classifier, not a loop

The design note ends: "The env read that builds the config stays at the
edge (`main.rs`), and so does the measurement, which has to ask both the
operating system and the allocator" — the pure core never reads the
environment or the OS directly
[crates/logic/pressure.rs](repo://crates/logic/pressure.rs#L3-L15).

## Related pages

- [Cell lifecycle](/openwiki/runtime/cell-lifecycle.md) — what "resident"
  and "idle" mean.
- [Configuration](/openwiki/operations/configuration.md) — the knobs
  above and their interplay rules.
- [Observability](/openwiki/operations/observability.md) — how pressure
  state is reported.
