---
type: architecture
title: Cell lifecycle and ownership
description: How a cell (celld's Durable Object equivalent) moves between inactive, resident, dormant, and hibernated states, how cold activation and capacity admission work, how eviction and pressure shedding choose victims, and how requests route to the owning node.
tags: [cell-lifecycle, durable-objects, routing, admission, eviction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-e65834f5c83ba76e348f4b8a
    resource: repo://crates/logic/schedule.rs
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Cell lifecycle and ownership

A cell is a named Durable-Object-equivalent: a small server with its own
SQLite database. Exactly one node owns a cell at a time. This page describes
how a cell is named, the states it passes through, how the node admits,
activates, routes, and evicts cells, and how the decision core keeps those
lifecycle policies replayable.

## What a cell is and how it is named

A cell scope names one Durable Object: `Class:instance`, or a bare instance
that the runtime prefixes with the single configured class. The scope is used
both as a filesystem path component under the data directory and as an
object-store key, so its charset is a security fence. `valid_cell_scope`
admits only ASCII alphanumerics plus `_ - . : $`, at most 255 bytes, and
rejects `.` and `..`; `/` and `\` are excluded so a scope can never be more
than one path component, which is what makes an embedded `..` inert.
`crates/logic/cell.rs:15-51` defines the gate, and every caller that accepts a
scope from the network applies it before the scope reaches storage.

## The cell state model

The decision core maps phases onto the Cloudflare Durable Objects lifecycle
states. `crates/logic/lib.rs:98-111` records the mapping:

- **Resident** — the cell is active or idle in memory (Cloudflare states 1-3).
- **Dormant** — out of memory but still owned by this node, so the cell has
  not moved off its host. A dormant cell with surviving hibernatable sockets
  is **hibernated** (Cloudflare state 4).
- **Inactive** — out of memory and owned by nobody: needing a cold start
  (Cloudflare state 5, and the initial state of every cell).

`crates/logic/lib.rs:113-190` defines the full `Phase` enum. Between the coarse
states sit the in-flight phases of one activation or eviction:
`WaitingActivation`, `ReadingOwner`, `ReadingNodeLease`,
`RecoveringOwnerLog`, `ReadingCapacity`, `WaitingCapacity`, `Acquiring`,
`ReconcilingAcquire`, `Restoring`, `Starting`, `Publishing`,
`EnsuringDurability`, `Cleaning`, `Dormant`, `Adopting`, `Resident`, `Remote`,
and `Fenced`. `phase_name` (`crates/logic/lib.rs:214-240`) assigns each phase
a stable short name that `/state` and `celld diagnose` publish, so the operator
interface does not change when the Rust enum is renamed.

`is_hibernated` (`crates/logic/lib.rs:1410-1423`) is exactly a `Dormant` cell
that still holds a hibernatable WebSocket, and `is_hibernatable`
(`crates/logic/lib.rs:1425-1438`) is a resident cell doing no work and holding
nothing that must survive in memory. A hibernated cell wakes exactly the way a
cold start does — nothing in memory survives, so the constructor runs again —
except that its clients stay connected and it stays on its node.

## Ownership and epochs

Each cell has one ownership record in the bucket (`cells/<cell>/own.json`)
that names the owner node's session and carries a fencing epoch. A node
acquires a cell with a conditional write, and the object store accepts exactly
one such write, so two nodes cannot acquire the same cell. The acquisition
adapter is `BucketOwnership` in `crates/celld/ownership_store.rs:211-420`; the
record wire shape is a node name plus an epoch. Every activation — a takeover
and a local wake alike — advances the epoch, so an epoch never has two
writers. The durability consequences (the epoch prefix fence, conditional
writes, RPO=0) are the subject of the
[durability protocol page](durability-protocol.md).

## Routing a request to the owner

When a request reaches a node, the core routes it. `request`
(`crates/logic/lib.rs:2819-2851`) first refuses a fenced node, then checks
`node_authoritative()` (the node lease is valid); otherwise the request fails
with `NodeUnavailable`. `request_authorized` (`crates/logic/lib.rs:2878-2960`)
then dispatches on the cell's current phase:

- A resident, non-quiescing cell completes **Local** immediately.
- A cell in `EnsuringDurability` wins the race with voluntary eviction: the
  eviction is retired and the cell completes Local.
- A cell with a cached remote owner completes **Remote**, naming the owning
  node, its address, and the epoch.
- An inactive or dormant cell is queued for activation (below).

A WebSocket event from a socket the cell already owns is routed locally as
long as the cell is resident (`websocket_request`, `crates/logic/lib.rs:2857-2876`);
a hibernatable socket can outlive residency and follows the ordinary route so
it can reactivate here or reach a successor.

### Remote redispatch is at-most-once

A cell runs on exactly one node, so every other node forwards to the owner.
When a forward fails, `crates/logic/routing.rs:1-60` decides whether the call
may be re-sent by how far the attempt got: a connection that was never
established carried no request bytes, so re-sending cannot double-apply;
every other failure (timeout after the request was written, truncated body,
decode error) is `Ambiguous` and must fail the caller instead of risking
running the request twice. Each recoverable class (`NotOwner`,
`NeverConnected`) gets one retry, counted separately.

### Top-level Worker requests can reuse a resident isolate

A stateless Worker fetch takes the resident-isolate fast path only when an
isolate is idle; otherwise it is rescheduled to the stateless Worker pool,
never run nested (`crates/logic/schedule.rs:1-14`). The core chooses the
resident by round-robin over resident cells that are not active, not
quiescing, and not firing an alarm, advancing a `worker_cursor`
(`worker_request`, `crates/logic/lib.rs:1480-1519`).

## Cold activation and capacity admission

A cold start begins with `ColdStart::ReadOwner` (or `ColdStart::Restore` for a
same-node resume). `admit_or_queue_activation` (`crates/logic/lib.rs:1578-1596`)
is the admission gate: if the cell already holds a permit or the node is below
`max_activations`, it starts immediately; otherwise the cell enters
`WaitingActivation` and joins the FIFO `activation_waiters` queue.
`pump_activations` (`crates/logic/lib.rs:1598-1635`) admits one waiter per
free permit. The queue is the whole admission policy: a waiter with `k`
waiters ahead of it is admitted within `k` releases, so no arrival pattern can
starve it (`crates/logic/lib.rs:539-545`).

Residency has a separate hard cap: `has_capacity` (`crates/logic/lib.rs:1369-1377`)
is `occupied < max_resident && !shedding`. A node at its cell cap refuses more
and holds what it has rather than shedding a live cell it must then place
elsewhere; the only sampled fact that refuses admission is genuine memory
pressure, which a cell count cannot see.

A cell that waits out the operation deadline behind the activation or capacity
gate is refused with `CapacityExhausted` (`expire_queued`,
`crates/logic/lib.rs:4546-4601`). The `QueuedActivation` timer is keyed by cell
and generation so a later parking cannot disarm an earlier one
(`TimerSlot`, `crates/celld/actor.rs:39-68`).

## Eviction, shedding, and pressure

Eviction removes a cell **out of memory**, which produces `Dormant`; shedding
is what then publishes it unowned. (Cloudflare's "evict" removes a cell *off
its host*, which produces `Inactive`; celld and Cloudflare use the word
differently — `crates/logic/lib.rs:108-111`.)

`has_capacity` treats residency as a hard cap enforced at admission. Memory
pressure is the sampled resource. The pure classifier lives in
`crates/logic/pressure.rs:1-80`: `PressureConfig` carries `high_bytes` (the
`CELLD_MAX_RSS_MB` ceiling) and `rss_hard_bytes` (an absolute 95%-of-machine
cap on the complete cgroup charge), and each latch engages at its own ceiling
and releases at its own low watermark. The core holds the shedding latch and
the hysteresis, so a sample sequence is replayable (`shedding`,
`crates/logic/lib.rs:642-646`).

`shed_one` (`crates/logic/lib.rs:4493-4515`) only sheds when the blocker is
admission headroom, never while the node is already walking down, and counts
in-flight evictions against the waiters so each completed eviction does not
start another. The victim is chosen by `shed_candidate`
(`crates/logic/lib.rs:4603-4632`): resident, idle, not holding an uncovered
alarm, preferring the isolate closest to empty (only the cut that takes an
isolate's last cell returns its heap), then never-refused first, then by
recency of a refused eviction, then least-recently-used, with the id as a
tiebreak so the choice is a function of state rather than map iteration order.

The `evict_rebalance` / `OwnershipOnEvict` decision controls whether an
eviction hands the cell to the fleet (`Release`) or keeps the ownership record
so a same-node wake can rename the local snapshot into place (`Sticky`). An
idle eviction keeps the record and the local snapshot (`cache.rs` calls it a
pure optimization: every entry is a copy the bucket already holds); a pressure
shed releases the cell so the next node to want it can take it without waiting
for this one to notice. Under pressure a node durably replicates and fences
the least-recently-used idle cells and publishes them unowned without
resetting their epochs, and it refuses to reacquire new unowned cells. It does
not shed a cell with active work or a live host WebSocket.

## The shell executes, the core decides

All of this policy lives in `celld-logic`, which has no I/O, clock, or
randomness of its own. The production actor (`crates/celld/actor.rs`) is the
only caller of `celld_logic::on_event`: it performs the returned `Effect`s and
reports the versioned completion `Event`s through the actor mailbox. The core
keeps the concurrency bounds as replayable state (`activation_permits`,
`eviction_permits`, `capacity_waiters`), and `State::validate`
(`crates/logic/lib.rs:1073+`) checks the structural invariants after every
event — for example that every activation permit is held by a cell in an
activation phase, and that the `occupied` counter agrees with a walk of the
cell map. `phase_census` (`crates/logic/lib.rs:977-983`) exposes the phase
distribution under stable names for operators.

## Related pages

- [Durability, fencing, and the output gate](durability-protocol.md) — the epoch prefix, conditional writes, and RPO=0 that make a single-writer cell safe.
- [V8 runtime and Cloudflare Workers compatibility](workers-runtime.md) — the isolate pool and how resident cells execute application code.
<!-- openwiki: broken internal link [fleet-operations.md] file "fleet-operations.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- [Operating a node and a fleet](fleet-operations.md) — pressure thresholds, drain, and the operator CLI.
- [Testing and verification strategy](../testing/verification.md) — how these lifecycle transitions are simulated and model-checked.
