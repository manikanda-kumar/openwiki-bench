---
type: lifecycle
title: "Cell lifecycle and Durable Object semantics"
description: "How a cell moves through phases from inactive to resident and back, how alarms/cron/queues wake it, and how restore picks a durable source."
tags: [cell, lifecycle, alarms, cron, queues, restore]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-e5ac10d305aff4ea0756b67b
    resource: repo://crates/logic/alarm.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-9adfa4329f90a51f50e97ef0
    resource: repo://crates/logic/sweep.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Cell lifecycle and Durable Object semantics

A **cell** is one Durable Object instance: a named server with a private
SQLite database ([docs/README.md](../docs/README.md)). celld expresses the
Durable Objects lifecycle as an explicit state machine in the decision core,
`crates/logic/lib.rs`, and every transition happens only through `on_event`
(`crates/logic/lib.rs:3-6`).

## The `Phase` state machine and DO states

`Phase` (`crates/logic/lib.rs:113-201`) maps onto the Durable Objects
lifecycle where Cloudflare has a name for it (`crates/logic/lib.rs:110-117`):

| celld `Phase` | DO state | Meaning |
|---|---|---|
| `Resident { epoch }` | active / idle (states 1–3) | in memory, serving |
| `Dormant { epoch }` | hibernated (state 4) if hibernatable sockets survived; else simply out of memory but still owned by this node | "Out of memory, still owned here" |
| `Inactive` | inactive (state 5) | "out of memory and owned by nobody: removed from the host, needing a cold start… the initial state of every cell" |

