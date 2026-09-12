---
type: architecture
title: "Architecture and crate boundaries"
description: "How the celld workspace splits decision-making (celld-logic) from effects (celld) and replication (celld-ltx), and how the single actor serializes events."
tags: [architecture, actor, decisions, effects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-7091fbd5baa39fe548c0e34d
    resource: repo://crates/celld/control_plane.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Architecture and crate boundaries

celld is a Rust Cargo workspace with exactly three crates, and the split follows
one rule stated in the workspace manifest: "`crates/logic` owns all behavioral
state and decisions; `crates/celld` is only an effect executor and adapter
host" (`Cargo.toml`, workspace header comment). The third crate,
`celld-ltx`, is the embeddable SQLite streaming-replication engine
(`crates/ltx/src/lib.rs:4-9`).

## The three crates

| Crate | Role | Size | Key surfaces |
|---|---|---|---|
| `celld-logic` (`crates/logic`) | Decision core: all behavioral state transitions | ~17 modules, `crates/logic/lib.rs` ~5,500 lines | `on_event`, `State`, `Event`, `Effect` |
| `celld` (`crates/celld`) | Production executor, V8 host, adapters, CLI binary | `js.rs` 9k lines, `main.rs` ~4.9k lines | `actor`, `js`, `bucket`, `ltx_repl`, `peer_auth`, CLI |
| `celld-ltx` (`crates/ltx`) | SQLite WAL\→LTX streaming replication library | `replica.rs`, `db.rs`, `wal.rs`, `compactor.rs` | `Db`, `Replica`, LTX segment format |

Nothing else is a member; the resolver and every direct dependency are pinned
in `[workspace.dependencies]` "so the crates can never drift onto two versions
of the same crate" (`Cargo.toml`).

## The decision core: `on_event` is the only door

`crates/logic/lib.rs` opens with the invariant in its module doc: "[`on_event`]
is the only way behavioral state advances. The production executor and
deterministic simulator both feed it events and perform the returned effects.
No adapter may mutate [`State`] directly" (`crates/logic/lib.rs:3-6`). The
function signature is total and single-threaded in shape:

```rust
pub fn on_event(state: &mut State, event: Event) -> Vec<Effect>   // crates/logic/lib.rs:5215
```

- **Input** is an `Event` (`crates/logic/types.rs:402`): node-lease starts and
  CAS completions, `RequestAt`/`CapacityRequestAt`/`HandoffRequestAt` ingress,
  `TimerFired`, `WebSocketRequestAt`, local-cell scans, and similar completion
  events with sampled wall/monotonic clocks attached.
- **Output** is a list of `Effect`s (`crates/logic/types.rs:740`): schedule a
  timer, CAS a node lease or owner record, recover a dead node's log, read
  capacity peers, reconcile a wake entry, and so on.

The design consequence is stated where it matters: every effect carries an
`OpId`, and the core rechecks reality when the completion event returns
(`crates/logic/types.rs:412-429`), so the executor never "does" semantics —
it reports what happened and the core decides again. Load-bearing comments
explain why clocks are *events*, not free variables: `now_mono_ms` anchors the
first lease TTL to the monotonic instant it was sampled, so "a slow boot [does
not discard] a perfectly good lease" (`crates/logic/types.rs:404-410`), and
`NodeLeaseCasCompleted` carries the log state the shell actually stamped into
the attempt's body, so core readback comparisons "must use this value, never
its pre-attempt belief" (`crates/logic/types.rs:418-429`).

This shape exists for two reasons the code names explicitly:

1. **Fencing under a hung IO.** The binary's doc comment: the "actor polls its
   mailbox, timers, and in-flight effect futures together. This is the
   execution shape required for monotonic lease ticks to fence the node even
   when a storage operation remains hung, without spawning a task per effect"
   (`crates/celld/main.rs:9-12`).
2. **Deterministic simulation.** Because logic is a pure event\→effects
   function over `State`, a simulator can drive the same events as production
   ("the production executor and deterministic simulator both feed it events",
   `crates/logic/lib.rs:3-6`). The test strategy page covers how the
   repositories exercise this.

## The executor: one actor, many effects

