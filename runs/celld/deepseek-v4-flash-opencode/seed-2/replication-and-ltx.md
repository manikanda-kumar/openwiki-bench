---
type: concept
title: SQLite replication, the LTX format, and the fleet log tier
description: How celld captures each cell's SQLite WAL as LTX data, the LTX v0.5.2 object layout and compaction levels, the bundle envelope, and the in-fleet node-log that enables fleet-durable write acknowledgements.
tags: [replication, ltx, sqlite, wal, node-log, compaction]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-9f6270d214b8ff6c345f5424
    resource: repo://crates/logic/log_evict.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-2e61390dbf1d699be0f0a0b7
    resource: repo://crates/ltx/reference/ltx-format.md
  - id: openwiki-source-7c84b1c1d301dbd888aff852
    resource: repo://crates/ltx/src/bundle.rs
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
  - id: openwiki-source-a7e94ad79f2787fba86dfd37
    resource: repo://crates/ltx/src/wal.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# SQLite replication, the LTX format, and the fleet log tier

Every cell is a SQLite database in WAL mode. celld captures committed writes
as LTX data and ships it to the bucket; a fleet of two or more nodes also
streams it to a small follower ensemble so a write can be acknowledged before
the bucket round trip completes. This page covers the replication library,
the LTX format, the object layout, and the node log.

## The replication library

