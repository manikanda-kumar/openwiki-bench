---
type: architecture
title: Architecture overview
description: celld is a Rust daemon that runs Cloudflare Workers and Durable Objects on user-owned machines — the node/fleet/cell model, the decision-core/executor split, and the main control flows.
tags: [architecture, overview, durable-objects, actors, fleet]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-3fa7b94a6ed05a0c35f6ec1f
    resource: repo://crates/celld/Cargo.toml
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Architecture overview

celld is an open-source daemon that runs Cloudflare Workers and Durable
Objects on self-hosted machines. Each Durable Object instance is a *cell*:
a named server with its own SQLite database, whose long-term state lives in
an object-store bucket the operator owns (S3-compatible, Google Cloud
Storage, or Azure Blob Storage). One `celld` process is a *node*; the nodes
sharing one bucket are a *fleet*; there is no serving control plane and no
consensus service — bucket conditional writes decide ownership
(repo://README.md#L3-L23).

## The three-crate workspace

The workspace comment states the layering rule that shapes the entire tree:

> `crates/logic` owns all behavioral state and decisions; `crates/celld` is
> only an effect executor and adapter host.

(repo://Cargo.toml#L1-L2)

- **`crates/logic`** (`celld-logic`) — a dependency-free pure decision core.
  Every behavioral state advance flows through one function,
  `on_event(state, event) -> effects`; no adapter mutates `State` directly
<!-- openwiki: broken internal link [/architecture/event-core.md] file "/architecture/event-core.md" does not exist. Fix the href or restore the target, then delete this comment. -->
  (see [The decision core](/architecture/event-core.md)).
- **`crates/ltx`** (`celld-ltx`) — the in-process SQLite replication
  library: WAL capture as LTX segments, replica storage, restore,
  compaction, and bundle reads. It is a from-scratch Rust port of
  Litestream's replication behavior with the LTX v0.5.2 block format
  (repo://crates/ltx/src/lib.rs#L3-L9).
- **`crates/celld`** — the daemon: V8 embedding, the actor shell, storage
  and lease adapters, peer HTTP, the CLI subcommands, and the JS runtime
  surfaces. Its `[[bin]]` is the `celld` binary; `main.rs` alone is ~5000
  lines (repo://crates/celld/Cargo.toml#L15-L24).

## Core mental model

A *cell* maps to a Cloudflare Durable Object: it serves HTTP, holds
WebSocket connections, sets alarms, and owns a private single-threaded
SQLite database (storage operations are synchronous and never interleave,
so per-cell data stays consistent). A cell is *resident* when it is in
memory, *hibernated* when it retains WebSocket clients while evicted from
memory, and *inactive* when it exists only as objects in the bucket — which
is how every cell starts (repo://docs/README.md#L5-L36).

Exactly one node serves a cell at a time. A node claims a cell by
conditionally writing an ownership record to the bucket; the claim expires
unless renewed, so a dead machine releases its cells without a failure
detector. That single-owner rule plus the write-durability proof (RPO=0)
are the system's two core promises (repo://docs/README.md#L37-L59).

## Runtime shape: one actor

Every node runs one actor that serializes every event through the decision
core:

> One actor serializes every event through `celld-logic`; the actor polls
> its mailbox, timers, and in-flight effect futures together. This is the
> execution shape required for monotonic lease ticks to fence the node even
> when a storage operation remains hung, without spawning a task per
> effect.

(repo://crates/celld/main.rs#L3-L22)

That serial execution is deliberate: fencing correctness depends on a lease
tick observable even while an I/O effect is hung, and a single event loop
gives the decision core exactly-once sequential observation of all inputs.
The actor is defined in `crates/celld/actor.rs` with a `production` arm for
real I/O and simulated cell-host arms used by the conformance test suite
(repo://crates/celld/lib.rs#L299-L435).

## Two HTTP listeners

The node binds two listeners at startup
(repo://crates/celld/main.rs#L3182-L3190):

1. **Public listener** (`--listen`, `bind_ingress_listener`) — serves the
   deployed Worker: `/` ingress, the WebSocket upgrade path, and
   `/.well-known/celld/health` (repo://crates/celld/main.rs#L2579-L2620).
2. **Internal listener** (`--internal-listen`, `bind_internal_listener`) —
   peer and operator traffic only: `/peer/probe`, `/peer/handoff`,
   `/peer/log/*`, `/peer/tunnel`, `/peer/abort/`, plus operator routes
   `/runtime/<scope>` for reserved classes and `/reload`, `/shutdown`,
   `/state` (repo://crates/celld/main.rs#L2622-L2733).

The internal listener must sit on a trusted private network; peers
authenticate by a fleet HMAC (see [Peer network and fleet
authentication](/integration/peer-network-and-auth.md)).

## Main data/control flows

Inbound request → public listener → ingress handler → resolves route via
decision core (`RuntimeManager` cell request) → if owned locally, the cell's
V8 isolate runs; if owned remotely, request forwards to the owner's internal
listener via signed peer transport (h1 tunnels) (repo://README.md#L18-L34).

A cell write → SQLite commit → WAL capture as L0 LTX segment → durability
proof two ways: bucket-conditional CAS according to the store dialect, or
followers-ack for fleet mode (`CELLD_DURABILITY`, fleet default) → output
gate releases the HTTP response (see [Durability and
replication](/flows/durability-and-replication.md)).

Lease renewal, alarm wake hints (`wake/` bucket entries), cron scheduling,
queue planning, and memory-pressure shedding are all driven by decision-core
timers and effects, and execute at the adapter exactly as decided (see
<!-- openwiki: broken internal link [/architecture/event-core.md] file "/architecture/event-core.md" does not exist. Fix the href or restore the target, then delete this comment. -->
[The decision core](/architecture/event-core.md)).

## Deployment and code change

`celld deploy` invokes esbuild on a Wrangler project and writes the
normalized manifest plus `deploy/current.json` to the bucket — the pointer
*is* the deploy. Every node converges on the pointer, materializing a new
Generation that holds compiles, isolates, asset resolvers, and cron
schedules; adoption is in-place, per-node polling at
`CELLD_DEPLOY_POLL_S` (repo://crates/celld/generation.rs#L7-L14). See
<!-- openwiki: broken internal link [/flows/deployments-and-generations.md] file "/flows/deployments-and-generations.md" does not exist. Fix the href or restore the target, then delete this comment. -->
[Deployments and generations](/flows/deployments-and-generations.md).

## Failure posture

A node that cannot renew its lease self-fences: it stops cells, fails
in-flight requests, logs `SELF-FENCE:`, and exits with code 3 — terminal
until restarted by its supervisor. Fence failure is a normal fleet input;
peers discard the dead node's lease and acquire cells through the ownership
<!-- openwiki: broken internal link [/flows/ownership-and-leasing.md] file "/flows/ownership-and-leasing.md" does not exist. Fix the href or restore the target, then delete this comment. -->
records (see [Ownership, leases, and fencing](/flows/ownership-and-leasing.md)).
