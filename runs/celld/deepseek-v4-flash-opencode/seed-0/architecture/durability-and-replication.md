---
type: architecture
title: Durability and Replication
description: How celld proves a write durable before acknowledging it (RPO=0) — the output gate, LTX WAL capture, epoch-prefixed bucket layout, bucket versus fleet durability, the node-log follower ensemble, takeover recovery, restore sources, and compaction.
tags: [durability, replication, ltx, output-gate, node-log, restore]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-9f6270d214b8ff6c345f5424
    resource: repo://crates/logic/log_evict.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-7c84b1c1d301dbd888aff852
    resource: repo://crates/ltx/src/bundle.rs
  - id: openwiki-source-0c5d4616a8d424ba569c0176
    resource: repo://crates/ltx/src/compaction_level.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Durability and Replication

celld makes two storage promises: exactly one node serves a cell at a
time, and no write that was acknowledged is ever lost (RPO=0). This page
describes the durability half: how a write is captured, how celld proves
it survives a failure before answering, how a fleet proves a write faster
than the bucket alone can, and how a takeover restores a cell from the
complete history.

## The acknowledgement rule

The mechanism that turns the promise into code is the **output gate**:
nothing that reveals a cell's state may leave the process while that cell
has a write it cannot prove durable. "A client told about a write that a
crash then discards has been told something false" (crates/logic/output_gate.rs#L3-L11).

