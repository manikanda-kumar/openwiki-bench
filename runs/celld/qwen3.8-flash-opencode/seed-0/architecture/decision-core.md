---
type: architecture
title: Sans-I/O decision core (celld-logic)
description: crates/logic holds every behavioral decision of celld as pure functions over a replayable State — on_event consumes Events and emits Effects, all I/O belongs to adapters, and each policy (gates, routing, restore, pressure, wake, alarm, cron, KV, Queue) is a small falsifiable module.
tags: [sans-io, decision-core, policy, determinism, celld-logic]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-e5ac10d305aff4ea0756b67b
    resource: repo://crates/logic/alarm.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-4e2df396109dfd4edefa6079
    resource: repo://crates/logic/drain.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-5139cf45e1183dbe26084038
    resource: repo://crates/logic/http.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-9f6270d214b8ff6c345f5424
    resource: repo://crates/logic/log_evict.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Sans-I/O decision core (celld-logic)

`celld-logic` is the pure decision core of the engine. Its crate header states
the contract: `on_event` is the only way behavioral state advances; the
production executor and a deterministic simulator both feed it events and
perform the returned effects; no adapter may mutate `State` directly
([crates/logic/lib.rs#L3-L8](repo://crates/logic/lib.rs#L3-L8)). The crate has
no dependencies — no async, I/O, clocks, randomness, or locks
([crates/logic/Cargo.toml#L8-L11](repo://crates/logic/Cargo.toml#L8-L11)) — so
the same code replays identically under any executor. The shell that runs it is
described in [actor and execution boundary](actor-execution.md).

## The vocabulary: Event in, Effect out, State between

`crates/logic/types.rs` holds "the vocabulary the core is written in":
everything is data, `Event` is the only way in, `Effect` the only way out, and
no decision is made in that file — that is `State` in the crate root
([crates/logic/types.rs#L3-L8](repo://crates/logic/types.rs#L3-L8)). Ids are
flat scalars (`CellId`, `NodeId`, `RequestId`, `OpId`, `Epoch`)
([crates/logic/types.rs#L11-L17](repo://crates/logic/types.rs#L11-L17)).
Inputs cover requests, timers, and every adapter completion
(`OwnerRead`, `OwnerCasCompleted`, `RestoreCompleted`, `DurableReached`,
`NodeLogRecovered`, …) ([crates/logic/types.rs#L402](repo://crates/logic/types.rs#L402));
outputs name the I/O the shell must perform — `ReadOwner`/`CasOwner`,
`CasNodeLease`, `Restore`, `StartRuntime`/`StopRuntime`, `Publish`,
`AwaitDurable`, `Release`, `ScheduleTimer`, `Halt`
([crates/logic/types.rs#L740](repo://crates/logic/types.rs#L740)).

`on_event` first folds the event's timestamps into the state's notion of now
(`state.now_mono_ms = max(...)`) — the core never reads a clock; time arrives as
data ([crates/logic/lib.rs#L5215-L5222](repo://crates/logic/lib.rs#L5215-L5222)).

`State` is one authoritative struct: cell phases, request pins, durability
barriers, activation/eviction permits, and a FIFO capacity-waiter queue
([crates/logic/lib.rs#L486-L560](repo://crates/logic/lib.rs#L486-L560)). Two
design commitments show up in its fields:

- **Bounds live in the replayable machine, not in executor bookkeeping.**
  Activation and eviction permits are explicit sets, and capacity waiting is
  FIFO "in arrival order" so a waiter with `k` waiters ahead is admitted within
  `k` releases — "the queue converts 'eventually, probably' into a bound"
  ([crates/logic/lib.rs#L536-L552](repo://crates/logic/lib.rs#L536-L552)).
- **Management views are projections, never second inventories.**
  `PresenceSnapshot`/`ActivitySnapshot` replay to the same values for the same
  events, kept beside the cell's epoch so callers can identify the exact
  fenced runtime ([crates/logic/types.rs#L19-L46](repo://crates/logic/types.rs#L19-L46)).

Debug builds exploit this by calling `State::validate` after every event — a
model-checking assertion over ceilings like the resident bound and the
eviction-permit bound ([crates/logic/lib.rs#L1073-L1090](repo://crates/logic/lib.rs#L1073-L1090),
[crates/celld/actor.rs#L2792-L2795](repo://crates/celld/actor.rs#L2792-L2795)).

## The reified policy modules

The `logic/*.rs` files are individual policies "reified sans-IO": predicates
and transitions the shell must consult, kept small enough to reason about.
Each pairs a pure decision with an executor that owns the bytes:

| Module | Decision it owns |
| --- | --- |
| [gate.rs](repo://crates/logic/gate.rs#L3-L56) | The per-cell input gate for `blockConcurrencyWhile`: while held, no *new* event is delivered; it never queues (the shell's job channel is the queue) and `acquire` cannot fail because delivery points check `is_open` first |
| [output_gate.rs](repo://crates/logic/output_gate.rs#L3-L63) | The single egress choke point: nothing revealing cell state leaves while a write is unproven; `Channel` enumerates every route and `State::output` applies one rule to all of them (details in [durability and fencing](../concepts/durability-and-fencing.md)) |
| [schedule.rs](repo://crates/logic/schedule.rs#L3-L14) | Cell-isolate dispatch: a fetch takes the resident-isolate fast path only when the isolate is idle, never nested; plus small sequencing choices like the WebSocket echo close code |
| [isolate.rs](repo://crates/logic/isolate.rs#L3-L27) | Pool policy over observed load, separating **turns** (CPU demand, released across awaits) from **requests** (heap affiliation that pins later turns to the same isolate) |
| [routing.rs](repo://crates/logic/routing.rs#L3-L59) | Whether a failed peer forward may be re-sent: `NeverConnected`/`NotOwner` get one retry each, `Ambiguous` never, protecting at-most-once execution |
| [restore.rs](repo://crates/logic/restore.rs#L3-L29) | The durability choice among restore sources; e.g. a previous-epoch eviction snapshot is reusable only when the cell was *not* taken over from another node |
| [wake.rs](repo://crates/logic/wake.rs#L3-L8) | Alarm-wake entry reconciliation plus the bucket wake key scheme (`entry_key`/`parse_entry_key`, [wake.rs#L37-L58](repo://crates/logic/wake.rs#L37-L58)), shared so a production S3 flusher and a deterministic fake cannot diverge |
| [alarm.rs](repo://crates/logic/alarm.rs#L3-L34) | Retry backoff after handler failure: 2 s base doubling to a 64 s cap, abandoned at 6 limit-counting failures; excused failures (shedding) back off without counting |
| [cron.rs](repo://crates/logic/cron.rs#L3-L11) | When cron triggers fire: one-minute resolution in UTC, matching Cloudflare and the wake index's minute buckets |
| [kv.rs](repo://crates/logic/kv.rs#L3-L12) | KV addresses and published bounds; validation deliberately lives in JS because a Rust host op costs more than D1 set the bar |
| [queue.rs](repo://crates/logic/queue.rs#L3-L12) | Queue policy: bounds, lease-generation advancement, retry timing, settlement fencing, config validation — lease generation travels in `PlannedLease` so a caller cannot forget to advance it |
| [peer.rs](repo://crates/logic/peer.rs#L3-L37) | Signed-request security fences: identity charset, two-sided clock window, replay-cache retention ≥ the window |
| [http.rs](repo://crates/logic/http.rs#L3-L19) | Whether the request authority may reach `request.url` at all — a structural fence so a hostile `Host` cannot make every Worker request throw in `new URL(...)` |
| [cell.rs](repo://crates/logic/cell.rs#L3-L46) | Cell-scope validity: charset excludes `/` and `\` and rejects `.`/`..`, because the scope becomes a path component and a bucket key; 255-byte bound is the fleet-wide `NAME_MAX` guarantee |
| [pressure.rs](repo://crates/logic/pressure.rs#L3-L16) | The memory-shedding latch as a pure classifier of a sample plus prior state; residency is *not* here — it is a hard cap enforced at admission, and conflating the two once caused placement churn |
| [drain.rs](repo://crates/logic/drain.rs#L3-L18) | Fleet drain-token claims and the first-readiness gate; the token is advisory — every failure path degrades to the pre-token behavior, never worse |
| [cache.rs](repo://crates/logic/cache.rs#L3-L16) | Snapshot-cache eviction: the cache is pure optimization over bucket-authoritative state, so plain LRU is provably enough |
| [sweep.rs](repo://crates/logic/sweep.rs#L3-L12) | The shared 256-row bound for cell-owned reclamation, so no new cell-backed feature can pick an unbounded cleanup loop |
| [sqlite.rs](repo://crates/logic/sqlite.rs#L3-L29) | When SQLite engine failure poisons the actor: a critical code (`FULL`/`IOERR`/`NOMEM`/`INTERRUPT`) coinciding with a destroyed transaction |
| [dead_node_reconciliation.rs](repo://crates/logic/dead_node_reconciliation.rs#L3-L8) | Retiring `node-cells/` markers left by dead historical generations, with bounded retry |

The module headers record their own history — deleted siblings, wedges, and
rejected designs — which is where the rationale for each boundary lives
(for example the input gate's "why acquiring cannot fail"
([gate.rs#L39-L53](repo://crates/logic/gate.rs#L39-L53))).

## Two facts about the log-tier modules

`log_tier.rs` (per-node WAL streamed to a follower ensemble, with the bucket
record `log/<node>.json` as CAS-guarded membership root) and `log_evict.rs`
(gray-follower eviction so one slow follower cannot stall every ack) carry a
header that calls the tier "design stage; not yet wired into the engine"
([crates/logic/log_tier.rs#L3-L4](repo://crates/logic/log_tier.rs#L3-L4)).
**The current code contradicts that comment**: the shipped in-fleet log tier
for `CELLD_DURABILITY=fleet` lives in the shell's `crates/celld/node_log.rs`,
which states "The decisions are `celld_logic::log_tier`; this module is their
executor" ([crates/celld/node_log.rs#L16-L18](repo://crates/celld/node_log.rs#L16-L18))
and calls those decisions directly — `FollowerLog` as "the shipping decision"
([crates/celld/node_log.rs#L981-L984](repo://crates/celld/node_log.rs#L981-L984)),
`ack_fleet_allowed`, `takeover_gate`, `start_recovery`, `finish_recovery`
([crates/celld/node_log.rs#L2562-L2582](repo://crates/celld/node_log.rs#L2562-L2582),
[crates/celld/node_log.rs#L3146-L3147](repo://crates/celld/node_log.rs#L3146-L3147)).
`log_evict`'s policy is built from the environment by
`node_log::eviction_policy_from_env`
([crates/celld/node_log.rs#L208-L210](repo://crates/celld/node_log.rs#L208-L210)).
Treat the wiring, not the stale header, as the fact; the mechanics are on
[durability and fencing](../concepts/durability-and-fencing.md).

## Why the core exists

`docs/testing.md` describes the payoff: because "the clock, the randomness,
and the object store are interfaces, and a simulator drives the core," the
coordination protocol can be replayed under adversarial deterministic
schedules, with seeds kept until a bug is dead
([docs/testing.md#L87-L103](repo://docs/testing.md#L87-L103)). The simulator,
the TLA+ specifications, and their corpus are **not present in this repository
snapshot** — the shell only compiles them in via `include!(env!("CELLD_..."))`
under `cfg(celld_internal_tests)`
([crates/celld/lib.rs#L299-L317](repo://crates/celld/lib.rs#L299-L317)). Within
this repository the core's determinism is exercised by the per-event
`State::validate` assertions in debug builds and by the shape of the API
itself.

Related: [architecture hub](../architecture.md) ·
[actor and execution boundary](actor-execution.md) ·
[cell lifecycle](../concepts/cell-lifecycle.md) ·
[durability and fencing](../concepts/durability-and-fencing.md)
