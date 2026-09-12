---
type: architecture
title: celld Architecture
description: The node-fleet-cell model, per-cell SQLite, the bucket as root of authority, the clean-sheet decision-core split between crates/logic and crates/celld, and the event-effect control loop.
tags: [architecture, durable-objects, decision-core, actor, bucket]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# celld Architecture

celld is a self-hosted, distributed implementation of Cloudflare Workers and
Durable Objects. One `celld` process is a **node**; the nodes that share one
object-storage bucket form a **fleet**; and each Durable Object instance is a
**cell** — a named server with its own private SQLite database. Exactly one
node owns a cell at a time, and the bucket holds the durable authority that
decides who owns what.

The workspace is deliberately split into a pure decision core and an effect
executor. `crates/logic` owns every behavioral decision and has no I/O, clocks,
randomness, or locks. `crates/celld` is the effect executor and V8 host, and
`crates/ltx` provides the in-process SQLite replication format. This split is
declared at the top of the workspace `Cargo.toml`:

> `crates/logic` owns all behavioral state and decisions; `crates/celld` is
> only an effect executor and adapter host.

## The workspace

The root `Cargo.toml` declares three members — `crates/*` — with every direct
dependency pinned once in `[workspace.dependencies]` so the crates can never
drift onto two versions of one crate (`Cargo.toml` lines 3-5, 33-35).

The release profile is size- and speed-tuned with `lto = "fat"`,
`codegen-units = 1`, `opt-level = "s"`, `panic = "abort"`, and `strip = true`
(`Cargo.toml` lines 9-14). A separate `lab` profile ships unsstripped with
`lto = "thin"`, `codegen-units = 16`, `incremental = true`, and line tables so
`perf` can attribute CPU by function during lab runs (`Cargo.toml` lines
19-27). The binary sets the global allocator to jemalloc because glibc's arena
serialization measurably reduced throughput (`crates/celld/main.rs` lines 44-50).

### Crate boundaries

- **`celld-logic`** (`crates/logic`) is a "pure decision core: no async, I/O,
  clocks, randomness, locks, or dependencies" (`crates/logic/Cargo.toml`). Its
  single entrypoint is `on_event`, and no adapter may mutate `State` directly
  (`crates/logic/lib.rs` lines 3-7). The production executor and the
  deterministic simulator both feed it events and perform the effects it
  returns, which is what makes the coordination protocol deterministically
  testable.
- **`celld`** (`crates/celld`) is the executable. It owns the V8 runtime, the
  HTTP and peer listeners, the SQLite files, the object-store client, and the
  serial actor that repeatedly drives `celld_logic::on_event`
  (`crates/celld/lib.rs` lines 7-10).
- **`celld-ltx`** (`crates/ltx`) provides "embeddable streaming replication
  for a SQLite database": it captures WAL data as LTX segments, restores
  databases, compacts levels, and reads bundle objects (`crates/ltx/src/lib.rs`
  lines 1-11). It is a from-scratch Rust reimplementation of the Litestream v0.5
  replication behavior and the LTX v0.5.2 block format, vendored and owned by
  celld rather than tracked against an upstream branch
  (`crates/ltx/Cargo.toml`).

## The node-fleet-cell model

A cell maps onto a Durable Object: "a small server with a name and a private
SQLite database" (`docs/README.md` line 8-9). Each cell runs on one thread; a
second request interleaves only while the first awaits, and storage operations
are synchronous and never interleave, so the data in a cell stays consistent
(`docs/README.md` lines 12-14). Cells share no database.

Cell lifecycle states mirror Durable Objects (`crates/logic/lib.rs` lines
98-111 and `Phase` at lines 113-190):

- **Inactive** — out of memory and owned by nobody; the initial state of every
  cell and "only an object in the bucket, so it costs almost zero".
- **Resident** — in memory, and either **active** (doing work) or **idle**
  (waiting). The runtime removes an idle cell from memory.
- **Hibernated** — a cell removed from memory that keeps its hibernatable
  WebSocket clients and stays on its node.
- **Dormant** — out of memory but still owned by this node.

A cell keeps no memory across these transitions, so its constructor runs again
on the next event (`docs/README.md` lines 30-34).

The data path is per-cell SQLite: "Each cell is its OWN db file (its own
replicated, epoch-fenced bucket prefix)" (`crates/celld/storage.rs`). `ctx.storage` is async in JS but synchronous underneath (local SQLite), and the JS harness wraps synchronous Rust ops in async rather than hoisting a
separate thread (`crates/celld/storage.rs`).

## The bucket as root of authority

The fleet bucket holds "the deployments, the cell state, the ownership records,
the node leases, and the peer-authentication secret" (`docs/security.md`
lines 141-143). Two properties make this the authority:

1. **Conditional writes.** celld claims a cell by writing a small ownership
   record "with a condition the storage enforces — the write succeeds only if
   nobody else changed the record first" (`docs/README.md` lines 40-43). The
   bucket therefore "decides who wins, and two nodes cannot both claim the same
   cell". The claim expires unless the node keeps renewing it, so a dead
   machine releases its cells without a membership protocol or failure detector
   (`README.md` lines 19-22).
2. **Read-after-write consistency.** Together with the conditional create and
   conditional overwrite, this is one of three properties the object store must
   provide (`docs/guarantees.md` lines 18-24). Qualified stores are Amazon S3,
   Cloudflare R2, Tigris, Google Cloud Storage, and Azure Blob Storage; celld
   runs the release tests against R2 (`docs/guarantees.md` lines 26-28).

The ownership record names the owner's node session and carries a fencing
epoch. Every activation advances the epoch, so the replicator writes each
cell's SQLite data under `cells/<cell>/ltx/e<epoch>/`, and an epoch never has
two writers (`docs/guarantees.md` lines 108-131). A node that lost ownership
can keep writing, but its writes land in a superseded prefix.