The `Channel` enum enumerates every route that can reveal a cell's state.
The shell holds each egress effect and sends an `Event::Output` with its
route; the core applies one durability rule to every route and releases
the held effect only when the cell's commits are proven
(crates/logic/output_gate.rs#L13-L40). Setting `CELLD_OUTPUT_GATE=0`
removes the wait entirely — the shell sends no `Event::Output` — accepting
possible loss of an acknowledged write (docs/README.md#L690).

A write opens its own **barrier** and waits for a proof that covers its
committed position. A read-only output trails the newest barrier open on
its cell, because a reader can start after a write commits and before its
proof lands (crates/logic/output_gate.rs#L97-L165). A proof only
acknowledges the write when it proves a position that **covers** it —
a lagging or lying replicator fails the write rather than acknowledging
one the node cannot restore (crates/logic/output_gate.rs#L167-L196).

## LTX capture

Each committed SQLite write is captured as **LTX data**, the transaction
format the replication uses. The `celld-ltx` crate is a from-scratch Rust
reimplementation of Litestream v0.5.11, with the block format following
LTX v0.5.2 (crates/ltx/src/lib.rs#L3-L8). A managed `Db` per resident
cell runs the WAL→LTX capture loop: it diffs the real WAL against the
last LTX position and writes the next L0 LTX file, with atomic
tmp→rename and a position cache (crates/ltx/src/db.rs#L11-L32).

The object layout is `cells/<cell>/ltx/e<epoch>/` in the bucket,
mirroring the local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree
(crates/celld/ltx_repl.rs#L11-L15). The epoch in the key is the fence: a
node that lost ownership can keep writing, but its writes land in a
superseded prefix, and a restore selects the current lineage
(docs/guarantees.md#L120-L128).

## Bucket versus fleet durability

How celld proves a write durable before it answers is selected by
`CELLD_DURABILITY`, which defaults to `fleet`
(crates/celld/main.rs#L3721-L3726):

- **Bucket proof.** A single node has nobody to send the write to, so
  every write waits for a bucket upload. Because a bucket proof reveals
  nothing until an ownership read confirms the record still names this
  node at this epoch, the core emits `Effect::VerifyOwnership` after a
  bucket proof and acknowledges only if that read succeeds — a partitioned
  node that replicated into its superseded prefix fails the write
  (crates/logic/output_gate.rs#L184-L196, docs/guarantees.md#L133-L149).
- **Fleet proof.** With two or more nodes, the owner sends each write to
  one or two other nodes, which hold a copy of its recent writes. The
  write acknowledges as soon as those followers hold it on disk, or when
  the bucket upload proves it first, whichever wins. A fleet proof needs
  no ownership read: the ensemble seal is its fence, because a takeover
  seals a member before restoring (crates/logic/output_gate.rs#L184-L196).

A fleet of three or more nodes holds three copies of an acknowledged
write; the ensemble keeps acknowledging while one follower remains, so a
fleet does not fall back to the bucket each time it loses a follower
(docs/guarantees.md#L151-L167).

## The node-log ensemble

`CELLD_DURABILITY=fleet` is implemented as an in-fleet replicated log
tier. Each node streams the per-cell L0 LTX segments it has captured but
not yet uploaded to a small follower ensemble over the signed peer
transport. A write acknowledges when every member holds its segment on
disk — write-all, ack-all — or when the ordinary bucket upload proves it
first (crates/celld/node_log.rs#L3-L12).

`log/<node>.json` is the CAS-guarded root of truth for the ensemble and
the log epoch. It is created before the node's first fleet-durable
acknowledgement and never deleted, so a takeover that finds no record may
treat the bucket as complete (crates/celld/node_log.rs#L14-L16,
crates/logic/log_tier.rs#L16-L18). A follower failure degrades the node to
bucket-proof acks until a periodic re-recruit conditionally swaps a fresh
ensemble (crates/celld/node_log.rs#L17-L19).

Write-all pays one classic price: one slow follower stalls every ack. The
leader therefore evicts a follower on sustained suspicion — a windowed
append-latency tail over an absolute budget or a sibling-factor median, or
a single append outstanding past a hard backstop — and an empty-join
reconfiguration makes a false positive cost only one flush plus one
conditional write (crates/logic/log_evict.rs#L1-L13).

## The takeover recovery gate

A cold activation checks the prior owner's log records before it reads
the bucket. An absent record proves the session never acknowledged past
the bucket; a sealed record proves recovery completed. An open or
recovering record makes the activation run **recovery**: it fences the
record with a compare-and-swap, seals the reachable followers, uploads
their retained segments and bundles into the per-cell prefixes, and then
marks the record sealed. The activation cannot restore until this sequence
completes (docs/guarantees.md#L169-L183). In the decision core this is the
`RecoveringOwnerLog` phase and the `Effect::RecoverNodeLog`
(crates/logic/types.rs#L769-L778, crates/logic/lib.rs#L113-L166).

## Restore

A restore selects the newest epoch prefix that contains LTX data and reads
the full contiguous chain from transaction zero. celld no longer writes an
epoch seal object, and a legacy `e<epoch>.seal.json` object does not limit
the chain — the rule reads the full chain because a node-log recovery or a
bundle drain can add an acknowledged tail after an earlier restore
(docs/guarantees.md#L185-L198).

Restore-source selection is a durability decision reified sans-IO: the
activation restores from the newest *safe* source, a local eviction
snapshot or the replicated bucket. A local snapshot from the **previous**
epoch is reusable only when the node did **not** take the cell over from
another node, because a takeover means someone else may have written the
cell while the node slept (crates/logic/restore.rs#L21-L29). Availability
of each source is I/O; the choice among them is the pure predicate
(crates/logic/restore.rs#L3-L10).

## Compaction and tiering

Left unmanaged, a write-hot cell's L0 history grows to thousands of
objects. Background compaction combines additive L1 objects (a takeover
then reads tens of objects instead of thousands, gated by
`CELLD_LTX_COMPACTION` and paced by `CELLD_LTX_COMPACTION_MIN_TXIDS` and
`CELLD_LTX_COMPACTIONS`). The final handoff of a closed database publishes
one full snapshot — an L9 object — so the successor does not replay the
complete transaction history (docs/README.md#L448-L451,
docs/README.md#L696-L698).

Compaction levels follow the canonical Litestream levels, with level 0 as
the capture level and **level 9 as the snapshot level** that contains
complete database snapshots (crates/ltx/src/compaction_level.rs#L6-L8).
The tiering path can first combine segments from many cells into a node
**bundle** and drain each segment into its per-cell prefix later; at
rest, the bucket is pure Litestream, because a drained bundle leaves no
trace (crates/ltx/src/bundle.rs#L1-L12).
