---
type: "Reference"
title: "Sans-IO Decision Core (celld-logic)"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-e8fcaece1f081632b9f33665
    resource: repo://crates/logic/cache.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-4e2df396109dfd4edefa6079
    resource: repo://crates/logic/drain.rs
  - id: openwiki-source-5139cf45e1183dbe26084038
    resource: repo://crates/logic/http.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Sans-IO Decision Core (celld-logic)

## Responsibility and boundary

`celld-logic` holds all behavioral state and decisions for a celld node; `crates/celld` is only an effect executor and adapter host (Cargo.toml workspace comment, crates/celld/lib.rs). The crate is deliberately dependency-free: its manifest declares it a "Pure decision core: no async, I/O, clocks, randomness, locks, or dependencies" (crates/logic/Cargo.toml). No adapter may mutate `State` directly; `on_event` is the only way behavioral state advances, and both the production executor and the deterministic simulator feed it events and perform the returned effects (crates/logic/lib.rs#L1-L10).

In production, exactly one caller exists: the serial `Actor` in `crates/celld/actor.rs`, which drives `celld_logic::on_event(state, event)` once per event and performs the emitted effects through adapter futures that never borrow core state (crates/celld/actor.rs#L1-L10, #L3908).

## The Event/Effect vocabulary

All wire types are data in `crates/logic/types.rs`, whose header states the contract: "`Event` is the only way in, `Effect` the only way out, and the rest are the shapes those two carry" (crates/logic/types.rs#L1-L9).

- **Inputs.** `Event` variants cover clock/time stamps carried in by the shell (`TimerFired`, `RequestAt`, `LoadSampled`), adapter completions (`RestoreCompleted`, `OwnerCasCompleted`, `DurableReached`, `OwnershipVerified`, `NodeLeaseCasCompleted`, …), and lifecycle directives (`ReleaseAll`, `NodeFenced`, `GenerationChanged`) (crates/logic/types.rs#L402-L697).
- **Outputs.** `Effect` variants are versioned by an `OpId`, and "completion events with an obsolete `op` are ignored" — so a stale firing from a replaced lease generation is harmless and late I/O can be reconciled deterministically (crates/logic/types.rs#L737-L740, #L286-L288).
- **Clocks never enter the core.** `on_event` folds event-supplied `now_ms`/`now_mono_ms` samples into `State` with `max`, so time is an observed input, not an ambient read (crates/logic/lib.rs#L5196-L5222). Deterministic timers are versioned effects (`Effect::ScheduleTimer` with a `Timer` keyed by generation), not implicit clock reads (crates/logic/types.rs#L286-L314).
- **Egress channels are closed.** `Channel` enumerates every route by which a cell's state can leave the process (`Response`, `Fetch`, `WsHibernatable`, `WsSelf`, `Service`, `CellRpc`, `Queue`) and is deliberately not `#[non_exhaustive]`, so adding a channel breaks every exhaustive shell match until its hold/release rules are decided (crates/logic/types.rs#L316-L369). Alarms are excluded on purpose because their settlement is replayed back into the core rather than released to the shell (crates/logic/types.rs#L326-L333).

## What State owns

`State` is the single authoritative coordination record: the cell map with per-cell `Phase`, in-flight request and barrier tables, permit sets, wait queues, and caches — everything that must replay identically under a schedule (crates/logic/lib.rs#L487-L579). Notable design points encoded in the field comments:

- The output gate lives as `barriers: BTreeMap<OpId, Barrier>`; an open gate makes its cell active so it cannot be evicted underneath it, and a fence drains barriers to failed responses so a write is never acknowledged after the node loses authority (crates/logic/lib.rs#L513-L523).
- Cold-route admission is explicit: `activation_permits`, `eviction_permits`, and a FIFO `capacity_waiters` queue, because "a waiter with `k` waiters ahead of it is admitted within `k` releases, so no arrival pattern can starve it" (crates/logic/lib.rs#L530-L546).
- Remote-route knowledge (`node_lease_cache`) and bookkeeping for invalidated-but-still-running ops (`retired_runtime_ops`, `timed_out_runtime_starts`) are core state, not hidden executor optimizations (crates/logic/lib.rs#L563-L575).
- `Config` carries the numeric policy the core enforces: `max_resident`, `max_activations`, `max_evictions`, `max_releases`, per-cell outbound WebSocket budget, eviction ownership mode, operation deadline, alarm residency window, idle eviction, and the pressure config (crates/logic/types.rs#L62-L136).

`State::validate` walks these invariants (for example, `(request, channel)` uniqueness for held outputs), and a single `set_phase` gate keeps the capacity-occupying count exact so nothing else has to recount (crates/logic/lib.rs#L1048-L1073, #L5455-L5460).

## Cell phase machine

Each cell advances through `Phase`: `Inactive` → `WaitingActivation` → `ReadingOwner` → (optionally `ReadingNodeLease`, `RecoveringOwnerLog`, `ReadingCapacity`/`WaitingCapacity`) → `Acquiring` → `Restoring` → `Starting` → `Publishing` → `Resident`, with `Cleaning` on the way out (crates/logic/lib.rs#L113-L135, #L5420-L5452). The doc comment fixes the vocabulary: `Resident` is in memory; `Dormant` is out of memory but still owned by this node, and a dormant cell that keeps hibernatable sockets is *hibernated*; `Inactive` is owned by nobody and needs a cold start. It also warns that celld and Cloudflare use "evict" differently: celld evicts out of memory (producing `Dormant`), and shedding is what publishes the cell unowned (crates/logic/lib.rs#L100-L111).

`StopCause` distinguishes the exits: an idle eviction keeps the ownership record so a same-node wake renames the local file into place instead of paying a remote restore, `Reset` follows a failed durability proof (serve nothing that the bucket lacks), and `Swap` moves a cell to a new application generation at the same epoch with no ownership or replication change (crates/logic/types.rs#L929-L953).

## Subsystem map: decision here, executor there

Each logic module owns one decision family; a named adapter in `crates/celld` performs the I/O. Representative pairs:

| Decision (crates/logic) | Owner question | Executor (crates/celld) |
| --- | --- | --- |
| `gate` | When the input gate is held, no other event may reach the cell (workerd `io-gate.h` rule) | isolate dispatch in `js.rs`/`runtime.rs` |
| `output_gate` + `Channel` | Withhold any egress that can reveal an unproven write | main/peer routes releasing `Effect::Release` |
| `routing` | A failed peer forward is retried only when the connection was never established; every later failure risks double-apply (crates/logic/routing.rs#L1-L13) | tunnel client in `main.rs`/`ws_client.rs` |
| `restore` | Choose the newest SAFE restore source (local eviction snapshot vs bucket) purely; availability checks are I/O (crates/logic/restore.rs#L1-L12) | `ltx_repl.rs`, `runtime.rs` |
| `pressure` | Classify a memory sample against the hysteresis latch; residency caps are enforced separately at admission (crates/logic/pressure.rs#L1-L11) | `memory.rs` sampling, shed pump in the actor |
| `isolate` + `schedule` | Which isolate runs the next turn, when to grow/shrink, and whether a Worker fetch may take the resident fast path (crates/logic/isolate.rs#L1-L12, crates/logic/schedule.rs#L1-L9) | `pool.rs` |
| `wake` | `WakeCore::decide` reconciles bucket wake entries with a cell's alarm; key scheme shared so executors cannot diverge (crates/logic/wake.rs#L1-L9) | `wake.rs` flusher |
| `drain` | Fleet drain-token claim/settle policy; correctness never depends on the token (crates/logic/drain.rs#L1-L11) | `drain_token.rs` |
| `log_tier` + `log_evict` | Node-log ensemble membership, epoch fencing, gray-follower eviction; `log/<node>.json` is the CAS root of truth (crates/logic/log_tier.rs#L1-L11, crates/logic/log_evict.rs#L1-L12) | `node_log.rs` |
| `cache` | LRU bound on local eviction-snapshot files, justified because the cache is pure optimization (crates/logic/cache.rs#L1-L10) | actor eviction path |
| `cron`, `alarm` | Next-occurrence math (minute/UTC) and bounded alarm backoff as pure functions (crates/logic/cron.rs#L1-L10, crates/logic/alarm.rs#L1-L7) | reserved cron cells, `storage.rs` backoff rows |
| `cell`, `peer`, `http`, `sqlite` | Security/parsing fences: cell-scope charset is a path-traversal fence (crates/logic/cell.rs#L1-L11), peer identity and clock-window predicates (crates/logic/peer.rs#L1-L8), request-authority shape (crates/logic/http.rs#L1-L11), and SQLite engine-failure codes (crates/logic/sqlite.rs#L1-L9) | scope validation on ingress, `peer_auth.rs`, actor fail-closed |
| `sweep` | One bound (256 rows/turn) so no cell-backed feature invents an unbounded cleanup loop (crates/logic/sweep.rs#L1-L11) | KV/Queue cell harness |
| `dead_node_reconciliation` | Backoff for retiring legacy `node-cells/` debris in shared buckets (crates/logic/dead_node_reconciliation.rs#L1-L8) | `dead_node_gc.rs` |

## Durability proof sources differ by fence

The core distinguishes proof mechanisms where the fences differ: a fleet proof is already arbitrated because a takeover seals followers first, so it needs no ownership re-read, while a bucket proof must emit `Effect::VerifyOwnership` — read `own.json`, acknowledge only if it still names this node at this epoch (crates/logic/types.rs#L371-L379, #L865-L873). `Event::DurableReached` reports the position actually proven, so "a replicator that proves less than it was asked to cannot force an early ack" (crates/logic/types.rs#L521-L536). See [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md).

## Determinism and validation — and what is not in this snapshot

The crate disables its own test target (`test = false`) and reserves a `cfg(celld_internal_tests)` check-cfg, indicating tests are compiled in behind an internal cfg rather than in the shipped crate (crates/logic/Cargo.toml#L8-L15). `docs/testing.md` describes a deterministic simulator driving this core with injected latency, CAS races, lost responses, and scripted adversaries, plus hand-synced TLA+ specifications — but no simulator or TLA+ source exists in this repository snapshot (searches for test modules find none under `crates/`), so the harness locations are an external or withheld detail; do not assume they live here (docs/testing.md#L81-L104). What the snapshot does establish is the shape that makes those tools possible: all nondeterminism (clock, randomness, storage) enters as events, and every effect is versioned and replayable (crates/logic/lib.rs#L1-L10, crates/logic/types.rs#L737-L740).

Related: [Architecture Overview](/openwiki/architecture/overview.md), [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Cells, Ownership, and Fencing](/openwiki/concepts/cells-ownership.md), [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md).
