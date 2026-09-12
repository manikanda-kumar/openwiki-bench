---
type: concept
title: LTX replication and the in-fleet node log
description: How each committed SQLite write becomes an LTX capture and replica object, L0-L9 compaction and bundles, and the fleet node-log tier (write-all/ack-all ensemble).
tags: [replication, ltx, node-log, compaction, bundles]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-25715893776ae7c92ad47c4e
    resource: repo://crates/ltx/src/compactor.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---

# LTX replication and the in-fleet node log

celld turns each committed SQLite write into LTX data and replicates it to the
object store. This page explains the LTX capture surface, the per-epoch prefix
layout, compaction, tiering, bundles, and the in-fleet node-log tier.

## The LTX capture surface

`celld-ltx` (`crates/ltx`) is an embeddable streaming replication engine: it
captures WAL data as LTX segments, reads and writes replica storage, restores
databases, compacts levels, and reads bundle objects (`crates/ltx/src/lib.rs:3-5`).

The database lifecycle (`crates/ltx/src/db.rs`) is a port of litestream's
`db.go`:

- WAL-mode setup with a long-running read-lock checkpoint takeover and a
  WAL→LTX capture loop (`crates/ltx/src/db.rs:1-5`).
- The capture API is deliberately **synchronous**: `rusqlite::Connection` is
  `!Sync`, so the module owns the connection directly, holds the long-running
  read transaction with raw `BEGIN`/`ROLLBACK` SQL, and lets `Replica` drive
  `sync()` and `checkpoint()` from a blocking context (`crates/ltx/src/db.rs:8-18`).
- `sync` diffs the real WAL against the last LTX position and writes the next
  L0 LTX file with atomic tmp→rename and a position cache; `verify` handles the
  snapshot-on-continuity-break branch lattice (`crates/ltx/src/db.rs:25-29`).

`crates/celld/ltx_repl.rs` is the in-process replication backend built on
`celld-ltx`: one shared `object_store` client for the whole node, a managed
`celld_ltx::Db` per resident cell that captures the cell's committed WAL and
uploads it on demand (`crates/celld/ltx_repl.rs:3-9`).

## The per-epoch object layout

The object layout is `cells/<cell>/ltx/e<epoch>/` in the bucket, mirroring the
local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree. The backend carries the
fleet's key prefix itself, so two fleets sharing one bucket do not replicate
over each other (`crates/celld/ltx_repl.rs:10-15`). The epoch in the key is the
fence that keeps a stale owner's writes in a superseded lineage.

## Compaction and levels

The compactor (`crates/ltx/src/compactor.rs`) merges ordered LTX inputs into one
byte-compatible LTX output, keeping one decompressed page per input rather than
a database-sized page map (`crates/ltx/src/compactor.rs:1-4`). Level compaction
(`replica_compactor.rs`) and the additive L1 object path keep a takeover from
reading thousands of objects: `CELLD_LTX_COMPACTION` (default `1`) enables
additive L1 objects, and `CELLD_LTX_COMPACTION_MIN_TXIDS` (default 256) queues
a background L1 attempt after a durable TXID distance
(`docs/README.md:696-697`).

## Bundles

A bundle combines segments — including from many cells into a node bundle. The
tiering path can first combine segments from many cells into a node bundle and
drain each segment into its per-cell prefix later (`docs/guarantees.md:127-128`).
`crates/ltx/src/bundle.rs` provides bundle object reading.

## The in-fleet node log (fleet durability)

`crates/celld/node_log.rs` is v0 of the replicated log tier under
`CELLD_DURABILITY=fleet` (the default). Each node streams the per-cell L0 LTX
segments it has captured but not yet uploaded to a small follower ensemble over
the signed peer transport. A write acknowledges when every member holds its
segment on disk — write-all, ack-all — or when the ordinary bucket upload
finishes first, whichever wins (`crates/celld/node_log.rs:3-12`).

`log/<node>.json` is the CAS-guarded root of truth for the ensemble and the log
epoch. It is created before the node's first fleet-durable ack and never
deleted, so a takeover that finds no record may treat the bucket as complete
(`crates/celld/node_log.rs:14-18`). The decisions are `celld_logic::log_tier`.
A node recruits up to two followers, so a fleet of three or more nodes holds
three copies of an acknowledged write; the ensemble keeps acknowledging while
one follower remains (`docs/guarantees.md:159-162`). A node without an ensemble
acknowledges each write on a bucket proof instead
(`docs/guarantees.md:164-167`).

`crates/logic/log_tier.rs` is the pure decision core for this tier. Safety
rules (`crates/logic/log_tier.rs:13-23`):

- a follower's (ensemble, epoch) view changes only with the record, never on
  the leader's stream alone;
- a follower refuses appends at or below its persisted seal mark;
- reconfiguration force-tiers the open fragment through the new fragment base
  before the CAS;
- recovery seals before it certifies, and certifies from a sealed member only;
- the record is created before the first fleet-durable ack and never deleted,
  so record absence proves the bucket is complete.

The takeover recovery gate: a cold activation checks the prior owner's log
records before reading the bucket. An absent record proves the session never
acknowledged past the bucket; a sealed record proves recovery completed; an
open or recovering record makes the activation recover the session — fence the
record with a CAS, seal the reachable followers, upload their retained segments
into the per-cell prefixes, then mark the record sealed — before it can restore
(`docs/guarantees.md:169-183`).

## Restore

A restore selects the newest epoch prefix that contains LTX data and reads the
full contiguous chain from transaction zero; celld no longer writes an epoch
seal object, and a legacy `e<epoch>.seal.json` does not limit the chain
(`docs/guarantees.md:185-189`). A fenced node can append an unacknowledged tail
to an older prefix and a later restore can expose it; this does not violate the
contract because a failed or absent acknowledgement does not prove the write is
absent — the full chain is read because a recovery or bundle drain can add an
acknowledged tail after an earlier restore (`docs/guarantees.md:192-198`).

---

## Related pages

- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Change guides: representative maintenance tasks](/openwiki/operations/change-guides.md)