`celld-ltx` "provides embeddable streaming replication for a SQLite
database. It captures WAL data as LTX segments, reads and writes replica
storage, restores databases, compacts levels, and reads bundle objects." It
is a from-scratch Rust reimplementation of Litestream v0.5.11, with the block
format following LTX v0.5.2 (crates/ltx/src/lib.rs#L3-L13).

The pieces:

- **`db.rs`** owns the SQLite lifecycle: WAL-mode setup, the long-running
  read-lock checkpoint takeover, and the WAL→LTX capture loop. `sync` diffs
  the real WAL against the last LTX position and writes the next L0 LTX file
  with an atomic tmp→rename and a position cache. The capture API is
  synchronous and owns the connection directly, avoiding the `!Sync`/borrow
  problem of `rusqlite` (crates/ltx/src/db.rs#L1-L33).
- **`wal.rs`** parses SQLite WAL frames and verifies salt and cumulative
  checksum integrity. It does not enforce transaction boundaries — it may
  return uncommitted frames, and honoring commit records is the caller's
  responsibility (crates/ltx/src/wal.rs#L1-L10).
- **`replica.rs`** connects a managed `Db` to a `ReplicaClient`. `sync`
  copies each new L0 LTX file to the remote, advancing one TXID at a time;
  `restore` downloads the LTX files in TXID order, merges them, and
  reconstructs the SQLite file to a temp file that is fsync'd and atomically
  renamed (crates/ltx/src/replica.rs#L1-L24). The scope is L0-only and
  single-replica; the snapshot level is empty without compaction
  (crates/ltx/src/replica.rs#L25-L30).
- **`compactor.rs`** merges ordered LTX inputs into one byte-compatible LTX
  output, keeping one decompressed page per input rather than a
  database-sized page map (crates/ltx/src/compactor.rs#L1-L8).
- **`compaction_level.rs`** defines Litestream-compatible levels; the
  snapshot level is `SNAPSHOT_LEVEL = 9` (crates/ltx/src/compaction_level.rs#L6-L9).
- **`bundle.rs`** is a celld-original envelope: a container of verbatim L0
  LTX files, not a format. Its layout is the concatenated raw L0 bytes, a
  binary footer of rows, the footer length as a little-endian u32, and a
  four-byte magic `CLB1`; a row is
  `u16 cell_len | cell utf-8 | u64 cell_epoch | u64 txid | u64 offset | u64 len`.
  At rest the bucket is pure Litestream, and a drained bundle leaves no trace
  that the module ever existed (crates/ltx/src/bundle.rs#L1-L10).

## The LTX file format

The format is documented byte-for-byte in `crates/ltx/reference/ltx-format.md`
(version 3, derived from `superfly/ltx` v0.5.2). All multi-byte integers are
big-endian. A file is a 100-byte header, a page block, an empty page header
(`pgno == 0`) terminating the block, a page index of varint tuples plus an end
marker and a u64 size, and a 16-byte trailer
(crates/ltx/reference/ltx-format.md#L7-L23).

The header carries the magic `LTX1`, a flags word, the page size, the commit
size in pages, `MinTXID`, `MaxTXID`, a timestamp, the pre-apply checksum, the
WAL offset/size and salts, and a node id. A file is a snapshot when
`MinTXID == 1`; snapshots include all pages and have `PreApplyChecksum == 0`
(crates/ltx/reference/ltx-format.md#L25-L45). Checksums are CRC64-ISO with the
`ChecksumFlag` OR-ed into every stored checksum
(crates/ltx/reference/ltx-format.md#L75-L89). A file is named
`<minTXID:016x>-<maxTXID:016x>.ltx`
(crates/ltx/reference/ltx-format.md#L91-L93).

## The object layout and epoch fence

The in-process backend is built on `celld-ltx`: "one shared `object_store`
client for the whole node, and a managed `celld_ltx::Db` per resident cell
that captures the cell's committed WAL and uploads it on demand." A
just-written cell is registered the instant it activates, so the output gate
can prove a fresh cell durable with no cold-start window
(crates/celld/ltx_repl.rs#L3-L15). The object layout is
`cells/<cell>/ltx/e<epoch>/` in the bucket, mirroring the local
`<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree; the backend carries the fleet's
key prefix itself so two fleets sharing one bucket do not replicate over each
other (crates/celld/ltx_repl.rs#L10-L15).

The epoch in the key is the fence described on the
[ownership and durability](ownership-and-durability.md) page: a node that
lost ownership writes only into a superseded prefix, and a restore selects
the current lineage (docs/guarantees.md#L120-L128). Compaction bounds the
work a takeover does: with `CELLD_LTX_COMPACTION` on (the default), celld
creates additive L1 objects so a takeover reads tens of objects instead of
thousands, and a mixed fleet must set it to 0 until all nodes can read the
block objects (docs/README.md#L696-L697). `CELLD_LTX_COMPACTION_MIN_TXIDS`
(default 256) is the durable TXID distance that queues a background L1
attempt, and `CELLD_LTX_COMPACTIONS` (default 2) is the node-wide limit for
concurrent background L1 attempts (docs/README.md#L697-L698).

The backend bounds its I/O: `SYNC_CONCURRENCY` (64) caps concurrent cell
uploads, `RESTORE_DOWNLOAD_CONCURRENCY` (64) caps LTX downloads across every
restore on the node, and a single compaction attempt consumes at most
`COMPACTION_MAX_FILES` (256) source objects and
`COMPACTION_MAX_INPUT_BYTES` (64 MiB)
(crates/celld/ltx_repl.rs#L58-L75). `CELLD_LTX_TRUNCATE_PAGES` (default 128, a
512 KiB cap) truncates an ordinary cell's WAL file at the next checkpoint
because a passive checkpoint does not shrink the WAL file; queue cells use
passive checkpoints because a truncate boundary emits a full database image
(docs/README.md#L695-L696). `CELLD_LTX_DURABILITY_TIMEOUT_SECS` (default 10)
is the deadline for a durability proof and the final snapshot retry window
(docs/README.md#L699).

## The fleet log tier

The node log is "v0 of the in-fleet replicated log tier
(`CELLD_DURABILITY=fleet`)". Each node streams the per-cell L0 LTX segments
it has captured but not yet uploaded to a small follower ensemble over the
signed peer transport. A write acknowledges when every member holds its
segment on disk — write-all, ack-all — or when the ordinary bucket upload
proves it first, whichever wins. The bucket upload path is unchanged and
remains the tiering mechanism, so node-log recovery re-creates exactly the
objects the dead leader would have uploaded and every per-cell restore and
compaction mechanism stays byte-for-byte as it is
(crates/celld/node_log.rs#L3-L18).

`log/<node>.json` is the CAS-guarded root of truth for the ensemble and the
log epoch. It is created before the node's first fleet-durable acknowledgement
and never deleted, so a takeover that finds no record may treat the bucket as
complete (crates/celld/node_log.rs#L14-L18). The decisions are
`celld_logic::log_tier`; the module is their executor
(crates/celld/node_log.rs#L17-L18). The safety rules are each load-bearing: a
follower's `(ensemble, epoch)` view changes only with the record, never on
the leader's stream alone; a follower refuses appends at or below its
persisted seal mark; reconfiguration force-tiers the open fragment through
the new fragment base before the CAS, so an empty joiner is covered entirely
by the bucket; recovery seals before it certifies, and certifies from a
sealed member only; and the record is created before the first fleet-durable
ack and never deleted (crates/logic/log_tier.rs#L13-L23).

The folded log fields travel inside the node lease record: `NodeLogWire`
carries `state` (`open`/`recovering`/`sealed`), `epoch`, `ensemble`, `tiered`,
and `active`, and every writer of the lease carries it through unchanged
except the log tier itself and recovery
(crates/celld/ownership_store.rs#L57-L78). A takeover that finds an open or
recovering log state runs node-log recovery before it restores
(docs/guarantees.md#L169-L183).

### Follower selection and the gray-follower policy

The v0 limits are deliberate: entries travel as base64 JSON; a follower
failure degrades the node to bucket-proof acknowledgements until a periodic
re-recruit CASes a fresh ensemble; and recovery gathers from every reachable
sealed member and requires at least one (crates/celld/node_log.rs#L20-L23).

The gray-follower eviction policy is the log tier's answer to write-all's
classic price — one slow follower stalls every ack. The leader evicts a
follower on suspicion, and the empty-join reconfiguration makes a false
positive cost one flush plus one CAS. A follower is evicted when its windowed
append-latency tail exceeds `max(absolute budget, k × sibling median)`
sustained for a short window, or when a single append is outstanding past a
hard backstop; flapping is bounded by rate-capping reconfigurations rather
than by excluding the evicted member, because slowness is transient
(crates/logic/log_evict.rs#L3-L18). The default policy has a 25 ms absolute
tail budget, a 4× sibling factor, a 2 s sustain window, and a 1.5 s backstop
(crates/logic/log_evict.rs#L76-L91).

## How the pieces connect

A committed write becomes an L0 LTX file locally, is registered with the
node's `LtxRepl`, and is simultaneously (a) streamed to the follower ensemble
and (b) uploaded to `cells/<cell>/ltx/e<epoch>/`. The output gate waits for
whichever proof wins (crates/logic/output_gate.rs#L167-L196). A takeover
recovers any open node-log session before it reads the bucket, then restores
the full contiguous LTX chain from transaction zero
(docs/guarantees.md#L169-L198). See the
[ownership and durability](ownership-and-durability.md) page for the
acknowledgement rules and the [object storage](object-storage.md) page for the
provider dialects.
