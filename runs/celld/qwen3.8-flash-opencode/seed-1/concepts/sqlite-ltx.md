---
type: concept
title: SQLite State and LTX Replication
description: Each cell's private SQLite database behind the Durable Objects storage API, captured as LTX segments by the celld-ltx crate — WAL capture, L0 upload under epoch-fenced prefixes, L1 compaction and L9 snapshots, bundle objects, and the restore path that rebuilds a database from the bucket chain.
tags: [sqlite, ltx, replication, storage, compaction, restore, litestream]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-93e5bac71854233e4df4d7a1
    resource: repo://crates/celld/replication.rs
  - id: openwiki-source-407f6154ded2a2342941e356
    resource: repo://crates/celld/storage.rs
  - id: openwiki-source-0cf02de4c4ddf27a70ec8634
    resource: repo://crates/logic/sqlite.rs
  - id: openwiki-source-10a3ca6704a0d403c63dff35
    resource: repo://crates/ltx/README.md
  - id: openwiki-source-2e61390dbf1d699be0f0a0b7
    resource: repo://crates/ltx/reference/ltx-format.md
  - id: openwiki-source-7c84b1c1d301dbd888aff852
    resource: repo://crates/ltx/src/bundle.rs
  - id: openwiki-source-d623ebf5ac6a6289a978bd78
    resource: repo://crates/ltx/src/client/object_store.rs
  - id: openwiki-source-0c5d4616a8d424ba569c0176
    resource: repo://crates/ltx/src/compaction_level.rs
  - id: openwiki-source-25715893776ae7c92ad47c4e
    resource: repo://crates/ltx/src/compactor.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-a839dd465500b913e92b6123
    resource: repo://crates/ltx/src/replica.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# SQLite State and LTX Replication

A cell's memory is its SQLite database: "Each object is a cell: a named server with its own SQLite database" (README.md#L5-L8). This page covers the storage stack — what a cell's database looks like locally, how it is captured and uploaded as LTX data, and how another node rebuilds it. The durability protocol that *schedules* these reads and writes is [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md).

## The cell database

