---
type: subsystem
title: The celld-ltx replication engine
description: crates/ltx is an owned Litestream-v0.5/Rust port that captures committed SQLite WAL frames as LTX L0 segments, uploads them through a ReplicaClient abstraction, restores and compacts levels, and wraps segments in celld-original bundle objects.
tags: [sqlite, wal, ltx, replication, compaction, litestream, restore]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-10a3ca6704a0d403c63dff35
    resource: repo://crates/ltx/README.md
  - id: openwiki-source-2e61390dbf1d699be0f0a0b7
    resource: repo://crates/ltx/reference/ltx-format.md
  - id: openwiki-source-7c84b1c1d301dbd888aff852
    resource: repo://crates/ltx/src/bundle.rs
  - id: openwiki-source-defd36e16c6bcfd2cabbe88f
    resource: repo://crates/ltx/src/client/file.rs
  - id: openwiki-source-cbc235161038ebca210ee0a3
    resource: repo://crates/ltx/src/client/mod.rs
  - id: openwiki-source-d623ebf5ac6a6289a978bd78
    resource: repo://crates/ltx/src/client/object_store.rs
  - id: openwiki-source-8f42bb88621408074def0757
    resource: repo://crates/ltx/src/codec.rs
  - id: openwiki-source-0c5d4616a8d424ba569c0176
    resource: repo://crates/ltx/src/compaction_level.rs
  - id: openwiki-source-25715893776ae7c92ad47c4e
    resource: repo://crates/ltx/src/compactor.rs
  - id: openwiki-source-4d936a610dc0c9b35c2eae1a
    resource: repo://crates/ltx/src/db.rs
  - id: openwiki-source-05003cdb35af89f952359c25
    resource: repo://crates/ltx/src/error.rs
  - id: openwiki-source-55433b9cfeb94c64232356fb
    resource: repo://crates/ltx/src/host.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-8fab090a0d09f194f7324895
    resource: repo://crates/ltx/src/ltx.rs
  - id: openwiki-source-e1e967af531357151a74d547
    resource: repo://crates/ltx/src/replica_compactor.rs
  - id: openwiki-source-a839dd465500b913e92b6123
    resource: repo://crates/ltx/src/replica.rs
  - id: openwiki-source-a7e94ad79f2787fba86dfd37
    resource: repo://crates/ltx/src/wal.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# The celld-ltx replication engine

