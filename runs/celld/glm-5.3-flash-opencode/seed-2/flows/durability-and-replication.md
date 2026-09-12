---
type: durability-flow
title: Durability and replication
description: How celld earns RPO=0 — the output gate, LTX WAL capture, per-cell epoch-prefix uploads, the fleet node-log tier, bundle tiering, takeover recovery, and full-prefix restore.
tags: [durability, replication, ltx, output-gate, node-log, restore]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-3f8f03cead815bd38bdb57ba
    resource: repo://crates/logic/restore.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-10a3ca6704a0d403c63dff35
    resource: repo://crates/ltx/README.md
  - id: openwiki-source-2e61390dbf1d699be0f0a0b7
    resource: repo://crates/ltx/reference/ltx-format.md
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Durability and replication

celld's second core promise is that a write answered to the caller is
recoverable — RPO=0 — and this page maps how each layer maintains it. The
coordination contract lives in `crates/logic`; the effect-executing
mechanism lives in `crates/celld/{storage,ltx_repl,node_log,replication}.rs`
and the replication library `crates/ltx`.

## The output gate

A gate holds each write response until a durability proof covers the write.
The core releases it via `Effect::Release` only when the proof arrives, or
refuses when the write is known lost. The gate itself:

- `Event::Output { request, channel, position }` — the shell withholds. A
  committed-write event reveals `position` and opens its own barrier; a
  read-only event trails the newest barrier already open, costing no
  durability latency (repo://crates/logic/types.rs#L500-L514).
- `Effect::AwaitDurable` — ask the replicator to prove the cell's committed
  WAL reached `position`; this is per-request and changes no cell phase, so
  other co-resident requests continue serving while one response waits
  (repo://crates/logic/types.rs#L848-L862).
- `Event::DurableReached` — the completion side, which carries a
  `ProofSource` distinguishing the *fleet* proof (already arbitrated by the
  takeover's log-seal lock, so a stale owner's next ack-all fails closed)
  from the *bucket* proof (which requires an ownership-verification read
  before anything is revealed — repo://crates/logic/types.rs#L516-L528).

The user-visible opt-out is `CELLD_OUTPUT_GATE=0`, which removes the
replication wait at the cost of the promise (the documented default is 1)
(repo://docs/README.md#L688-L690).

## Local capture: WAL → LTX

Each resident cell owns a managed `celld_ltx::Db` that captures committed
WAL data into an L0 LTX segment. The library's README states the shape:

> `celld-ltx` is celld's in-process SQLite replication library. It captures
> committed WAL data as L0 LTX segments and reports the captured position.
> The crate can write segments to a filesystem or an object store.

(repo://crates/ltx/README.md#L3-L5)

The integration is in-process rather than a subprocess: "One shared
`object_store` client for the whole node, and a managed `celld_ltx::Db` per
resident cell that captures the cell's committed WAL and uploads it on
demand. No external process, no directory-watch lag — a just-written cell
is registered the instant it activates, so the output gate can prove a
fresh cell durable with no cold-start window."
(repo://crates/celld/ltx_repl.rs#L3-L10).

The underlying byte format is documented in
`crates/ltx/reference/ltx-format.md` (header, pages, index, trailer) and is
big-endian (repo://crates/ltx/reference/ltx-format.md#L1-L21).

## Where the data lands: `cells/<cell>/ltx/e<epoch>/`

Replicated data is uploaded under per-cell, per-epoch prefixes, with
**plain unconditional PUTs** — the fence is the epoch in the key. A node
that lost authority keeps writing, but into a superseded prefix that no
restore selects (repo://docs/guarantees.md#L122-L130).
`cells/<cell>/ltx/e<epoch>/` is written by `ltx_repl.rs`, matching the
local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree
(repo://crates/celld/ltx_repl.rs#L11-L12). Restore reads the newest epoch
prefix that contains LTX data and replays the full contiguous chain from
transaction zero — the "full-prefix restore" rule; a fenced node's late
appended tail in an older prefix is *not* a data-loss risk because acks
only ever follow proofs, and a later restore may legitimately expose an
acknowledged tail a naive epoch cut would miss
(repo://docs/guarantees.md#L205-L214).

## Bucket-proof acknowledgement

A single-node fleet *must* prove through the bucket. The output-gate flow:

1. cell commits its write locally.
2. replicator uploads to the bucket and reports the proven WAL position.
3. **ownership verification**: for a bucket proof only, celld re-reads
   `cells/<cell>/own.json` and answers whether it still names this node at
   this epoch (`Effect::VerifyOwnership`) *before* the output gate opens
   (repo://crates/logic/types.rs#L865-L875).
4. only then is the HTTP response released to the caller.

The ownership read is the fence against a partitioned stale owner: it can
commit locally and replicate into its superseded key, but the record won't
name it, so its write is never acknowledged
(repo://docs/guarantees.md#L143-L156).

## Fleet-proof acknowledgement (node log)

`CELLD_DURABILITY=fleet` (the default) routes each write to a recruited
follower ensemble of one or two peers; the write acks when every member
holds its segment on disk — write-all, ack-all — or when the ordinary
bucket upload proves it first, whichever wins
(repo://crates/celld/node_log.rs#L5-L11). The fleet default is
deliberately a no-op on a single node:

> `CELLD_DURABILITY` selects this behavior and defaults to `fleet`:
> the node serving the cell sends the write to one or two other nodes and
> answers once they hold it on disk, or once the bucket upload finishes,
> whichever comes first. This needs two or more nodes; a single node has
> nobody to send to, so every write waits for the bucket. Set `bucket` to
> always wait for the bucket.

(repo://docs/README.md#L688-L690)

The ensemble bookkeeping lives in the decision core
(`crates/logic/log_tier.rs`) with follower-recruitment, reconfiguration,
recovery, and takeover gates proposers/reconcilers, and the executor
(`crates/celld/node_log.rs`) drives actual transport and storage
(repo://crates/celld/node_log.rs#L1-L11). Follower failure degrades the
node to bucket-proof acks until a re-recruitment CASes a fresh ensemble;
recovery gathers from every reachable *sealed* member and requires at least
one (repo://crates/celld/node_log.rs#L19-L22).

## Fenced-mode bundle tiering

Every per-cell LTX tiering upload is batched at the node level:

> Bundle the paced tiering: one PUT per node-flush instead of one per
> cell-transaction — the Class A collapse, measured at 208x against
> per-transaction PUTs. On by default; 0 is the opt-out.

(repo://crates/celld/main.rs#L3740-L3744)

The bundle upload path is unchanged from a plain bucket upload and remains
the tiering mechanism, so node-log recovery recreates exactly the objects
the dead leader would have uploaded and every per-cell restore/compaction
mechanism stays byte-for-byte as-is
(repo://crates/celld/node_log.rs#L9-L14). `CELLD_LOG_BUNDLE=0` opts out of
the put-collapse; `CELLD_LOG_PIPELINE` bounds in-flight log rounds
(repo://docs/README.md#L691-L693).

## Takeover recovery: `RecoverNodeLog`

When an activation of a cell finds its prior owner's node-log record open
or recovering, plain restore cannot yet proceed: the dead owner's
acknowledged tail may exist only on its followers. The decision core has
the interlock as a policy:

> The takeover interlock, as a core decision: the dead owner's folded log
> state was not sealed, so its acked tail may exist only on its followers.
> The executor recovers every non-sealed session of `owner` into the
> bucket and reports `NodeLogRecovered`; only then does the claim proceed.

(repo://crates/logic/types.rs#L769-L776)

The executor path gathers retained segments and bundles from reachable
sealed members, uploads them into the per-cell prefixes, then marks the
record sealed. A cold activation checks the prior owner's node-log records
before it reads the bucket, so restoration only starts after this sequence
completes (repo://docs/guarantees.md#L158-L175).

## Restore

Activation restores `RestoreSpec`-identified epochs. The decision core
chooses whether the local replica may be reused (`resume_local`) or if the
remote replica is authoritative; the executor then restores an LTX snapshot
to `<watch>/<cell>/ltx/e<epoch>/db.sqlite` and starts a runtime at the same
epoch. Restore is ordinary work, not emergency work, and placement handles
it as part of normal traffic (repo://docs/guarantees.md#L218-L223).

## Compute essentials of LTX

- **L0 compaction**: cumulative segments are periodically compacted into
  additively-named L1 objects so a takeover reads dozens of objects instead
  of thousands; `CELLD_LTX_COMPACTION` (default 1) and
  `CELLD_LTX_COMPACTION_MIN_TXIDS` tune when an L1 attempt queues
  (repo://docs/README.md#L692-L698).
- **WAL truncate**: `CELLD_LTX_TRUNCATE_PAGES` caps the WAL the next
  checkpoint reads (default 128 pages = 512 KiB cap) and is disabled with 0
  (repo://docs/README.md#L695-L696).
- **Durability timeout**: `CELLD_LTX_DURABILITY_TIMEOUT_SECS` defaults to
  10 seconds for a proof retry window (repo://docs/README.md#L698-L698).

## Fault testing

The LTX fault-injection oracle (Dockerfile test stage) injects replica
faults and compares databases with the `sqlite3` CLI; this is how capture
and restore edge cases are exercised inside CI rather than only on a live
fleet (repo://Dockerfile#L31-L45).
