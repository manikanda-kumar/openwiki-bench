---
type: architecture
title: SQLite replication and the LTX log tier
description: How each cell's SQLite WAL is captured as LTX data, uploaded to the fleet bucket under epoch prefixes, replicated to a follower ensemble, compacted into additive L1 objects and L9 snapshots, and restored on takeover.
tags: [replication, ltx, sqlite, wal, compaction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-93e5bac71854233e4df4d7a1
    resource: repo://crates/celld/replication.rs
  - id: openwiki-source-7c84b1c1d301dbd888aff852
    resource: repo://crates/ltx/src/bundle.rs
  - id: openwiki-source-0c5d4616a8d424ba569c0176
    resource: repo://crates/ltx/src/compaction_level.rs
  - id: openwiki-source-25715893776ae7c92ad47c4e
    resource: repo://crates/ltx/src/compactor.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-8fab090a0d09f194f7324895
    resource: repo://crates/ltx/src/ltx.rs
  - id: openwiki-source-e1e967af531357151a74d547
    resource: repo://crates/ltx/src/replica_compactor.rs
  - id: openwiki-source-a839dd465500b913e92b6123
    resource: repo://crates/ltx/src/replica.rs
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# SQLite replication and the LTX log tier

Every cell is a SQLite database, and celld replicates each cell's committed
writes to the fleet bucket so a takeover can restore them. The replication
engine is `celld-ltx`, an in-process library vendored from Litestream and the
LTX format and evolved by celld (`crates/ltx/Cargo.toml:1-15`). The adapter
that drives it per cell is `LtxRepl` (`crates/celld/ltx_repl.rs`). Replication
inside the celld process means a node needs no external replicator.

## Object layout and the epoch fence

Each cell's database lives at `<watch>/<cell>/ltx/e<epoch>/db.sqlite` locally
and replicates to `cells/<cell>/ltx/e<epoch>/` in the bucket — epoch-in-prefix
is the data-path fence: a stale owner writes a dead prefix
(`crates/celld/replication.rs:1-7`). `LtxRepl` builds its own object-store
clients and carries the fleet key prefix itself, so two fleets sharing one
bucket do not replicate over each other (`crates/celld/ltx_repl.rs:1-15`).

`LtxRepl` keeps one shared `object_store` client for the whole node and one
managed `celld_ltx::Db` per resident cell. A cell is registered the instant it
activates, so the output gate can prove a fresh cell durable with no
cold-start window.

## The capture loop

`celld_ltx::Db` (`crates/ltx/src/db.rs:1-39`) owns the SQLite connection. It
opens the database in WAL mode with `wal_autocheckpoint(0)`, holds a
long-running read transaction as the checkpoint takeover, and runs the WAL→LTX
capture loop: diff the real WAL against the last LTX position and write the
next L0 LTX file, with atomic tmp→rename and a position cache. Checkpoints go
through `PRAGMA wal_checkpoint` modes (`Passive`, `Full`, `Restart`,
`Truncate`). Because `rusqlite::Connection` is `!Sync`, the capture API is
synchronous and the driver calls it from a blocking context
(`spawn_blocking`).

The WAL size is bounded: `CELLD_LTX_TRUNCATE_PAGES` (default 128, a 512 KiB
cap) truncates an ordinary cell's WAL file at the next checkpoint. A passive
checkpoint does not shrink the WAL file, so each capture reads the stale
region after a restart; the truncate keeps the read small. Queue cells use
passive checkpoints because a truncate boundary emits a full database image
(`crates/celld/ltx_repl.rs:711`, `980-985`).

## The LTX file format

`crates/ltx/src/ltx.rs:16-39` implements the LTX file format: every file
starts with the `LTX1` magic, format version 3, a 100-byte header, per-page
LZ4-block-compressed data, and CRC64-ISO checksums (both the file checksum and
the rolling snapshot checksum). The lock page (`PENDING_BYTE = 0x40000000`)
is derived from the SQLite page size and zero-filled on decode.

## Sync, restore, and the restore plan

`Replica` (`crates/ltx/src/replica.rs:1-25`) connects a managed `Db` to a
replication destination. It drives sync (copy each new L0 LTX file up to the
replica, advancing the replicated position one TXID at a time) and restore
(download the LTX files in TXID order, merge them with the compactor, and
reconstruct the SQLite database exactly as `DecodeDatabaseTo` does — pages
`1..=commit`, lock page zero-filled — to a temp file that is fsync'd and
atomically renamed into place). `calc_restore_plan` anchors on the snapshot
level and walks per-level cursors, so adding compaction "just works"; the
contiguous L0 chain `1..=N` is the restore path.

A restore keeps enough reads in flight to hide an object store's round-trip
latency (`RESTORE_DOWNLOAD_CONCURRENCY`, `crates/ltx/src/replica.rs:57-59`);
on the celld side, `RESTORE_DOWNLOAD_CONCURRENCY` bounds the aggregate across
every restore on the node (`crates/celld/ltx_repl.rs:62-66`), and
`SYNC_CONCURRENCY` caps concurrent per-cell uploads.

When a node activates a cell, `client_for` keys the client to the cell's epoch
prefix, and `highest_nonempty_epoch` selects the newest durable copy to
restore on takeover (`crates/celld/ltx_repl.rs:1183-1212`). A preserved local
eviction snapshot is reused only as the previous epoch's baseline — eviction
removes the LTX metadata, so reopening that image would start a new writer
generation at TXID 1 and pairing it with the same remote epoch would mix the
new lineage with the old tail; a clean process reload is the separate
`resume_local` path that retains both the live database and its LTX metadata
(`crates/celld/ltx_repl.rs:1261-1279`). `epoch_replicated` is the fail-closed
eviction gate: never delete the last local copy of state the bucket cannot
restore (`crates/celld/ltx_repl.rs:1214-1220`).

## Compaction into block objects

Compaction levels follow Litestream: `SNAPSHOT_LEVEL` is 9 (complete database
snapshots), and the default levels are L0, L1 (30 s), L2 (5 min), and L3
(1 h) (`crates/ltx/src/compaction_level.rs:6-54`). The `Compactor`
(`crates/ltx/src/compactor.rs:1-47`) merges ordered LTX inputs into one
byte-compatible LTX output, keeping one decompressed page per input rather
than building a database-sized page map. `ReplicaCompactor`
(`crates/ltx/src/replica_compactor.rs:1-31`) ports the storage-independent
part and is **additive**: it creates a destination object and never deletes a
source.

On the celld side, `CELLD_LTX_COMPACTION` is on by default: when a cell's
durable TXID distance reaches `CELLD_LTX_COMPACTION_MIN_TXIDS` (default 256),
a background attempt folds the L0 chain into an additive L1 object;
`CELLD_LTX_COMPACTIONS` (default 2) bounds the node-wide concurrency
(`crates/celld/ltx_repl.rs:2571-2588`). A takeover then reads tens of objects
instead of thousands. `CELLD_LTX_COMPACTION=0` must be set on every node of a
mixed fleet until all nodes can read the block objects, because an old reader
cannot take over a cell after its first L1 publication. A handoff snapshot is
an L9 object, so a successor does not replay the complete transaction history;
the proven L0 chain remains an additive fallback
(`EvictionRestoreArtifact`, `crates/celld/replication.rs:19-26`).

## Bundles

A bundle (`crates/ltx/src/bundle.rs:1-30`) is a celld-original envelope: a
container of verbatim L0 LTX files, never a format. Layout is the concatenated
raw L0 bytes plus a binary footer of rows (`cell`, `cell_epoch`, `txid`,
`offset`, `len`), the footer length, and a `CLB1` magic. The inner bytes are
exactly what the per-cell writer produces, so byte-level compatibility stays
checkable. At rest, the bucket is pure Litestream: a drained bundle leaves no
trace. The `BundleOverlayClient` lets compaction read bundle-resident frames
beside the per-cell objects, and its output stays pure per-cell L1s — the
continuous drain (`crates/celld/ltx_repl.rs:1461-1474`).

## The follower ensemble and node-log recovery

The durability page covers the fleet log tier; its replication unit is the
captured-but-not-yet-uploaded L0 segment (`ShipEntry`,
`crates/celld/ltx_repl.rs:77-84`). Each node streams these to a small follower
ensemble over the signed peer transport, and a write acknowledges when every
member holds it on disk. Followers keep each session's durable appends under
`<root>/peerlog/<node>/<generation>/` (`crates/celld/node_log.rs:676-702`).
Node-log recovery re-creates exactly the objects the dead leader would have
uploaded, so every per-cell restore and compaction mechanism stays unchanged.

## Waiting for durability

The actor waits on a cell's replication through `SyncWait`
(`crates/celld/replication.rs:28-37`): `Durable` when the latest local commit
is in the bucket, `Unsupported` when the replicator does not track the cell,
and `Failed` on error or timeout. The deadline for a durability proof and the
final snapshot retry window is `CELLD_LTX_DURABILITY_TIMEOUT_SECS` (default
10). A slow or busy object store can need a longer deadline for a large write
burst.

## Related pages

- [Durability, fencing, and the output gate](durability-protocol.md) — the proofs this replication produces and the epoch fence it rests on.
- [The fleet bucket and object storage](../operations/fleet-bucket.md) — the storage client, key prefixes, and provider dialects.
- [V8 runtime and Cloudflare Workers compatibility](workers-runtime.md) — how each cell's storage API maps onto its own SQLite database.
