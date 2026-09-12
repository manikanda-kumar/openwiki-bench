---
type: architecture
title: "Architecture: crates, the decision core, and the effect-execution loop"
description: "How celld splits a pure sans-IO decision core (celld-logic) from an effect-executing node host (celld) and a vendored SQLite replicator (celld-ltx), and how the serial actor keeps every lifecycle transition deterministic and replayable."
tags: [architecture, sans-io, actor, workspace, determinism]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T18:36:22.117Z
---

# Architecture: crates, the decision core, and the effect-execution loop

celld is a Cargo workspace of three crates with one hard ownership rule, stated
at the top of the root manifest: `crates/logic` owns all behavioral state and
decisions; `crates/celld` is only an effect executor and adapter host
([Cargo.toml](repo://Cargo.toml#L1-L5)). The third crate, `crates/ltx`, is a
vendored SQLite→object-store replicator. This split is not stylistic: it is what
lets the coordination protocol be model-checked and driven under deterministic
simulation (see [Testing and verification strategy](repo://docs/testing.md)).

## The three crates

- **`celld-logic`** (`crates/logic`) — the "pure decision core: no async, I/O,
  clocks, randomness, locks, or dependencies"
  ([crates/logic/Cargo.toml](repo://crates/logic/Cargo.toml#L7-L10)). It holds
  one `State` (cells, node lease, capacity queues, pressure latches, …) and a
  single entry point. The crate has no external dependencies at all.
- **`celld`** (`crates/celld`) — the node binary and its library: the V8 host,
  object-store adapters, HTTP listeners, peer transport, replication adapters,
  CLIs, and the serial actor that runs the core
  ([crates/celld/lib.rs](repo://crates/celld/lib.rs#L5-L9)).
- **`celld-ltx`** (`crates/ltx`) — in-process SQLite WAL replication to object
  storage in the LTX format. It is a vendored snapshot (2026-08-03) of the
  `rustyriver` reimplementation of Litestream v0.5 and the LTX format; celld
  owns and evolves the snapshot and does not track an upstream branch
  ([crates/ltx/Cargo.toml](repo://crates/ltx/Cargo.toml#L1-L8)).

Every direct dependency is declared once in `[workspace.dependencies]` so member
crates can never drift onto two versions of the same crate
([Cargo.toml](repo://Cargo.toml#L33-L35)).

## The Event/Effect contract

`celld_logic::on_event(&mut State, Event) -> Vec<Effect>` is the only way
behavioral state advances; the production executor and the deterministic
simulator both feed it events and perform the returned effects, and no adapter
may mutate `State` directly ([crates/logic/lib.rs](repo://crates/logic/lib.rs#L3-L7),
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L5215)).

The vocabulary lives in `crates/logic/types.rs`:

- [`Event`](repo://crates/logic/types.rs#L402) is everything the core is told:
  inbound requests (`RequestAt`), timer firings, memory samples, generation
  changes, and the completions of effects (`SelfNodeLeaseRead`,
  `NodeLeaseCasCompleted`, …). Clock readings are *inputs* carried by events:
  `on_event` folds each event's `now_mono_ms`/`now_ms` into the state's remembered
  maximum, so the core never asks what time it is, it remembers what it was told
  ([crates/logic/lib.rs](repo://crates/logic/lib.rs#L5215-L5222),
  [crates/logic/lib.rs](repo://crates/logic/lib.rs#L591-L599)).
- [`Effect`](repo://crates/logic/types.rs#L740) is "work performed outside the
  core": schedule a timer, read or conditionally-write a bucket record, restore
  a cell, start or stop a runtime, prove a write durable. Every asynchronous
  effect is versioned by an `OpId`, and completion events carrying an obsolete
  `op` are ignored ([crates/logic/types.rs](repo://crates/logic/types.rs#L736-L741)).

This versioning is what makes late adapter responses safe: an effect invalidated
by fencing may still complete, and its stale answer simply cannot disturb the
state.

## The serial actor

The node process runs one actor that is the only caller of `on_event`
([crates/celld/lib.rs](repo://crates/celld/lib.rs#L7-L9)). Adapter futures never
borrow core state; they send versioned completion events back through the
actor's mailbox. `Actor::step` handles exactly one ready mailbox item, one
in-flight completion, or one timer, and `drive` feeds cascading events through
`on_event` ([crates/celld/actor.rs](repo://crates/celld/actor.rs#L2184-L2200),
[crates/celld/actor.rs](repo://crates/celld/actor.rs#L2743)).

The binary polls the mailbox, its timer wheel, and the in-flight effect futures
*together* in one select. The reason is a safety property, not convenience:
monotonic lease ticks must be able to fence the node even while a storage
operation remains hung, which a per-effect spawned task would not guarantee
without spawning one watchdog per effect
([crates/celld/main.rs](repo://crates/celld/main.rs#L7-L12)).

After every event, both the production executor and the simulator run the
core's own cheap consistency gate, `State::validate`, which cross-checks the
occupied counter, permit sets, queue/phase agreement, operation indexes, and
held outputs against the maps they summarize
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L1045-L1073)).

## The execution facade and how determinism is enforced mechanically

All ambient nondeterminism is funneled through one module, `celld::asyncrt`,
which "delegates tasks and timers to Tokio and obtains nondeterministic process
values from the host," and which a cfg-gated build can replace with another
execution backend ([crates/celld/asyncrt.rs](repo://crates/celld/asyncrt.rs#L4-L8)).

The boundary is policed by lint, not convention. `clippy.toml` forbids
`tokio::spawn`, `tokio::time::*`, `std::time::Instant::now`, `SystemTime::now`,
`rand::random`, `std::process::id`, and direct `std::fs` calls, each with a
reason pointing at the execution-domain replacement; modules outside the
boundary carry explicit `#[allow(...)]` with a comment saying why
([clippy.toml](repo://clippy.toml#L1-L30)). The `celld` crate warns on
disallowed methods/types crate-wide ([crates/celld/lib.rs](repo://crates/celld/lib.rs#L3)),
and `disallowed_macros` is *forbidden* in `celld` and `celld-ltx`
([crates/celld/Cargo.toml](repo://crates/celld/Cargo.toml#L17-L18)).

The facade itself is a vendored variant of Tokio's `select.rs`: `select!` is
forced to be fair (cyclic start), and `select_biased!` requires a non-empty
reason literal, so an order-dependent race always documents which arm wins and
why ([crates/celld/lib.rs](repo://crates/celld/lib.rs#L42-L60),
[docs/library-api.md](repo://docs/library-api.md#L3-L10)). Because the re-exported
Tokio items are `doc(hidden)` upstream, a Tokio version bump must re-check this
facade; the failure mode is a compile error, and the workspace comment says not
to "fix" it by narrowing the version range
([crates/celld/lib.rs](repo://crates/celld/lib.rs#L11-L30)).

## The `celld_internal_tests` build seam

A single cfg flag, `celld_internal_tests`, converts the real node into the
simulated world: `asyncrt` is `include!`d from an environment-named file
(`CELLD_INTERNAL_ASYNCRT`), SQLite fault injection appears as `pub mod fault`,
and the conformance suites (`CELLD_CONFORMANCE_WORLD_TESTS`,
`CELLD_CONFORMANCE_SIM_STORE_TESTS`, …) are included as test modules, all from
paths supplied by the build
([crates/celld/lib.rs](repo://crates/celld/lib.rs#L300-L431)). The flag alone —
not `test` — selects the simulated `asyncrt`, so an external engine-tests crate
sees the same simulated world the in-crate suites do
([crates/celld/lib.rs](repo://crates/celld/lib.rs#L307-L312)). V8 stays out of
the simulation, because V8 is not deterministic
([docs/testing.md](repo://docs/testing.md#L95)). The conformance corpus is not
in this workspace; without the environment variables set, these gated modules
are simply absent.

## Process shape and build profiles

`main.rs` installs jemalloc as the global allocator: glibc's malloc serialized
arenas behind futexes under load, and jemalloc measured ~20% more hello-world
throughput on a 16-core host while returning the arena-lock sleep time as usable
memory ([crates/celld/main.rs](repo://crates/celld/main.rs#L45-L50)).

Release builds are size-tuned — fat LTO, one codegen unit, `opt-level = "s"`,
`panic = "abort"`, stripped ([Cargo.toml](repo://Cargo.toml#L7-L14)). A
dedicated `lab` profile keeps the same optimizations but swaps fat LTO for thin
LTO with incremental compilation and preserves symbols for `perf`, so the lab
fast loop is rebuild speed without changing shipped artifacts
([Cargo.toml](repo://Cargo.toml#L16-L27)). Two dependencies carry deliberate
exact pins with written rationales: `fastwebsockets =0.8.1` for the unstable
`unstable-split` feature the WebSocket tunnel needs
([Cargo.toml](repo://Cargo.toml#L50-L59)), and `sqlite-vec =0.1.9` for the
pre-v1 audited C amalgamation ([Cargo.toml](repo://Cargo.toml#L116-L118)).

## Reading order

- The cell state machine and its admission controls: [Cell lifecycle](/openwiki/architecture/cell-lifecycle.md).
- Bucket authority objects and fencing: [Coordination](/openwiki/architecture/coordination.md).
- Durability acknowledgement and replication: [Durability and replication](/openwiki/architecture/durability-and-replication.md).
