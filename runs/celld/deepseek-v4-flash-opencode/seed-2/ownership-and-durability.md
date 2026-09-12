---
type: concept
title: "Cell ownership, fencing, and the RPO=0 durability protocol"
description: How celld enforces exactly one owner per cell with conditional bucket writes and fencing epochs, and how every write is acknowledged only after a durability proof covers it.
tags: [ownership, fencing, durability, rpo, output-gate, consensus]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Cell ownership, fencing, and the RPO=0 durability protocol

celld makes two promises about your data: exactly one node serves a cell at
a time, so two machines never write the same database, and celld does not
answer a write until that write survives a failure, so nothing you were told
succeeded is lost (docs/guarantees.md#L3-L7). Both rest on the object store.
This page is how the mechanism works, checked against the code.

## The ownership record

Each cell has one ownership record in the bucket at
`cells/<cell>/own.json`, carrying the owner node and the epoch
(crates/celld/ownership_store.rs#L288-L299). A node acquires a cell with a
conditional write — a create (`CasGuard::Absent`) when no record exists, a
compare-and-swap on the previous record's etag when one does — and the
bucket accepts one such write, so two nodes cannot acquire the same cell
(docs/guarantees.md#L108-L118; crates/celld/ownership_store.rs#L401-L420).

The `CasGuard` is either `Absent` or `Match(etag)`, and a conditional write
that loses the race is a clean rejection, not an error
(crates/logic/types.rs#L220-L224). The adapter keeps a separate
conditional-write client with retries off, because a retried CAS put can land
on the first attempt's own token change and report a clean 412, converting
"may have committed" into a false rejection (crates/celld/bucket.rs#L155-L159).
An ambiguous acquire is re-read rather than retried blindly — it may have
applied — but the number of reconciles per claim is bounded by
`MAX_ACQUIRE_RECONCILES` (3), so a persistently unanswered store fails the
request instead of spinning forever (crates/logic/lib.rs#L81-L96).

## Fencing epochs

Every activation advances the epoch — a takeover and a local wake alike.
Each owner therefore replicates under a fresh epoch, and an epoch never has
two writers (docs/guarantees.md#L114-L118). The epoch in the object key is
the fence: the replicator copies each cell's SQLite data to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs, so a node that
lost ownership can keep writing but its writes land in a superseded prefix,
and a restore selects the current lineage (docs/guarantees.md#L120-L128).

A `RestoreSpec` carries the facts the ownership resolution already decided,
so the effect adapter never rediscovers or guesses them: the epoch, whether
the activation conditionally created epoch one (`fresh`), whether ownership
was seized from another node or a released record (`took_over`), whether the
node-level lease handoff proved this exact local epoch remains authoritative
(`resume_local`), and the prior owner the takeover displaced (`prior`)
(crates/logic/types.rs#L49-L70).

## The output gate (RPO=0)

The output gate is "one choke point every egress passes through": nothing
that reveals a cell's state may leave the process while that cell has a
write it cannot prove durable. A client told about a write that a crash then
discards has been told something false, and no later message can retract a
side effect that has already left (crates/logic/output_gate.rs#L3-L11).

The `Channel` enum enumerates every route that can reveal a cell's state.
The shell holds each effect and sends an `Event::Output` with its route; the
core applies one durability rule to every route and returns the same route in
an `Effect::Release`. The core does not read the channel — it stores what the
shell gave it and hands the same value back — so the invariant stays one rule
rather than six (crates/logic/output_gate.rs#L12-L40).

A write opens its own barrier and waits for a proof that covers its position.
A read-only output joins the newest barrier open on its cell, because a
reader can start after a write commits and before its proof lands, so the
reader's own start and end positions decide nothing; a cell with nothing
outstanding releases it at once, so an ordinary read pays no durability
latency (crates/logic/output_gate.rs#L67-L95). An alarm is not a channel but
opens a barrier in the same per-cell map, so every reader observes its
unproven write (crates/logic/output_gate.rs#L42-L57).

`durable_reached` acknowledges a write only when the replica proved a
position that covers the gated write's position: a shorter proof from a
lagging or lying replicator fails the write rather than acknowledging a
write the node cannot restore (crates/logic/output_gate.rs#L167-L196). On a
failed proof the cell resets: it stops serving writes the bucket may not
hold, keeps no local snapshot, and lets the next activation restore from the
bucket (crates/logic/output_gate.rs#L281-L284; crates/logic/types.rs#L941-L946).
The two proof sources carry different fences (`ProofSource::Fleet` vs
`ProofSource::Bucket`): a fleet proof is already arbitrated, while a bucket
proof must verify ownership before anything is revealed
(crates/logic/types.rs#L371-L379).

## Fleet vs bucket proofs

With `CELLD_DURABILITY=fleet` (the default), the owner sends each write to
one or two other nodes, which hold a copy of its recent writes; those nodes
are its followers, and the set of them is the ensemble. Every follower must
fsync the write, and a takeover seals the prior node-log session before it
restores, so the stale owner cannot complete another fleet proof
(docs/guarantees.md#L144-L149).

A node picks its followers from the other nodes in the fleet, so it never
counts itself. One follower is enough, therefore a fleet needs two running
celld nodes before any node can complete a fleet proof; a fleet of one
requests the fleet posture and does not get it. A node recruits up to two
followers, so a fleet of three or more holds three copies of an acknowledged
write, and the ensemble keeps acknowledging while one follower remains, so a
fleet does not fall back to the bucket each time it loses a follower
(docs/guarantees.md#L151-L163).

A node without an ensemble stays correct: it acknowledges each write on a
bucket proof instead. After a bucket proof, celld reads the ownership record
once and acknowledges only if the record still names this node at this epoch;
a partitioned node can commit locally and replicate into its superseded
prefix, but the ownership read then shows the new owner, so celld does not
acknowledge the write (docs/guarantees.md#L133-L142). The cost of the
single-node path is latency: the write waits for the object store
(docs/guarantees.md#L165-L167). The bucket upload races every fleet proof and
either one proves the write, so a slow follower cannot make a write slower
than a bucket proof, and concurrent writes to one cell join one shared
upload (docs/testing.md#L169-L177).

## The takeover recovery gate

The default fleet mode can acknowledge a write once the node-log ensemble
stores it; the bucket upload can complete later. Each process session
therefore creates a conditional node-log record before its first
fleet-durable acknowledgement (docs/guarantees.md#L171-L175).

A cold activation checks the prior owner's log records before it reads the
bucket. An absent record proves the session never acknowledged past the
bucket, and a sealed record proves recovery completed. An open or recovering
record makes the activation run recovery: it fences the record with a
compare-and-swap, seals the reachable followers, uploads their retained
segments and bundles into the per-cell prefixes, and marks the record sealed.
The activation cannot restore until this sequence completes
(docs/guarantees.md#L177-L183). In the core this is the
`Phase::RecoveringOwnerLog` phase and the `RecoverNodeLog` effect
(crates/logic/lib.rs#L124-L130; crates/logic/types.rs#L769-L776).

## Full-prefix restore

A restore selects the newest epoch prefix that contains LTX data and reads
the full contiguous chain from transaction zero. celld no longer writes an
epoch seal object, and a legacy `e<epoch>.seal.json` object does not limit
the chain (docs/guarantees.md#L185-L190). A fenced node can append an
unacknowledged tail to an older prefix, and a later restore can expose that
tail; this does not violate the contract, because a failed or absent
acknowledgement does not prove the write is absent. The rule reads the full
chain because a node-log recovery or a bundle drain can add an acknowledged
tail after an earlier restore, and a restore that stopped at the earlier cut
would hide that tail and lose acknowledged data
(docs/guarantees.md#L192-L198).

## Self-fencing

The durability promise depends on a node not owning cells it cannot
replicate. Each node holds a lease in the bucket, renews it after one third
of the lifetime, and fences itself when its published expiry passes or when
another writer replaces or removes the lease record; a fenced node logs
`SELF-FENCE:` and exits with code 3 (docs/guarantees.md#L201-L224). See the
[node lifecycle](node-lifecycle.md) page for the full lease protocol.

## The storage qualification test

No store publishes the conditional-write properties, so `celld diagnose`
sends four conditional writes (create, reject-create, update, reject-stale)
and requires two of them to fail; a store that accepts either one cannot
fence a cell, so celld names the store as the fault. Each node repeats the
test once at startup and stops if the store is broken
(docs/guarantees.md#L59-L75). See the [object storage](object-storage.md)
page for the dialects and the qualified providers.

## Related mechanism: the input gate

The input gate (`crates/logic/gate.rs`) is a separate, per-cell mechanism
that implements the `blockConcurrencyWhile` contract: while the gate is
held, no incoming event of any kind is delivered to that cell except the
event holding it. In celld every storage path is local SQLite underneath, so
a read or write completes inside the turn that started it and never yields
to another event; the gate's user is `blockConcurrencyWhile`, which holds
across arbitrary user code including real awaits
(crates/logic/gate.rs#L3-L28). Acquiring the gate happens during an event
and is synchronous with the JS call that asks for it; a nested block is
counted rather than refused, and a holder that dies is abandoned so a
cancelled request cannot shut the cell's gate forever
(crates/logic/gate.rs#L39-L53, crates/logic/gate.rs#L134-L144).

## Tests

The epoch fence is measured under contention: five hundred claimants tried
at the same time to own the same cells — 5,500 attempts, one writer for each
epoch, zero violations (docs/testing.md#L162-L165). The kill tests exercise
the durability promise directly: SIGKILL in the middle of a write stream with
the local database deleted, so recovery can only come from the bucket, and
every acknowledged write comes back (docs/testing.md#L135-L138). The
coordination protocol is also specified in TLA+ and checked at small size,
where a violation needs no clock skew and no storage anomaly to occur
(docs/testing.md#L35-L52).