`celld-ltx` (crate `crates/ltx`) is celld's in-process SQLite replication
library: it "captures committed WAL data as L0 LTX segments and reports the
captured position," and can write segments to a filesystem or object store,
restore databases, compact levels, and read bundle objects
([crates/ltx/README.md#L3-L7](repo://crates/ltx/README.md#L3-L7)). The durability
protocol that puts it under an acknowledgement gate is celld's, not the
library's ([crates/ltx/README.md#L9-L11](repo://crates/ltx/README.md#L9-L11)) —
see [durability and fencing](../concepts/durability-and-fencing.md).

## Provenance and compatibility

The crate is "seeded on 2026-08-03 from a read-only snapshot of rustyriver," a
from-scratch Rust reimplementation of Litestream v0.5 and the LTX format
(v0.5.2), and celld owns and evolves the snapshot rather than tracking an
upstream branch ([crates/ltx/README.md#L15-L20](repo://crates/ltx/README.md#L15-L20)).
Behavior comes from Litestream v0.5.11; the block format follows v0.5.16
because it includes LTX v0.5.2 ([crates/ltx/README.md#L25-L29](repo://crates/ltx/README.md#L25-L29)).
The port is deliberately incomplete: Litestream's object-storage *leaser* was
ported and then removed unused, because celld fences ownership with a
conditional-write record and an epoch-stamped prefix — "a lease file under the
replica prefix would be a second, competing layer"
([crates/ltx/README.md#L36-L43](repo://crates/ltx/README.md#L36-L43)).

File compatibility is a boundary worth knowing before touching formats:
celld and Litestream v0.5.16 read both new block files and old frame files;
v0.5.11 reads only frame files — LTX keeps file version 3 for both layouts, so
this is a *reader* boundary ([crates/ltx/README.md#L49-L55](repo://crates/ltx/README.md#L49-L55)).
The ordinary L0 writer still emits frames; the v0.5.2 encoder/compactor emit
blocks; and the node-wide L1 scheduler is **on by default**, so a mixed fleet
must set `CELLD_LTX_COMPACTION=0` until every takeover target has the dual
decoder ([crates/ltx/README.md#L55-L61](repo://crates/ltx/README.md#L55-L61),
[docs/README.md#L696](repo://docs/README.md#L696)).

## Capture: the `Db` lifecycle

`db.rs` owns SQLite database lifecycle: WAL-mode setup, the long-running
read-lock checkpoint takeover, the WAL→LTX capture loop, and manual
checkpointing ([crates/ltx/src/db.rs#L1-L4](repo://crates/ltx/src/db.rs#L1-L4)).
Because `rusqlite::Connection` is `!Sync` and a `Transaction` borrows it, the
capture API is synchronous and holds the read lock with raw `BEGIN`/`ROLLBACK`
plus a `read_lock_held` flag — mirroring the Go design — and callers drive
`sync()`/`checkpoint()` from a blocking context
([crates/ltx/src/db.rs#L8-L18](repo://crates/ltx/src/db.rs#L8-L18)). The path:
`sync → verify → sync_inner → write_ltx_from_wal/write_ltx_from_db` diffs the
real WAL against the last LTX position and writes the next L0 file atomically
(tmp→rename), with `verify` covering the snapshot-on-continuity-break branch
lattice ([crates/ltx/src/db.rs#L26-L31](repo://crates/ltx/src/db.rs#L26-L31)).
Checkpointing releases → `PRAGMA wal_checkpoint(<mode>)` → re-acquires, and a
three-tier `checkpoint_if_needed` policy with anti-feedback flags governs when
to checkpoint at all; Litestream #1292/celld #150 fixes seal passive
checkpoints with a writer barrier and snapshot truncate boundaries
([crates/ltx/src/db.rs#L32-L38](repo://crates/ltx/src/db.rs#L32-L38)).
This is why an ordinary cell truncates its WAL at checkpoint
(`CELLD_LTX_TRUNCATE_PAGES`, default 128 pages: a passive checkpoint does not
shrink the file, and every capture would re-read the stale region), while
Queue cells use passive checkpoints because a truncate boundary emits a full
database image ([docs/README.md#L695](repo://docs/README.md#L695)).

## The format stack

- `ltx.rs` — LTX file reader/writer plus CRC64-ISO file checksums and rolling
  checksums ([crates/ltx/src/ltx.rs#L1-L8](repo://crates/ltx/src/ltx.rs#L1-L8)).
  All multi-byte integers are big-endian; the layout (100-byte header,
  `PageHeader(6)+Size(4)+LZ4` per page, trailer) is documented in
  [crates/ltx/reference/ltx-format.md](repo://crates/ltx/reference/ltx-format.md#L1-L15).
- `wal.rs` — SQLite WAL header/frame parsing with cumulative SQLite checksums;
  it validates salt and checksum integrity as it reads
  ([crates/ltx/src/wal.rs#L1-L8](repo://crates/ltx/src/wal.rs#L1-L8)).
- `codec.rs` — the streaming LTX v0.5.2 encoder and a backward-compatible
  decoder that handles both legacy frames and sized blocks
  ([crates/ltx/src/codec.rs#L1-L2](repo://crates/ltx/src/codec.rs#L1-L2),
  [crates/ltx/src/codec.rs#L20-L24](repo://crates/ltx/src/codec.rs#L20-L24)).
  The LZ4 block compressor is a Rust port that preserves the exact compressed
  bytes of the v0.5.2 writer ([crates/ltx/README.md#L37-L40](repo://crates/ltx/README.md#L37-L40)).
- `error.rs` — a small taxonomy mapped from Litestream's sentinels
  (`NoSnapshots`, `ChecksumMismatch`, `LTXCorrupted`, `LTXMissing`, …)
  ([crates/ltx/src/error.rs#L20-L45](repo://crates/ltx/src/error.rs#L20-L45)).
- `host.rs` — host facilities (clock, filesystem, task spawner) that can affect
  LTX scheduling or timestamps; the default is the real host, and callers can
  inject another ([crates/ltx/src/host.rs#L1-L2](repo://crates/ltx/src/host.rs#L1-L2),
  [crates/ltx/src/host.rs#L242](repo://crates/ltx/src/host.rs#L242)).

## Levels, compaction, and bundles

`compaction_level.rs` carries the canonical Litestream v0.5.16 interval
levels plus `SNAPSHOT_LEVEL: 9` (the level holding complete database
snapshots) ([crates/ltx/src/compaction_level.rs#L1-L10](repo://crates/ltx/src/compaction_level.rs#L1-L10),
[crates/ltx/src/compaction_level.rs#L34-L36](repo://crates/ltx/src/compaction_level.rs#L34-L36)).
`compactor.rs` is a streaming port of the LTX compactor: it keeps one
decompressed page per input — never a database-sized page map — and requires
inputs ordered by transaction range ([crates/ltx/src/compactor.rs#L1-L5](repo://crates/ltx/src/compactor.rs#L1-L5)).
`replica_compactor.rs` is the storage-independent additive half: it creates a
destination object but **never deletes a source**
([crates/ltx/src/replica_compactor.rs#L1-L4](repo://crates/ltx/src/replica_compactor.rs#L1-L4)) —
which is what makes L1 compaction safe in a fleet that still restores the L0
chain.

`bundle.rs` is the one celld-original object format: an envelope of verbatim
L0 LTX files — concatenated raw bytes, a binary footer of rows
(`cell | cell_epoch | txid | offset | len`, little-endian), footer length, and
`CLB1` magic — used when the log tier first combines segments from many cells
into a node bundle and drains each segment into its per-cell prefix later
([crates/ltx/src/bundle.rs#L1-L15](repo://crates/ltx/src/bundle.rs#L1-L15),
[docs/guarantees.md#L126-L128](repo://docs/guarantees.md#L126-L128)). The
invariant is stated plainly: un-bundling is arithmetic, the inner bytes are
exactly what the per-cell writer produces, "at rest, the bucket is pure
Litestream," and deleting the module returns the crate to upstream shape
([crates/ltx/src/bundle.rs#L9-L13](repo://crates/ltx/src/bundle.rs#L9-L13)).

## Replica clients and restore

`client/mod.rs` defines the `ReplicaClient` trait — the storage abstraction
every backend implements, with buffered (owned-bytes) rather than streaming
I/O because L0 files are bounded
([crates/ltx/src/client/mod.rs#L1-L9](repo://crates/ltx/src/client/mod.rs#L1-L9)).
Backends: a local filesystem client ([file.rs](repo://crates/ltx/src/client/file.rs#L1-L4))
and the `object_store` client for S3/R2/MinIO-shaped endpoints, which keeps
the upstream conformance invariants — `{path}/{level:04x}/{min}-{max}.ltx`
keys, the 5 MiB single-PUT/multipart threshold, seek-skip listing in ascending
TXID order, `NoSuchKey → NotExist` mapping, and batched deletes of up to 1000
keys ([crates/ltx/src/client/object_store.rs#L1-L24](repo://crates/ltx/src/client/object_store.rs#L1-L24)).
`replica_url.rs` parses `s3://` and `file://` URLs (the gs/abs/oss/sftp/webdav
schemes are deliberately out of scope); celld's own bucket access for the
fleet path goes through `crates/celld/bucket.rs`
([crates/ltx/src/replica_url.rs#L1-L6](repo://crates/ltx/src/replica_url.rs#L1-L6)).

`replica.rs` connects a `Db` to a client and drives both halves:
**sync** copies each new L0 file upward, advancing the replicated position one
TXID at a time with `calc_pos` recovering the start from the newest remote
file; **restore** downloads LTX files in TXID order, merges them with the
compactor, and reconstructs the database pages `1..=commit` (lock page
zero-filled) into a temp file that is fsync'd and atomically renamed into
place ([crates/ltx/src/replica.rs#L3-L16](repo://crates/ltx/src/replica.rs#L3-L16)).
Scope is deliberately L0-only/single-replica — the port keeps
`calc_restore_plan` (snapshot anchor at level 9 plus per-level cursors) so
"adding compaction later just works," but in scope the plan is the contiguous
L0 chain `1..=N`; follow-mode tail restore and the background monitor are
deferred ([crates/ltx/src/replica.rs#L17-L30](repo://crates/ltx/src/replica.rs#L17-L30)).
Celld layers its full-prefix, newest-epoch selection on top of this
([crates/celld/ltx_repl.rs#L1309-L1312](repo://crates/celld/ltx_repl.rs#L1309-L1312)).

## How celld embeds it (`ltx_repl`)

`crates/celld/ltx_repl.rs` is the in-process backend: one shared
`object_store` client per node and a managed `celld_ltx::Db` per resident cell
that captures the committed WAL and uploads on demand — "no external process,
no directory-watch lag — a just-written cell is registered the instant it
activates, so the output gate can prove a fresh cell durable with no cold-start
window" ([crates/celld/ltx_repl.rs#L3-L10](repo://crates/celld/ltx_repl.rs#L3-L10)).
It mirrors the local `<watch>/<cell>/ltx/e<epoch>/` tree onto the bucket's
`cells/<cell>/ltx/e<epoch>/` and carries the fleet key prefix itself, since
two fleets sharing one bucket would otherwise replicate over each other
([crates/celld/ltx_repl.rs#L11-L15](repo://crates/celld/ltx_repl.rs#L11-L15)).
`await_durable` is the durability proof's reporting channel
([crates/celld/ltx_repl.rs#L1539](repo://crates/celld/ltx_repl.rs#L1539)), and
the same module hosts the shipper loop that feeds the node-log ensemble
([crates/celld/ltx_repl.rs#L2860-L2876](repo://crates/celld/ltx_repl.rs#L2860-L2876)).

## Testing surface in this snapshot

The library exposes a `doc(hidden)` `internal` module ("unstable… supports
external verification tools") re-exporting the `db`, lz4, replica, and
object-store internals
([crates/ltx/src/lib.rs#L28-L37](repo://crates/ltx/src/lib.rs#L28-L37)). The
fault-injection oracle that the Dockerfile test stage installs `sqlite3` for —
diffing replicated databases against the reference engine — is itself part of
the externally injected `celld_internal_tests` corpus (the `fault` module in
`crates/celld/lib.rs` includes it from an environment-variable path), so the
oracle source is not present in this repository
([crates/celld/lib.rs#L332-L337](repo://crates/celld/lib.rs#L332-L337),
[Dockerfile#L26-L28](repo://Dockerfile#L26-L28)). The crate's own test harness
is disabled in the manifest ([crates/ltx/Cargo.toml#L19](repo://crates/ltx/Cargo.toml#L19)).

Related: [architecture hub](../architecture.md) ·
[durability and fencing](../concepts/durability-and-fencing.md) ·
[actor and execution boundary](../architecture/actor-execution.md) ·
[change guide](../development/change-guide.md)
