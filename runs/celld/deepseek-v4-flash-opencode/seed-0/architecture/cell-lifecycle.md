---
type: architecture
title: Cell Lifecycle and Scheduling
description: How a Durable Object cell moves through its phases on a node — inactive, cold activation, resident/active/idle, dormant and hibernated — including eviction, the isolate pool, event scheduling, alarms, and the durable wake index.
tags: [cell, lifecycle, scheduling, activation, eviction, alarm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-e5ac10d305aff4ea0756b67b
    resource: repo://crates/logic/alarm.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-e65834f5c83ba76e348f4b8a
    resource: repo://crates/logic/schedule.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Cell Lifecycle and Scheduling

A **cell** is one Durable Object: a named server with its own SQLite
database that lives on exactly one node at a time. This page describes
how a cell passes through the states of the Durable Objects lifecycle on
that node, how the node decides when to bring a cell into memory and when
to give it back, how cell events are scheduled, and how alarms keep
working after a cell leaves memory.

## Lifecycle states

The decision core models a cell's state as a `Phase`, and the phases map
onto the Durable Objects lifecycle states where Cloudflare has a name for
them (crates/logic/lib.rs#L113-L190):

- **Inactive** — out of memory and owned by nobody. Every cell starts
  here; it is only an object in the bucket.
- **Resident** — in memory on this node. A resident cell is **active**
  while it does work and **idle** while it waits.
- **Dormant** — out of memory but still owned by this node. A dormant
  cell that kept its hibernatable WebSocket clients is **hibernated**
  (Durable Objects state 4).
- A cell that no node holds, or that a request is waiting to bring up, is
  **Inactive** again.

The intermediate `Phase` variants (`ReadingOwner`, `Acquiring`,
`Restoring`, `Starting`, `Publishing`, `EnsuringDurability`, `Cleaning`,
`Adopting`, `WaitingActivation`, `WaitingCapacity`, `Remote`, `Fenced`)
are the transient cold-activation, handoff, and failure states; the
reported names (`phase_name`) are stable across internal renames because
`/state` and `celld diagnose` publish them (crates/logic/lib.rs#L212-L240).

A cell keeps no memory across the resident→dormant transition, so the
next event runs the object's constructor again exactly as a cold start
does; the only difference from `Inactive` is that a hibernated cell's
sockets survive and it stays on its node
(crates/logic/lib.rs#L1410-L1422).

## A cell runs one event at a time

Each cell's isolate runs one event at a time. A second request
interleaves only while the first awaits, and storage operations are
synchronous underneath the async JS surface and never interleave, so the
data in a cell stays consistent (docs/README.md#L12-L15). When the
isolate is already pumping an event, a top-level Worker fetch is
rescheduled to the stateless Worker pool — never run nested — carrying its
request identity so the reply still lands
(crates/logic/schedule.rs#L3-L10).

## The decision core drives every transition

All behavioral state advances through one entry point: `on_event`, which
takes the current `State` and one `Event` and returns a list of `Effect`s
(crates/logic/lib.rs#L5215-L5217). The production executor performs those
effects (object-store reads and writes, runtime starts and stops, timers)
and later feeds the completion events back through the same mailbox. No
adapter may mutate `State` directly (crates/logic/lib.rs#L1-L6). Each
event handler runs, then the core pumps pending activations, releases, and
generation swaps, validates its invariants in debug builds, and arms
operation deadlines (crates/logic/lib.rs#L5298-L5314).

## Cold activation

A request or wake for a cell that is not resident starts a cold route
(`request_authorized`, crates/logic/lib.rs#L2878-L2960):

1. The cell enters `WaitingActivation` if all `max_activations` permits
   are held; otherwise it takes a permit and reads the ownership record
   (`Phase::ReadingOwner`, `Effect::ReadOwner`)
   (crates/logic/lib.rs#L1554-L1576).
2. With ownership resolved, the core either conditionally acquires the
   record (`Phase::Acquiring`, `Effect::CasOwner`) or, when a safe
   previous epoch is known, goes straight to restore
   (`Phase::Restoring`, `Effect::Restore`)
   (crates/logic/lib.rs#L1692-L1736).
3. The runtime is started (`Effect::StartRuntime`), the cell is published
   as routable (`Phase::Publishing`, `Effect::Publish`), and it becomes
   `Resident` (crates/logic/types.rs#L838-L847).

A cell that cannot be activated because the node is at its resident-cell
capacity waits in `Phase::WaitingCapacity` behind `max_resident`, and the
core immediately tries to shed a victim to make room
(crates/logic/lib.rs#L1738-L1763). A cell parked behind either gate is
given an operation deadline; if it waits it out, its requests are refused
with `CapacityExhausted` (crates/logic/lib.rs#L4527-L4601).

Each cold route holds one activation permit across ownership resolution,
capacity waiting, restore, and publish, so `max_activations` bounds the
nonresident work a node starts at once (crates/logic/types.rs#L64-L71).

## Eviction and shedding

A resident, idle cell can be evicted. Eviction is not immediate: the core
first moves the cell to `Phase::EnsuringDurability` and emits
`Effect::EnsureDurable`, and the runtime stops only after the cell's
commits are proven recoverable from replica authority
(crates/logic/types.rs#L848-L854). The number of durability proofs in
flight is bounded by `max_evictions` (crates/logic/types.rs#L72-L80).

The core refuses to evict a cell that is not hibernatable or whose alarm
is not durably covered by a wake entry, and it holds a cell whose alarm is
about to fire within `alarm_resident_ms` unless the node is shedding or
draining (crates/logic/lib.rs#L4441-L4491).

The eviction order (used by demand shedding and pressure shedding alike)
prefers the isolate closest to empty, then cells that have not recently
refused eviction, then least-recently used, with the id as a tiebreak
(crates/logic/lib.rs#L4603-L4646). Packing cells onto the fullest isolate
is deliberate: only a cut that takes an isolate's last cell returns its
heap (crates/logic/isolate.rs#L248-L271).

An idle cell is evicted with no pressure involved after
`idle_evict_ms`, so a quiet node does not hold every cell it ever served
(crates/logic/lib.rs#L4648-L4671). Whether an ordinary eviction also
releases the ownership record is configurable
(`OwnershipOnEvict::Release` hands the cell to the fleet; keeping the
record makes a same-node wake a local rename instead of a restore)
(crates/logic/types.rs#L95-L103).

## The isolate pool

JS runs on a set of isolates that grow and shrink with demand. An isolate
is not bound to a thread — `v8::Locker` installs the entering thread's
per-isolate state — but it is bound to the JS state it holds
(crates/logic/isolate.rs#L3-L9). Two quantities matter:

- **turns** — queued plus running work on the isolate; released across an
  await, so it is the CPU signal that placement balances.
- **requests** — requests whose promise and closures live in the
  isolate's heap; affiliation is memory and is what admission and
  shedding care about (crates/logic/isolate.rs#L11-L22).

Stateless requests are placed on the isolate with the fewest turns and
growth at `grow_at`; admission and placement are one call so the shell
cannot admit a request it cannot place (crates/logic/isolate.rs#L131-L223).
A cell's realm is placed once, for the whole life of the cell on the node,
packed onto the fullest isolate that has room under the per-isolate
`max_cells` ceiling (crates/logic/isolate.rs#L225-L271).

An isolate that hosts a cell is never a retirement candidate, because a
cell does not drain itself the way requests do; an isolate may be freed
only when it is provably drained — no queued or running turn, no live
affiliation, and no hosted cell (crates/logic/isolate.rs#L283-L310).

## Alarms and the wake index

A cell's committed alarm is mirrored into the bucket as
`wake/<YYYY-MM-DDTHH:MM>/<cell>` (minute buckets, UTC, lexicographically
ordered) so the wake hint survives a fence, a crash, and a deploy
(crates/logic/wake.rs#L30-L39). The `WakeCore` is a pure sans-IO
reconciliation: it decides whether a PUT or DELETE is needed, and an
executor (production's async bucket flusher or the deterministic fake)
asks for steps and reports outcomes so the ordering rules cannot diverge
between them (crates/logic/wake.rs#L3-L10).

The key invariants are enforced by the reconcile ordering:

- An alarm arm is acknowledged to the application only when a durable
  wake entry covers it; a proven entry at the same or an earlier minute
  suffices, so only tightening pays a synchronous PUT
  (crates/logic/wake.rs#L131-L177).
- A move PUTs the new key before deleting the old one, so a crash strands
  one extra entry (a spurious wake), never zero
  (crates/logic/wake.rs#L182-L189).
- The delete of a consumed alarm is gated on the consuming commit being
  durable — deleting the entry while the commit is still local would leave
  replicated truth armed with no entry
  (crates/logic/wake.rs#L192-L209).

Eviction of an alarm-bearing cell is fail-closed on the entry being
`verified` (proven present) and not about to be deleted
(crates/logic/wake.rs#L259-L267). A due scan wakes cells whose entries
have arrived, a per-node heap plus boot scan re-activates them, and a
per-fleet advisory **waker** role (a singleton lease, claimable when it
expires) revives orphans whose owner died
(crates/celld/wake.rs#L1-L8, crates/logic/wake.rs#L480-L487).

A failed alarm handler retries on an exponential backoff
(`2s << min(retry, 6)`) and is abandoned once six limit-counting failures
accrue; failures the caller excuses (for example a shed under pressure)
back off but never reach the ceiling (crates/logic/alarm.rs#L10-L34).

## Cell scope validity

A cell scope (`Class:instance`) is a security fence: it becomes a path
component and an object-store key, so only ASCII alphanumerics plus
`_ - . : $` are admitted, `.` and `..` are rejected, and a scope may be at
most 255 bytes — the minimum `NAME_MAX` celld accepts for a data
filesystem, so a scope that passes the gate fits every node in the fleet
(crates/logic/cell.rs#L15-L51).
