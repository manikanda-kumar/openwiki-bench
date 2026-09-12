---
type: data
title: Replication and durability proofs
description: How celld proves every write durable before acknowledging — LTX WAL capture, the output gate, bucket vs fleet durability, follower ensembles and node-log sessions, and LTX compaction.
tags: [replication, durability, ltx, output-gate, followers]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-93e5bac71854233e4df4d7a1
    resource: repo://crates/celld/replication.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-f3e1324400248262b434a997
    resource: repo://docs/library-api.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Replication and durability proofs

## The replication backend: in-process LTX

`crates/celld/ltx_repl.rs` is the in-process replication backend built on
`celld-ltx`. Its design removes the external replicator entirely
("Replication runs inside the celld process, so a node needs no external
replicator" [docs/README.md](repo://docs/README.md#L112-L113)). Key points
from the module doc:

- One shared `object_store` client for the whole node and a managed
  `celld_ltx::Db` per resident cell, capturing the cell's committed WAL and
  uploading it on demand.
- No directory-watch lag: a just-written cell registers the instant it
  activates, "so the output gate can prove a fresh cell durable with no
  cold-start window"
  [crates/celld/ltx_repl.rs](repo://crates/celld/ltx_repl.rs#L3-L11).
- Object layout is `cells/<cell>/ltx/e<epoch>/` in the bucket, mirroring
  the local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree. This backend
  builds **its own** object-store clients rather than going through
  `bucket::Bucket`, so it carries the fleet key prefix itself — otherwise
  two fleets sharing one bucket would replicate over each other
  [crates/celld/ltx_repl.rs](repo://crates/celld/ltx_repl.rs#L12-L17).

`crates/celld/replication.rs` states the same invariant on the data path:
"epoch-in-prefix is the data-path fence: a stale owner writes a dead
prefix" [crates/celld/replication.rs](repo://crates/celld/replication.rs#L3-L8).

Every packet of the write path is what the
[celld-ltx crate](/openwiki/architecture/workspace-layout.md) provides:
"`celld-ltx` provides embeddable streaming replication for a SQLite
database. It captures WAL data as LTX segments, reads and writes replica
storage, restores databases, compacts levels, and reads bundle objects"
[crates/ltx/src/lib.rs](repo://crates/ltx/src/lib.rs#L3-L7).

## The output gate

 CELLD_OUTPUT_GATE defaults on. "The default is `1`, so celld proves each
write durable before it acknowledges the write. Set `0` to remove the
replication wait and accept possible loss of an acknowledged write"
[docs/README.md](repo://docs/README.md#L688-L691). The alarm contract
builds on the same boundary: when an event arms an alarm before its
response boundary, no successful response is sent until a durable wake
entry covers the alarm [docs/README.md](repo://docs/README.md#L66-L70).

The acknowledgement modes are selected by `CELLD_DURABILITY`:

- `fleet` (default): "the node serving the cell sends the write to one or
  two other nodes and answers once they hold it on disk, or once the
  bucket upload finishes, whichever comes first". A single node has
  nobody to send to, so every write waits for the bucket
  [docs/README.md](repo://docs/README.md#L689-L691).
- `bucket`: always wait for the bucket.

After a bucket proof, the node re-reads the ownership record and only
acknowledges if it still names this node at this epoch (see
[Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md))
[docs/guarantees.md](repo://docs/guarantees.md#L133-L146).

## Fleet durability: followers, ensembles, node logs

The fleet proof uses follower nodes, not the store:

- A node recruits up to two followers (never itself). One follower
  suffices and the ensemble keeps acknowledging while one remains; three
  or more nodes hold three copies
  [docs/guarantees.md](repo://docs/guarantees.md#L151-L167).
- Every follower must **fsync** the write, and a takeover seals the prior
  node-log session before restoring so a stale owner cannot complete
  another fleet proof [docs/guarantees.md](repo://docs/guarantees.md#L141-L149).
- Each process session creates a conditional **node-log record** before
  its first fleet-durable acknowledgement; a cold activation must resolve
  it (absent / sealed / open → recovery) before restoring
  [docs/guarantees.md](repo://docs/guarantees.md#L168-L183).

Latency results the repo's own testing page gives with conditions: a lab
fleet measured about 600 ms for a bucket proof and about 25 ms for a
fleet proof; the bucket upload races every fleet proof, so a slow
follower cannot make a write slower than a bucket proof; concurrent
writes to one cell join one shared upload
[docs/testing.md](repo://docs/testing.md#L168-L177).

The node-log machinery has explicit tuning knobs:

- `CELLD_LOG_HEDGE_MS` — the wait before a leader sends a second copy of a
  slow append to a follower. Default is **adaptive**: the wait derives
  from the slowest recent append (4× that append, at least 250 ms, always
  below the eviction backstop), so a loaded fleet does not send copies for
  honest slow appends. `0` disables the second copy. An append is
  idempotent per sequence, so the copy is safe, and the leader uses the
  answer that arrives first and confirms
  [docs/README.md](repo://docs/README.md#L694-L694). Code-side, how the
  lane arms its hedge deadline is a deliberate choice between `Fixed`
  (the `CELLD_LOG_HEDGE_MS` ordering) and `Adaptive`
  [crates/celld/node_log.rs](repo://crates/celld/node_log.rs#L1710-L1727).
- `CELLD_LOG_CAPTURE_WORKERS` (concurrency of log-capture workers,
  default 8) and `CELLD_LOG_PIPELINE` (fleet log rounds in flight,
  default 4) bound replication work
  [crates/celld/ltx_repl.rs](repo://crates/celld/ltx_repl.rs#L2874-L2874)
  [crates/celld/node_log.rs](repo://crates/celld/node_log.rs#L4181-L4181).

The local durability stack has a unique in-process owner:
`node_log::DurabilityOwner`. "Cloneable runtime handles can borrow the
replicator and the manager, but only this value controls their coupled
registration and background tasks" — a drop requests the local fallback
but does not join tasks; `shutdown_local` proves all admitted tasks
completed. This replaces the removed public setters/spawns (see
[docs/library-api.md](repo://docs/library-api.md#L20-L43)) that leaked
ownership cycles and detached tasks
[crates/celld/node_log.rs](repo://crates/celld/node_log.rs#L2715-L2748).

## Compaction: L0 chain, L1 objects, L9 snapshots

The replica path compacts into levels so restores stay cheap:

- **Additive L1 objects**: `CELLD_LTX_COMPACTION` defaults on so "celld
  creates additive L1 objects, and a takeover reads tens of objects
  instead of thousands" [docs/README.md](repo://docs/README.md#L695-L697).
  `CELLD_LTX_COMPACTION_MIN_TXIDS` (durable TXID distance that queues a
  background L1 attempt, default 256) paces it; `CELLD_LTX_COMPACTIONS`
  bounds concurrent attempts node-wide (default 2)
  [docs/README.md](repo://docs/README.md#L697-L698).
- **Final L9 snapshots**: at graceful handoff, a node proves the batch
  durable "and tries to publish one full snapshot of each closed
  database. The snapshot is an L9 object, so the successor does not replay
  the complete transaction history. The remote L0 chain remains an additive
  fallback" [docs/README.md](repo://docs/README.md#L448-L451).
- On a successful eviction the successor artifact is exactly one of those:
  a full L9 snapshot or the proven additive L0 chain
  [crates/celld/replication.rs](repo://crates/celld/replication.rs#L24-L38).

`celld-ltx` implements the tiering: "compacts levels", and its
`compaction_level` module distinguishes the level classes
[crates/ltx/src/lib.rs](repo://crates/ltx/src/lib.rs#L3-L7)
[crates/ltx/src/compaction_level.rs](repo://crates/ltx/src/compaction_level.rs).

## WAL truncation

Ordinary cells truncate their WAL at the next checkpoint once it reaches
`CELLD_LTX_TRUNCATE_PAGES` pages ("default: 128, a 512 KiB cap"), because
"a passive checkpoint does not shrink the WAL file, so each capture reads
the stale region after a restart". Queue cells use passive checkpoints,
because "a truncate boundary emits a full database image"
[docs/README.md](repo://docs/README.md#L694-L694).

## Durability deadlines

`CELLD_LTX_DURABILITY_TIMEOUT_SECS` (default 10) sets "the deadline for a
durability proof and the final snapshot retry window". The doc page notes
a slow or busy object store can need a longer deadline for a large write
burst [docs/README.md](repo://docs/README.md#L699-L699).

## What the tests establish

- "Every acknowledged write comes back" after a SIGKILL mid-write-stream
  plus local-database deletion, "because the output gate held each
  response until the write was durable"
  [docs/testing.md](repo://docs/testing.md#L136-L141).
- A throttled bucket (429) slows the engine to the store's write rate,
  "because a node that knows its replicated position does not ask a slow
  store for extra listings"
  [docs/testing.md](repo://docs/testing.md#L147-L148).
