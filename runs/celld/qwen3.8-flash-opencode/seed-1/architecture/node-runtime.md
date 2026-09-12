---
type: architecture
title: Node Runtime and Actor Loop
description: How a celld node process starts, binds its listeners, and runs one serial Actor that drives the logic core, plus the asyncrt facade, machine/host sampling, strict env parsing, and the clippy boundary that keeps I/O out of the decision domain.
tags: [architecture, runtime, actor, startup, asyncrt, lint-boundary]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-594c5ed5fc67a4a995238255
    resource: repo://crates/celld/actor/production.rs
  - id: openwiki-source-e0a9f7c0b5fac71c8c311121
    resource: repo://crates/celld/asyncrt.rs
  - id: openwiki-source-3fa7b94a6ed05a0c35f6ec1f
    resource: repo://crates/celld/Cargo.toml
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-55ec5a6f535496955b66f4ff
    resource: repo://crates/celld/host_services.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Node Runtime and Actor Loop

The `celld` binary is a node: one process that embeds V8 and executes the fleet's deployment (README.md, docs/README.md). Its runtime is deliberately a serial event loop around the sans-IO core, wrapped in ambient-IO facades that a lint enforces. See [Sans-IO Decision Core](/openwiki/architecture/decision-core.md) for the core itself and [Architecture Overview](/openwiki/architecture/overview.md) for the crate map.

## Startup: listeners first, everything else after

