---
type: architecture-overview
title: Architecture and ownership boundaries
description: celld is a three-crate Rust workspace — a sans-IO decision core (celld-logic), an effect-executing node shell (celld), and an embedded SQLite replication engine (celld-ltx) — that runs Cloudflare Workers and Durable Objects on a bucket-coordinated fleet.
tags: [architecture, workspace, crates, sans-io, ownership-boundary]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-10a3ca6704a0d403c63dff35
    resource: repo://crates/ltx/README.md
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Architecture and ownership boundaries

celld is a self-hosted daemon that runs Cloudflare Workers and Durable Objects
on your own machines. Each Durable Object is a *cell*: a named server with its
own SQLite database. A *node* is one `celld` process; the nodes that share one
object-storage bucket are a *fleet*. Ownership of a cell is decided by a
conditional write to the bucket, so exactly one node owns a cell at a time, and
there is no membership protocol, leader election, or consensus service
([README.md#L3-L22](repo://README.md#L3-L22)).

The shipped binary and crate are version 0.4.0 ([crates/celld/Cargo.toml#L2-L3](repo://crates/celld/Cargo.toml#L2-L3)).

## The three-crate ownership split

The workspace is described in its own manifest header as a "clean-sheet celld
workspace" in which `crates/logic` owns all behavioral state and decisions and
`crates/celld` is only an effect executor and adapter host
([Cargo.toml#L1-L5](repo://Cargo.toml#L1-L5)). This is the repository's central
ownership boundary:

- **`celld-logic`** (`crates/logic`) — the pure decision core. Its `on_event`
  is the only way behavioral state advances; both the production executor and
  a deterministic simulator feed it events and perform the returned effects,
  and no adapter may mutate `State` directly
  ([crates/logic/lib.rs#L1-L10](repo://crates/logic/lib.rs#L1-L10)). The crate
  declares no dependencies at all — "no async, I/O, clocks, randomness, locks,
  or dependencies" ([crates/logic/Cargo.toml#L8-L11](repo://crates/logic/Cargo.toml#L8-L11)) —
  and the entry point is `pub fn on_event(state: &mut State, event: Event) -> Vec<Effect>`
  ([crates/logic/lib.rs#L5515](repo://crates/logic/lib.rs#L5515)). See
  [decision core](architecture/decision-core.md).
- **`celld`** (`crates/celld`) — the effect-adapter shell and binary host. The
  executable owns one serial actor that is the only caller of
  `celld_logic::on_event`; adapter futures never borrow core state and send
  versioned completion events back through its mailbox
  ([crates/celld/lib.rs#L5-L9](repo://crates/celld/lib.rs#L5-L9)). It contains
  the V8 runtime, SQLite plumbing, HTTP listeners, bucket adapters, deploy/dev
  tooling, and telemetry. See [actor and execution boundary](architecture/actor-execution.md).
- **`celld-ltx`** (`crates/ltx`) — embeddable streaming replication for one
  SQLite database: it captures WAL data as LTX segments, writes them to a
  filesystem or object store, and can restore, compact levels, and read bundle
  objects ([crates/ltx/src/lib.rs#L1-L9](repo://crates/ltx/src/lib.rs#L1-L9)).
  It is a 2026-08-03 snapshot of *rustyriver*, a from-scratch Rust port of
  Litestream v0.5 and the LTX v0.5.2 format, which celld owns and evolves
  rather than tracks upstream ([crates/ltx/README.md#L3-L20](repo://crates/ltx/README.md#L3-L20)).
  celld uses it inside a larger durability protocol — the output gate, epoch
  fencing, replicated node log, and takeover recovery enforce the write
  acknowledgement contract; the library alone does not
  ([crates/ltx/README.md#L9-L11](repo://crates/ltx/README.md#L9-L11)). See
  [the ltx engine](persistence/ltx-engine.md).

All direct dependencies live in `[workspace.dependencies]` so the member crates
can never drift onto two versions of the same crate
([Cargo.toml#L33-L35](repo://Cargo.toml#L33-L35)). Build profiles are
deliberate: the shipped `release` profile is size-tuned (fat LTO, one codegen
unit, `opt-level = "s"`, `panic = "abort"`, stripped), and a `lab` profile keeps
release optimization but drops the fat-LTO relink and keeps symbols so `perf`
on a lab node attributes CPU by function
([Cargo.toml#L7-L28](repo://Cargo.toml#L7-L28)).

## Canonical control flow

A request crosses the workspace boundary exactly once:

1. An HTTP listener in `crates/celld/main.rs` accepts a public Worker request
   or an internal peer/operator request. During drain, new public requests
   receive 503 with `Retry-After: 1` while `/.well-known/celld/health` is still
   served ([crates/celld/main.rs#L2572-L2597](repo://crates/celld/main.rs#L2572-L2597)).
2. The listener hands work to the serial actor, whose `step` handles exactly
   one ready mailbox item, effect completion, or timer at a time
   ([crates/celld/actor.rs#L2184-L2186](repo://crates/celld/actor.rs#L2184-L2186)).
3. The actor turns inputs into `celld_logic::Event` values (`Request`,
   `TimerFired`, `OwnerCasCompleted`, `DurableReached`, …) and calls `on_event`,
   which returns a list of `Effect`s (`CasOwner`, `ReadOwner`, `Restore`,
   `StartRuntime`, `AwaitDurable`, `Release`, `Halt`, …)
   ([crates/logic/types.rs#L402](repo://crates/logic/types.rs#L402),
   [crates/logic/types.rs#L740](repo://crates/logic/types.rs#L740)).
4. Effect adapters perform the I/O — bucket conditional writes, peer HTTP, V8
   turns, SQLite calls — and deliver versioned completion events back through
   the actor's mailbox; they never touch core state
   ([crates/celld/lib.rs#L5-L9](repo://crates/celld/lib.rs#L5-L9)).

## The execution domain and its compile-time fence

The actor execution domain must not touch ambient tokio, clocks, randomness, or
process state directly. `clippy.toml` forbids `tokio::spawn`,
`tokio::time::*`, `std::time::Instant::now`, `rand::random`, `std::process::id`,
and the `std::fs` family, each with a reason pointing at the sanctioned
substitute (`celld::asyncrt` or the injected execution-domain clock/RNG/filesystem)
([clippy.toml#L1-L24](repo://clippy.toml#L1-L24)). Modules outside the boundary
carry an explicit lint allow and a comment naming why (for example the V8 arm in
`runtime.rs` and `pool.rs`). This discipline is what lets the same core run
against a simulated clock, RNG, and object store.

Internal tests, observers, and the simulated `asyncrt` are *not plain files in
this snapshot*: `crates/celld/lib.rs` injects them with
`include!(env!("CELLD_..."))` gated on `cfg(celld_internal_tests)` — for example
the real `asyncrt` is swapped for a simulated one when the flag is set
([crates/celld/lib.rs#L300-L317](repo://crates/celld/lib.rs#L300-L317)) and the
conformance "world" suites are included the same way
([crates/celld/lib.rs#L365-L431](repo://crates/celld/lib.rs#L365-L431)). The
external corpus files, the TLA+ specifications, and the live-fleet lab
described in [docs/testing.md](repo://docs/testing.md#L29-L104) are not present
in this repository snapshot; do not assume a local command runs them.

## The bucket is the shared interface

The fleet coordinates entirely through reserved object prefixes. celld reserves
`probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`, `deploy/`,
`deploy-blobs/`, `wake/`, and `telemetry/`, deletes objects under some of them,
and an application must never write under these prefixes
([docs/guarantees.md#L76-L81](repo://docs/guarantees.md#L76-L81)). The types of
the bucket-resident objects exchanged with deployment tools are the durable
interface — "these objects are the interface; nothing else is exchanged"
([crates/celld/protocol.rs#L3-L4](repo://crates/celld/protocol.rs#L3-L4)). The
engine talks to one bucket through a single `object_store` client that speaks
two conditional-write dialects (S3 etag CAS and its alternates)
([crates/celld/bucket.rs#L3-L9](repo://crates/celld/bucket.rs#L3-L9)), and the
ownership adapter over that contract contains only serialization and error
classification — ownership decisions stay in `celld-logic`
([crates/celld/ownership_store.rs#L3-L7](repo://crates/celld/ownership_store.rs#L3-L7)).

## Subsystem map

Where each system lives, one responsibility each:

| Subsystem | Home | Responsibility |
| --- | --- | --- |
| Input gate | [crates/logic/gate.rs](repo://crates/logic/gate.rs#L3-L8) | Per-cell concurrency: how many requests a cell serves at once, sans-IO |
| Output gate | [crates/logic/output_gate.rs](repo://crates/logic/output_gate.rs#L3-L4) | The one choke point every egress passes through before acknowledgement |
| Dispatch/schedule | [crates/logic/schedule.rs](repo://crates/logic/schedule.rs#L3-L8) | Cell-isolate dispatch decisions (one event at a time per isolate; Worker fast path) |
| Routing retry | [crates/logic/routing.rs](repo://crates/logic/routing.rs#L3-L6) | Whether a failed peer dispatch may be re-sent |
| Restore policy | [crates/logic/restore.rs](repo://crates/logic/restore.rs#L3-L8) | Which restore source is durability-safe |
| Wake | [crates/logic/wake.rs](repo://crates/logic/wake.rs#L3-L8) + [crates/celld/wake.rs](repo://crates/celld/wake.rs#L3-L9) | Alarm-wake entry reconciliation and the bucket `wake/` mirror that survives fence and crash |
| Node log (fleet durability) | [crates/celld/node_log.rs](repo://crates/celld/node_log.rs#L3-L23) | In-fleet replicated log tier behind `CELLD_DURABILITY=fleet` |
| Replication adapters | [crates/celld/ltx_repl.rs](repo://crates/celld/ltx_repl.rs#L3-L10), [crates/celld/replication.rs](repo://crates/celld/replication.rs) | Managed `celld-ltx` databases per resident cell; epoch-fenced bucket prefixes |
| V8 runtime | [crates/celld/runtime.rs](repo://crates/celld/runtime.rs#L7-L11), [crates/celld/js.rs](repo://crates/celld/js.rs) | Runtime materialization behind core-authorized lifecycle effects; the Workers JS engine |
| Isolate pool | [crates/celld/pool.rs](repo://crates/celld/pool.rs#L7-L12) | Shell around the isolate policy; isolates are not thread-bound (`v8::Locker`) |
| Cell storage | [crates/celld/storage.rs](repo://crates/celld/storage.rs#L6-L14) | SQLite backing for `ctx.storage`; one db file per cell |
| Deploy pipeline | [crates/celld/deploy.rs](repo://crates/celld/deploy.rs#L8-L13), [crates/celld/protocol.rs](repo://crates/celld/protocol.rs) | Build a Wrangler project and write it to the bucket |
| Generations | [crates/celld/generation.rs](repo://crates/celld/generation.rs#L3-L9) | One application deployment as the running process holds it |
| Fleet discovery | [crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L9) | Bucket deployment/lease adapters reused by the host |
| Drain token | [crates/celld/drain_token.rs](repo://crates/celld/drain_token.rs#L3-L8) | One bucket object that serializes concurrent handoff donors |
| Dead-node GC | [crates/celld/dead_node_gc.rs](repo://crates/celld/dead_node_gc.rs#L3-L7) | Retiring debris from dead process generations |
| Telemetry | [crates/celld/telemetry.rs](repo://crates/celld/telemetry.rs#L6-L10), [crates/celld/otlp.rs](repo://crates/celld/otlp.rs) | Wide events out of the shell, Parquet or OTLP out |
| Dev stack | [crates/celld/dev.rs](repo://crates/celld/dev.rs#L3-L7) | `celld dev`: one persisted local object store plus one supervised node |
| Managed control plane | [crates/celld/control_plane.rs](repo://crates/celld/control_plane.rs) | Alpha celld.dev sessions (presence, explorer, module sync) |
| Memory pressure | [crates/logic/pressure.rs](repo://crates/logic/pressure.rs), [crates/celld/memory.rs](repo://crates/celld/memory.rs) | Pure classifier of a memory sample plus the shedding latch; measurement at the edge |

Deep dives: [cell lifecycle](concepts/cell-lifecycle.md),
[durability and fencing](concepts/durability-and-fencing.md),
[the ltx engine](persistence/ltx-engine.md),
[the V8/Workers runtime](runtime/v8-workers.md),
[listeners and peers](networking/listeners-and-peers.md),
[deployments](deployments/deploy-and-rollout.md),
[reserved classes](platform/reserved-classes.md),
[node operations](operations/node-operations.md),
[telemetry](operations/telemetry-and-logs.md), and the
[change guide](development/change-guide.md).

## Documentation and fixtures

`docs/` is the operator-facing contract: `docs/README.md` carries the
user-visible model of cells, fleets, residency states, and alarms
([docs/README.md#L3-L19](repo://docs/README.md#L3-L19)), and `guarantees.md`,
`security.md`, `limitations.md`, `telemetry.md`, and `cloudflare-compat.md`
define the promises and gaps. Where a doc claim is load-bearing here, it is
cross-checked against source (for example the residency vocabulary above is
implemented as `Phase` values the core reports, and the drain 503 path is in
`main.rs`). `examples/` holds runnable Wrangler projects — `hello`, `counter`,
`alarm`, `cron`, `d1`, `kv`, `r2`, `router`, `rpc`, `vectordb`, `wasm`,
`webapi`, `workflow`, `wsclient`, `wsecho` and more — that exercise the
supported API surface ([examples/README.md#L1-L23](repo://examples/README.md#L1-L23)).

## Known-boundary statements

- The repository does not establish how a fleet is provisioned or how the
  celld.dev serving side works beyond the alpha control-plane client in
  `crates/celld/control_plane.rs`.
- `crates/logic/log_tier.rs` carries a "design stage; not yet wired into the
  engine" header ([crates/logic/log_tier.rs#L3-L4](repo://crates/logic/log_tier.rs#L3-L4)),
  but that comment is stale: the shipped fleet-durability tier in
  `crates/celld/node_log.rs` names `celld_logic::log_tier` as the source of
  its decisions and calls them directly
  ([crates/celld/node_log.rs#L16-L18](repo://crates/celld/node_log.rs#L16-L18),
  [crates/celld/node_log.rs#L981-L984](repo://crates/celld/node_log.rs#L981-L984)).
  Prefer the code.