Each cell is its **own** SQLite file (its own replicated, epoch-fenced bucket prefix), and the isolate that hosts cells keeps a `scope -> Connection` map: open on activate, close on evict (crates/celld/storage.rs#L6-L14). DO `ctx.storage` is async in JS but synchronous underneath — synchronous Rust ops exposed to V8 and wrapped in `async` by the JS harness, "same contract, no thread-hopping" (crates/celld/storage.rs#L7-L9). The storage state belongs to the isolate, not the thread, because a cell event is a tokio task whose turns run on whatever worker holds the isolate; nothing is synchronized because a turn holds the isolate lock (crates/celld/storage.rs#L19-L29).

The tables follow Cloudflare's own names — `_cf_KV` for key-value, `_cf_ALARM` for alarms, `_cf_METADATA` — carried over deliberately: "a tooling library that drops everything except `_cf_*` will happily delete" them, so celld adopted the names rather than inventing ones (crates/celld/storage.rs#L291-L330). SQL (`ctx.storage.sql`, D1) runs on the same database; sqlite-vec adds the `vec0` virtual table behind the `sqlite_vec` compatibility flag and `FEATURE_SQLITE_VEC_V1` deploy marker (examples/README.md `vectordb`, crates/celld/deploy.rs).

## celld-ltx: capture and the LTX file

`celld-ltx` "provides embeddable streaming replication for a SQLite database. It captures WAL data as LTX segments, reads and writes replica storage, restores databases, compacts levels, and reads bundle objects" (crates/ltx/src/lib.rs#L3-L9). It is a from-scratch Rust port: replication behavior from Litestream v0.5.11, block format from LTX v0.5.2, with the pierrec/lz4 block compressor ported byte-exactly (crates/ltx/README.md#L16-L31).

The wire unit is an LTX v3 file: `"LTX1"` magic, a 100-byte big-endian header carrying page size, commit size, `MinTXID`/`MaxTXID`, timestamp, pre-apply checksum, and WAL salt/offset fields, then per-page records (page number, LZ4-compressed data), a page index, and a 16-byte trailer (crates/ltx/reference/ltx-format.md#L1-L45). The capture loop lives in `db.rs`: WAL-mode setup with `wal_autocheckpoint(0)`, a held read transaction (raw `BEGIN` + `SELECT COUNT(1)`) that takes over checkpointing from SQLite — the highest-risk interaction being "a long-running read transaction with a manual `PRAGMA wal_checkpoint`" — and `sync → verify → sync_inner → write_ltx_from_wal` producing one segment per committed transaction (crates/ltx/src/db.rs#L3-L25). WAL frames are parsed and cumulative-checksummed independently in `wal.rs` (crates/ltx/src/wal.rs#L3-L12). The API stays synchronous because `rusqlite::Connection` is `!Sync` and its transactions borrow it; the caller runs it on a blocking context (crates/ltx/src/db.rs#L11-L18).

## Levels: L0 chain, L1 compaction, L9 snapshots

The compaction levels are Litestream-compatible: level 9 is the snapshot level (`SNAPSHOT_LEVEL: i32 = 9`) and the default list is the four canonical Litestream v0.5.16 levels, each non-zero level compacting from its predecessor on an interval (crates/ltx/src/compaction_level.rs#L6-L40). Merging is streaming: "The compactor keeps one decompressed page per input. It does not build a database-sized page map" and inputs must be ordered by transaction range (crates/ltx/src/compactor.rs#L3-L5).

In celld the arrangement is purpose-specific (crates/celld/ltx_repl.rs#L3-L16):

- **L0** — every captured transaction uploads to `cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs (docs/guarantees.md#L120-L129). The local tree mirrors it at `<watch>/<cell>/ltx/e<epoch>/db.sqlite` (crates/celld/replication.rs#L4-L7). Because passive checkpoints never shrink the WAL file and each capture rereads the stale region after a restart, celld truncates an ordinary cell's WAL at the next checkpoint at `CELLD_LTX_TRUNCATE_PAGES` pages (default 128 = 512 KiB); queue cells are exempt because their truncate boundary would emit a full-database image (docs/README.md#L695).
- **L1** — background additive compaction (`CELLD_LTX_COMPACTION`, default on): "celld creates additive L1 objects, and a takeover reads tens of objects instead of thousands" (docs/README.md#L696-L698). A remote L0 chain always remains the byte-compatible fallback, and mixed-version fleets must disable L1 until every reader understands v0.5.2 block objects (docs/README.md#L696-L697, #L447-L449).
- **L9** — a full snapshot. A shutting-down node "tries to publish one full snapshot of each closed database. The snapshot is an L9 object, so the successor does not replay the complete transaction history" (docs/README.md#L447-L449); if the snapshot retry window expires, the handoff still releases with the proven L0 chain (`EvictionRestoreArtifact::{Snapshot, L0Chain}`) (crates/celld/replication.rs#L19-L28).

## Bundles: node-level batching, per-cell truth

The tiering path can first concatenate verbatim L0 bytes from many cells into one *bundle* object per node flush — a celld-original envelope (raw concatenated LTX bytes + a little-endian footer index of cell/epoch/txid/offset/len rows), explicitly "a container of verbatim L0 LTX files, never a format… At rest, the bucket is pure Litestream. A drained bundle leaves no trace that this module ever existed" (crates/ltx/src/bundle.rs#L3-L12). Restores read per-cell prefixes only, so recovery drains each bundle row into `cells/<cell>/ltx/e<epoch>/` before anyone may restore from it (crates/celld/ltx_repl.rs#L181-L196). This is what lets the node-log tier hold one stream per node without fragmenting the per-cell object space.

## Object layout and the storage client

The `ReplicaClient` trait is the storage abstraction (ported from litestream's `replica_client.go`), with `file` and `object_store` backends (crates/ltx/src/client/mod.rs#L3-L9). The object-store backend keeps the upstream invariants: key scheme `{path}/{level:04x}/{min}-{max}.ltx`, a 5 MiB single-PUT-vs-multipart threshold, list + seek-skip on `min_txid < seek` in ascending TXID order, `NoSuchKey` → not-exist mapping, and batch deletes of up to 1000 keys (crates/ltx/src/client/object_store.rs#L3-L20). `LtxRepl` deliberately builds its own `object_store` clients carrying the fleet key prefix, rather than going through the node's `bucket::Bucket` (crates/celld/ltx_repl.rs#L12-L16).

## Restore

`Replica::restore` downloads LTX files in TXID order, merges them with the compactor, and reconstructs the database "the way `Decoder.DecodeDatabaseTo` does — pages `1..=commit`, lock page zero-filled, written verbatim — to a temp file that is fsync'd and atomically renamed into place" (crates/ltx/src/replica.rs#L7-L15). celld adds the protocol-level choice of *which* chain to read: the newest nonempty epoch prefix, the full contiguous chain from transaction 0, restored only when the logic core's `RestoreSpec` says the source is safe (crates/celld/ltx_repl.rs#L1309-L1340, crates/logic/restore.rs#L3-L12). Local eviction snapshots can win the race instead, renamed into place without touching the bucket at all (crates/logic/cache.rs#L3-L9). A restore's first read pays downloads up to a node-wide concurrency bound (`MAX downloads across every restore on this node`) so one hot cell cannot monopolize the store (crates/celld/ltx_repl.rs#L62-L69).

## Failure behavior

- A WAL that SQLite destroyed mid-transaction fails the actor closed: `logic/sqlite` classifies engine-level result codes (NOMEM, INTERRUPT, IOERR, FULL) and production asserts they match `rusqlite::ffi` in debug builds (crates/logic/sqlite.rs#L3-L9).
- An unproven durability result resets the cell and keeps no local snapshot (crates/logic/output_gate.rs#L281-L284).
- The ltx fault-injection oracle diffs databases with the sqlite3 CLI in the Docker test stage (Dockerfile#L26-L33); the oracle's harness itself is not part of this snapshot.

Related: [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md), [Workers and V8 Runtime](/openwiki/concepts/workers-runtime.md), [Architecture Overview](/openwiki/architecture/overview.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
