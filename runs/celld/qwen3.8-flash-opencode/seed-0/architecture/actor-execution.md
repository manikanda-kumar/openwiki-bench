---
type: "Reference"
title: "Actor and execution boundary (celld shell)"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-594c5ed5fc67a4a995238255
    resource: repo://crates/celld/actor/production.rs
  - id: openwiki-source-e0a9f7c0b5fac71c8c311121
    resource: repo://crates/celld/asyncrt.rs
  - id: openwiki-source-55ec5a6f535496955b66f4ff
    resource: repo://crates/celld/host_services.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---


# Actor and execution boundary (celld shell)

The `celld` crate deliberately contains no lifecycle policy. Its contract is
stated in its own header: the executable owns one serial actor that is the only
caller of `celld_logic::on_event`; adapter futures never borrow core state and
send versioned completion events back through its mailbox
([crates/celld/lib.rs#L5-L9](repo://crates/celld/lib.rs#L5-L9)). This page
covers that shell — the actor loop, the timer discipline, the execution-domain
fence, the startup path, and the failure exit. The pure decisions themselves
live in [the decision core](decision-core.md).

## The serial loop

`Actor::run` (in `crates/celld/actor/production.rs`) is a start → select →
step loop over three sources: the mailbox receiver, a `FuturesUnordered` of
in-flight effect futures, and a `tokio_util::time::DelayQueue` of armed timers
([crates/celld/actor/production.rs#L8-L41](repo://crates/celld/actor/production.rs#L8-L41)).
Each loop iteration handles exactly one ready input, effect completion, or
timer firing — `Actor::step` is the unit of serialization
([crates/celld/actor.rs#L2184-L2186](repo://crates/celld/actor.rs#L2184-L2186))
— and the select stays deliberately unbiased because production permits every
ready-input order ([crates/celld/actor/production.rs#L11-L13](repo://crates/celld/actor/production.rs#L11-L13)).
Effects returned by the core are pushed into the unordered set and timer arms
into the delay queue by `drain_step_output`
([crates/celld/actor.rs#L1108-L1126](repo://crates/celld/actor.rs#L1108-L1126)).

`Actor::drive` converts a mailbox message or completion into a core `Event`,
calls the core, and executes each returned `Effect`. Some effects resolve
immediately — for example `CloseWebSocket` drops the transport and pushes a
synchronous `WebSocketClosed` event back onto the drive queue
([crates/celld/actor.rs#L3718-L3729](repo://crates/celld/actor.rs#L3718-L3729))
— so one input can cascade through several `on_event` rounds before the actor
yields. Mailbox inputs include `Request`, `WorkerRequest`, `CancelRoute`,
`Output` (a held response entering the output gate), `SampleLoad` (the memory
pressure feed), `GenerationChanged` (a new deployment), and `BeginPreserve`
([crates/celld/actor.rs#L2215-L2410](repo://crates/celld/actor.rs#L2215-L2410)).
While the node is in preserve mode (a same-node reload), new requests are
answered `NodeFenced` and cell-alarm timers are dropped
([crates/celld/actor.rs#L2218-L2223](repo://crates/celld/actor.rs#L2218-L2223),
[crates/celld/actor.rs#L2201-L2204](repo://crates/celld/actor.rs#L2201-L2204)).

## Versioned timers

Timer slots are named, not anonymous. `TimerSlot` coalesces most timers by cell
or role (renewing a lease only cares about the newest arm) but keys
`OperationDeadline` per `OpId` and `QueuedActivation` per cell *and* generation
— because a shared slot for outstanding operations would let arming one
deadline silently cancel another, leaving activations unwatched
([crates/celld/actor.rs#L40-L55](repo://crates/celld/actor.rs#L40-L55)).
Each arm gets a monotonic per-slot ordinal, and `TimerSlots::fire` removes the
armed entry only when both slot and ordinal match
([crates/celld/actor.rs#L94-L141](repo://crates/celld/actor.rs#L94-L141)).
A stale `DelayQueue` expiry for a displaced timer is therefore inert rather
than double-firing — the completion-vs-cancellation race is resolved by
version, which is the same discipline the mailbox uses for effect results.

Debug builds get one extra guard: `validate_invariants` defaults to
`cfg!(debug_assertions)` and re-checks every core invariant with a full
cell-table scan after each event — roughly 800 µs per event at ten thousand
resident cells, which is why release builds rely on the deterministic model
instead ([crates/celld/actor.rs#L1775-L1781](repo://crates/celld/actor.rs#L1775-L1781),
[crates/celld/actor.rs#L2792-L2795](repo://crates/celld/actor.rs#L2792-L2795)).

## The execution domain and its fence

Everything ambient reaches the actor through `crate::asyncrt`. The module owns
the process's production domain: the Tokio handle, a monotonic clock anchored
at process start (`mono_ms`/`mono_us`), the wall clock (`wall_ms`), the
process tag, the injected `FileSystem`, labeled RNG streams
(`rng(consumer)`), and the shared `HostServices`
([crates/celld/asyncrt.rs#L24-L58](repo://crates/celld/asyncrt.rs#L24-L58),
[crates/celld/asyncrt.rs#L149-L219](repo://crates/celld/asyncrt.rs#L149-L219)).
It is the one module that `#![allow]`s the forbidden primitives, because it
*owns* them ([crates/celld/asyncrt.rs#L3-L11](repo://crates/celld/asyncrt.rs#L3-L11)).
Elsewhere, `clippy.toml` forbids `tokio::spawn`, `tokio::time::*`,
`std::time::{Instant, SystemTime}`, `rand::random`, `std::process::id`, and the
`std::fs` family, each with a reason naming the sanctioned substitute
([clippy.toml#L1-L24](repo://clippy.toml#L1-L24)); modules outside the actor
boundary (the V8 arm, the fleet CLI) carry explicit allows that say why.

The custom `select!`/`select_biased!` macros live in `crates/celld/lib.rs`.
They are a re-implementation of Tokio's internal `select.rs` machinery because
the underlying items are `doc(hidden)` upstream and could change without a
semver break; `select_biased!` additionally requires a non-empty reason string
literal stating which arm wins and why, so biased ordering can never be
introduced casually ([crates/celld/lib.rs#L11-L28](repo://crates/celld/lib.rs#L11-L28),
[crates/celld/lib.rs#L41-L56](repo://crates/celld/lib.rs#L41-L56)). The
unbiased `select!` rotates its first-polled branch per call via
`select_start`, keeping tie-breaking out of source order
([crates/celld/asyncrt.rs#L170-L187](repo://crates/celld/asyncrt.rs#L170-L187)).

Because `asyncrt` is a module, not a dependency, a cfg-gated build can replace
it wholesale: with `--cfg celld_internal_tests` the crate includes a simulated
`asyncrt` from an environment-variable path while the shipped build keeps the
real one ([crates/celld/lib.rs#L305-L317](repo://crates/celld/lib.rs#L305-L317)).
`HostServices` follows the same seam — production installs one service set
(CPU sampler, memory sample, wake-entry and WebSocket services), while a
deterministic domain installs one set per simulated node with a scripted
metrics backend so co-hosted nodes do not share counters
([crates/celld/host_services.rs#L3-L8](repo://crates/celld/host_services.rs#L3-L8),
[crates/celld/host_services.rs#L46-L96](repo://crates/celld/host_services.rs#L46-L96)).
The actor's ownership reads/CASes have the same shape: an `Ownership` enum
switches between a bucket-backed store and an in-memory store
([crates/celld/actor.rs#L146-L161](repo://crates/celld/actor.rs#L146-L161)).

**Verification caveat for this snapshot:** the internal test/observer bodies
(including the simulated `asyncrt`) are injected via `include!(env!("CELLD_..."))`
and are not present in the repository, and `celld-logic`/`celld-ltx` disable
their default test harnesses ([crates/celld/lib.rs#L299-L317](repo://crates/celld/lib.rs#L299-L317),
[crates/logic/Cargo.toml#L8-L11](repo://crates/logic/Cargo.toml#L8-L11)). No
`#[test]` attribute exists in the visible source. What the repository *does*
establish is the compile-time fence: `cargo build`, `cargo clippy --all-targets
-- -D warnings` (the Dockerfile's test stage)
([Dockerfile#L23-L34](repo://Dockerfile#L23-L34)), and the cfg mechanism above.

## Startup before state

`crates/celld/startup.rs` binds both listeners before storage or V8 work
starts, so the executor receives an already-validated peer address
([crates/celld/startup.rs#L3-L9](repo://crates/celld/startup.rs#L3-L9)).
The policy encoded there:

- Sockets listen with backlog 4,096 rather than the inherited 128, because a
  1,200-client reconnect cohort once filled accept queues and produced resets
  on healthy nodes ([crates/celld/startup.rs#L20-L26](repo://crates/celld/startup.rs#L20-L26)).
- An internal listener on an unspecified address requires an explicit
  `--advertise` ([crates/celld/startup.rs#L227-L240](repo://crates/celld/startup.rs#L227-L240)).
- Advertising a literal public IP is rejected unless `--unsafe-public-advertise`
  is set; RFC 6598 `100.64.0.0/10` (Tailscale-style overlays) counts as
  private, and hostnames are accepted but deliberately never resolved at
  startup — reachability is defined from each peer's network
  ([crates/celld/startup.rs#L42-L96](repo://crates/celld/startup.rs#L42-L96),
  [crates/celld/startup.rs#L241-L248](repo://crates/celld/startup.rs#L241-L248)).
- The open-file limit is raised to the hard ceiling, and startup warns if it
  still caps residency below 1,000 cells (budgeting 8 descriptors per cell)
  ([crates/celld/startup.rs#L111-L155](repo://crates/celld/startup.rs#L111-L155)).

## Fencing is terminal

When the core decides the node has lost authority — today the expired node
lease watchdog — it returns `Effect::Halt { code, reason }`. The actor logs the
`SELF-FENCE:` line naming the cause before going, then sends the code through
a fence channel ([crates/celld/actor.rs#L3730-L3742](repo://crates/celld/actor.rs#L3730-L3742)).
The supervising loop in `main.rs` exits through `exit_flushed(code)`, which
flushes the log guard before the hard `std::process::exit`
([crates/celld/main.rs#L118-L121](repo://crates/celld/main.rs#L118-L121)); an
unexpected actor panic, an unexpected replication-process exit, or a failed
replication health check all take the same `SELF-FENCE` path with exit code 3
([crates/celld/main.rs#L4203-L4231](repo://crates/celld/main.rs#L4203-L4231)).
The fenced state is terminal by design: only a process restart returns the
node to the fleet (see [durability and fencing](../concepts/durability-and-fencing.md)).

Related: [decision core](decision-core.md) ·
[cell lifecycle](../concepts/cell-lifecycle.md) ·
[durability and fencing](../concepts/durability-and-fencing.md) ·
[change guide](../development/change-guide.md)
