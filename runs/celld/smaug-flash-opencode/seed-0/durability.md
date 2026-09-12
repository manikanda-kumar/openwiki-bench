---
type: durability
title: Durability, Fencing, and the Replication Protocol
description: RPO=0 durability guarantees, epoch fencing, ownership records, the fleet node-log ensemble, the takeover recovery gate, storage requirements, and self-fencing.
tags: [durability, fencing, replication, ltx, rpo-zero, node-log]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-fb3f4a433a44fb71aaaecdf1
    resource: repo://crates/ltx/Cargo.toml
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Durability, Fencing, and the Replication Protocol

celld makes two promises about data:

1. **One writer at a time.** Exactly one node serves a cell at a time, so two
   machines never write the same database.
2. **RPO=0.** celld does not answer a write until that write survives a
   failure, so nothing told to the client as succeeded is ever lost.

This page is the mechanism behind both (`docs/guarantees.md` lines 1-13). The
full argument is in that file; here it is grouped into the pieces a maintainer
must hold together: the storage contract, the ownership record, the epoch
prefix, the acknowledgement rule, the fleet node-log ensemble, the takeover
recovery gate, the LTX format, and self-fencing.

## The bucket must provide three properties

Both promises rest on the object store (`docs/guarantees.md` lines 12-18):

- **A conditional create** — the write fails when the object exists.
- **A conditional overwrite** — the write fails when the object changed after
  the read.
- **Read-after-write consistency** — a read after a successful write returns
  that write.

Qualified stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage,
and Azure Blob Storage. The release tests run against R2, and the S3 path uses
the same client and headers (`docs/guarantees.md` lines 26-28). Backblaze B2,
Hetzner Object Storage, and DigitalOcean Spaces do not implement the required
conditional writes, so "celld is not correct on such a store: two nodes can
then own one cell" (lines 30-33).

The enforcement point is a startup storage probe. `celld diagnose` sends four
conditional writes to the bucket and requires two of them to fail
(`docs/guarantees.md` lines 60-73). Each node repeats the test once at startup
and stops on a broken store; `CELLD_STORAGE_PROBE=0` disables it.

Conditional-write dialect is provider-specific: S3-compatible buckets get
`If-None-Match: *` / `If-Match` etag comparisons, `gs://` uses the Cloud
Storage XML API `x-goog-if-generation-match` with OAuth, and `az://` uses the
same `If-` headers on Put Blob. The adapter treats only `AlreadyExists` /
`Precondition` (HTTP 412 on Azure) as clean rejections; every other error is
ambiguous because "an ambiguous write can have changed the object"
(`docs/guarantees.md` lines 43-52). This truth is reflected in the bucket
client's error contract: `put_cas` answers `Ok(None)` only for a clean 412/409
rejection and surfaces every other failure as `Err` (`crates/celld/bucket.rs`).

## The ownership record

Each cell has one ownership record in the bucket naming the owner's node
session and carrying a fencing epoch. A node acquires a cell with a conditional
write — a create when no record exists, a compare-and-swap on the previous
record when one does — and the bucket accepts one such write, so two nodes
cannot acquire the same cell (`docs/guarantees.md` lines 108-114).

**Every activation advances the epoch.** A takeover and a local wake alike.
"Each owner therefore replicates under a fresh epoch, and an epoch never has
two writers" (lines 115-118).

## The epoch prefix is the data-path fence

The replicator copies a cell's SQLite data to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs
(`docs/guarantees.md` lines 122-124). The epoch in the key is the fence: "a node
that lost ownership can keep writing, but its writes land in a superseded
prefix, and a restore selects the current lineage". The same layout is
implemented in the in-process replica (`crates/celld/ltx_repl.rs` lines 9-15),
which mirrors the local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree into the
bucket.

## The acknowledgement rule (RPO=0)

A gate holds each write response until a durability proof covers the write
(`docs/guarantees.md` lines 132-148):

- **After a bucket proof**, celld reads the ownership record once and
  acknowledges only if the record still names this node at this epoch. A
  partitioned node can commit locally and replicate into its superseded prefix,
  but the ownership read then shows the new owner, so celld does not
  acknowledge. "The check reads the record instead of comparing a clock, so a
  paused process or a skewed clock cannot pass it."
- **A fleet proof** does not require that read. The owner sends each write to
  one or two other nodes that form its ensemble; every follower must fsync the
  write, and a takeover seals the prior node-log session before it restores, so
  the stale owner cannot complete another fleet proof.

