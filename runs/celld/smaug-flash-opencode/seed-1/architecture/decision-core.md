---
type: architecture
title: The Logic Decision Core (crates/logic)
description: The clean-sheet, replayable coordination state machine behind celld — the Event/Effect protocol, State, cell lifecycle phases, the output gate, node authority, capacity, and memory-pressure shedding.
tags: [architecture, decision-core, lifecycle, state-machine, coordination]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# The Logic Decision Core (`crates/logic`)

The `celld-logic` crate is the decision core of the whole system. It owns every piece of behavioral state and every lifecycle decision; the `crates/celld` executable acts only as an effect executor and adapter host. The single entry point is `celld_logic::on_event`, documented at `crates/logic/lib.rs:5215`, and both the production actor and the deterministic simulator feed it events and then perform the returned effects pasa each event through the same state machine.

`on_event(&mut State, Event) -> Vec<Effect>` is the only way behavioral state advances. `Field` facts (`crates/logic/types.rs`) such as `Event` (the only way in), `Effect` (the only way out), `Phase`, `Channel`, and `OwnerRecord` carry data, but no decision is made there — decisions live in `State` (`crates/logic/lib.rs:487`).

## Node authority and readiness

The core does not read a clock or a proc file itself. Events carry sampled timestamps (`event_now_ms` / `event_mono_ms`, `crates/logic/lib.rs:5183`), and `State::node_authoritative` (`crates/logic/lib.rs:723`) evaluates the published node lease against the remembered monotonic clock. Authority is the lease's published validity at ask time, not the `NodeAuthority::Held` variant: a peer treats the record as dead the instant `now_ms` reaches `expires_ms`, so a holder whose lease lapsed answers `false` here even if the fence timer has not fired. `ready_to_serve` (`crates/logic/lib.rs:740`) additionally requires the node not be fenced or resuming. The polarity of the `<` / `>=` check matches the fence timer so the predicate and timer cannot disagree.

## Cell lifecycle phases

Each cell moves through an explicit `Phase` (`crates/logic/lib.rs:113`). The phases map onto the Durable Objects lifecycle states where Cloudflare has names for them:

- `Resident` — active or idle, in memory (DO states 1-3).
- `Dormant` — out of memory but still owned by this node; hibernated when surviving hibernatable sockets are present (`State::is_hibernated`, `crates/logic/lib.rs:1415`).
- `Inactive` — out of memory and owned by nobody, needing a cold start (DO state 5 and the initial state of every cell).

The complete transient path is named so operator tooling can report it: `WaitingActivation`, `ReadingOwner`, `ReadingNodeLease`, `RecoveringOwnerLog`, `ReadingCapacity`, `WaitingCapacity`, `Acquiring`, `ReconcilingAcquire`, `Restoring`, `Starting`, `Publishing`, `EnsuringDurability`, `Cleaning`, `Adopting`, `Remote`, and `Fenced`. Each non-terminal phase carries its `OpId`, and every in-flight cell-scoped operation is indexed by `cell_ops` so a completion event that names only the op can resolve to its cell in one lookup (`crates/logic/lib.rs:579`).

The operator-visible short name of a phase is drawn from `phase_name` (`crates/logic/lib.rs:214`), and `phase_census` (`crates/logic/lib.rs:977`) reports how many cells sit in each phase. The names are deliberately stable across internal renames because charts and humans read them.

## Capacity and admission

Residency is a hard ceiling, counted exactly rather than sampled. `max_resident` in `Config` (`crates/logic/types.rs:63`) bounds resident cells plus activation reservations abl; `State::occupied` is maintained at every phase transition, and `has_capacity` (`crates/logic/lib.rs:1369`) only refuses admission when the node is at its cell cap or actively shedding. A node at capacity refuses more and holds what it has rather than shedding a live cell it must then place elsewhere.

Activation concurrency is bounded by `max_activations` (`crates/logic/types.rs:77`), a separate permit set that is part of the replayable state machine rather than an implicit count of executor tasks. Cells waiting for a residency slot park in a FIFO `capacity_waiters` queue (`crates/logic/lib.rs:546`); FIFO is the whole admission policy because waking every waiter and letting them race is unfair by construction under sustained eviction.

## The output gate (RPO=0)