The comment also warns about vocabulary drift: **Cloudflare "evicts" a cell
off its host (→ `Inactive`), while celld "evicts" it out of memory (→
`Dormant`), and *shedding* is what publishes it unowned**
(`crates/logic/lib.rs:116-117`). [docs/README.md](../docs/README.md) uses the
same vocabulary ("A cell that then keeps its hibernatable WebSocket clients,
and stays on its node, is **hibernated**").

Between those stable states the machine walks explicit intermediate phases —
`WaitingActivation`, `ReadingOwner`, `ReadingNodeLease`,
`RecoveringOwnerLog`, `ReadingCapacity`, `Acquiring`, `ReconcilingAcquire`,
`Restoring`, `Starting`, `Publishing`, `EnsuringDurability`, `Cleaning`,
`Adopting`, `Remote`, `Fenced` (`crates/logic/lib.rs:113-201`). Phase names
are stable strings published by `/state` and `celld diagnose`
(`crates/logic/lib.rs:220+`).

## Activation: claim, restore, publish

A cold start follows the phase sequence, and the steps are all core decisions
executed by the shell:

1. A request arrives for an inactive cell (`Event::RequestAt`,
   `crates/logic/types.rs:441-452`).
2. The core reads the owner record (`Effect::ReadOwner`) and node lease if a
   prior owner exists; if the previous owner's log was never sealed, the
   **takeover interlock** runs first — `RecoveringOwnerLog` exists so the
   "dead owner's … acked tail may exist only on its followers" and must be
   recovered before the claim proceeds (`crates/logic/types.rs:769-778`).
3. The claim is made with an owner-record CAS (`Effect::CasOwner`); an
   ambiguous CAS is re-read rather than retried blindly, bounded by
   `MAX_ACQUIRE_RECONCILES = 3` (`crates/logic/lib.rs:104-110`).
4. The SQLite database is restored from the newest **safe** source — a local
   eviction snapshot or the replicated bucket copy
   (`crates/logic/restore.rs:5-8`). Choosing is a pure durability predicate:
   "pick a stale one over a newer replica and the cell serves lost writes;
   pick a needlessly-remote one and pay dozens of sequential round trips"
   (`crates/logic/restore.rs:9-13`). The availability checks (file existence,
   bucket LIST) are IO the executor performs, but the *choice* is sans-IO.
5. The runtime starts, the cell is published routable, and durability is
   proved (`EnsuringDurability` returns to `Resident` on ambiguity,
   `crates/logic/lib.rs:171-175`).

Ownership itself — the CAS dialect, lease expiry, and fencing that gate these
steps — is covered in the ownership page and `crates/logic/gate.rs` /
`crates/logic/peer.rs`.

## Alarms

Alarm retry is "reified sans-IO" in `crates/logic/alarm.rs`: after a handler
fails, celld persists a backoff row in SQLite and "abandons the alarm once a
bounded number of limit-counting failures accrue"
(`crates/logic/alarm.rs:4-6`). The schedule is a pure function of the row's
counters: `RETRY_CEILING = 6` counted failures, backoff base 2 s left-shifted
up to 6 times (`crates/logic/alarm.rs:8-11`). Failures the caller excuses —
for example a shed under pressure — "back off but never reach the ceiling"
(`crates/logic/alarm.rs:17-19`). The woken cell runs the constructor again,
because "A cell keeps no memory across these transitions, so the constructor
runs again on the next event" ([docs/README.md](../docs/README.md)).

## Wake reconciliation

`crates/logic/wake.rs` owns alarm-wake entries in the bucket and their key
scheme. `WakeCore::decide` is a pure transition, and `Reconcile` holds "the
ordering rules an executor must obey"; "Any executor — production's async S3
flusher or a deterministic fake — asks for steps and reports outcomes, so the
rules cannot diverge between them" (`crates/logic/wake.rs:5-9`). The wake
index keys on minute buckets (`wake::entry_key`), which is why cron
resolution is also one minute (`crates/logic/cron.rs:12-17`).

## Cron triggers

A `triggers.crons` entry in the Wrangler config "becomes one reserved cell
whose alarm is armed at the next occurrence" (`crates/logic/cron.rs:7-9`).
Everything about *when* — parsing the expression, walking to the next minute,
choosing retry vs next occurrence — is a pure function of expression +
timestamp (`crates/logic/cron.rs:8-11`). Resolution is one minute, zone UTC,
matching both Cloudflare cron triggers and the wake index minute buckets
(`crates/logic/cron.rs:12-17`), so "The schedule is therefore never more
precise than the alarm that carries it."

## Queues

"A queue is one reserved cell. The cell owns SQL and dispatch, while this
module owns the values and transitions that another caller must reproduce"
— stable address, public bounds, alarm deadline, concurrency admission, retry
timing, lease-generation advancement, settlement fencing, purge
classification (`crates/logic/queue.rs:3-8`). The lease generation travels in
`PlannedLease`, so "A caller cannot select a row and then forget to advance
its generation" (`crates/logic/queue.rs:9-11`).

## Sweeps

Sweeps reclaim space after "a read path has already hidden expired state",
and are **bounded per cell turn**: `BATCH_ROWS = 256` rows examined per turn,
and "a full batch asks the alarm to return promptly. KV and Queues use the
same bound and the same harness executor, so a new cell-backed feature cannot
quietly choose an unbounded cleanup loop" (`crates/logic/sweep.rs:4-10`).

## Cell scope validity is a security fence

A cell scope (`Class:instance` or a bare instance) is used both as a path
component (`db_path`) and as an object-store key
(`cells/<scope>/ltx/e<epoch>`), so its charset is a security fence:
`valid_cell_scope` allows only ASCII alphanumerics, `_ - . : $`, ≤ 255 bytes,
and rejects `.` and `..` exactly so a scope "can never be more than one path
component" and cannot traverse out of the data directory or bucket prefix
(`crates/logic/cell.rs:9-13`, `33-70`). Network callers apply this gate
before the scope reaches storage (`crates/logic/cell.rs:17-19`).

## WebSocket kinds and pinning

`WebSocketKind` distinguishes `Hibernatable`, `Regular`, and `Outbound`
sockets (`crates/logic/types.rs:391-400`). A regular or outbound socket "pins
its resident runtime, so its final events must still run locally after a
shutdown batch marks the cell as quiescing" (`Event::WebSocketRequestAt`
doc, `crates/logic/types.rs:471-481`); an outbound socket "is created by
application code at a rate the application chooses, so how much of the node
it may hold is budgeted" (`crates/logic/types.rs:396-400`).
