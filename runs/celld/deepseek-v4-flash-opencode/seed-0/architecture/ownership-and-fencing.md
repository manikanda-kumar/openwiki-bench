---
type: architecture
title: Ownership, Leases, and Fencing
description: How exactly one node serves a cell — per-cell ownership records written with conditional bucket writes, the fencing epoch, node leases and fleet discovery, takeover, and self-fencing when a node loses its lease.
tags: [ownership, fencing, lease, epoch, takeover]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Ownership, Leases, and Fencing

celld's first promise is that exactly one node serves a cell at a time, so
two machines never write the same database. This page describes the
mechanism: per-cell ownership records guarded by conditional bucket
writes, the fencing epoch that keeps a stale owner's writes out of the
current lineage, the node leases that keep a dead machine's cells
reclaimable, and the self-fence that stops a node that can no longer
prove it owns what it serves.

## The ownership record

Each cell has one ownership record in the bucket at
`cells/<cell>/own.json` (crates/celld/ownership_store.rs#L289). The
record names the owner node's session and carries a fencing epoch; `None`
for the node is a deliberately released, fenced record, and epochs never
reset (crates/logic/types.rs#L138-L144).

A node acquires a cell with a conditional write — a create when no record
exists, a compare-and-swap on the previous record when one does — and the
bucket accepts one such write, so two nodes cannot acquire the same cell
(docs/guarantees.md#L108-L118). Every activation advances the epoch, a
takeover and a local wake alike, so each owner replicates under a fresh
epoch and an epoch never has two writers
(docs/guarantees.md#L116-L118).

An ambiguous compare-and-swap is re-read rather than retried blindly: the
write may have applied. Each claim may reconcile an ambiguous acquire at
most `MAX_ACQUIRE_RECONCILES = 3` times before the request fails, so a
store that persistently answers ambiguously does not spin forever
(crates/logic/lib.rs#L24-L48, crates/logic/lib.rs#L3674-L3696).

## What the bucket must provide

The protocol rests on three object-store properties: a conditional create
(the write fails when the object exists), a conditional overwrite (the
write fails when the object changed after the read), and read-after-write
consistency. Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage, and
Azure Blob Storage qualify; stores that lack working conditional writes
cannot fence a cell — two nodes can then both own one cell
(docs/guarantees.md#L16-L34).

## The epoch prefix

The replicator copies each cell's SQLite data to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs. The epoch in
the key is the fence: a node that lost ownership can keep writing, but
its writes land in a superseded prefix, and a restore selects the current
lineage (docs/guarantees.md#L120-L128).

## Node leases

Each node holds a lease in the bucket at `nodes/<node>.json`, carrying an
expiry and the node's advertised address, peer protocol version, and
per-process generation (crates/logic/types.rs#L146-L165). A node renews
the lease after one third of the lifetime (`CELLD_TTL_MS`, default
10000 ms) (docs/guarantees.md#L200-L204).

Authority is the lease's published validity evaluated **at ask time** on
the monotonic clock, not the `Held` variant: `node_authoritative` refuses
a request the instant the lease lapses, even before the
`Timer::NodeLeaseFence` backstop fires, because a suspended VM's timer
fires late but a request evaluated after resume still refuses
(crates/logic/lib.rs#L723-L742).

Lease renewal has a strict continuity rule. A renewal that lands at or
after the prior lease's expiry has not extended anything: every peer was
already entitled to read the record, find it dead, and seize the node's
cells, and one of them may have begun doing exactly that. "The gap is a
fence, not a hiccup" — the core fences the node rather than resurrecting
the lease, because that is precisely how two nodes end up serving one
cell (crates/logic/lib.rs#L1857-L1891). An initial acquisition that lands
already-expired never becomes authoritative; the node retries rather than
fencing a runtime that never owned anything
(crates/logic/lib.rs#L1892-L1901).

## Self-fencing

A node that cannot reach the bucket cannot renew its lease and cannot
replicate, so it must not own cells. When its published expiry passes it
fences itself: it stops each active cell and fails every request it has
not completed. A node whose lease record another writer replaced or
removed fences at once, because that record proves the authority moved
(docs/guarantees.md#L208-L212).

The fence (crates/logic/lib.rs#L5076-L5149):

- marks the node fenced and clears the activation and capacity queues;
- fails every output-gate barrier with `NodeFenced`, so a write waiting
  on a durability proof is refused rather than acknowledged — the fence
  and the fail are atomic;
- stops each cell's runtime (`Effect::StopRuntime` with
  `StopCause::Fence`) and refuses all of its requests.

The fence writes nothing to the bucket: each peer already reads the lease
as dead or replaced, so a peer can acquire the cells through the ownership
records, and a request is safe even before the fence runs because routing
compares the current time against the published expiry each time
(docs/guarantees.md#L214-L218). A fenced node logs a line that starts
with `SELF-FENCE:` and exits with code 3; the halt reason is
`NodeLeaseExpired` (docs/guarantees.md#L220-L223,
crates/logic/types.rs#L236-L244).

## Takeover

When a node stops, another node takes each cell over. The acquirer first
collects whatever the stopped node had not uploaded yet, through the
node-log recovery gate (an open or recovering prior session must be
fenced, its followers sealed, and its retained segments uploaded before
restore), and it restores from the newest safe source
(docs/guarantees.md#L61-L65, docs/guarantees.md#L169-L183). A release can
also be explicit: an eviction or a shutdown handoff publishes the cell as
unowned (`Effect::ReleaseOwner`, keeping its epoch) and asks a compatible
peer to acquire it (`Effect::AdoptReleased`), so a successor can take the
cell without waiting out the node lease
(crates/logic/types.rs#L806-L819).

## Fleet discovery

There is no join service and no fixed membership list. Nodes find each
other through the leases in the bucket: `celld diagnose` enumerates every
node lease, and ownership resolution reads the owner record and, when
needed, a peer's lease to learn its address and protocol version
(crates/celld/ownership_store.rs#L320-L350, docs/README.md#L415-L416).
The bucket supplies discovery and authority, not network reachability —
peer traffic carries a protocol version but no content signature, so the
trusted private network is the security boundary
(docs/README.md#L417-L425).
