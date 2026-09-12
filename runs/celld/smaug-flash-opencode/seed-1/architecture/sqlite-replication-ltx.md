---
type: architecture
title: SQLite Replication and LTX (crates/ltx)
description: The embeddable streaming replication library celld uses — WAL capture into LTX segments, replica restore, compaction levels, the bundle overlay, and the object-store and file clients.
tags: [architecture, replication, sqlite, ltx, litestream, storage]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-7c84b1c1d301dbd888aff852
    resource: repo://crates/ltx/src/bundle.rs
  - id: openwiki-source-25715893776ae7c92ad47c4e
    resource: repo://crates/ltx/src/compactor.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-a839dd465500b913e92b6123
    resource: repo://crates/ltx/src/replica.rs
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# SQLite Replication and LTX (`crates/ltx`)

`celld-ltx` provides embeddable streaming replication for a SQLite database
(`crates/ltx/src/lib.rs:3-13`). It captures WAL data as LTX segments, reads and
writes replica storage, restores databases, compacts levels, and reads bundle
objects. The original replication behavior is a from-scratch Rust
reimplementation of Litestream v0.5.11, and the block format follows LTX
v0.5.2 (`crates/ltx/src/lib.rs:7-9`).

The crate is layered so a host can drive one managed database against one
replica. The public re-exports put `Db`, `Replica`, `ReplicaClient`,
`FileReplicaClient`, `ObjectStoreClient`, `restore`, and the `internal` module
at the crate root (`crates/ltx/src/lib.rs:43-109`).

## Core position and identity helpers

The replication position is `Pos` (`crates/ltx/src/lib.rs:240`), a `TXID` plus a
rolling post-apply checksum that together uniquely identify the state of the
database at a point in the log. `TXID` is a monotonic `u64` formatted as a
zero-padded 16-character lowercase hex string, matching the on-disk LTX filename
convention. `wal_checksum` (`crates/ltx/src/lib.rs:346`) computes the running
SQLite WAL checksum and panics if the input is not a multiple of 8 bytes.

Go's `path.Clean`/`path.Join` are ported byte-for-byte (`path_clean`,
`crates/ltx/src/lib.rs:401`), because the LTX path helpers build object-store
keys with Go's OS-independent `path` package — a root with a trailing slash such
as an S3 prefix `"backups/"` must yield the same key (`"backups/ltx"`), not a
doubled separator.

## Database lifecycle (`Db`)

`crates/ltx/src/db.rs` owns the SQLite database lifecycle: WAL-mode setup, the
long-running read-lock checkpoint takeover, the WAL→LTX capture loop, and manual
checkpointing. Because `rusqlite::Connection` is `!Sync` and a
`rusqlite::Transaction` borrows its connection, the capture API is kept
synchronous and owns the connection directly; the long-running read transaction
is held with raw `BEGIN`/`ROLLBACK` SQL plus a `read_lock_held` flag, and
`Replica` drives `sync()` and `checkpoint()` from a blocking context
(`spawn_blocking` or a dedicated DB thread). The idempotent-release behavior is
a trivial flag check (`crates/ltx/src/db.rs:8-18`).

The functional capture path runs `open`/`init` (WAL-mode DSN,
`wal_autocheckpoint(0)`, control tables, read page size, acquiring the read
lock, ensuring the WAL has ≥1 frame), then `sync` → `verify` → `sync_inner` →
`write_ltx_from_wal`/`write_ltx_from_db` which diffs the real WAL against the
last LTX position and writes the next L0 LTX file with atomic tmp→rename and a
position cache. `verify` is the snapshot-on-continuity-break branch lattice,
and `checkpoint_if_needed` applies a 3-tier policy with three anti-feedback
flags to avoid re-syncing or re-checkpointing what was just verified
(`crates/ltx/src/db.rs:20-47`).

