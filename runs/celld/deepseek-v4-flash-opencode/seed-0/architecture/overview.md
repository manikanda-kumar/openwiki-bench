---
type: architecture
title: Architecture Overview
description: The node/fleet/cell model, the clean-sheet sans-I/O decision core (celld-logic) versus the effect-executor shell (celld), the serial actor execution shape, the crate boundaries, and the major subsystems.
tags: [architecture, actor, decision-core, crates, celld]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-e0a9f7c0b5fac71c8c311121
    resource: repo://crates/celld/asyncrt.rs
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Architecture Overview

celld is a self-hosted, distributed Durable Objects runtime. It runs
Cloudflare Workers and Durable Objects on your own machines, storing the
long-term state in a bucket you own (S3-compatible, Google Cloud Storage,
or Azure Blob Storage), with no serving control plane and no consensus
service (README.md#L3-L11).

## The model: node, fleet, cell

- A **node** is one `celld` process, run one on each machine. Each node
  embeds V8 and executes Wrangler bundles.
- The nodes that share one bucket are a **fleet**. The bucket holds the
  deployments, the cell state, and small ownership records.
- A **cell** is a Durable Object: a named server with its own SQLite
  database. Exactly one node owns a cell at a time; a conditional bucket
  write gives a node the ownership of a cell, so there is no membership
  protocol, no failure detector, and no consensus service
  (README.md#L14-L22).

A cell has the same states as a Cloudflare Durable Object — resident
(active or idle), hibernated, and inactive — and a cell that nothing is
serving costs almost nothing (docs/README.md#L22-L28).

## Crate boundaries

The workspace is a deliberate three-way split (Cargo.toml#L1-L7):

- **`crates/logic`** — the clean-sheet **decision core**. It owns all
  behavioral state and decisions, and it is *sans-IO*: the clock, the
  randomness, and the object store are interfaces, and the same core is
  driven by the production executor and by a deterministic simulator
  (crates/logic/lib.rs#L1-L6, docs/testing.md#L88-L95).
- **`crates/celld`** — the executable and library shell. It is only an
  **effect executor and adapter host**: the V8 runtime, the bucket
  client, the listeners, and the replicator live here and perform the
  effects the core returns (Cargo.toml#L1-L2).
- **`crates/ltx`** — the embeddable streaming replication library that
  captures committed SQLite WAL data as LTX segments, restores
  databases, and compacts levels; a from-scratch Rust reimplementation
  of Litestream v0.5.11 with the LTX v0.5.2 block format
  (crates/ltx/src/lib.rs#L3-L8).

Every direct dependency is declared once in `[workspace.dependencies]`
so the crates can never drift onto two versions of the same crate
(Cargo.toml#L12-L13).

## The serial actor and the event loop

The decision core advances only through `on_event`, which consumes one
`Event` and returns a list of `Effect`s (crates/logic/lib.rs#L5215).
The production executable runs **one serial actor** that is the only
caller of `on_event`; the actor polls its mailbox, its timers, and its
in-flight effect futures together, in a single `step` that handles one
ready input (crates/celld/lib.rs#L5-L9, crates/celld/main.rs#L7-L10,
crates/celld/actor.rs#L2184-L2206).

This execution shape is required: monotonic lease ticks must be able to
fence the node even when a storage operation remains hung, without
spawning a task per effect (crates/celld/main.rs#L7-L10). Adapter
futures never borrow core state; they send versioned completion events
back through the actor's mailbox (crates/celld/lib.rs#L5-L9).

Each event is applied through `drive`, which executes the returned
effects (performing I/O, arming timers, pushing immediate follow-up
events) until the queue empties, then validates core invariants in debug
builds (crates/celld/actor.rs#L2743-L2776).

## The major subsystems

- **Object store** — one bucket client bound to one bucket, speaking
  three conditional-write dialects: S3 (`If-Match`/`If-None-Match` etag
  CAS), Cloud Storage XML API (`x-goog-if-generation-match`), and Azure
  Blob (the S3 etag dialect on Put Blob) (crates/celld/bucket.rs#L5-L15).
- **Ownership and leases** — per-cell ownership records
  (`cells/<cell>/own.json`) written with conditional writes, node leases
  (`nodes/<node>.json`), and fleet discovery through the bucket
  (crates/celld/ownership_store.rs#L289-L350). The decisions live in
  `celld-logic`; the adapter only serializes, samples the wall clock, and
  classifies errors (crates/celld/ownership_store.rs#L5-L8).
- **Replication** — an in-process `celld-ltx` `Db` per resident cell
  captures the committed WAL and uploads it on demand to
  `cells/<cell>/ltx/e<epoch>/`, so a just-written cell is registered the
  instant it activates (crates/celld/ltx_repl.rs#L3-L15). The fleet
  durability tier streams uncaptured segments to a follower ensemble over
  the signed peer transport (crates/celld/node_log.rs#L3-L12).
- **V8 runtime** — rusty_v8 directly, with one isolate per cell. The
  `js` module runs actual Durable Objects, and the isolate pool owns the
  isolates and the counters while `celld-logic::isolate` makes every
  policy choice (crates/celld/pool.rs#L1-L9, crates/celld/js.rs#L1-L3).
- **Control plane** — the public Worker listener and the internal peer
  and operator listener, both bound by shared startup primitives before
  storage or V8 work starts (crates/celld/startup.rs#L1-L7).
- **Deployment** — `celld deploy` builds a Wrangler project and writes
  deployment objects directly to the bucket; each node reads
  `deploy/current.json` and adopts new deployments in place
  (crates/celld/fleet.rs#L628, docs/README.md#L245-L255).

## The async runtime facade

`celld::asyncrt` is the production execution facade: it delegates tasks
and timers to Tokio and obtains nondeterministic process values from the
host, and a cfg-gated build can replace the whole module with another
execution backend — which is how the deterministic simulator shares the
same core logic (crates/celld/asyncrt.rs#L1-L7). The actor's `select`
facade is adapted from Tokio's `select.rs` and documented as such so a
Tokio version bump re-checks the facade (crates/celld/lib.rs#L11-L29).

## Failure handling

Failures are normal inputs, not recovery procedures. A node that loses
its lease fences itself and exits with code 3 (a `SELF-FENCE:` log
line), and a supervisor restarts the process
(docs/guarantees.md#L200-L228). The output gate ensures no acknowledged
write is lost, and ambiguous object-store results are kept ambiguous
rather than guessed — a write that may have landed is never retried
blindly (docs/guarantees.md#L43-L52).