This is the output gate, implemented as a single choke point in the decision
core (`crates/logic/output_gate.rs`): "Nothing that reveals a cell's state may
leave this process while that cell has a write it cannot prove durable." When
`CELLD_OUTPUT_GATE=0`, the shell sends no `Event::Output` and accepts possible
loss of an acknowledged write.

`CELLD_DURABILITY` selects the posture and defaults to `fleet`
(`docs/guarantees.md` lines 151-167): one node picks followers from other nodes
so it never counts itself and needs two running nodes before any write can
complete a fleet proof. A node recruits up to two followers, so a fleet of
three holds three copies. "A node without an ensemble stays correct. It
acknowledges each write on a bucket proof instead" (§"The ensemble needs two
nodes", lines 152-167).

## The fleet node-log ensemble

Under `CELLD_DURABILITY=fleet`, each node runs a small replicated log tier
(`crates/celld/node_log.rs`). Each node streams the per-cell L0 LTX segments it
has captured but not yet uploaded "to a small follower ensemble over the signed
peer transport". A write acknowledges "when every member holds its segment on
disk — write-all, ack-all — or when the ordinary bucket upload proves it first,
whichever wins" (lines 3-11).

`log/<node>.json` is the CAS-guarded root of truth for the ensemble and the log
epoch. It is "created before the node's first fleet-durable ack and never
deleted, so a takeover that finds no record may treat the bucket as complete"
(lines 15-18). The decisions are `celld_logic::log_tier`; this module is their
executor (line 19). A follower failure degrades the node to bucket-proof acks
until a periodic re-recruit CASes a fresh ensemble (lines 21-23).

## The takeover recovery gate

A cold activation checks the prior owner's log records before it reads the
bucket (`docs/guarantees.md` lines 171-183):

- An **absent record** proves the session never acknowledged past the bucket.
- A **sealed record** proves recovery completed.
- An **open or recovering record** makes the activation run recovery: it fences
  the record with a compare-and-swap, seals the reachable followers, uploads
  their retained segments and bundles into the per-cell prefixes, and marks the
  record sealed. "The activation cannot restore until this sequence completes."

## Full-prefix restore

A restore "selects the newest epoch prefix that contains LTX data, and it reads
the full contiguous chain from transaction zero"
(`docs/guarantees.md` lines 186-198). celld no longer writes an epoch seal
object. The rule reads the full chain because "a node-log recovery or a bundle
drain can add an acknowledged tail after an earlier restore; a restore that
stopped at the earlier cut would hide that tail and lose acknowledged data."

## Self-fencing

Each node holds a bucket lease with an expiry, renewed after one third of the
lifetime (`CELLD_TTL_MS`, default 10000 ms) (`docs/guarantees.md` lines
200-212). Authority is evaluated from the *published* expiry, not a trusting a
timer:

> "A suspended VM's timer fires late, but a request evaluated after resume
> still refuses." (`crates/logic/lib.rs` in the `node_authoritative`
> documentation)

A node that cannot renew and cannot replicate must not own cells: "when its
published expiry passes, it fences itself: it stops each active cell, and it
fails every request that it has not completed" (`docs/guarantees.md` lines
205-208). A node whose lease record was replaced fences at once. The fence
writes nothing to the bucket — peers already read the lease as dead and acquire
through the ownership records. A fenced process logs a line starting with
`SELF-FENCE:` and exits code 3 (lines 214-224). The fenced state is terminal;
only a restart returns the node to the fleet through the same cold-activation
path that a peer failure uses.

## The LTX format and celld-ltx

The LTX crate provides "embeddable streaming replication for a SQLite
database": it captures WAL data as LTX segments, reads and writes replica
storage, restores databases, compacts levels, and reads bundle objects
(`crates/ltx/src/lib.rs` lines 1-11). It is a from-scratch Rust
reimplementation of the Litestream v0.5.11 replication behavior, and "the block
format follows LTX v0.5.2" (lines 7-8), vendored into the repository and owned
by celld (`crates/ltx/Cargo.toml`).

In-process, celld wires the crate through `crates/celld/ltx_repl.rs`: "One
shared `object_store` client for the whole node, and a managed `celld_ltx::Db`
per resident cell that captures the cell's committed WAL and uploads it on
demand" (lines 3-11). A just-written cell is registered the instant it
activates, so the output gate can prove a fresh cell durable with no
cold-start window. The backend builds its own object-store clients and carries
the fleet's key prefix itself, "so two fleets sharing one bucket would
replicate over each other" otherwise.