`Channel` (`crates/logic/types.rs:335`) enumerates every route by which an output can reveal a cell's state: `Response`, `Fetch`, `WsHibernatable`, `WsSelf`, `Service`, `CellRpc`, and `Queue`. Every channel passes through `State::output` (`crates/logic/output_gate.rs:83`), which applies one durability rule to every route without branching on which channel it is. A write opens its own barrier and waits until the replica proves a position that *covers* the gated write's position (`Effect::AwaitDurable`), while a read-only output trails the newest barrier open on its cell (`trail_open_barrier`, `crates/logic/output_gate.rs:142`). The core stores the channel and returns it in `Effect::Release`; it never reads the channel, so one invariant cannot split into per-channel rules.

A bucket-proof acknowledgement additionally requires `Effect::VerifyOwnership` before anything is revealed (`durable_reached`, `crates/logic/output_gate.rs:173`), because "durable in `e<epoch>/`" is not durable if the prefix was orphaned)Skip detailed; the fleet-proof path is arbitrated by the ensemble instead. An alarm opening a barrier is a second kind of owner (`GateOwner::Alarm`), not a seventh channel, because it settles by replay back into the core rather than release to the shell.

When a gate is drained by a fence or deadline, the write is failed rather than acknowledged into an orphaned lineage, and the cell is reset (`settle_gate`, `crates/logic/output_gate.rs:232`).

## Shedding and memory pressure

Memory-pressure shedding is a pure classifier of a memory sample plus the prior shedding state, in `crates/logic/pressure.rs.` The core never reads the environment; the process and allocator measurements arrive via `Event::LoadSampled`, and `PressureConfig` holds the watermarks. Residency is deliberately not here — it is capped at admission. Shedding engages when the memory the cells hold crosses a ceiling, and the latch (the `Latches` struct, `crates/logic/pressure.rs:54`) holds the node in shedding until every configured low watermark clears, so it walks down instead of oscillating around its ceiling.

The eviction victim is chosen by `shed_candidate` (`crates/logic/lib.rs:4603`), which prefers the cell on the isolate closest to empty because only the cut that takes an isolate's last cell returns the whole heap. A cell with an imminent, uncovered alarm, or one a live transport pins, is not shed. Idle eviction (`evict_idle`, `crates/logic/lib.rs:4656`) gives a long-unused cell back with no pressure involved when `idle_evict_ms` is set.

## Versioned operations and failure handling

Every asynchronous effect is versioned by an `OpId` (`crates/logic/types.rs:18`); completion events carrying an obsolete `op` are ignored by the core's phase checks. A dangle/stall in a single event is bounded by `operation_deadline_ms` in `Config`, so a swallowed effect cannot leave a request waiting forever. `Failure` (`crates/logic/types.rs:386`) distinguishes a `Definite` failure (definitely did not commit) from an `Ambiguous` one (may have committed before its caller lost the response). Ambiguous acquires are re-read rather than retried blindly, and a single claim may reconcile at most `MAX_ACQUIRE_RECONCILES` (3) times before the request fails (`crates/logic/lib.rs:96`).

The core also runs a cheap internal consistency gate, `State::validate` (`crates/logic/lib.rs:1073`), after every event on both executors. It checks that occupancy, activation permits, eviction permits, the `active_cells` reverse index, and the phase/queue invariants all agree, and it refuses a cell in a swap path flag outside the swap path.

## Deterministic re-executability

Because the core never reads a clock, PRNG, or I/O directly, the same event sequence reproduces the same state and effects; the deterministic simulator used by the test suite drives the core with a seeded scheduler. `Config`, `Stats`, and the `AuthoritySnapshot`/`StepSafetyObserverSnapshot` helpers behind `celld_internal_tests` let tests and the conformance world observe the core's decisions at event boundaries. The effect adapters in `crates/celld` never borrow core state; they send versioned completion events back through the actor mailbox (`crates/celld/lib.rs:5`).

## Loading relation to the rest of the crate set

- `crates/celld` implements the actual I/O: conditional bucket writes (`ownership_store.rs`), V8 isolates (`js/`), replication (`replication.rs`), and the runtime (`runtime.rs`). It executes the `Effect`s the core returns and replies with the corresponding `Event`s.
- `crates/ltx` provides the storage/replication library that turns SQLite WAL data into LTX segments; the core's `EnsureDurable`/`AwaitDurable` effects are what the replicator is proving.
