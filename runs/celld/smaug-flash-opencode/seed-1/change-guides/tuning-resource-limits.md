---
type: change-guide
title: Change Guide — Tuning Resident-Cell and Memory Limits
description: How to change resident-cell ceilings, activation bounds, eviction/release concurrency, memory shedding thresholds, the V8 heap limit, and how to rebuild the release and lab profiles.
tags: [change-guide, resource-limits, memory, config, tune]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Change Guide: Tuning Resident-Cell and Memory Limits

This guide shows where each tunable in celld's resource-limiting surface lives
in the environment-variable and `Config` source, and how to rebuild the release
or lab binary after a change. It is the companion to the operator-facing
[operations/configuration](../operations/configuration.md) page; here the focus
is where the value is read and how to change the ceiling.

## The Config shape in the decision core

The decision core consumes a `celld_logic::Config` (`crates/logic/types.rs:63`)
with these fields:

- `max_resident` — resident cells plus activation reservations may never exceed
  this.
- `max_activations` — complete nonresident cold routes in flight at once.
- `max_evictions` — evictions that may hold a durability proof in flight at
  once.
- `max_releases` — complete cell handoffs in flight during shutdown.
- `max_outbound_websockets`, `ownership_on_evict`, `require_node_lease`,
  `peer_protocol`, `operation_deadline_ms`, `alarm_resident_ms`,
  `idle_evict_ms`, and `pressure`.

The production actor builds the limits in `crates/celld/actor.rs:2108-2116`; the
runtime reads the environment in `crates/celld/main.rs:3166-3281`.

## Resident-cell ceiling: `CELLD_MAX_RESIDENT_CELLS`

The maximum resident cells is optional. With no value the node has no resident
ceiling (defaults to `usize::MAX`), because the prototype's original default of
eight introduced eviction churn in unconstrained workloads
(`crates/celld/main.rs:3166-3171`). Set it in the environment, e.g.
`CELLD_MAX_RESIDENT_CELLS=1000`. `Config::max_resident` is a hard cap enforced
at admission; a node at the cap refuses more work and holds what it has rather
than shedding a live cell it must place elsewhere.

## Cold-activation concurrency: `CELLD_ACTIVATIONS`

`CELLD_ACTIVATIONS` bounds how many complete nonresident routes may be in
flight at once; a cold request holds a slot across ownership resolution,
capacity waiting, restore, and publish. With no value the node uses available
parallelism capped by `DEFAULT_MAX_CONCURRENT_ACTIVATIONS`
(`crates/celld/main.rs:3271-3277`).

## Eviction and release concurrency: `CELLD_EVICTIONS`, `CELLD_RELEASES`

`CELLD_EVICTIONS` is the number of evictions that may hold a durability proof in
flight at once (the pause that drains a node quickly), defaulting to
`DEFAULT_MAX_CONCURRENT_EVICTIONS`. `CELLD_RELEASES` bounds complete cell
handoffs in flight during shutdown, and the permit remains held through
durability, release, and successor ownership acceptance
(`crates/celld/main.rs:3278-3281`, `crates/logic/types.rs:74-87`).

## Memory-shedding thresholds: `CELLD_MAX_RSS_MB`

Memory-pressure shedding is configured through `PressureConfig`
(`crates/logic/pressure.rs:20`), with `high_bytes` (the ordinary ceiling on the
memory the cells hold) and `rss_hard_bytes` (an absolute cap on the complete
cgroup charge or process RSS fallback). `PressureConfig::from_limits` builds the
watermarks from the total machine/cgroup memory and `CELLD_MAX_RSS_MB`
(`crates/logic/pressure.rs:110-120`). `CELLD_MAX_RSS_MB=0` disables pressure
shedding entirely, and a value at or above the absolute cap (95% of available
memory) makes the cap the effective limit, which logs a warning
(`crates/celld/machine.rs:110-128`).

The `/state` route reports the four input measurements: allocator-adjusted RSS,
active cgroup working set, the complete cgroup charge, and the absolute cap.

## V8 heap limit: `CELLD_V8_HEAP_LIMIT_MB`

The per-isolate V8 heap limit defaults to 128 MB, matching a Durable Object on
Cloudflare. It is read in `crates/celld/env_vars.rs:82-86`, which rejects a
value whose byte count overflows. The limit decides how many hibernatable
WebSocket clients a cell can carry, and an isolate above 90% of the limit
refuses a new hibernatable WebSocket until heap use falls under 90%
(`README.md:297-311`).

## The lifecycle tuning knobs in `Config`

- `CELLD_OPERATION_DEADLINE_MS` (default 15000) bounds a single outstanding
  activation effect (`crates/celld/actor.rs:30-37`).
- `CELLD_IDLE_EVICT_S` gives a long-unused cell back with no pressure involved
  (`crates/celld/actor.rs:2116`).
- `CELLD_ALARM_RESIDENT_MS` (`Event`/`Config::alarm_resident_ms`) keeps a cell
  resident inside an imminent-alarm window so the wake would cost more than the
  residency it saves.
- `CELLD_PRESSURE_OWNERSHIP` selects `release` (default) or `sticky` ownership
  on eviction (`crates/celld/machine.rs:57-67`).
- `CELLD_TTL_MS` (default 10000) sets the node-lease lifetime
  (`crates/celld/machine.rs:53-55`).

All environment parsing goes through `crates/celld/env_vars.rs`, which validates
every typed production variable before the runtime starts so a typo cannot
silently change the configuration of a running node (`crates/celld/env_vars.rs:3-8`).

## Build profiles

`Cargo.toml` defines two tuned profiles (`Cargo.toml:9-31`):

- `release`: fat LTO, `codegen-units = 1`, `opt-level = "s"`, `panic = "abort"`,
  and `strip = true`. Shipped artifacts stay on `release`.
- `lab`: inherits `release` but uses thin LTO, `codegen-units = 16`,
  incremental compilation, `strip = false`, and `debug = "line-tables-only"` so
  `perf` on a node attributes CPU by function. The lab image keeps symbols; the
  shipped release stays stripped.

Rebuild the release binary with `cargo build --release` and the lab image with
`cargo build --profile lab`. The `[profile.dev.package.sha2]` / `rsa` entries
give those crates `opt-level = 3` for the dev profile.

A code or config change to a limit is a rebuild of the `celld` crate; there is
no runtime-reload of these ceilings, so a tuning change goes through a normal
rollout of the node binary.
