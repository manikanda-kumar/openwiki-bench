---
type: runtime
title: Cell lifecycle and activation
description: The cell state machine — inactive/hibernated/resident, activation with restore, the serial executor (actor) and its timers, isolate pool balancing, alarm wake and orphan revival, and deployment moves at safe points.
tags: [lifecycle, activation, cell, actor, isolate, alarms]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-2f36a204fbf1f86adbe0d189
    resource: repo://crates/celld/wake.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Cell lifecycle and activation

## Cell states

From `docs/README.md`, a cell has the same states as a Durable Object
[docs/README.md](repo://docs/README.md#L22-L33):

- **Inactive**: no node holds the cell — an advertisement
  [docs/README.md](repo://docs/README.md#L4-L5) of the name only; storage
  is only a bucket object. Every cell starts here.
- **Resident**: in memory — **active** while it works, **idle** while it
  waits.
- **Hibernated**: removed from memory with hibernatable WebSocket
  clients kept connected, staying on its node.

A cell keeps nothing across these transitions (the constructor runs
again on the next event), except the hibernated cell's WebSocket clients
and its node placement. All storage operations work while only one node
leaves the cell — the durability story is on
[Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md).

## `on_event` is the only way state advances

The actor implements the executor. "The serial lifecycle executor" runs
when celld serves requests. All behavioral behavior flows through
`on_event(state, event) -> Vec<Effect>` (the logic core's single method)
[crates/logic/actor.rs](repo://crates/celld/actor.rs#L3-L26)
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L4-L7). Its imports name
the domain types (AdoptedCell, CasGuard, CasOutcome, Channel, Config,
Effect, Event, Failure, LeaseCasOutcome, NodeLeaseRecord, NodeLeaseSpec,
OwnerRecord, OwnershipOnEvict, Phase, RequestError, Route, State,
StopCause, Timer, WebSocketKind, WorkerRoute, OpId) — the request-driven
event loop is a set of effects the shell must perform
[crates/celld/actor.rs](repo://crates/celld/actor.rs#L14-L26).

## The actor's timers

`crates/celld/actor.rs` defines the shell's timer slots, and the comment
is a critique of slot coalescing
[crates/celld/actor.rs](repo://crates/celld/actor.rs#L44-L65):

- `NodeLeaseRenew` / `NodeLeaseFence` — lease lifecycle (see
  [owner fencing](/openwiki/data/ownership-fencing.md)).
- `CellAlarm(scope)` — per cell; coalesced to the newest arming.
- `OperationDeadline(OpId)` — **keyed by operation**: "each watches a
  different outstanding operation, and a shared slot would let arming
  one silently cancel another, leaving every activation but the most
  recent with nothing watching it."
- `QueuedActivation(scope, generation)` — "keyed by cell and generation
  for the same reason as the deadline above: a node parks many cells at
  once, and one slot per cell would let a later parking disarm an
  earlier one."

Each non-restore operation carries a deadline
(`CELLD_OPERATION_DEADLINE_MS`, default 15 000)
[crates/celld/actor.rs](repo://crates/celld/actor.rs#L29-L36).

## The isolate pool

`crates/logic/isolate.rs` is "the isolate pool, reified sans-IO". An
isolate is not bound to a thread: "`v8::Locker` installs the entering
thread's per-isolate state, so any worker can take an isolate and run a
turn in it. What an isolate *is* bound to is the JS state it holds"
[crates/logic/isolate.rs](repo://crates/logic/isolate.rs#L3-L18).

Two load quantities answer **different questions**
[crates/logic/isolate.rs](repo://crates/logic/isolate.rs#L20-L27):

- **turns** — queued and running turns. *CPU* demand. Placement
  balances it. A request awaiting I/O contributes nothing because the
  isolate is released across the await; it counts the queue, because an
  isolate serves one turn at a time so "executing" alone is never the
  demand signal.
- **requests** — requests affiliated with the isolate. A request's
  promise lives in that isolate's heap, "so every later turn must come
  back. Affiliation is memory, not CPU, and is what admission and
  shedding care about."

The isolate pool grows and shrinks with demand; "the shell reports what
it sees and performs what it is told" — it never decides
[crates/logic/isolate.rs](repo://crates/logic/isolate.rs#L9-L19).

## Alarms and wake entries for inactive cells

`crates/celld/wake.rs` is the wake system (active by default):

- **Alarm state is mirrored into the bucket** at
  `wake/<YYYY-MM-DDTHH:MM>/<cell>` so a wake hint survives
  fence/crash/deploy; the sweep evicts alarm-bearing cells behind a
  durable snapshot, and there is an advisory waker for **orphans** whose
  owner died
  [crates/celld/wake.rs](repo://crates/celld/wake.rs#L3-L16).
- A **stale entry costs one spurious wake, a missing entry costs a lost
  wake** — an asymmetric failure model, so the system prefers to wake a
  cell for nothing rather than lose the alarm
  ([crates/celld/wake.rs](repo://crates/celld/wake.rs#L10-L16)).
- Boot-time orphan scan plus a periodic waker tick list and filter the
  whole `wake/` prefix; the scan and the `next_alarm_ms` mirror ride the
  existing 5 s sweep tick
  [crates/celld/wake.rs](repo://crates/celld/wake.rs#L37-L39).
- `celld_logic::wake` owns `parse_entry_key`, `Op`, `Step`, and
  `WakeCore` — the sans-I/O core of the wake protocol
  [crates/celld/wake.rs](repo://crates/celld/wake.rs#L18-L21).
- Stay-resident threshold: "alarms due sooner than this keep their cell
  resident when residency is cheaper than a wake cycle"
  [crates/celld/wake.rs](repo://crates/celld/wake.rs#L26-L31).

The response boundary rule: a response is not held open for an alarm
armed inside a `waitUntil` past the response deadline — "an event sets
an alarm before its response boundary" must still be durably covered by
a wake entry before that event's response can succeed, and a later
`waitUntil` alarm must not delay another event's response
[docs/README.md](repo://docs/README.md#L66-L70).

## Deployment moves at safe points

When a node adopts a new deployment
([deploy flow](/openwiki/operations/node-cli.md)):

- A resident Durable Object moves to the new deployment **only at a safe
  point**: no request runs in it, no alarm handler runs in it, no output
  waits for durability, and no regular WebSocket is open.
- The move preserves storage, epoch, and hibernatable WebSockets,
  touching neither the bucket nor the disk.
- An object that reaches no safe point within
  `CELLD_DEPLOY_MAX_AGE_S` (default 60; 0 forces immediately) is
  **forced**: running work is cancelled and regular WebSockets close
  with code 1012 (the same behavior as a Cloudflare deployment).
- During the window, requests on one deployment may call objects on the
  other; two adjacent versions must accept each other's calls.

The move is documented
[docs/README.md](repo://docs/README.md#L258-L272).

## Cold activation and the restore path

Requesting a cold cell (or reaching it via a route miss) triggers cold
activation: capacity budgeting (`CELLD_ACTIVATIONS` — default the CPU
count or 128, whichever is smaller) then restore from the newest safe
source (local eviction snapshot vs replicated bucket — see
[Restore and takeover](/openwiki/data/restore-takeover.md)), with the
CAS claim and epoch advance happening before any work runs
([Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md)).

## Related pages

- [Resident capacity, pressure shedding, and overload](/openwiki/runtime/admission-pressure.md) —
  what makes an idle cell evict.
- [Restore and takeover](/openwiki/data/restore-takeover.md) — restore
  source choice and recovery.
- [JS/V8 host surfaces](/openwiki/runtime/js-v8-host.md) — what surfaces
  a running isolate exposes to code.
