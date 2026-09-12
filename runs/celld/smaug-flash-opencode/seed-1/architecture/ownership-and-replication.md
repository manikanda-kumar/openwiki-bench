---
type: architecture
title: Ownership, Leases, and Replication
description: How celld nodes claim cells via conditional bucket writes, hold self-node leases, self-fence, pick a follower ensemble, replicate LTX data, and prove a write durable through fleet verses bucket proofs.
tags: [architecture, ownership, leases, replication, durability, fencing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-93e5bac71854233e4df4d7a1
    resource: repo://crates/celld/replication.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Ownership, Leases, and Replication

This page is how celld keeps its two promises: exactly one node serves a cell
at a time, and no acknowledged write is lost (RPO=0). The authoritative
narrative is `docs/guarantees.md`; this page grounds each mechanism in the
executing code in `crates/celld` and the lease-fold logic in `crates/logic`.

## The object store contract

celld needs three properties from the bucket: a conditional create (the write
fails when the object exists), a conditional overwrite (the write fails when
the object changed after the read), and read-after-write consistency. The
qualified stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage,
and Azure Blob Storage (`docs/guarantees.md:18-58`). The request dialect differs
per provider: an S3-compatible bucket uses `If-None-Match: *` and `If-Match`
etag headers, a `gs://` bucket selects the Cloud Storage XML API with the
`x-goog-if-generation-match` precondition and OAuth credentials, and an `az://`
bucket uses the same `If-` headers with Put Blob.

Each node re-runs a storage probe at startup that sends four conditional writes
and requires two of them to fail; a store that accepts either one cannot fence a
cell, so the node stops. The test can be disabled with `CELLD_STORAGE_PROBE=0`
(`docs/guarantees.md:59-83`). celld reserves the `probe/`, `cells/`, `nodes/`,
`node-cells/`, `fleet/`, `deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/`
prefixes.

## The ownership record and epoch fence

Each cell has one ownership record. `OwnerRecord` (`crates/logic/types.rs:139`)
carries the owner node option, a fencing epoch, and an etag; a `None` node is a
deliberately released, fenced record, and epochs never reset. A node acquires a
cell with a conditional write — a create when no record exists, a
compare-and-swap on the previous record when one does — and the bucket accepts
exactly one such write, so two nodes cannot acquire the same cell. Every
activation advances the epoch, so an epoch never has two writers
(`docs/guarantees.md:109-127`).

The effect adapter that performs these writes is `BucketOwnership`
(`crates/celld/ownership_store.rs:147`), which deliberately contains
serialization, wall-clock sampling, SDK configuration, and error
classification only; ownership decisions remain in `celld-logic`. Ownership
resolution, capacity, and the claim are decided by the decision core and the
adapter just executes the conditional write and reports the CAS outcome.

The data-path fence is the epoch inside the object key. The local cell db lives
at `<watch>/<cell>/ltx/e<epoch>/db.sqlite` and replicates to
`cells/<cell>/ltx/e<epoch>/` in the bucket; a stale owner that lost ownership
can keep writing but its writes land in a superseded prefix
(`crates/celld/replication.rs:3-7`, `crates/celld/ltx_repl.rs:11-15`).

## Self-node leases and fencing

Each node holds a lease in the bucket under `nodes/<node>.json`
(`NNodeLeaseWire`, `crates/celld/ownership_store.rs:32`), carrying the node,
expiry, address, peer protocol, generation, the folded node-log state, and the
published load record. A node renews its lease after one third of the lifetime
(`CELLD_TTL_MS`, default 10000 ms), and a renewal that does not reach the bucket
does not fence the node because it retries while the published expiry has not
passed (`docs/guarantees.md:200-205`).

The authority question is evaluated in the decision core, not the adapter:
`State::node_authoritative` (`crates/logic/lib.rs:723`) compares the remembered
monotonic clock against the record's `expires_ms`. A node that cannot reach the
bucket cannot renew or replicate, so when its published expiry passes it fences
itself: it stops each active cell and fails every request it has not completed.
A node whose lease record another writer replaced or removed fences at once,
because that record proves the authority moved. The fence writes nothing to the
bucket; every peer already reads the lease as dead or replaced, so a peer can
acquire the cells through the ownership records. A fenced node logs a line that
starts with `SELF-FENCE:` and stops with exit code 3; the fenced state is
terminal and only a restart returns the node to the fleet
(`docs/guarantees.md:207-228`).

## The acknowledgement rule (RPO=0) and the output gate

celld does not answer a write until a durability proof covers it. The proof is
enforced by the output gate in the decision core (`crates/logic/output_gate.rs`),
which withholds every output that can reveal a cell's state until the cell's
committed position is proven replicated (`Effect::AwaitDurable`).

There are two proof sources (`ProofSource`, `crates/logic/types.rs:375`):

- **Bucket proof.** The owner uploads the write's LTX data to the bucket, then
  reads the ownership record once and acknowledges only if the record still
  names this node at this epoch (`Effect::VerifyOwnership`,
  `crates/logic/output_gate.rs:190-196`). A partitioned node can commit locally
  and replicate into its superseded prefix, but the ownership read then shows
  the new owner, so celld does not acknowledge the write
  (`docs/guarantees.md:133-146`).
- **Fleet proof.** The owner sends each write to one or two other nodes, which
  hold a copy of its recent writes; those nodes are its followers, and the set
  of them is the ensemble. Every follower must fsync the write, and a takeover
  seals the prior node-log session before it restores, so a stale owner cannot
  complete another fleet proof. A fleet proof needs no ownership read because
  the ensemble arbitrated it.

A node picks its followers from the other nodes in the fleet and never counts
itself, so a fleet of two nodes is the minimum before any node can complete a
fleet proof. A single node stays correct but acknowledges each write on a
bucket proof, which is slower. `CELLD_DURABILITY=fleet` is the default, so a
fleet of one node requests the fleet posture and does not get it
(`docs/guarantees.md:151-167`).

## The in-fleet replicated log tier (node log)

The fleet path is implemented by `crates/celld/node_log.rs`, which streams each
cell's captured-but-not-yet-uploaded L0 LTX segments to a small follower
ensemble over the signed peer transport. A write acknowledges when every member
holds its segment on disk — write-all, ack-all — or when the ordinary bucket
upload proves it first, whichever wins (`crates/celld/node_log.rs:3-12`). The
`log/<node>.json` record is the CAS-guarded root of truth for the ensemble and
the log epoch; it is created before the node's first fleet-durable ack and never
deleted, so a takeover that finds no record may treat the bucket as complete.

The decisions are `celld_logic::log_tier`; the node-log module is their executor
(`crates/celld/node_log.rs:13-18`). v0 limits are deliberate: entries travel as
base64 JSON, a follower failure degrades the node to bucket-proof acks until a
periodic re-recruit CASes a fresh ensemble, and recovery gathers from every
reachable sealed member and requires at least one (`crates/celld/node_log.rs:20-23`).

## The takeover recovery gate (lease-fold)

A cold activation checks the prior owner's log records before it reads the
bucket (`Effect::RecoverNodeLog`, `crates/logic/types.rs:774`) for a
non-sealed open session. An absent record proves the session never acknowledged
past the bucket, and a sealed record proves recovery completed. An open or
recovering record makes the activation run recovery: it fences the record with a
compare-and-swap, seals the reachable followers, uploads their retained segments
and bundles into the per-cell prefixes, and then marks the record sealed. The
activation cannot restore until this sequence completes
(`docs/guarantees.md:169-184`). The decision to run the takeover interlock is a
core decision carried on the node lease record's `log_state`
(`crates/logic/types.rs:159-162`).

## Restore

A restore selects the newest epoch prefix that contains LTX data and reads the
full contiguous chain from transaction zero; celld no longer writes an epoch
seal object. A fenced node can append an unacknowledged tail to an older prefix,
and a later restore can expose that tail without violating the contract, because
a failed acknowledgement does not prove the write is absent
(`docs/guarantees.md:185-198`). The restore work runs against the `celld-ltx`
library through `crates/celld/ltx_repl.rs`, capped by
`RESTORE_DOWNLOAD_CONCURRENCY`.

## Peer transport and the follower ensemble

Peer-control and reserved-cell operator requests run over the internal listener
and are signed with the fleet HMAC. `PeerAuth` (`crates/celld/peer_auth.rs:60`)
binds each body with a canonical request signature, a clock window of 30s, and a
replay cache of one million entries, so a request carries both a clock limit and
replay protection. Cell fetch and cell-RPC requests carry a protocol version and
depend on the trusted private network. The security implications are covered on
the [security model](../security.md) page.