`crates/celld/actor.rs` is the "serial lifecycle executor and its shell-side
request drivers" (module doc, `crates/celld/actor.rs:3`). One actor owns the
execution domain: it "handles exactly one ready mailbox item, completion, or
timer" at a time (`crates/celld/actor.rs:2184`), multiplexing its mailbox,
timers (`TimerSlot`) and in-flight effect futures via `FuturesUnordered`
(`crates/celld/actor.rs:27-29`). The `logic::State` and `Event`/`Effect` types
it imports (`crates/celld/actor.rs:14-18`) are the same ones the simulator
drives.

Around the actor, `crates/celld` is organized as adapters, each of which
declares itself outside the decision domain:

- `ownership_store.rs`: "Bucket ownership effect adapter, over either
  conditional-write dialect… Serialization, wall-clock sampling, SDK
  configuration and error classification only. Ownership decisions remain in
  `celld-logic`" (module doc, `crates/celld/ownership_store.rs:5-8`).
- `deploy.rs`: "Deployment is an operator control-plane path outside the Actor
  execution domain" (module doc).
- `control_plane.rs`: "Managed control-plane sessions execute outside the
  Actor execution domain" (module doc).
- `js.rs`: "The raw V8 adapter and its child modules remain outside the Actor
  execution domain. The Actor-reachable wake and WebSocket state is injected
  through HostServices" (module doc).

`main.rs` is the vertical slice: connection, startup, shutdown, and the V8
shell, with "the library Actor own[ing] the execution domain and its routed
adapters" (`crates/celld/main.rs:7-8`).

## The replication engine: `celld-ltx`

`crates/ltx/src/lib.rs` positions itself as "embeddable streaming replication
for a SQLite database. It captures WAL data as LTX segments, reads and writes
replica storage, restores databases, compacts levels, and reads bundle
objects. The original replication behavior is a from-scratch Rust
reimplementation of Litestream v0.5.11. The block format follows LTX v0.5.2"
(`crates/ltx/src/lib.rs:4-9`). It is embedded by `crates/celld/ltx_repl.rs`,
which runs "one managed `celld_ltx::Db` per resident cell that captures the
cell's committed WAL and uploads it on demand" (`crates/celld/ltx_repl.rs:5-7`).
The durability flow lives in the replication page; architecturally, the note
is that `ltx_repl.rs` "builds its own object-store clients rather than going
through `bucket::Bucket`, so it carries the fleet's key prefix itself: without
that, two fleets sharing one bucket would replicate over each other"
(`crates/celld/ltx_repl.rs:10-13`).

## Ownership map (where a change goes)

| Question | Where it lives | Evidence |
|---|---|---|
| Should X happen next for a cell/lease/log? | `crates/logic/*` | `crates/logic/lib.rs:3-6` |
| How do we talk to the object store? | `crates/celld/bucket.rs`, `ownership_store.rs`, `ltx_repl.rs` | module docs |
| How does JavaScript execute? | `crates/celld/js.rs`, `js/` shims, `asyncrt.rs`, `host_services.rs` | `crates/celld/js.rs:9-15` |
| How do peers talk? | `crates/celld/peer_auth.rs`, `peer_probe.rs`, `main/peer_tunnel.rs`, `protocol.rs` | `crates/celld/peer_auth.rs:15-26` |
| What is deployed? | `crates/celld/deploy.rs`, `protocol.rs`, `generation.rs` | `crates/celld/deploy.rs:8-12` |
| Which commands exist? | `crates/celld/main/cli.rs` | `crates/celld/main/cli.rs:69-107` |

There is intentionally no fourth crate for the simulator or the host
services; the binary keeps all connection/startup/V8-shell code and the
library keeps the Actor ("The binary contains connection, startup, shutdown,
and V8 shell code. The library Actor owns the execution domain and its routed
adapters", `crates/celld/main.rs:5-8`).

## Unknowns

- The deterministic simulator harness is referenced by module docs but no
  standalone simulator crate is present in the tree; the test suites in
  `crates/celld/lib.rs` (conformance and fault modules,
  `crates/celld/lib.rs:299-390`) are the closest code. See the testing page.
- Release binaries, not always the `lab` profile, are what users run; the
  workspace comment says the lab profile is "the lab fast loop" (`Cargo.toml`)
  and does not establish where any of the results are compared.
