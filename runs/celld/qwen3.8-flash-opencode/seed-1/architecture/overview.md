---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-202feef6a807aadb656fd2df
    resource: repo://crates/celld/main/peer_tunnel.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-10a3ca6704a0d403c63dff35
    resource: repo://crates/ltx/README.md
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Architecture Overview

celld is a self-hosted daemon that runs Cloudflare Workers and Durable Objects on your own machines: each node is one `celld` process embedding V8, nodes sharing one object-storage bucket form a fleet, and a cell (a named server with its own SQLite database) is owned by exactly one node at a time through conditional bucket writes — no membership protocol, no consensus service (README.md#L14-L22, docs/README.md#L17-L45).

## The three-crate ownership split

The workspace comment states the contract in one line: "`crates/logic` owns all behavioral state and decisions; `crates/celld` is only an effect executor and adapter host" (Cargo.toml#L1-L2).

- **`celld-logic` (crates/logic)** — the pure decision core: no async, I/O, clocks, randomness, locks, or dependencies (crates/logic/Cargo.toml#L8-L9). `on_event(&mut State, Event) -> Vec<Effect>` is the only way behavioral state advances, and no adapter may mutate `State` (crates/logic/lib.rs#L3-L8). Everything durable-knowable about ownership, epochs, gates, permits, and placement lives here so it can be replayed deterministically. Details: [Sans-IO Decision Core](/openwiki/architecture/decision-core.md).
- **`celld` (crates/celld)** — the adapter host: a serial Actor owns core state and performs every returned effect through futures that "never borrow core state; they send versioned completion events back through its mailbox" (crates/celld/lib.rs#L6-L9). It also hosts the V8 runtime (js.rs, runtime.rs, pool.rs), the two HTTP listeners, the object-store client, deployment build, and the CLI (crates/celld/main.rs#L3-L15). Details: [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Workers and V8 Runtime](/openwiki/concepts/workers-runtime.md).
- **`celld-ltx` (crates/ltx)** — the in-process SQLite replication library, seeded from rustyriver (a reimplementation of Litestream v0.5 and the LTX format) and owned as first-class celld source: it "captures committed WAL data as L0 LTX segments and reports the captured position," writes to a filesystem or object store, and can restore, compact, and snapshot; celld wraps it in the larger durability protocol (crates/ltx/README.md#L3-L12, #L16-L24). Details: [SQLite State and LTX Replication](/openwiki/concepts/sqlite-ltx.md).

Ownership direction matters: `celld` depends on both `celld-logic` and `celld-ltx` (crates/celld/Cargo.toml dependencies), the logic crate depends on nothing, and the ltx crate knows nothing about ownership or epochs — it is given a path and a bucket prefix (crates/celld/ltx_repl.rs#L3-L16).

## Flow 1: a cold request to an inactive cell

1. Ingress arrives at the public listener; the Worker's `env.NS.idFromName(...).fetch()` becomes a `/cell/<scope>` request validated by `celld_logic::cell::valid_cell_scope` before the scope can name any path (crates/celld/main.rs#L2791-L2794, crates/logic/cell.rs#L1-L11). Direct DO access uses the `/do/` route (crates/celld/main.rs#L2750).
2. The request becomes an `Event::RequestAt` in the Actor mailbox; the core resolves routing from its cached node lease or emits `Effect::ReadOwner` for the cell's `ownership.json` (crates/logic/types.rs#L583-L590). If another live node owns the cell, the core answers `Effect::Complete { route: Remote }` and the shell proxies over that peer's internal listener through the pooled peer tunnel (crates/logic/types.rs#L699-L708, crates/celld/main/peer_tunnel.rs#L3-L15). See [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md).
3. If the cell is unowned or the owner's lease is dead/expired, the activation path runs inside the core: `ReadingOwner` → `ReadingNodeLease` (of the owner) → optionally `RecoveringOwnerLog` (if the dead owner's folded log state is unsealed) → `CasOwner` with a fresh epoch; "every activation advances the epoch," so the data-path prefix is a fence against the stale owner (docs/guarantees.md#L108-L126, crates/logic/types.rs#L769-L778).
4. The shell then performs `Effect::Restore` (choosing the newest safe source — local eviction cache vs the bucket's LTX chain — by core predicate, crates/logic/restore.rs#L1-L12), `Effect::StartRuntime` (the V8 arm materializes an isolate, runs the DO constructor backed by the cell's SQLite file), and `Effect::Publish` to make the route externally dispatchable (crates/celld/runtime.rs#L6-L11). Warm requests to a resident cell skip all of this: they do zero bucket operations (docs/testing.md#L163-L168).

## Flow 2: a durable write

1. A handler writes via `ctx.storage`, which is synchronous over the cell's local SQLite; each committed WAL change is captured as LTX data by the managed `celld_ltx::Db` for that cell inside `LtxRepl` (crates/celld/storage.rs#L6-L14, crates/celld/ltx_repl.rs#L3-L10).
2. Nothing reveals the write until it is proven: when any egress (HTTP response, RPC reply, `fetch`, WebSocket frame…) that can expose the write is ready to leave, the shell sends `Event::Output` naming the committed position, and the core withholds it behind a barrier (crates/logic/types.rs#L500-L520).
3. The core emits `Effect::AwaitDurable`; the proof races two mechanisms — the bucket upload of the epoch-prefixed LTX objects and, on a fleet of two or more nodes, the node-log ensemble where one or two followers fsync copies (docs/README.md#L51-L59, crates/celld/node_log.rs#L6-L21).
4. On `Event::DurableReached`, a fleet proof releases the held output directly, while a bucket proof first emits `Effect::VerifyOwnership` — one read proving the ownership record still names this node at this epoch — so a partitioned node never acknowledges a write the new owner cannot see (crates/logic/types.rs#L521-L542, #L865-L873, docs/guarantees.md#L131-L149).

## Invariants the map rests on

- **One writer per cell** is delegated to the object store: the claim is a conditional create or CAS, so "two nodes cannot both claim the same cell," and expired claims release the cell without a failure detector (docs/README.md#L38-L45).
- **No acknowledged write is lost (RPO=0)** is enforced by the output gate plus fencing, not by storage luck (docs/guarantees.md#L1-L14).
- **Replaceable nodes** follow from both: the bucket holds long-term state, and a takeover recovers any open node log from the prior owner before restoring (README.md#L31-L33).

A node that cannot keep its lease self-fences and exits, because a node that cannot reach the bucket cannot replicate and "must not own cells" (docs/guarantees.md#L200-L224).

Related: [Quickstart](/openwiki/quickstart.md), [Cells, Ownership, and Fencing](/openwiki/concepts/cells-ownership.md), [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