`CheckpointMode` mirrors Go's stringly-typed modes and renders exactly
`PASSIVE`/`FULL`/`RESTART`/`TRUNCATE` into `PRAGMA wal_checkpoint(<mode>)`
(`crates/ltx/src/db.rs:66-83`).

## The replica sync loop and restore (`Replica`)

`Replica` connects a managed `Db` to a replication destination via a
`ReplicaClient` and drives two halves of replication (`crates/ltx/src/replica.rs:4-16`):
- **sync**: copies each new L0 LTX file the capture loop wrote locally up to the
  remote replica, advancing the replicated position one TXID at a time.
  `calc_pos` recovers the starting position from the newest file already on the
  replica.
- **restore**: downloads the LTX files in TXID order, merges them with the
  compactor, and reconstructs the SQLite database file the way the LTX decoder
  does — pages `1..=commit` written verbatim, lock page zero-filled — to a temp
  file that is fsync'd and atomically renamed into place.

The restore-plan calculation honors a target TXID and probes the snapshot level
first, so it stays a faithful port that works when compaction is added. The
current scope is L0-only and one-shot (`crates/ltx/src/replica.rs:18-36`); follow
mode, the background monitor, and v0.3.x restore are documented as deferred.

## Compaction

The compactor (`crates/ltx/src/compactor.rs`) is a streaming port of the LTX
`Compactor` that merges ordered LTX inputs into one byte-compatible LTX output.
It keeps one decompressed page per input rather than building a database-sized
page map, so inputs must be ordered by transaction range
(`crates/ltx/src/compactor.rs:1-36`). `compaction_level.rs` and
`replica_compactor.rs` model the level hierarchy and the replica-side compactor,
with `SNAPSHOT_LEVEL` being where full snapshots would land after compaction.

## The bundle overlay

The bundle (`crates/ltx/src/bundle.rs`) is a celld-original, self-contained
envelope: a container of verbatim L0 LTX files. The layout is the concatenated
raw L0 bytes, a binary footer of rows, the footer length as a little-endian u32,
and a four-byte magic `"CLB1"`. A row is `u16 cell_len | cell utf-8 | u64
cell_epoch | u64 txid | u64 offset | u64 len`, all little-endian; un-bundling is
pure arithmetic. Because the inner bytes are exactly what the per-cell writer
produces, byte-level compatibility stays checkable, and a drained bundle leaves
the bucket in pure-Litestream state with no trace (`crates/ltx/src/bundle.rs:4-12`).
Nothing else in the crate depends on bundles, so deleting this file returns the
crate to its upstream shape.

## ReplicaClient backends

`ReplicaClient` is the storage abstraction every replica backend implements
(`crates/ltx/src/lib.rs:72-88`), with its listing returning LTX `FileInfo`
metadata. The available backends are:

- `FileReplicaClient`, which stores LTX files on the local filesystem.
- `ObjectStoreClient` (behind the `s3` feature), using the `object_store` crate,
  with `ObjectStoreConfig` for S3/R2/MinIO buckets and a shared
  `Arc<dyn ObjectStore>`.

At rest the bucket is pure Litestream LTX, so the object-store client and the
file client obey the same regular L0 layout and the same compaction levels.

## The `internal` verification surface

The crate exposes an unstable `internal` module with no compatibility guarantee,
re-exporting `db`, `lz4_block`, `replica`, and (behind `s3`) `object_store`
internals for external verification tools (`crates/ltx/src/lib.rs:30-41`).

## Use by celld

celld consumes `celld-ltx` for both the per-cell replication backend and the
bundle sink. `crates/celld/ltx_repl.rs` builds its own object-store clients
rather than going through `bucket::Bucket` and carries the fleet's key prefix
itself, so two fleets sharing one bucket do not replicate over each other
(`crates/celld/ltx_repl.rs:11-15`). One shared `object_store` client serves the
whole node, and a managed `Db` per resident cell captures the cell's committed
WAL and uploads it on demand (`crates/celld/ltx_repl.rs:5-9`).
