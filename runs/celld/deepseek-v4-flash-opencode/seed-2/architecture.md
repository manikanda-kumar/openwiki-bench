---
type: architecture
title: celld system architecture
description: How celld runs Cloudflare Workers and Durable Objects as self-hosted cells on your own machines, the three-crate layering, the single-actor decision core, and the primary control and data flows.
tags: [architecture, durable-objects, rust, distributed-systems]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# celld system architecture

celld is an open-source daemon that runs Cloudflare Workers and Durable
Objects on machines you own. Each Durable Object is a **cell**: a named
server with its own SQLite database. A node is one `celld` process, and the
nodes that share one bucket are a **fleet**; the bucket holds the
deployments, the cell state, and small ownership records. celld needs no
serving control plane and no consensus service — a conditional bucket write
gives a node ownership of a cell, so exactly one node owns a cell at a time
(README.md#L1-L23).

## Ownership boundaries: a three-crate split

The workspace is deliberately split so that all behavioral decisions live in
one crate and every other crate only executes them:

- **`celld-logic`** (`crates/logic`) is the "clean-sheet celld decision
  core". `on_event` is the only way behavioral state advances; the production
  executor and the deterministic simulator both feed it events and perform
  the returned effects, and no adapter may mutate `State` directly
  (crates/logic/lib.rs#L3-L7). It performs no I/O of its own: the clock, the
  randomness, and the object store are interfaces, and a simulator drives the
  core (docs/testing.md#L88-L95).
- **`celld`** (`crates/celld`) is the effect executor and adapter host. The
  `Cargo.toml` states the contract: "`crates/logic` owns all behavioral state
  and decisions; `crates/celld` is only an effect executor and adapter host"
  (Cargo.toml#L1-L2). It owns the V8 engine, the HTTP listeners, the bucket
  client, the replication executor, and the CLI.
- **`celld-ltx`** (`crates/ltx`) is an embeddable streaming-replication
  library for SQLite: it captures WAL data as LTX segments, reads and writes
  replica storage, restores databases, compacts levels, and reads bundle
  objects. It is a from-scratch Rust reimplementation of Litestream v0.5.11,
  with the block format following LTX v0.5.2 (crates/ltx/src/lib.rs#L3-L13).

The split is what makes the coordination protocol testable: the pure
decision core is replayed by a seeded scheduler, so a failure is not a fluke
(docs/testing.md#L96-L103).

## The execution model

The binary runs one serial actor that is the only caller of
`celld_logic::on_event`. The actor polls its mailbox, timers, and in-flight
effect futures together; adapter futures never borrow core state, and they
send versioned completion events back through the mailbox
(crates/celld/lib.rs#L5-L9). This single-threaded-through-the-core shape is
required so monotonic lease ticks can fence the node even when a storage
operation remains hung, without spawning a task per effect
(crates/celld/main.rs#L7-L13).

The core is an event/effect machine:

- `Event` is the only way in and `Effect` the only way out; both are data
  types defined in `crates/logic/types.rs`
  (crates/logic/types.rs#L401-L402). Events include `Request`, `OwnerRead`,
  `OwnerCasCompleted`, `DurableReached`, `RestoreCompleted`,
  `RuntimeStarted`, `NodeFenced`, and `ReleaseAll`.
- Every asynchronous effect is versioned by an operation id; completion
  events with an obsolete `op` are ignored
  (crates/logic/types.rs#L737-L744). Effects include `ReadOwner`,
  `CasOwner`, `CasNodeLease`, `Restore`, `StartRuntime`, `Publish`,
  `AwaitDurable`, `VerifyOwnership`, `StopRuntime`, `FireAlarm`, and
  `Release`.
- The core stores a channel for each output and hands it back; it never
  reads it. `Channel` enumerates every external route a cell's state can
  leave the process: `Response`, `Fetch`, `WsHibernatable`, `WsSelf`,
  `Service`, `CellRpc`, and `Queue` (crates/logic/types.rs#L334-L354).

## Nodes, fleets, and cells

- **Cell**: one Durable Object — a small server with a name and a private
  SQLite database. Cells share no database; each cell runs on one thread, a
  second request interleaves only while the first awaits, and storage
  operations are synchronous and never interleave
  (docs/README.md#L8-L15).
- **Node**: one `celld` process on one machine. It embeds V8 and executes
  Wrangler bundles (README.md#L16-L18).
- **Fleet**: the nodes that share one bucket. Any node can serve any cell,
  so capacity is added by starting another node against the same bucket
  (docs/README.md#L17-L21). Nodes discover owners and peers from bucket
  leases; there is no account or join service (README.md#L185-L187).
- **The bucket** is the root of authority. It stores the deployments, the
  SQLite replicas, the ownership records, the node leases, and the shared
  peer-authentication secret (docs/security.md#L138-L145). A person who
  holds the bucket credentials controls the fleet.

A cell has the same states as a Cloudflare Durable Object: **resident**
(active or idle in memory), **hibernated** (out of memory but keeping its
hibernatable WebSockets on its node), **inactive** (an object only in the
bucket, owned by nobody), and **remote** (owned by another node). Every cell
starts inactive (docs/README.md#L22-L34).

## Control flow: a request to a cell

A request for a cell enters the actor as an `Event::Request`/`RequestAt`.
The core resolves ownership through its phase machine
(`Phase::ReadingOwner` → `ReadingNodeLease` → `RecoveringOwnerLog` →
`ReadingCapacity` → `WaitingCapacity` → `Acquiring` → `ReconcilingAcquire` →
`Restoring` → `Starting` → `Publishing` → `Resident`; crates/logic/lib.rs#L113-L190),
emitting effects such as `ReadOwner`, `CasOwner`, `Restore`, `StartRuntime`,
and `Publish` that adapters perform. If the cell is owned by another node
the core routes it to a `Remote` phase (crates/logic/lib.rs#L180-L188), and
the adapter proxies the call over the signed peer transport. Management and
inspection traffic reads the same state machine through the
`PresenceSnapshot` projection, which carries each resident cell's exact
fencing epoch (crates/logic/types.rs#L48-L54).

The `Config` type in the core carries the admission ceilings the core
enforces: `max_resident`, `max_activations`, `max_evictions`, `max_releases`,
`max_outbound_websockets`, and the pressure configuration
(crates/logic/types.rs#L62-L136). The shell builds this from the environment
(`crates/celld/machine.rs`) and the core makes every decision from it, so a
deterministic schedule can replay the decisions.

## Data flow: durable writes

Each cell's SQLite database runs in WAL mode. Every committed write is
captured as LTX data and uploaded to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs
(crates/celld/ltx_repl.rs#L10-L15; docs/guarantees.md#L120-L128). The epoch
in the object key is the fence: a node that lost ownership can keep writing,
but its writes land in a superseded prefix, and a restore selects the current
lineage (docs/guarantees.md#L120-L128).

celld does not acknowledge a write until a durability proof covers it
(RPO=0). With `CELLD_DURABILITY=fleet` (the default), the owner sends each
write to one or two follower nodes that fsync it and answers as soon as they
hold it on disk; the bucket upload finishes afterwards. A single node has
nobody to send to, so every write waits for the bucket
(docs/README.md#L51-L59). The output gate withholds each response until the
proof lands (crates/logic/types.rs#L500-L536); see the
[ownership and durability](ownership-and-durability.md) page for the
mechanism.

## Runtime and build entrypoints

- **Binary entry**: `crates/celld/main.rs` (the `celld` binary) and its CLI
  parser `crates/celld/main/cli.rs`. The process uses jemalloc as the global
  allocator, chosen after a measured throughput comparison against glibc
  malloc (crates/celld/main.rs#L44-L50).
- **Library surface**: `crates/celld/lib.rs` re-exports the adapter modules.
  The `celld` crate additionally provides a fair `select!` facade
  (`crates/celld/lib.rs` implements the macro machinery; the documented
  contract is in docs/library-api.md).
- **Release profile**: size-tuned (`opt-level = "s"`, fat LTO, `panic =
  "abort"`, stripped); a `lab` profile trades the fat-LTO relink for thin LTO
  and keeps line tables for `perf` (Cargo.toml#L8-L27).
- **CI**: `.github/workflows/release.yml` builds Linux x86-64, Linux ARM64,
  and Apple Silicon binaries from a `candidate` branch, attests provenance,
  and publishes the container image `ghcr.io/denoland/celld` on a published
  release.

## Two HTTP surfaces

A node opens two HTTP listeners (docs/security.md#L21-L34):

- The **public listener** (`--listen`) serves the deployed Worker. It
  reserves only `/.well-known/celld/health`; the deployed Worker owns every
  other public path.
- The **internal listener** (`--internal-listen`) serves the peer protocol
  and the operator API. Its default address is `127.0.0.1:0`, so celld
  selects an available loopback port at each start; `--advertise` gives
  peers an address that reaches it.

celld does not terminate TLS on either listener; the private network is the
security boundary (docs/security.md#L78-L80). See the
[security](security.md) page for the complete boundary.

## Invariants and failure behavior

- **One writer per cell**: the ownership records use conditional writes, so
  two nodes cannot acquire one cell, and each activation advances the epoch,
  so an epoch never has two writers (docs/guarantees.md#L108-L118).
- **RPO=0**: a write is acknowledged only after a durability proof covers
  it; a failed or ambiguous proof refuses the response
  (crates/logic/types.rs#L500-L536).
- **Lease-based self-fencing**: each node holds a lease in the bucket that it
  renews after one third of its lifetime; when the published expiry passes,
  the node fences itself, fails its outstanding requests, and exits with
  code 3 (docs/guarantees.md#L201-L224).
- **Operation deadlines**: a non-restore operation is bounded by
  `CELLD_OPERATION_DEADLINE_MS` (default 15000), so a swallowed effect cannot
  park a request forever (crates/logic/types.rs#L112-L120).

## Extension seams

- The **decision core** is the seam for protocol change: add an `Event`,
  an `Effect`, and a phase transition in `crates/logic`, then implement the
  effect in an adapter. The deterministic simulator and the TLA+
  specifications are the verification companions (docs/testing.md).
- The **`LtxHost`/`FileSystem` abstraction** in `celld-ltx` lets the
  replication library run against real files or a deterministic fake
  (crates/ltx/src/lib.rs#L51-L54).
- The **`DurabilityOwner`** seam in `crates/celld/node_log.rs` is the
  documented lifetime contract for embedding celld as a library
  (docs/library-api.md#L12-L60).
- **Reserved Durable Object classes** (`__D1Database`, `__Workflow`,
  `__KvNamespace`, `__Queue`) let D1, Workflows, KV, and Queues run as cells
  supplied by the runtime rather than by the Worker
  (crates/celld/deploy.rs#L58-L81).

## Tests that pin the architecture

The crate split is exercised by the conformance and simulation suites: the
`celld` crate includes simulation tests behind `celld_internal_tests` that
drive the same decision core with a simulated store and a simulated clock
(crates/celld/lib.rs#L394-L418), and `crates/logic` is a pure decision core
with no I/O of its own specifically so a simulator can drive it
(docs/testing.md#L88-L95).