## The clean-sheet decision core

`State` in `crates/logic/lib.rs` holds all authoritative coordination state. It
tracks each cell's `Phase`, the node authority (a lease in
`NodeAuthority`), withheld outputs behind the durability gate (`barriers`),
activation and capacity admission queues, the shedding latch, and the current
application generation.

The core never reads a clock: "the core never asks what time it is, it
remembers what it was told" (`crates/logic/lib.rs` lines 591-599). Authority is
evaluated at ask time against the published lease expiry on the remembered
monotonic clock, not by trusting a timer to have fired
(`crates/logic/lib.rs` lines 714-737). This is what lets a suspended VM still
refuse a request after resume.

The `celld-logic` crate deliberately has no I/O so that "the clock, the
randomness, and the object store are interfaces, and a simulator drives the
core" (`docs/testing.md` lines 88-95). The simulated store injects latency,
compare-and-swap races, and lost responses.

### Cell phases

The `Phase` enum (lines 113-190) enumerates the state a single cell crosses:
`Inactive`, cold-activation queuing (`WaitingActivation`), owner/lease reads
(`ReadingOwner`, `ReadingNodeLease`), the lease-fold recovery interlock
(`RecoveringOwnerLog`), capacity admission (`ReadingCapacity`,
`WaitingCapacity`), the conditional claim (`Acquiring`,
`ReconcilingAcquire`), restore (`Restoring`), runtime start/publish
(`Starting`, `Publishing`), durability proof (`EnsuringDurability`), stop
(`Cleaning`), `Dormant`, successor handoff (`Adopting`), `Resident`, and
`Remote` (cell owned by another node) and the terminal `Fenced`. The funnel
`phase_name` maps these onto stable report strings that `/state` and
`celld diagnose` publish (`crates/logic/lib.rs` lines 212-240).

### Admission and fairness

Two FIFO queues bound concurrency. `activation_waiters` bounds cold-cell
activation to `max_activations`, and `capacity_waiters` bounds residency to
`max_resident`. The capacity waiters are FIFO deliberately: "waking every
waiter on a release and letting them race is unfair by construction — under
sustained eviction a waiter can time out while thousands of slots are freed
around it", and a queue converts "eventually, probably" into a bound
(`crates/logic/lib.rs` lines 539-545). The same rationale applies to the
activation waiters.

## The actor serialization model

The executable runs one serial actor as "the only caller of
`celld_logic::on_event`" (`crates/celld/lib.rs` lines 7-10). Adapter futures
never borrow core state; they send versioned completion events back through the
actor mailbox and the actor re-enters `on_event`.

`main.rs` states the shape explicitly (lines 9-13): "One actor serializes every
event through `celld-logic`; the actor polls its mailbox, timers, and in-flight
effect futures together. This is the execution shape required for monotonic
lease ticks to fence the node even when a storage operation remains hung,
without spawning a task per effect."

The `actor` module owns the shared timer discipline via `TimerSlots` and the
`TimerSlot` enum, which keys deadlines by operation and queued activations by
cell/generation so one arming cannot silently cancel another
(`crates/celld/actor.rs` lines 39-68).

### Events and effects

The control loop is a closed circuit: the core emits an `Effect` describing an
I/O or runtime intent; the effect adapter performs it without touching `State`;
and the adapter sends back a versioned `Event` describing the outcome, which
the core consumes to advance `State`. Because `State` only ever advances
through `on_event`, every transition is replayable by the deterministic
simulator.

Fenced or lagged runtime operations are not silently dropped. The core keeps
`retired_runtime_ops` so that "Start/publish effects invalidated by fencing may
still commit. Their late completion must trigger compensating cleanup, not be
ignored" (`crates/logic/lib.rs` lines 567-569). Runtime starts that exceed
their deadline but still own a live executor task are tracked in
`timed_out_runtime_starts`, because a start cannot be cancelled safely and the
core keeps its phase until the real completion arrives (lines 574-576).

## The output gate

Every egress that can reveal a cell's state passes through one choke point —
the output gate — which withholds a response until every write it can reveal is
proven durable (`crates/logic/output_gate.rs`). This is the RPO=0 guarantee:
"celld does not answer a write until the data survives a failure"
(`docs/guarantees.md`). The gate holds each response behind a `Barrier`, and a
fence drains the gate to a failed response so a write is never acknowledged
after the node loses authority (`crates/logic/lib.rs` lines 513-522).

## Upstream and downstream relationships

- **Upstream of the core:** the network listeners (public Worker ingress,
  internal peer/operator listener), the V8 runtime, and the object-store
  client all feed `Event`s into the actor.
- **Downstream of the core:** `Effect`s drive cell activation/stop, durability
  proofs, ownership CASes, peer forwarding, and telemetry.
- **Replication and storage:** `crates/celld` wires `celld-ltx` (the
  per-cell `Db`) to the shared object-store client, laid out as
  `cells/<cell>/ltx/e<epoch>/` in the bucket (`crates/celld/ltx_repl.rs`).

## Configuration and failure behavior

Configuration surfaces as environment variables and command-line flags, and is
parsed strictly: "An unset variable selectives its documented default. A
supplied variable must contain a valid value, so a typo cannot silently change
the configuration of a running node" (`crates/celld/env_vars.rs`). A
validation pass exits at startup on a malformed value.

Failure modes center on the lease and the fencing epoch: a node that cannot
renew its lease or whose record was replaced fences itself and exits code 3
(`docs/guarantees.md` lines 200-228). The failure of a node is treated as a
normal input rather than a recovery procedure.
