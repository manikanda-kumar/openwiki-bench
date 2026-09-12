---
type: ownership-flow
title: Ownership, leases, and fencing
description: How celld earns exactly-one-owner per cell — conditional records, fencing epochs, node leases, self-fencing, takeover recovery, and dead-node reconciliation.
tags: [ownership, leasing, fencing, epochs, self-fence]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-9956f428da052d89a6fb042f
    resource: repo://crates/celld/dead_node_gc.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-3777add599c1e5db92332f60
    resource: repo://crates/logic/dead_node_reconciliation.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Ownership, leases, and fencing

celld's first promise: exactly one node serves a cell at a time. The
mechanism rests entirely on the bucket, and the design summary is short:

> The short version: the ownership records use conditional writes, so two
> nodes cannot acquire one cell. The replicated data carries its fencing
> epoch in the object key, so a node that lost ownership writes only into
> a superseded prefix. And before celld acknowledges a write, it proves
> the write durable and confirms that it still owns the cell.

(repo://docs/guarantees.md#L108-L113)

## What the bucket must provide

Three properties from the object store drive the protocol: conditional
create (fails when the object exists), conditional overwrite (fails when
the object changed after the read), and read-after-write consistency.
The qualified stores are S3, R2, Tigris, GCS, and Azure Blob Storage; a
store that ignores or fakes conditionals fails *late and silently*, so the
startup probe (and `celld diagnose`) verifies them empirically
(repo://docs/guarantees.md#L32-L52, L88-L102). `probe/` writes exactly one
small object per run that is never read.

## The ownership record and epochs

The record at `cells/<cell>/own.json` names the owner's session and a
fencing epoch:

> The short record names the owner node's session and carries a fencing
> epoch. A node acquires a cell with a conditional write — a create when
> no record exists, a compare-and-swap on the previous record when one
> does — and the bucket accepts one such write, so two nodes cannot
> acquire the same cell. Every activation advances the epoch, a takeover
> and a local wake alike. Each owner therefore replicates under a fresh
> epoch, and an epoch never has two writers.

(repo://docs/guarantees.md#L110-L120)

The serialized wire record is exactly two fields — `node` and `epoch` with
the etag riding separately as the CAS token
(repo://crates/celld/ownership_store.rs#L20-L24,
L287-L301) — and epochs never reset, which is why an evicted cell that
gets re-activated keeps its old epoch and why `log_tier` and takeover code
can reason about ordered epochs.

The acquire path has three decision states encoded in the decision core
(`RestoreSpec`): activation distinguished a *fused* epoch conditionally
created by this activation (epoch one, no replica precedes it), a *local
resume* (the same local epoch remains authoritative and the adapter must
not consult remote replicas), and the *prior owner* of a takeover — three
facts that `Effect::Restore` faithfully executes but never re-derives
(repo://crates/logic/lib.rs#L33-L52).

## Node leases

Each node holds a lease in the bucket at `nodes/<node>.json`, renewed on a
timer. The rules:

- The lease carries `expires_ms` (the *published* expiry) and is renewed
  after one third of `CELLD_TTL_MS` (default 10000 ms) so one failed
  renewal attempt has time to retry before the expiry actually lapses
  (repo://docs/guarantees.md#L184-L187).
- A renewal that does not reach the bucket does *not* immediately fence the
  node; it retries while its published expiry has not passed.
- When the published expiry passes, or the lease record another writer
  replaced or removed proves authority moved, the node self-fences
  (repo://docs/guarantees.md#L188-L196).
- Routing decisions compare current time against the published expiry on
  *every* request, so a request is safe even before the fence runs — a
  paused node is not routed to
  (repo://docs/guarantees.md#L196-L199).

The fence is write-free: peers already see the lease as dead or replaced
and acquire cells through the ordinary ownership-record path, so the dead
node publishes nothing
(repo://docs/guarantees.md#L201-L205).

## Self-fencing

> A fenced node logs a line that starts with `SELF-FENCE:` and stops with
> the exit code 3. celld reports other internal failures with the same
> prefix and code, so the line names the cause. The fenced state is
> terminal: only a restart returns the node to the fleet, through the same
> cold-activation path that a peer failure uses.

(repo://docs/guarantees.md#L201-L210)

That requires the operator's contract: a supervisor (systemd, Docker with a
restart policy, Kubernetes) that restarts the process without an attempt
limit and waits at least one lease lifetime between attempts, so a
repeated fence cycle stays observable rather than thrashing
(repo://docs/guarantees.md#L63-L69). The supervisor is part of the
correctness contract, not an operational nicety.

## Takeovers

When a node would serve a cell whose record names another (dead) node,
the activation grinds through the *takeover interlock*:

1. Read the ownership record and the prior owner's node-log state.
2. If the prior owner's log state is not sealed, run recovery: CAS the
   record into recovering, gather retained segments and bundles from every
   reachable sealed follower, upload them into the per-cell prefix, then
   mark the record sealed (repo://crates/logic/types.rs#L769-L776,
   repo://docs/guarantees.md#L158-L175).
3. Only now can the restore begin, under the new epoch — so the dead
   owner's unacked tail cannot be exposed pre-flight from a stale bucket
   read.

Takeover distinguishes *fencing* (the old node keeps running but must not
write) from node failure: a record taken away from a healthy node causes
that node to self-fence on its next renewal attempt, while restore of the
cell can proceed independently on the claimer.

## Dead-node reconciliation

When a node that has been dead for longer than its lease is absent from
the fleet, its cells' records are the danger: a record pointing at an
eternally-dead node stalls the ordinary flow. The reconciliation decision
core (`crates/logic/dead_node_reconciliation.rs`) and its executor
(`crates/celld/dead_node_gc.rs`) implement the machinery:

- The per-node record carries the folded node-log state; retirement must
  respect it and tombstones carry it unchanged, because the record and the
  log tier are one durable state in one body
  (repo://crates/celld/dead_node_gc.rs#L27-L36).
- Retry ticking is exponential (deterministic core policy
  `retry_delay_ms(tick, failure_count)`),
  repo://crates/logic/dead_node_reconciliation.rs#L15-L26.

## Writing while not owner

A stale writer cannot damage the current cell: it writes into a superseded
epoch prefix. The reader's full-chain restore may see those pages; this is
allowed because a missing acknowledgement never proves the write is
missing, so the restored state may include work a caller already retried
elsewhere — the invariant is *acknowledged writes are never lost*, not
"unacknowledged writes never surface" (repo://docs/guarantees.md#L213-L217).

## Eviction and rebalance

An idle eviction keeps the ownership record (the next activation on the
same node renames the local file instead of paying a remote restore), while
a *rebalance* eviction releases the record to the fleet and inserts the
freed cell as adoptable by a peer; both are `StopCause::Evict` with
`rebalance` deciding which (repo://crates/logic/types.rs#L930-L940).
`CELLD_MAX_RESIDENT_CELLS` and memory-pressure shedding invoke these
decisions from the core; the executor never sheds independently
(repo://crates/logic/pressure.rs#L203-L263).
