---
type: decision-core
title: The decision core (celld-logic)
title_safe: The decision core (celld-logic)
description: How behavioral state advances through the deterministic celld-logic crate — Events, Effects, the no-IO purity contract, and how the production executor and simulator both drive it.
tags: [architecture, decision-core, actor, events, effects, simulation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-9f6270d214b8ff6c345f5424
    resource: repo://crates/logic/log_evict.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# The decision core (celld-logic)

`crates/logic` owns all behavioral state and decisions in celld. Its contract
is stated in the crate root and enforced by the workspace layout:

> [`on_event`] is the only way behavioral state advances. The production
> executor and deterministic simulator both feed it events and perform the
> returned effects. No adapter may mutate [`State`] directly.

(repo://crates/logic/lib.rs#L3-L7)

The Cargo manifest backs this with the environment the core is allowed to
touch: **no async, I/O, clocks, randomness, locks, or dependencies** — the
package is declared `[lib] test = false` with no dependencies at all
(repo://crates/logic/Cargo.toml#L10-L14). Every decision is therefore a pure
function of `(State, Event) -> Effects`, which is what makes the same core
reusable by the production daemon and by the seeded deterministic simulator
<!-- openwiki: broken internal link [/validation/testing-strategy.md] file "/validation/testing-strategy.md" does not exist. Fix the href or restore the target, then delete this comment. -->
used for testing (see [Testing strategy](/validation/testing-strategy.md)).

## The core signature

```rust
pub fn on_event(state: &mut State, event: Event) -> Vec<Effect>
```

(repo://crates/logic/lib.rs#L5215-L5215)

`on_event` first folds the event's clocks into `State` — wall-clock `now_ms`
and monotonic `now_mono_ms` are advanced with a `.max()` so clock regressions
never fold backwards (repo://crates/logic/lib.rs#L5205-L5214) — and then
dispatches the event to the matching state handler, which both mutates state
and appends zero or more effects.

## Events

`Event` is the complete sensor vocabulary the executor can report. It
spans node-level lifecycle (lease acquisition, CAS completion, fencing),
cell activation and durable outputs, alarms, WebSockets, queue broker
traffic, cron scheduling, pressure telemetry, and reload/generation
changes. Representative variants:

- `StartNodeLease` with the spec and both clocks; the event carries
  `now_mono_ms` explicitly because the initial lease's TTL must anchor at
  boot time, not at the process'a originating zero
  (repo://crates/logic/types.rs#L403-L411).
- `Request` / `RequestAt` / `CapacityRequestAt` / `HandoffRequestAt` —
  ordinary ingress, capacity-refused ingress, and takeover-driven ingress,
  each sampled differently (repo://crates/logic/types.rs#L441-L470).
- `Output { request, channel, position }` — a response leaving the process,
  the input side of the output gate; `position = Some(..)` when the event
  advanced the cell's committed WAL and the output must wait on a matching
  durability-proof barrier, `None` when the event was read-only
  (repo://crates/logic/types.rs#L500-L514).
- `DurableReached { op, result, source }` — the completion side of a
  durability proof, with a `ProofSource` that decides whether the fleet or
  bucket acknowledgement fence applies
  (repo://crates/logic/types.rs#L516-L528).

The full list also includes `TimerFired`, `ReadOwner`/lease-read results,
`NodeLogRecovered`, `WakeHintAt`, `AlarmObserved`/`AlarmFinished`,
`LoadSampled`, `GenerationChanged`, WebSocket open/close, and cancel-related
bookkeeping.

## Effects

`Effect` is the complete action vocabulary a decision can request from its
adapter. It covers the same span as events but as *commands*: timers
(`ScheduleTimer`), conditional writes (`CasNodeLease`, `CasOwner`), reads
(`ReadSelfNodeLease`, `ReadOwner`, `ReadCapacityPeers`, `VerifyOwnership`),
replication lifecycle (`Restore`, `EnsureDurable`, `AwaitDurable`), runtime
lifecycle (`StartRuntime`, `Publish`, `StopRuntime` with a `StopCause`),
signal embedding (`FireAlarm`, `AlarmFinished`), and the output gate's
`Release` plus the output-`gate`-held-completion `Complete` mapping
(repo://crates/logic/types.rs#L740-L920). Each variant importantly carries
the *decision-relevant* facts only — e.g. `RestoreSpec` boots with the
epoch, whether the epoch was `fresh`, whether ownership was seized from a
different node, whether the local replica remains authoritative, and the
node the takeover displaced — so the adapter executes but never re-decides
ownership (repo://crates/logic/lib.rs#L33-L52).

## State and its invariants

`State` holds the node identity, an open/fenced authority, resident
activity, activation permits, eviction permits, alarms, pending effects, and
the folded log-owner state. Two invariants are locally enforced:

- Admission is checked against configured ceilings: `occupied` resident
  cells may not exceed `max_resident`, concurrent evictions may not exceed
  `max_evictions`, and activation permits may not exceed `max_activations`.
- ActiveSupport accounting must balance: each held output belongs to a
  pinned cell, and `(request, channel)` pairs are unique — a validation
  failure rejects the transition immediately rather than letting the shell
  run on corrupted authority
  (repo://crates/logic/lib.rs#L1048-L1073 and
  repo://crates/logic/lib.rs#L1073-L1115).

The validate method is the downstream contract the executor meets whenever
the actor's state converges, and it makes illegal event sequences show up as
deterministic validation errors rather than silent shell divergence.

## Determinism is load-bearing

Three properties make the pure core safe:

1. **Closed execution domain.** Wall and monotonic clocks advance only from
   event-supplied timestamps and only forward (`state.now_ms.max(..)`), so
   replaying a schedule reproduces every decision bit-for-bit.
2. **Effects carry decisions**, not instructions to re-derive them. That is
   why `RestoreSpec` explicitly stamps `fresh`, `took_over`,
   `resume_local`, and `prior` — the adapter *does not* rediscover these
   facts, it executes them (repo://crates/logic/lib.rs#L46-L52).
3. **Policy is centralized.** Whether a node may shed a resident cell, when
   an alarm's wake entry needs a bucket write, what a queue batch plans —
   these are all decisions the core owns, so a simulator exercises the exact
   code the production fleet runs.

## The major decision modules

Each module in the crate is a self-contained policy slice invoked by the
state machine when its domain's questions arise:

- `pressure.rs` — memory-pressure classification: node load samples are
  latched and classified into shedding/shutting states with per-metric
  release thresholds and headroom checks
  (repo://crates/logic/pressure.rs#L151-L185, L203-L263).
- `log_tier.rs` — the fleet-durability log coordinator: follower joins,
  append sequencing, ensemble acks, sealing, recovery, takeover gating, and
  the ship ledger that tracks tiering
  (repo://crates/logic/log_tier.rs#L69-L145, L208-L277).
- `wake.rs` — alarm wake-hint plan: when to put or delete a `wake/` bucket
  object for a cell's next alarm, with delete-in-flight tracking and adopt
  semantics (repo://crates/logic/wake.rs#L102-L175, L192-L245).
- `queue.rs` — queue broker decisions: leases, retries, batch planning,
  settlement verification, purge planning, and admission-concurrency gates
  (repo://crates/logic/queue.rs#L46-L332).
- `isolate.rs` — isolate placement and admission: pool load checks,
  refusal reasons under shedding, and placement selection for both worker
  requests and cell residency
  (repo://crates/logic/isolate.rs#L33-L248).
- `gate.rs` — the `InputGate`: which events a quiescing cell may still
  accept, and when a gate abandons (repo://crates/logic/gate.rs#L68-L141).
- `restore.rs` — restore-source policy: `previous_epoch_reusable` decides
  whether a local replica at an older epoch may be reused by a takeover or
  eviction rebalance (repo://crates/logic/restore.rs#L27-L27).
- `log_evict.rs` — follower eviction decisions for the fleet log tier:
  health sampling, hedging deadlines, quarantines, correlated-stall
  detection, and swap policy (repo://crates/logic/log_evict.rs#L28-L394).
- `pressure`, `schedule`, `cron` — `Cron` parsing and matching/next-time
  evaluation for cron-driven alarm scheduling
  (repo://crates/logic/cron.rs#L115-L176).

## ConsumING the core

The executor/host adapter lives in `crates/celld`: the actor shell drives
`on_event` sequentially from a single-threaded mailbox, with `production.rs`
implementing the effect executors against real I/O — object-store calls,
V8 isolates, streams, WebSocket — while `conformance_sim_cell_host` and the
in-tree `conformance_*_tests` modules feed the same core through a simulated
world for deterministic testing (see
<!-- openwiki: broken internal link [/validation/testing-strategy.md] file "/validation/testing-strategy.md" does not exist. Fix the href or restore the target, then delete this comment. -->
[Testing strategy](/validation/testing-strategy.md)). The split is enforced
in the reverse direction too: celld depends on `celld-logic`, never the
other way around, at the crate level
(repo://Cargo.toml#L13-L18).
