---
type: concept
title: Cell lifecycle and placement
description: A cell moves through core Phase states from Inactive through cold activation to Resident/Dormant; admission, eviction, hibernation, restore-source choice, and alarm wake are all decided in celld-logic and performed by the shell's runtime, pool, and wake adapters.
tags: [cell-lifecycle, activation, eviction, hibernation, wake, placement]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-3232fb9585042cdcff032e07
    resource: repo://crates/celld/pool.rs
  - id: openwiki-source-2f36a204fbf1f86adbe0d189
    resource: repo://crates/celld/wake.rs
  - id: openwiki-source-e5ac10d305aff4ea0756b67b
    resource: repo://crates/logic/alarm.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-e65834f5c83ba76e348f4b8a
    resource: repo://crates/logic/schedule.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Cell lifecycle and placement

A cell is one Durable Object instance with its own SQLite database. This page
follows a cell through the states the decision core models and the shell
adapters that realize them. Ownership and fencing semantics are on
[durability and fencing](durability-and-fencing.md); the isolate mechanics are
on [the runtime page](../runtime/v8-workers.md).

## The lifecycle vocabulary

The core's `Phase` enum is the authoritative state machine, and it maps onto
the named Cloudflare states: `Resident` is active-or-idle in memory,
`Dormant` is out of memory but still owned by this node, and a dormant cell
whose hibernatable WebSockets survived is *hibernated*; `Inactive` is out of
memory and owned by nobody — the initial state of every cell. The header also
warns that celld and Cloudflare use "evict" differently: Cloudflare evicts a
cell *off its host* (producing `Inactive`); celld evicts *out of memory*
(producing `Dormant`), and shedding is what publishes it unowned
([crates/logic/lib.rs#L98-L113](repo://crates/logic/lib.rs#L98-L113)). Between
`Inactive` and `Resident` sit the cold-activation phases
`WaitingActivation`, `ReadingOwner`, `ReadingNodeLease`, `RecoveringOwnerLog`,
`ReadingCapacity`, `WaitingCapacity`, `Acquiring`, `ReconcilingAcquire`,
`Restoring`, `Starting`, `Publishing`, plus `EnsuringDurability`, `Cleaning`,
`Dormant`, `Adopting`, `Remote`, and `Fenced`
([crates/logic/lib.rs#L113-L190](repo://crates/logic/lib.rs#L113-L190)). Phase
names are stable public vocabulary: `/state` and `celld diagnose` publish them
([crates/logic/lib.rs#L212-L214](repo://crates/logic/lib.rs#L212-L214)).

Nothing survives the memory→dormant→memory round trip: "the constructor runs
again on the next event", and a hibernated cell wakes like a cold start except
its sockets stayed connected
([docs/README.md#L22-L34](repo://docs/README.md#L22-L34)). The code agrees:
hibernation is defined as a `Dormant` cell holding at least one
`Hibernatable` socket, with the surviving sockets "the whole of the difference
from `Inactive`" ([crates/logic/lib.rs#L1411-L1422](repo://crates/logic/lib.rs#L1411-L1422)).

## Where a request lands

`State::request` is the routing choke point. A fenced node answers
`NodeFenced`; a node that is not node-authoritative answers `NodeUnavailable`;
otherwise `request_authorized` dispatches on the cell's phase
([crates/logic/lib.rs#L2819-L2851](repo://crates/logic/lib.rs#L2819-L2851)):

- `Resident` → `Route::Local`, with the cell's `last_used_mono_ms` refreshed
  (the LRU clock used by shedding)
  ([crates/logic/lib.rs#L1444-L1462](repo://crates/logic/lib.rs#L1444-L1462)).
- `Remote { node, addr, epoch, peer_protocol }` → `Route::Remote`, so the
  non-owner forwards to the owner over the peer network — carrying the epoch
  and protocol version, which is what makes stale routing visible
  ([crates/logic/lib.rs#L2897-L2911](repo://crates/logic/lib.rs#L2897-L2911)).
  When a forward *fails*, [routing::Dispatcher decides whether a re-send is
  safe](../architecture/decision-core.md).
- `EnsuringDurability` (voluntary eviction in progress) rescues the cell back
  to `Resident`: a new request wins the race with eviction, the durability op
  is retired, and the eviction permit is returned — "leaked, it counts against
  `max_evictions` forever and eventually stands every future eviction down"
  ([crates/logic/lib.rs#L2884-L2896](repo://crates/logic/lib.rs#L2884-L2896)).
- Cold (`Inactive`) starts the activation pipeline; in-flight phases simply
  park the request on the cell until the route resolves
  ([crates/logic/lib.rs#L2932-L2938](repo://crates/logic/lib.rs#L2932-L2938)).

WebSockets have their own rule: a registered regular or outbound socket on a
resident cell is kept local through a drain, while a hibernatable socket
follows the ordinary route so it can reactivate or reach a successor
([crates/logic/lib.rs#L2853-L2876](repo://crates/logic/lib.rs#L2853-L2876)).

## Cold activation

`State::request` funnels an `Inactive` cell through `admit_or_queue_activation`
— cold demand queues behind `max_activations` before any I/O begins
([crates/logic/lib.rs#L115-L116](repo://crates/logic/lib.rs#L115-L116)). The
pipeline then, per phase above, reads the owner record, claims it with a CAS
when the prior owner's lease has expired, restores, starts the runtime, and
publishes. A takeover first runs the node-log interlock: `RecoveringOwnerLog`
appears when the dead owner's folded log state was not sealed, and the
executor must recover its sessions before the claim
([crates/logic/lib.rs#L124-L130](repo://crates/logic/lib.rs#L124-L130)) — see
[durability and fencing](durability-and-fencing.md).

The core, not the adapter, decides the restore source. `RestoreSpec` carries
"facts already decided by ownership resolution" — `fresh` (conditional create
of epoch one, so no replica can precede it), `took_over` (a previous local
eviction cache is not authoritative), `resume_local` (the node-level lease
handoff proved this exact local epoch authoritative, so the adapter must not
consult the remote replica), and `prior` (the displaced owner, for the
takeover interlock) — and the effect adapter explicitly "must not rediscover
or guess these" ([crates/logic/lib.rs#L49-L69](repo://crates/logic/lib.rs#L49-L69)).
The durability predicate behind the choice is
[restore::previous_epoch_reusable](repo://crates/logic/restore.rs#L21-L29):
an idle-eviction cache under `epoch - 1` may be reused only when nobody else
had the cell.

An ambiguous bucket answer during the claim is reconciled, but only three
times: "a store answering ambiguously three times running is not about to
start answering", so the request then fails and the caller decides
([crates/logic/lib.rs#L92-L96](repo://crates/logic/lib.rs#L92-L96)).

## Admission, eviction, and shedding

Admission is exact, not sampled: `has_capacity` means the resident count is
below `max_resident` **and** the node is not shedding memory — "a node at its
cell cap is at capacity, not overloaded: it refuses more and holds what it
has, rather than shedding a live cell it must then place again elsewhere"
([crates/logic/lib.rs#L1369-L1376](repo://crates/logic/lib.rs#L1369-L1376)).
`CELLD_MAX_RESIDENT_CELLS` sets the hard cap
([crates/celld/machine.rs#L111](repo://crates/celld/machine.rs#L111));
concurrency budgets default to `min(available_parallelism, 128)` activations,
4 evictions, and 8 releases
([crates/celld/main.rs#L3271-L3282](repo://crates/celld/main.rs#L3271-L3282),
[crates/celld/main.rs#L2973-L2982](repo://crates/celld/main.rs#L2973-L2982)).

Idle eviction runs on every event when `idle_evict_ms` is configured and picks
the LRU `shed_candidate` ([crates/logic/lib.rs#L4656-L4671](repo://crates/logic/lib.rs#L4656-L4671)).
The victim rule is deliberately not plain LRU: a candidate must be
`is_hibernatable` (resident, not active) and its alarm must be covered or
absent ([crates/logic/lib.rs#L1425-L1437](repo://crates/logic/lib.rs#L1425-L1437)),
and the cut comes from the isolate *closest to empty*, because only evicting
an isolate's last cell returns its V8 heap — "evicting by recency alone
spreads the cuts over every isolate, so the node gives up its working set and
frees nothing"; ties break on refusal history, recency, then cell id so the
choice is a function of state, not map order
([crates/logic/lib.rs#L4603-L4640](repo://crates/logic/lib.rs#L4603-L4640)).

Under memory pressure the latch keeps the node shedding until every low
watermark clears (preventing oscillation), and the walk-down has a stopping
condition: once the projected cut has landed and a fresh sample has not risen,
further eviction stops rather than walking the node to zero
([crates/logic/lib.rs#L4674-L4720](repo://crates/logic/lib.rs#L4674-L4720)).
Shedding then "durably replicates and fences the least-recently used idle
cells, publishes them as unowned without resetting their epochs, and refuses
to reacquire new unowned cells" ([README.md#L288-L295](repo://README.md#L288-L295)).

## Resident concurrency and fairness

While resident, a cell serves several requests at once by design; what must
not interleave is `blockConcurrencyWhile`, enforced by the per-cell input gate
whose shell side asks `is_open` at each delivery point
([crates/logic/gate.rs#L3-L56](repo://crates/logic/gate.rs#L3-L56)). A
top-level Worker fetch runs in a resident cell's isolate only when that
isolate is idle — never nested — otherwise it reschedules to the stateless
pool ([crates/logic/schedule.rs#L3-L10](repo://crates/logic/schedule.rs#L3-L10)),
and the shell's turn scheduler lanes (stateless vs per-cell) keep one Queue
producer event from letting producer work starve alarms and settlements
([crates/celld/pool.rs#L39-L43](repo://crates/celld/pool.rs#L39-L43)).
Shell activity completion is reported back through a `CellActivityGuard` whose
drop alone says "this cell is idle again" — the token carries no policy
([crates/celld/lib.rs#L432-L454](repo://crates/celld/lib.rs#L432-L454)).

## Alarms and wake

An alarm set before a response boundary keeps that response waiting for a
durable wake entry; a later `waitUntil` alarm cannot delay another event's
response ([docs/README.md#L67-L70](repo://docs/README.md#L67-L70)). Committed
alarm state is mirrored into the bucket as `wake/<YYYY-MM-DDTHH:MM>/<cell>` so
the hint survives fence, crash, and deploy; the sweep evicts alarm-bearing
cells only behind a durable entry; a per-node heap plus boot scan re-activates
them; and a per-fleet advisory waker revives orphans whose owner died
([crates/celld/wake.rs#L3-L9](repo://crates/celld/wake.rs#L3-L9)). The key
scheme and reconciliation ordering live in the core so production and
simulation cannot diverge ([crates/logic/wake.rs#L3-L8](repo://crates/logic/wake.rs#L3-L8)).
A failing alarm handler retries with exponential backoff (2 s base, capped at
64 s, abandoned after 6 counted failures; excused failures such as shedding
back off without counting)
([crates/logic/alarm.rs#L9-L33](repo://crates/logic/alarm.rs#L9-L33)). Cron
triggers reuse the same machinery: each `triggers.crons` entry becomes one
reserved cell whose alarm is armed at the next minute-resolution UTC
occurrence ([crates/logic/cron.rs#L3-L11](repo://crates/logic/cron.rs#L3-L11)).

Related: [architecture hub](../architecture.md) ·
[decision core](../architecture/decision-core.md) ·
[durability and fencing](durability-and-fencing.md) ·
[listeners and peers](../networking/listeners-and-peers.md) ·
[node operations](../operations/node-operations.md)
