---
type: "Reference"
title: "Durability, fencing, and the output gate"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---


# Durability, fencing, and the output gate

celld makes two promises: exactly one node serves a cell at a time (so two
machines never write the same database), and celld does not answer a write
until that write survives a failure (RPO=0). This page is how the source keeps
both promises. The full argument is also written up in `docs/guarantees.md`;
this page anchors each step to the code.

## What the bucket must provide

The ownership protocol relies on three object-store properties: a conditional
create (the write fails when the object exists), a conditional overwrite (the
write fails when the object changed after the read), and read-after-write
consistency. The storage adapter (`crates/celld/bucket.rs:1-25`) implements
two conditional-write dialects behind one surface: S3 and Azure Blob Storage
use the etag sent as `If-Match` / `If-None-Match`, and Google Cloud Storage
uses the object generation sent as `x-goog-if-generation-match`, because GCS
does not apply `If-Match` to a PUT. The CAS token is opaque to callers. The
error contract is load-bearing: `put_cas` answers `Ok(None)` only for a clean
412/409 rejection, and every other failure is ambiguous — the write may have
committed.

## The ownership record and the epoch prefix

Each cell has one ownership record at `cells/<cell>/own.json` naming the owner
node's session and a fencing epoch. A node acquires the cell with a conditional
write, so the object store accepts exactly one acquisition. The adapter is
`BucketOwnership` (`crates/celld/ownership_store.rs:211-420`); a takeover and a
local wake alike advance the epoch (`record_acquisition`, `crates/logic/lib.rs:1469-1478`),
so an epoch never has two writers.

The replicator copies the cell's SQLite data to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs. The epoch in the
key is the fence: a node that lost ownership can keep writing, but its writes
land in a superseded prefix, and a restore selects the current lineage. The
tiering path can first combine segments from many cells into a node bundle and
drain each segment into its per-cell prefix later.

## The acknowledgement rule: the output gate

Nothing that reveals a cell's state may leave the process while the cell has a
write it cannot prove durable — a client told about a write that a crash then
discards has been told something false (`crates/logic/output_gate.rs:3-10`).
`State::output` (`crates/logic/output_gate.rs:83-95`) is the one choke point
every egress channel passes through. The core stores the channel it is handed
but does not branch on it, so all channels share one rule.

- A **write** opens its own barrier (`open_write_barrier`) and emits
  `Effect::AwaitDurable` for its committed position. `durable_reached`
  (`crates/logic/output_gate.rs:173-196`) acknowledges only when the proven
  position **covers** the gated write's position; a shorter proof fails the
  write rather than acknowledging one the node cannot actually restore.
- A **read-only output** trails the newest barrier open on its cell
  (`trail_open_barrier`), because a reader can start after a write commits and
  before its proof lands. With nothing outstanding it releases at once, so an
  ordinary read pays no durability latency.
- With `CELLD_OUTPUT_GATE=0` the shell sends no `Event::Output`, bypassing the
  gate entirely — the operator's explicit trade of durability for latency.

### Bucket proofs check ownership, fleet proofs do not

A bucket proof reveals nothing until an ownership read confirms the record
still names this node at this epoch: "durable in `e<epoch>/`" is not durable
if the prefix was orphaned, so `durable_reached` emits `Effect::VerifyOwnership`
for a `ProofSource::Bucket` result and only `ownership_verified`
(`crates/logic/output_gate.rs:202-212`) settles the gate. A **fleet proof**
needs no read — the ensemble arbitrated it: a takeover seals a member before
restoring, so a stale owner's ack-all fails closed. A write whose proof fails
resets the cell (`StopCause::Reset`) so the node stops serving writes the
bucket does not hold (`crates/logic/output_gate.rs:281-285`).

The gate also gates alarms: `alarm_finished` opens a barrier owned by
`GateOwner::Alarm`, which settles by replay into the core (ordering the
consume-side wake-entry delete after the proof) rather than by release to the
shell — so a read-only output trails an alarm's unproven write exactly as it
trails a request's (`crates/logic/output_gate.rs:44-57`, `248-274`).

## Fleet mode: the node-log ensemble

`CELLD_DURABILITY` selects how a write is proven durable; the default is
`fleet`. A node picks its followers from the other nodes in the fleet, so it
never counts itself; one follower is enough, so a fleet needs two running nodes
before any node can complete a fleet proof. A node recruits up to two
followers, and the ensemble keeps acknowledging while one follower remains, so
a fleet does not fall back to the bucket each time it loses a follower. A node
without an ensemble stays correct — it acknowledges on a bucket proof instead.

The in-fleet replicated log tier (`crates/celld/node_log.rs:1-24`) streams
each per-cell L0 LTX segment the node has captured but not yet uploaded to the
follower ensemble over the signed peer transport. A write acknowledges when
every member holds its segment on disk — write-all, ack-all — or when the
ordinary bucket upload proves it first, whichever wins. The bucket upload path
is unchanged and remains the tiering mechanism, so node-log recovery
re-creates exactly the objects the dead leader would have uploaded.

