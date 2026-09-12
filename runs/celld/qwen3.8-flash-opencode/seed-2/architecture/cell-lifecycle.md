---
type: architecture
title: "Cell lifecycle: phases, activation, and eviction"
description: "The decision core's per-cell state machine: the cold-activation phase ladder, capacity and activation permits, eviction victim order, hibernation, alarms, pressure shedding, drain, and generation swaps."
tags: [cell-lifecycle, state-machine, admission-control, eviction, alarms]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T18:36:22.117Z
---

# Cell lifecycle: phases, activation, and eviction

Every cell on a node is a `Phase` in `celld-logic`'s `State`, advanced only
through `on_event`. This page covers the per-cell machine; bucket ownership
mechanics are on [Coordination](/openwiki/architecture/coordination.md) and the
durability gate that holds write acknowledgements is on
[Durability and replication](/openwiki/architecture/durability-and-replication.md).

## Phase vocabulary

The phases deliberately map onto Cloudflare's named Durable Object lifecycle
states: `Resident` is active or idle in memory, `Dormant` is out of memory but
still owned by this node (a dormant cell that kept hibernatable sockets is
*hibernated*), and `Inactive` is out of memory and owned by nobody. celld and
Cloudflare use "evict" differently: celld evicts *out of memory* (producing
`Dormant`), and shedding is what then publishes the cell unowned
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L98-L111)).
`is_hibernated` is exactly "phase is `Dormant` and some surviving socket is
`Hibernatable`" ([crates/logic/lib.rs](repo://crates/logic/lib.rs#L1415-L1423)).

## The cold-activation ladder

A request for an inactive cell walks an explicit phase ladder, each step keyed
by the `OpId` of the effect it waits on
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L112-L190)):

`WaitingActivation` → `ReadingOwner` → (`ReadingNodeLease` |
`RecoveringOwnerLog`) → `ReadingCapacity`/`WaitingCapacity` → `Acquiring`
(→ `ReconcilingAcquire` on an ambiguous CAS) → `Restoring` → `Starting` →
`Publishing` → `Resident`.

`Restoring` consumes a `RestoreSpec` that ownership resolution already decided
(epoch, fresh, took-over, resume-local, prior owner) so the adapter never
re-discovers or guesses a restore source
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L49-L70)). A cold route that
finds the cell owned by another node becomes `Remote` and is forwarded; one that
lost its authority becomes `Fenced`.

`EnsuringDurability` is the one in-between state where the runtime *remains
published and routable* while a durability proof runs; a failed or ambiguous
proof simply returns the cell to `Resident`
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L156-L161)). A `Starting`
phase whose deadline expired still keeps its operation until the real
completion arrives, because a runtime start cannot be cancelled safely, and new
callers fail fast rather than starting a duplicate
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L570-L575)).

## Admission permits, all in the replayable state

Three bounded concurrencies gate this work, and the core holds them as explicit
sets so the bounds are part of the replayable state machine rather than
implied by executor task counts:

