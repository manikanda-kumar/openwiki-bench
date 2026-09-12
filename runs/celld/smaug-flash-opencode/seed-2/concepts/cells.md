---
type: concept
title: Cells, scopes, and the lifecycle state machine
description: What a Durable Object cell is, the scope charset security fence, and the complete phase state machine from cold start through residency, dormancy, eviction, and takeover.
tags: [cells, lifecycle, phases, scopes, admission]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---

# Cells, scopes, and the lifecycle state machine

In celld terms, a **cell** is a Durable Object: a small named server with a
private SQLite database. Each cell runs on one thread, storage operations are
synchronous and never interleave, and cells share no database
(`docs/README.md:8-15`). This page covers the cell scope namespace, the full
lifecycle phase machine, and the admission policy that bounds how many cells a
node runs.

## Cell scopes and the security charset

A cell scope names one Durable Object: `Class:instance`, or a bare instance
that the runtime prefixes with the single configured class. The scope is used
as a path component and as an object-store key, so its charset is a security
fence (`crates/logic/cell.rs:3-14`).

`valid_cell_scope` accepts a non-empty value of at most `MAX_CELL_SCOPE` (255)
bytes that is not `.` or `..`, containing only ASCII alphanumerics plus
`_ - . : $` (`crates/logic/cell.rs:18`, `crates/logic/cell.rs:43-50`). `/` and
`\` are excluded so the scope can never be more than one path component, which
is what makes an embedded `..` inert; `.` and `..` themselves are rejected. `:`
is admitted as the class/instance separator, and `$` because it is a legal
JavaScript identifier character. The callers that accept a scope from the
network apply the gate before the scope reaches storage.

## Cell states

A cell has the states of a Durable Object (`docs/README.md:22-28`):

- **Resident** — in memory; **active** while it does work, **idle** when it
  waits.
- **Dormant** — out of memory, but still owned by this node. A dormant cell
  with surviving hibernatable sockets is **hibernated**.
- **Inactive** — out of memory and owned by nobody; needs a cold start. Every
  cell starts inactive and an inactive cell costs almost zero.

Note that celld and Cloudflare use "evict" differently: Cloudflare evicts a
cell off its host (producing Inactive), while celld evicts a cell out of memory
(producing Dormant); shedding is what then publishes it unowned
(`crates/logic/lib.rs:108-111`).

## The phase state machine

The core's `Phase` enum (`crates/logic/lib.rs:113-190`) is the authoritative
transitions:

- `Inactive` — initial state of every cell.
- `WaitingActivation` — cold demand queued behind `max_activations`, before any
  I/O begins.
- `ReadingOwner` / `ReadingNodeLease` — resolving ownership.
- `RecoveringOwnerLog` — the takeover interlock (lease-fold): the dead owner's
  folded log state was unsealed, so the executor recovers its sessions before
  this cell may claim.
- `ReadingCapacity` / `WaitingCapacity` — capacity handoff admission.
- `Acquiring` / `ReconcilingAcquire` — the ownership compare-and-swap.
- `Restoring` — restoring the SQLite replica.
- `Starting` / `Publishing` / `EnsuringDurability` — the runtime starts, is
  published and routable, then its replica durability is proved.
- `Cleaning` — stopping the runtime, then `Dormant` (out of memory, still
  owned here).
- `Adopting` — the owner record is no longer this node's and a signed peer
  request waits for a successor.
- `Resident` — active or idle in memory.
- `Remote` — the cell is owned by another node; routes forward.
- `Fenced` — this node has lost authority.

Phase names are stable operator-facing strings; `phase_name` maps each phase to
its published short name, and `phase_census` reports them
(`crates/logic/lib.rs:214-240`, `crates/logic/lib.rs:977-983`).

## Activation, capacity, and admission bounds

Several explicit sets and queues in `State` implement the admission policy:

- **`activation_permits`** — cells holding a complete cold-route admission.
  The bound is `Config::max_activations`. Keeping this explicit makes the
  concurrency bound part of the replayable state machine
  (`crates/logic/lib.rs:530-534`).
- **`activation_waiters`** — cells queued behind the activation ceiling.
- **`capacity_waiters`** — cells waiting for a residency slot. This is FIFO by
  design: under sustained eviction a waiter can otherwise time out while
  thousands of slots are freed around it (`crates/logic/lib.rs:540-546`).
- **`occupied`** — how many cells currently occupy capacity, maintained at
  every phase transition (`crates/logic/lib.rs:580-584`).
- **`eviction_permits`** — cells with an eviction in flight, for the same
  replayability reason (`crates/logic/lib.rs:538`).

`Config` sets the limits: `max_resident` (resident cells plus activation
reservations), `max_activations`, `max_evictions`, and `max_releases`. The
`State::new` constructor asserts these are all positive
(`crates/logic/types.rs:63-87`, `crates/logic/lib.rs:651-657`).

## Restore-source selection

A restore picks the newest safe source — a local eviction snapshot or the
replicated bucket. `previous_epoch_reusable(epoch, took_over)` returns true only
when `epoch > 1` and we did not take the cell over from another node: a takeover
means someone else may have written the cell while we slept, so their durable
state is authoritative (`crates/logic/restore.rs:27-28`).

## Presence and management projections

- **`presence_snapshot`** reports the serving flag and the resident cells with
  their epochs (`crates/logic/lib.rs:916-935`).
- **`phase_census`** gives a stable count of cells per phase for operators —
  this addresses the case where `occupied` alone cannot diagnose a node stuck
  mid cold-start (`crates/logic/lib.rs:974`).

---

## Related pages

- [Architecture: the decision core, the effect executor, and replication](/openwiki/concepts/architecture.md)
- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
