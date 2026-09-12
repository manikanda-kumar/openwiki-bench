---
type: "Reference"
title: "Architecture: the decision core, the effect executor, and replication"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-594c5ed5fc67a4a995238255
    resource: repo://crates/celld/actor/production.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-fb3f4a433a44fb71aaaecdf1
    resource: repo://crates/ltx/Cargo.toml
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Architecture: the decision core, the effect executor, and replication

celld is a distributed runtime for Cloudflare Workers and Durable Objects. It
is built as a clean-sheet three-tier split that keeps every behavioral decision
in a pure, replayable core and leaves all I/O, clocks, and concurrency to an
adapter host.

## Ownership boundaries between the crates

The workspace has three crates, each with a distinct responsibility:

- **`celld-logic`** (`crates/logic`) is the "pure decision core": no async, no
  I/O, no clocks, no randomness, no locks, and no dependencies. Its manifest
  declares this explicitly (`crates/logic/Cargo.toml:8-9`). All behavioral
  state and decisions live here.
- **`celld`** (`crates/celld`) is the "effect executor and adapter host": it
  owns the connection, V8 shell, storage, deployment, and CLI code. Per the
  workspace manifest, `crates/celld` is only an effect executor and adapter
  host; the core owns all behavioral state and decisions (`Cargo.toml:2`).
- **`celld-ltx`** (`crates/ltx`) is an in-process SQLite→object-store
  replication engine, a vendored snapshot of rustyriver/Litestream v0.5 that
  celld owns and evolves (`crates/ltx/Cargo.toml:4-8`).

The `celld` crate is the only one with a binary target. Its library helps
embed and test, and the `celld` binary (`main.rs`) is the runnable vertical
slice.

## The decision core: Event, State, Effect

`celld-logic` advances behavioral state through exactly one function:
`on_event(state: &mut State, event: Event) -> Vec<Effect>` (`crates/logic/lib.rs:5215`).
Its crate documentation states this is the only way behavioral state advances,
and that production and deterministic simulation both feed it events and
perform the returned effects; no adapter may mutate `State` directly
(`crates/logic/lib.rs:3-7`).

The vocabulary is defined in `crates/logic/types.rs`:

- **`Event`** is the only way in — the complete set of things the core can be
  told, from `StartNodeLease` and cell `Request`s through `DurableReached`,
  `OwnerCasCompleted`, `RestoreCompleted`, `LoadSampled`, and `NodeFenced`
  (`crates/logic/types.rs:402-697`).
- **`Effect`** is the only way out — the asynchronous work the adapter must
  perform, such as `ReadOwner`, `CasOwner`, `Restore`, `StartRuntime`,
  `EnsureDurable`, `AwaitDurable`, `VerifyOwnership`, `StopRuntime`, and
  `Halt` (`crates/logic/types.rs:740-920`).
- **`State`** (`crates/logic/lib.rs:487`) is the authoritative coordination
  state: cells, phases, activation/capacity permits, node authority, barriers,
  timers, pressure latches, and all decision state.

Events carry their sampled clocks (`now_ms` / `now_mono_ms`) so the core never
reads a clock; it remembers what it was told (`crates/logic/lib.rs:591-599`).
The core advances `State` based purely on these observations and emits
`Effect`s.

Effects are versioned by an `OpId`; all asynchronous effects are versioned, and
completion events with an obsolete `op` are ignored (`crates/logic/types.rs:737-738`).
This lets a late completion from a superseded operation fail harmlessly.

## The serial actor executor

`celld` runs everything through one serial actor, the only caller of
`celld_logic::on_event`. Adapter futures never borrow core state; they send
versioned completion events back through its mailbox (`crates/celld/lib.rs:6-9`).

The production selector in `crates/celld/actor/production.rs` is the execution
shape: it polls the mailbox, the in-flight effect futures, and the timer delays
together with a single unbounded select, then drains the step output
(`crates/celld/actor/production.rs:14-40`). This is the shape required for
monotonic lease ticks to fence the node even when a storage operation remains
hung, without spawning a task per effect (`crates/celld/main.rs:7-12`).

The actor has three ready-input classes:

- `Message` — the mailbox (requests, completions routed back).
- `Completed` — an in-flight effect future's completion event.
- `TimerFired` — an armed timer fired.

Each `step` feeds one input into `on_event`, collects the returned `Effect`s,
and arms/disarms timer slots. Timer arms are keyed by slot and versioned so a
stale firing from a replaced arm is ignored (`crates/celld/actor.rs:39-116`).

## The deterministic-simulation seam

Because `celld-logic` has no I/O, the same core can be driven by production and
by a deterministic simulator. The `celld` crate swaps in a simulated asyncrt
world under `cfg(celld_internal_tests)` (`crates/celld/lib.rs:305-330`): the
corpus flag selects the simulated asyncrt so external engine tests and in-crate
suites see the same simulated world, while `test` alone keeps the real one.
The simulated store injects latency, compare-and-swap races, and lost responses.

## The custom select facade

`celld` defines its own `select!`/`select_biased!` macros via
`__celld_domain_select` (`crates/celld/lib.rs:42-297`). Two properties matter:

- **Fair** (`select!`): polls branches from a cyclic start offset so source
  order does not decide a tie; it rejects a `biased;` token
  (`crates/celld/lib.rs:262-268`).
- **Biased** (`select_biased!`): requires a non-empty reason string that states
  which arm wins and why (`crates/celld/lib.rs:281-297`).

The facade is substantially adapted from Tokio's `select.rs`; the tokens it
re-exports are `doc(hidden)` upstream and carry no compatibility guarantee, so
a Tokio version bump must re-check the facade (`crates/celld/lib.rs:11-28`).

## Replication lives in `celld-ltx`

Each cell's SQLite commits are captured as LTX data and streamed to the fleet
bucket by `celld-ltx`, driven by `crates/celld/ltx_repl.rs`. The `ltx` crate
provides capture of WAL data as LTX segments, replica read/write, restores,
level compaction, and bundles (`crates/ltx/src/lib.rs:3-5`). It is the
mechanism that turns each committed SQLite write into a durability proof
object.

## Key data flows

- **Ingress → routing:** a request enters the `celld` binary, resolves a cell
  route (local, or remote through the signed peer transport), and the actor
  drives the cell lifecycle through `on_event`.
- **Cold cell → residency:** the core runs `ReadOwner` → `ReadNodeLease` →
  (recover node log) → `ReadCapacityPeers` → `CasOwner` → `Restore` →
  `StartRuntime` → `Publish` → (ensure durability/resident). Each step is an
  `Effect`, and the actor performs the I/O and reports a completion `Event`.
- **Write → durability:** a handler write advances the cell's WAL position; the
  output gate (`Effect::AwaitDurable`) withholds the response until the
  core proves the position durable (see the durability page).

## State is never mutated by adapters

The invariant that makes this design safe is that no adapter mutates `State`.
Adapters perform `Effect`s and feed completion `Event`s back into the mailbox;
all transitions, admission bounds, and fences are core decisions that the
simulator can replay. `State::validate` runs after every event in both executors
and checks internal consistency invariants (`crates/logic/lib.rs:1073`).

---

## Related pages

- [Cells and the lifecycle state machine](/openwiki/concepts/cells.md)
- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Deploying applications and adopting generations](/openwiki/operations/deploying.md)
