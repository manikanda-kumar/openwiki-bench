---
type: operations
title: Configuration, limits, and memory pressure
description: Environment-variable configuration, isolate admission ceilings, memory-pressure thresholds and caps with cgroup working-set math, and overload handling.
tags: [configuration, limits, memory, pressure, shedding]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Configuration, limits, and memory pressure

## Configuration source of truth

The `docs/README.md` environment-variable table is the user-facing
contract: unset variables select their documented defaults, boolean
variables accept only `0` or `1`, and a supplied invalid value stops
startup (repo://docs/README.md#L703-L708). Two layers enforce this —
env parsing in `crates/celld/machine.rs` (`lease_ttl_ms_from_environment`,
`ownership_on_evict_from_environment`, `pressure_config_from_environment`,
`local_cache_max_bytes_from_environment`,
repo://crates/celld/machine.rs#L53-L131) and the boolean/positive helpers
in `crates/celld/env_vars.rs` (repo://crates/celld/env_vars.rs#L16-L36).

Key operational variables from the table (repo://docs/README.md#L665-L702):

| variable | effect (grounded) |
| --- | --- |
| `CELLD_BUCKET` | Fleet bucket and key prefix, same as `--bucket`. Sized to the fleet, credential-locked |
| `CELLD_ADDR` / `CELLD_INTERNAL_ADDR` / `CELLD_ADVERTISE` | Master bind and advertise addresses (same as CLI flags) |
| `CELLD_TTL_MS` | Lease lifetime, default 10000 ms, renewed after one third |
| `CELLD_MAX_RESIDENT_CELLS` | Hard resident-cell limit enforced at admission |
| `CELLD_MAX_RSS_MB` | Pressure threshold; default 80% of available memory, 0 disables the threshold *and* the absolute cap |
| `CELLD_MAX_CELL_REQUESTS` | Concurrent fetch limit per DO/queue broker (default 64) |
| `CELLD_MAX_REQUEST_BODY_BYTES` | Body limit (default 1 GiB) |
| `CELLD_ACTIVATIONS` | Concurrent cold-cell activations (default: min(available CPU count, 128)) |
| `CELLD_DURABILITY` | `bucket` or `fleet` proof mode, default `fleet` |
| `CELLD_OPERATION_DEADLINE_MS` | Non-restore op deadline (default 15000) |
| `CELLD_V8_HEAP_LIMIT_MB` | Per-isolate V8 heap limit, default 128 MB (repo://README.md#L297-L303) |

## Admission ceilings

The decision core owns admission: `isolate.rs::admit(load, shedding)`
refuses placement when the pool is at a ceiling, with `Refusal` variants
that distinguish loaded and shedding refuses. `place()` and `place_cell()`
pick the placement; pool limits (`PoolLimits`) carry the per-worker and
per-cell capacities (repo://crates/logic/isolate.rs#L33-L248).

The configurable knobs include `CELLD_MAX_LOADED_WORKERS` (default 256
concurrent loaded workers), `CELLD_MAX_STATELESS_ISOLATES`,
`CELLD_MAX_CELL_REQUESTS` (default 64 concurrent fetch events per target):
(repo://docs/README.md#L682-L693).

## Overload behavior

At the limit, celld refuses work rather than tail-dropping silently:

> celld admits a maximum of 64 concurrent fetch events for one Durable
> Object or Queue broker. Set `CELLD_MAX_CELL_REQUESTS` to use a different
> positive limit. celld returns HTTP status `503` when the target reaches
> this limit, and it does not start the excess event. The response
> contains `Retry-After: 1` and `X-Celld-Overload: cell`.

(repo://docs/README.md#L640-L652)

The runtime also emits a `cell_overload_refused` log event with the cell
scope, node, region, in-flight count, and limit. Count these responses
separately from transport errors and application failures.
(repo://docs/README.md#L652-L658).

## Memory pressure: two thresholds, one metric bundle

Two release limits apply to a node's memory: a per-node pressure
threshold (default 80% of *available* memory, override with
`CELLD_MAX_RSS_MB`) and a separate absolute cap at 95% of the available
memory that protects the node when shedding cannot release a kernel
charge (repo://README.md#L276-L284).

The measurement is deliberately nuanced because process RSS and cgroup
memory answer different questions:

> In a Linux cgroup, the threshold uses the greater of the allocator-
> adjusted RSS and the active cgroup working set. celld calculates the
> working set as `memory.current` less `inactive_file` from `memory.stat`,
> then it removes the measured allocator slack. This calculation includes
> active kernel charges that process RSS does not report, and it excludes
> file pages and allocator pages that celld cannot return by shedding a
> cell. The `/state` route reports all four input measurements: RSS,
> cgroup current, cgroup working set, and the allocator-adjusted in-use.

(repo://README.md#L267-L282, grounded in repo://crates/celld/memory.rs#L14-L30)

The jemalloc `stats` feature is what makes this workable: it makes
`stats.allocated` and `stats.resident` readable, so the *difference*
yields the allocator slack the cells actually use — without it a node
that shed its whole working set stays latched on an RSS number the
allocator controls (repo://Cargo.toml#L86-L92 the tikv-jemalloc-ctl
comment).

`CELLD_MAX_RSS_MB=0` disables both the threshold and the cap. When the
available-memory size cannot be read, an explicit threshold triggers a cap
of 125% of that threshold (repo://README.md#L284-L288). Each limit
releases at 80% of its own value, so crossing one limit does not hold the
node against the other (repo://README.md#L291-L296).

## Pressure decisions live in the core

The decision core latches and classifies node load to decide *when* to
shed and *which* cells:

> `pressure.rs` classifies a `Load` sample against a `PressureConfig`,
> producing an updated `Latches` set and a label, with release thresholds
> and headroom checks; `release_target(resident_cells)` and
> `walk_metric(latches)` drive release sequencing.

(repo://crates/logic/pressure.rs#L151-L263)

Under pressure, a node does not shed arbitrarily:

> Under pressure, celld durably replicates and fences the
> least-recently-used idle cells, publishes them as unowned without
> resetting their epochs, and refuses to reacquire new unowned cells. It
> does not shed a cell with active work or a live host WebSocket.

(repo://README.md#L288-L297)

The result: a spare node receives no assignment; it acquires a released
cell through the ordinary bucket protocol when traffic reaches it.

## V8 heap limit

Independent from node memory, each isolate carries a V8 heap limit —
default 128 MB, matching a Cloudflare Durable Object; `CELLD_V8_HEAP_LIMIT_MB`
changes it. An isolate above 90% refuses a new hibernatable WebSocket and
halts SQL result-set materialization at the same threshold; healthy at
under 90%; celld forces a collection when the idle heap measurement is
above 75% of the limit (repo://README.md#L297-L312).

## Operational tuning switches

Remaining documented knobs: `CELLD_LTX_*` compaction and truncate
defaults (see [Durability and replication]),
`CELLD_LOG_CAPTURE_WORKERS` (default 8), `CELLD_LOG_PIPELINE` (default 4
fleet-log rounds in flight), `CELLD_LOG_HEDGE_MS` (adaptive default: 4x
the slowest recent append, at least 250 ms, always below the eviction
backstop; 0 disables the second copy)
(repo://docs/README.md#L691-L694). The help output shows the advanced
tuning switches and their defaults; an unset variable selects its
documented default (repo://docs/README.md#L703).