### The folded log record

Since the lease-fold, the log record lives **in** the node lease record:
`nodes/<node>.json` carries a folded `log` object (state, epoch, ensemble,
tiered offset), and the core's lease writes carry it through unchanged
(`crates/celld/ownership_store.rs:57-67`, `442-455`; `crates/celld/node_log.rs:235-248`).
The record is created before the node's first fleet-durable acknowledgement and
never deleted, so a takeover that finds no record may treat the bucket as
complete (`crates/celld/node_log.rs:14-18`, `crates/logic/log_tier.rs:1-19`).
The follower store keeps each session's durable appends under
`<root>/peerlog/<node>/<generation>/` (`crates/celld/node_log.rs:676-702`).

### Recovery before takeover

A cold activation checks the prior owner's log records before it reads the
bucket (`Effect::RecoverNodeLog`, `crates/logic/types.rs:769-778`). An absent
record proves the session never acknowledged past the bucket, and a sealed
record proves recovery completed. An open or recovering record makes the
activation run recovery: it fences the record with a compare-and-swap, seals
the reachable followers, uploads their retained segments and bundles into the
per-cell prefixes, and then marks the record sealed. The activation cannot
restore until this sequence completes.

## Full-prefix restore

A restore selects the newest epoch prefix that contains LTX data and reads the
full contiguous chain from transaction zero. celld no longer writes an epoch
seal object, and a legacy `e<epoch>.seal.json` object does not limit the chain
(`docs/guarantees.md#full-prefix-restore`). This is deliberate: a fenced node
can append an unacknowledged tail to an older prefix, and a later restore can
expose that tail; the rule reads the full chain because a node-log recovery or
a bundle drain can add an acknowledged tail after an earlier restore, and a
restore that stopped at the earlier cut would hide acknowledged data.

## Node leases and self-fencing

Each node holds a lease in the bucket (`nodes/<node>.json`). The core starts
it once at process start (`start_node_lease`, `crates/logic/lib.rs:1798-1837`)
and renews it on a timer after one third of the lifetime (`CELLD_TTL_MS`,
default 10000 ms). The lease body also advertises the node's load for
placement (`NodeLoadWire`), the folded log state, and the peer protocol.

Authority is the lease's published validity evaluated **at ask time** on the
monotonic clock, not the `Held` variant: `node_authoritative`
(`crates/logic/lib.rs:714-737`) answers `false` the instant `now_ms` reaches
`expires_ms`, even before the fence timer fires — a suspended VM's timer fires
late, but a request evaluated after resume still refuses.

A renewal that lands at or after the prior lease's expiry is a **fence**, not
a hiccup: every peer was already entitled to read that record as dead and
seize the node's cells, and resurrecting the lease would be exactly how two
nodes end up serving one cell (`complete_node_lease_write`,
`crates/logic/lib.rs:1857-1911`). The `NodeLeaseFence` timer uses `>=`, not
`>`, matching the predicate so they cannot disagree (`crates/logic/lib.rs:2398-2408`).

`fence_node` (`crates/logic/lib.rs:2810-2817`) sets `NodeAuthority::Fenced`,
runs the fence, and emits `Effect::Halt` with code 3. The fence
(`crates/logic/lib.rs:5076-5135`) stops each active cell, fails every request
the node has not completed with `NodeFenced`, and drains every output gate to a
failed response — the fence and the fail are atomic, so a write is never
acknowledged after the node loses authority. The fence writes nothing to the
bucket; each peer already reads the lease as dead or replaced and can acquire
the cells through the ownership records. The fenced state is terminal: only a
restart returns the node to the fleet, and the process's own exit code 3
(`main.rs`) matches the `SELF-FENCE:` log line.

### Bucket proofs and the partition case

A partitioned node can commit locally and replicate into its superseded
prefix, but the ownership read the bucket proof performs then shows the new
owner, so celld does not acknowledge the write. The check reads the record
instead of comparing a clock, so a paused process or a skewed clock cannot
pass it (`docs/guarantees.md#the-acknowledgement-rule`).

## The storage probe

Because no store publishes the required properties, each node asks the store
directly. `probe_storage_before_serving` (`crates/celld/fleet.rs:281-305`) runs
the conditional-write test once at startup (two of four writes must fail), and
a node that finds a broken store stops; `CELLD_STORAGE_PROBE=0` disables it,
and `celld diagnose --read-only` runs the other checks with a credential that
cannot write. The probe writes and deletes a small object under `probe/`.
celld reserves `probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`,
`deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/` in the bucket, and an
application must not write under them.

## Related pages

- [Cell lifecycle and ownership](cell-lifecycle.md) — how ownership and epochs interact with activation, admission, and eviction.
- [SQLite replication and the LTX log tier](replication.md) — the LTX capture, compaction, and restore that produce the durability proofs.
- [The fleet bucket and object storage](../operations/fleet-bucket.md) — dialects, key prefixes, and provider qualification.
- [Testing and verification strategy](../testing/verification.md) — the TLA+ models and simulation that check these invariants.