`crates/celld/startup.rs` holds the process startup primitives: "both sockets are reserved before storage or V8 work starts, and the executor receives an already-validated peer address for the internal socket" (crates/celld/startup.rs#L3-L10). The public listener auto-range is ports 8080–8099 (`AUTO_LISTEN_START`/`AUTO_LISTEN_END`), with an `AutoLoopback`/`LoopbackEphemeral`/`Explicit` bind model and a 4096 backlog (crates/celld/startup.rs#L17-L29).

The advertised address is typed as `Advertise::Addr(SocketAddr)` or `Advertise::Name { host, port }`; a hostname is allowed because container platforms hand out stable names, and it is deliberately *not* resolved here since reachability is defined from each peer's network (crates/celld/startup.rs#L43-L53). `advertise_scope` classifies loopback, private, and shared-overlay ranges, and `is_public_ip` flags the literal public IPs that require `--unsafe-public-advertise` (crates/celld/startup.rs#L61-L98, docs/security.md). On Unix, startup raises the file-descriptor limit from a budget of 8 FDs per cell with a 1,000-cell minimum (crates/celld/startup.rs#L114-L123).

## The serial Actor

`crates/celld/actor.rs` is "the serial lifecycle executor and its shell-side request drivers" (crates/celld/actor.rs#L3). Its shape is a correctness requirement, not a simplification: "One actor serializes every event through `celld-logic`; the actor polls its mailbox, timers, and in-flight effect futures together. This is the execution shape required for monotonic lease ticks to fence the node even when a storage operation remains hung, without spawning a task per effect" (crates/celld/main.rs#L8-L15). A hung bucket call therefore cannot starve the lease-fence timer, because the loop never blocks on a single effect.

The production loop (`Actor::run`, crates/celld/actor/production.rs#L8-L42) is an `asyncrt::select!` over exactly three input families: the `Message` mailbox (route requests, preserve directives), a `FuturesUnordered` of in-flight effect adapters reporting versioned completion events, and a `DelayQueue` of armed timers whose stale ordinals are filtered by `timer_slots.fire`. The selector "stays unbiased because production permits every ready-input order"; deterministic callers bypass `run` and drive `Actor::start`/`Actor::step` directly (crates/celld/actor/production.rs#L9-L13). Each step drives `celld_logic::on_event` (crates/celld/actor.rs#L3908) and drains the produced effects into futures, timers, and mailbox replies.

The Actor struct is executor bookkeeping only: pending route replies, per-cell handoff pipeline timings, the node-log manager handle, the gate-held outputs (`gated_responses` keyed by request+channel, and a per-cell FIFO `ws_gates` so "no client ever sees a frame that trails an unproven write"), and a `fence` sender that carries the core's halt decision out to the process (crates/celld/actor.rs#L1728-L1794). A `validate_invariants` flag re-checks every core invariant after each event: roughly 800 µs per event at 10,000 resident cells, so debug builds and simulation keep the full-table scan and release builds rely on the deterministic model (crates/celld/actor.rs#L1767-L1781, #L2162).

Timers arriving from the core are coalesced into `TimerSlot`s with per-slot ordinals; `OperationDeadline` is keyed by operation because a shared slot "would let arming one silently cancel another", and `QueuedActivation` by cell+generation because "a node parks many cells at once" (crates/celld/actor.rs#L40-L70).

## The asyncrt facade

`crates/celld/asyncrt.rs` "owns the ambient production primitives which the boundary lint prohibits elsewhere": it delegates tasks and timers to Tokio and obtains nondeterministic process values from the host, and "a cfg-gated build can replace this module with another execution backend" (crates/celld/asyncrt.rs#L3-L12). Its surface includes `spawn`/`blocking`/`block_on` with joinable `TaskHandle`s, `wall_ms`/`mono_ms` clocks, `sleep_until`/`timeout_at` keyed to monotonic milliseconds, `fs()` returning the `celld_ltx::FileSystem` the replicator uses, labeled RNG streams (`rng("session")`, `machine.rs`), and the crate's `select!`/`select_biased!` macros documented in docs/library-api.md (crates/celld/asyncrt.rs#L101-L212).

The facade also re-exports a fork of Tokio's internal `select.rs` machinery: every re-exported item is `doc(hidden)` upstream with no compatibility guarantee, so "a Tokio version bump must therefore re-check this facade against the select.rs of the new version", and the chosen failure mode is a compile error in celld, not a silent behavior change (crates/celld/lib.rs#L11-L27).

## Machine and host services

`crates/celld/machine.rs` records "two kinds of fact, both read once at startup or sampled on a timer: the environment the operator set, and the machine underneath — memory, CPU ticks, page size — which is per-platform and therefore duplicated behind `cfg` for each one" (crates/celld/machine.rs#L3-L8). It also mints the per-process identities: the node session ID, the 32-byte peer key, and the process generation (crates/celld/machine.rs#L12-L29).

`crates/celld/host_services.rs` bundles those observations (CPU percent, RSS, etc.) into one service set: "Production installs one service set. A deterministic domain installs one set per simulated node, so co-hosted incarnations do not share counters or host measurements" (crates/celld/host_services.rs#L3-L9). Memory specifics (RSS vs cgroup working set) are covered under [Fleet Operations](/openwiki/operations/fleet-operations.md).

## Strict environment parsing

`crates/celld/env_vars.rs` enforces that "an unset variable selects its caller's documented default. A supplied variable must contain a valid value, so a typo cannot silently change the configuration of a running node", and `validate()` checks every typed production variable up front because some consumers cache values or read them from synchronous callbacks and cannot return an error at the point of use (crates/celld/env_vars.rs#L3-L26). The documented result: "celld exits during startup when a supplied value is invalid" (docs/README.md, Environment variables section).

## The lint-enforced boundary

The architecture boundary is machine-checked. `crates/celld/lib.rs` turns on `#![warn(clippy::disallowed_methods, clippy::disallowed_types)]` and `crates/celld/Cargo.toml` sets `disallowed_macros = "forbid"` (crates/celld/lib.rs#L3, crates/celld/Cargo.toml#L20-L21). `clippy.toml` forbids ambient primitives inside the execution boundary — `tokio::spawn`, `tokio::time::*`, `SystemTime::now`, `Instant::now`, `rand::random`, `std::process::id`, and direct `std::fs::*` — each with a reason pointing at the replacement: `celld::asyncrt::spawn`, the execution-domain clock/RNG, or the injected filesystem (clippy.toml#L4-L26). Printing is bounded the same way: `std::println`/`std::print` are forbidden in favor of `celld::cli_output::Output` for stdout data and the `note!` macro for human stderr (clippy.toml#L84-L86).

Code that legitimately lives outside the Actor execution domain — the V8 arm, telemetry, deploy, CLI paths — carries `#![allow(clippy::disallowed_methods)]` with a comment stating why, for example `runtime.rs` ("RuntimeManager is the V8 cell-host arm, so its executor and observability clocks remain ambient") (crates/celld/runtime.rs#L3-L5) and `telemetry.rs` ("Telemetry is observational and does not affect Actor decisions") (crates/celld/telemetry.rs#L3-L5). The practical rule for changes: new coordination decisions go in `crates/logic` (which has no dependency on Tokio at all, crates/logic/Cargo.toml#L8-L12), and new I/O goes in an adapter that either stays outside the domain by allowance or calls through `asyncrt`.

Related: [Architecture Overview](/openwiki/architecture/overview.md), [Sans-IO Decision Core](/openwiki/architecture/decision-core.md), [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
