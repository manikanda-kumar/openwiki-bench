---
type: architecture
title: System architecture and ownership boundaries
description: The three-crate workspace split — celld-logic as the pure decision core, celld-ltx as SQLite replication, and celld as the effect executor and adapter host — the single serial actor that drives them, and the node/fleet/cell mental model.
tags: [architecture, actors, crates, event-effect]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
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
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# System architecture and ownership boundaries

celld is a self-hosted, distributed Durable Objects runtime. Each cell (a
Durable-Object-equivalent) is a named server with its own SQLite database;
the long-term state lives in an object-storage bucket; and the nodes that
share one bucket form a fleet. The defining architectural fact is a strict
separation between decision and execution: the workspace comment in
`Cargo.toml:1-5` states it directly — `crates/logic` owns all behavioral
state and decisions, and `crates/celld` is only an effect executor and
adapter host.

## The three crates

The workspace (`Cargo.toml`) has three members with distinct responsibilities:

- **`celld-logic`** (`crates/logic`) — the decision core. Its manifest declares
  a *pure* library: "no async, I/O, clocks, randomness, locks, or
  dependencies" (`crates/logic/Cargo.toml:8`). It has no `[dependencies]` at
  all. It is a state machine over a `State` struct, and it cannot be mutated
  from outside.
- **`celld-ltx`** (`crates/ltx`) — an in-process SQLite → object-store
  replication library, vendored from Litestream/LTX and evolved by celld
  (`crates/ltx/Cargo.toml:1-15`). It captures WAL data as LTX segments, reads
  and writes replica storage, restores databases, and compacts levels.
- **`celld`** (`crates/celld`) — the executable and library adapter host. It
  owns the V8 runtime, the HTTP listeners, the object-store client, the peer
  protocol, the CLI, and the serial actor that connects everything.

`crates/celld` depends on `celld-logic` and `celld-ltx`; neither depends on
the other. The dependency direction is always toward the pure core.

## The Event/Effect boundary

The vocabulary of the core is in `crates/logic/types.rs`. Its module doc
(`crates/logic/types.rs:5-7`) is the contract: "`Event` is the only way in,
`Effect` the only way out, and the rest are the shapes those two carry. No
decision is made in this file." The production executor and the deterministic
simulator both feed `Event`s to `celld_logic::on_event` and perform the
returned `Effect`s, so the two executors cannot diverge in behavior
(`crates/logic/lib.rs:3-7`).

An `Event` names facts the shell observed: a request arrived, a lease write
landed, a durability proof completed, a timer fired, a WebSocket closed. An
`Effect` names work the core has decided must happen outside: read the
ownership record, start a runtime, prove a position durable, release a
withheld output, halt the process. Every asynchronous effect is versioned by
an operation id, and completion events with an obsolete `op` are ignored
(`crates/logic/types.rs:737-739`), so late completions cannot corrupt a newer
decision.

## The serial actor

The executable runs one serial actor that is the *only* caller of
`celld_logic::on_event` (`crates/celld/lib.rs:5-9`). The actor polls its
mailbox, timers, and in-flight effect futures together. The module doc of
`main.rs` explains why this shape matters: "This is the execution shape
required for monotonic lease ticks to fence the node even when a storage
operation remains hung, without spawning a task per effect"
(`crates/celld/main.rs:7-12`).

The mailbox carries `Message`s (`crates/celld/actor.rs:327-416`) such as
`Request`, `Output`, `WebSocketOpened`, `ActivityFinished`, `ReleaseAll`, and
`GenerationChanged`. Adapter futures never borrow core state; they send
versioned completion events back through the mailbox, so the core remains the
single writer of its own state. After every event the core runs
`State::validate` (`crates/logic/lib.rs:1073+`), which checks the structural
invariants — that every activation permit is held by a cell in an activation
phase, that the `occupied` counter agrees with a walk of the cell map, and so
on.

## Nodes, fleets, and cells

A **node** is one `celld` process, and you run one on each machine. The nodes
that share one bucket are a **fleet**; that bucket holds the deployments, the
cell state, and small ownership records. A **cell** is a Durable Object: a
named server with its own SQLite database, which any node in the fleet can
serve. A node claims a cell by writing an ownership record to the bucket with
a condition the storage enforces, so exactly one node owns a cell at a time —
no membership protocol, no failure detector, no consensus service.

The bucket supplies discovery and authority, not network reachability. Nodes
find each other through the leases in the bucket; there is no join command and
no fixed membership list. Signed peer HTTP carries routing and replicated-log
transport over the internal listener.

## The replayable core

The core keeps the concurrency bounds as replayable state rather than as
executor task counts: activation permits, eviction permits, and capacity
waiters are all fields of `State` (`crates/logic/lib.rs:528-558`). The
deterministic simulator drives the same core with a seeded scheduler and
scripted adversaries, which is how the protocol is verified under adversarial
schedules without V8 (see the [testing page](../testing/verification.md)).
The clock, the randomness, and the object store are interfaces the executor
supplies, never facts the core reads for itself.

## The asyncrt facade

`celld::asyncrt` re-exports Tokio's select machinery behind a facade that adds
a deterministic `select!` (fair, cycling its start for each poll, rejecting
the `biased;` token) and `select_biased!` (source-ordered, requiring a reason
string). The facade is a vendored adaptation of Tokio's select macros and is
documented as having no compatibility guarantee (`crates/celld/lib.rs:11-29`).
Under the internal-tests flag the module is replaced by a simulated asyncrt,
so the conformance suites see the same simulated world the in-crate suites see
(`crates/celld/lib.rs:305-320`).

## Process-level choices

The binary installs jemalloc as the global allocator — glibc's malloc
serialized its arenas behind futexes and cost up to half a millisecond per
acquisition under load, while jemalloc measured 20% more hello-world
throughput (`crates/celld/main.rs:44-50`). `main` validates the environment,
parses the telemetry config, installs the rustls ring provider, initializes
V8 before any worker thread exists, and then runs the async main on a
multi-threaded Tokio runtime (`crates/celld/main.rs:2988-3005`).

## Related pages

- [Cell lifecycle and ownership](cell-lifecycle.md) — the phases and routing decisions the core owns.
- [Durability, fencing, and the output gate](durability-protocol.md) — the ownership and RPO=0 protocol the core enforces.
- [SQLite replication and the LTX log tier](replication.md) — the `celld-ltx` library the actor drives.
- [V8 runtime and Cloudflare Workers compatibility](workers-runtime.md) — the largest adapter the host owns.