- **Residency** — `max_resident`; resident cells plus activation reservations
  may never exceed it. This is the hard cap set by `CELLD_MAX_RESIDENT_CELLS`,
  enforced at admission ([crates/logic/types.rs](repo://crates/logic/types.rs#L63-L65),
  [crates/celld/machine.rs](repo://crates/celld/machine.rs#L110-L112)).
- **Activations** — `max_activations`; a cold request holds one slot across
  ownership resolution, capacity waiting, restore, and publish, while a warm
  request consumes none. The default is the available CPU count capped at 128,
  overridable with `CELLD_ACTIVATIONS`
  ([crates/logic/types.rs](repo://crates/logic/types.rs#L66-L71),
  [crates/celld/main.rs](repo://crates/celld/main.rs#L3271-L3277)).
- **Evictions/releases** — `max_evictions` bounds concurrent durability proofs
  (a proof is a bucket round trip, so serial eviction of hundreds of cells
  would stall admission for minutes), and `max_releases` bounds complete
  shutdown handoffs, whose permit stays held through durability, release, and
  successor acceptance ([crates/logic/types.rs](repo://crates/logic/types.rs#L72-L87),
  [crates/celld/main.rs](repo://crates/celld/main.rs#L3278-L3281)).

Cells over the residency ceiling queue in `capacity_waiters`, and the queue is
FIFO on purpose: waking every waiter to race is unfair by construction — under
sustained eviction a waiter could time out while thousands of slots free
around it. FIFO converts "eventually, probably" into a bound: with `k` waiters
ahead, admission comes within `k` releases
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L539-L546)). Every permit
set, the `occupied` counter, and the waiter queues are cross-checked on each
event by `State::validate`
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L1073-L1137)).

## Eviction, victim order, and shedding

Eviction order is the reason each cell remembers `last_used_mono_ms`: without
it, the victim would be whichever cell sorts first by id, so a node under
sustained pressure would restore-and-shed its busiest cell forever while an
idle cell further down the alphabet was never touched
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L350-L357)). Two more
signals refine the pick:

- A cell whose eviction failed to prove its replica durable records
  `eviction_refused_mono_ms`, so the order prefers cells that have not just
  failed while still returning to the refusniks when nothing else remains
  ([crates/logic/lib.rs](repo://crates/logic/lib.rs#L321-L332)).
- The isolate a cell sits in matters: taking an isolate's last cell returns a
  whole V8 heap, taking one of thirty-two returns only a cell record
  ([crates/logic/lib.rs](repo://crates/logic/lib.rs#L333-L340)).

Pressure shedding is a pure classifier of a memory sample plus the previous
latch state ([crates/logic/pressure.rs](repo://crates/logic/pressure.rs#L3-L6)),
and the latch itself lives in the core — the hysteresis "is the part with
actual behaviour" that a simulation must be able to replay
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L638-L647)). The walk down
runs at eviction speed, not sample speed: each completed eviction starts the
next while residency is still above the recomputed `shed_floor`, and a
completed cut that left the measurement flat makes another cut futile
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L600-L613)). Whether an
eviction releases the ownership record to the fleet or keeps it for a cheap
same-node wake is a configuration decision (`ownership_on_evict`): releasing
lets a loaded node shed *load*, keeping it would route every future request
back to the node that just said it has no room
([crates/logic/types.rs](repo://crates/logic/types.rs#L95-L103)).

A cell is never a candidate while it holds active requests or sockets that
cannot survive the isolate, and a hibernatable socket instead survives
eviction as hibernation. Idle eviction on a timer (`idle_evict_ms`) and an
imminent alarm (`alarm_resident_ms`: inside that window the wake would cost
more than the residency it saves) are separate policies layered on the same
eligibility test ([crates/logic/types.rs](repo://crates/logic/types.rs#L121-L128),
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L1425-L1440)).

## Concurrency inside a cell

A cell runs one event at a time; the input gate reproduces workerd's rule that
while the gate is held no incoming event of any kind — subrequest responses,
timers, stream reads — is delivered to the cell except the holder. Unlike
workerd, storage does not gate here: every celld storage path is local SQLite
whose awaited result drains in the same microtask checkpoint, so only
`blockConcurrencyWhile` holds the gate
([crates/logic/gate.rs](repo://crates/logic/gate.rs#L1-L22)). Refused events
are not re-queued by the core; they simply stay on the cell's job channel in
arrival order ([crates/logic/gate.rs](repo://crates/logic/gate.rs#L23-L31)).

## Alarms

An armed alarm is `Armed { at_ms, generation, covered }`; a firing one becomes
`Firing` and its settlement is ordered by the output gate — the consume-side
wake-entry delete waits behind the durable proof, because deleting the entry
while the consuming commit is still local would lose both the alarm and the
record that could revive it
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L242-L252),
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L360-L376)). After a handler
fails, the retry schedule is exponential from a 2-second base with a 64×
backoff cap; six *limit-counting* failures abandon the alarm, while excused
failures (for example a shed under pressure) back off but never count toward
the ceiling ([crates/logic/alarm.rs](repo://crates/logic/alarm.rs#L11-L31)).

## Shutdown drain and generation swaps

A draining node reserves each selected resident cell with a sticky `quiescing`
flag: accepted requests finish locally, new requests wait for the successor
route, and a draining node never returns to serving
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L306-L310),
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L490-L493)). `DrainPin`
projects exactly what still prevents a quiescing cell from handing off — the
active request, held gate outputs, or regular/outbound sockets
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L290-L302)).

When the node adopts a new application generation, resident cells move at a
safe point; `swap_max_age_ms` (0 forces at once) and `swap_eager_classes` bound
how long a stale generation may persist
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L617-L637)). A forced swap
first cancels the cell's activity and asks once (`swap_cancelled`), and `validate`
rejects a swap flag carried by a cell outside the swap path
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L341-L346),
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L1151-L1177)).

## Operator-visible shape

Phase names are part of the operator interface — `/state` and `celld diagnose`
publish them, and they are stable across internal renames
([crates/logic/lib.rs](repo://crates/logic/lib.rs#L212-L214)). `phase_census`
counts cells per phase because `occupied` alone misdiagnoses a node with
thousands of cells stuck mid-cold-start as nearly empty — a failure the fleet
actually hit ([crates/logic/lib.rs](repo://crates/logic/lib.rs#L966-L983)).
