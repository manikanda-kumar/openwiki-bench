---
type: system
title: "Ownership, leases, and fencing"
description: "How celld guarantees exactly one writer per cell through bucket conditional writes, node leases, expiry-driven self-fencing, and dead-node reconciliation."
tags: [ownership, fencing, leases, cas, consistency]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-9956f428da052d89a6fb042f
    resource: repo://crates/celld/dead_node_gc.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-3777add599c1e5db92332f60
    resource: repo://crates/logic/dead_node_reconciliation.rs
  - id: openwiki-source-c6c8c55af3ba6827f33bf834
    resource: repo://crates/logic/gate.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-edfb954b706fa7744e175849
    resource: repo://crates/logic/peer.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Ownership, leases, and fencing

celld promises exactly one server per cell, and makes that promise rest on
object storage rather than on a membership protocol. From
[docs/guarantees.md](../docs/guarantees.md): "no membership protocol, no
failure detector, no consensus service. … A conditional bucket write gives a
node the ownership of a cell, so exactly one node owns a cell at a time"
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
([README](README.md), "How it works").

## What the object store must provide

[docs/guarantees.md](../docs/guarantees.md) requires three properties:

- "A conditional create: the write must fail when the object exists."
- "A conditional overwrite: the write must fail when the object changed
  after the read."
- "Read-after-write consistency: a read after a successful write must
  return that write." (`docs/guarantees.md:19-24`)

"On a store without them, two nodes can own one cell. A store can also
accept the conditional headers and ignore the condition, and that store
fails late and silently" (`docs/guarantees.md:31-35`). **The storage
test** (`celld diagnose`) sends four conditional writes — create,
reject-create, update, reject-stale — and "Two of the four writes must fail.
A store that accepts either one cannot fence a cell" (`docs/guarantees.md:59-70`).
Every node repeats the probe at startup (set by `CELLD_STORAGE_PROBE`,
default on; `crates/celld/main/cli.rs:166-168`) and stops on a broken store.

## Where the decision lives vs where the IO lives

- **Decision side** (`crates/logic`): the core owns acquisition semantics as
  `Effect::CasOwner` / `CasGuard` / `CasOutcome` and lease CAS with
  `LeaseCasOutcome` (`crates/logic/types.rs:748-792`); ambiguous acquires are
  re-read, bounded by `MAX_ACQUIRE_RECONCILES = 3`
  (`crates/logic/lib.rs:104-110`). The peer predicates are
  security-fence pure functions: identity charset (≤128 bytes, alphanumerics
  + `_ - .`), a **two-sided** clock window (`abs_diff`, "a check that
  accepted arbitrarily old timestamps would let a captured signature replay
  forever"), and replay retention ≥ clock window
  (`crates/logic/peer.rs:9-31`).
- **Adapter side** (`crates/celld/ownership_store.rs`): "serialization,
  wall-clock sampling, SDK configuration and error classification only.
  Ownership decisions remain in `celld-logic`" (module doc, lines 5-8). It
  carries lease TTL, the folded log state in its own lease record, and the
  full etag chain of applied writes of its lease record
  (`ownership_store.rs:149-185`), and it classifies `put_cas` rejections
  (clean 412/409 → definite not-applied, everything else ambiguous,
  `crates/celld/bucket.rs:16-21`).
- **CAS dialects** (`crates/celld/bucket.rs`, the two-dialect surface): S3/Azure
  etag tokens via If-Match/If-None-Match, GCS generation tokens — because
  "GCS accepts S3-style requests on the same host but does not apply If-Match
  to a PUT, so only the generation dialect can fence there"
  (`bucket.rs:8-15`).

## The lease and self-fencing

Each node holds a **node lease** in the bucket. "The lease carries an
expiry, and the node renews it after one third of the lifetime
(`CELLD_TTL_MS`, default 10000 ms)" — and "A renewal that does not reach the
bucket does not fence the node", because the node retries while the
published expiry has not passed (`docs/guarantees.md:204-209`). Renewal runs
through the actor's event loop; that is *why* the single-actor shape exists —
"monotonic lease ticks [must] fence the node even when a storage operation
remains hung" (`crates/celld/main.rs:9-12`), and the first lease TTL is
anchored to the monotonic boot instant (`crates/logic/types.rs:404-410`).

When the published expiry passes — "a node that cannot reach the bucket
cannot renew and cannot replicate, so it must not own cells" — the node
**self-fences**: it stops each active cell, fails every uncompleted request,
fences at once if another writer replaced its lease record, writes nothing
to the bucket, logs `SELF-FENCE: <cause>` and exits with code 3. The state
is terminal; only a restart re-enters the fleet (`docs/guarantees.md:210-228`).
Routing already protects callers because every request is compared against
the published expiry (`docs/guarantees.md:223-226`).

Peer-side, "Every peer already reads the lease as dead or replaced, so a
peer can acquire the cells through the ownership records" and a takeover
must run the recovery interlock for unsealed dead-owner logs first
(`crates/logic/types.rs:769-778`), covered on the durability page.

## Input fencing within a cell

Concurrency inside a cell is gated by the input gate
(`crates/logic/gate.rs`): "while the gate is held, **no incoming event of any
kind is delivered** to that cell except the event holding it" — the workerd
rule (`io-gate.h`), reimplemented. "What holds it here is not storage": in
celld "every storage path is local SQLite underneath", so the gate holds
around explicit interrupt-unsafe spans rather than around KV reads
(`crates/logic/gate.rs:5-22`).

## Dead-node reconciliation and GC

- Takeover of a dead node's cells is a core decision (`Effect::CasOwner`
  with `takeover`, `ReadCapacityPeers` for capacity-aware landing;
  `crates/logic/types.rs:779-792`).
- `crates/logic/dead_node_reconciliation.rs` is the sans-IO decision side for
  retiring compatibility `node-cells/` debris left in fleet buckets shared
  with older celld generations; "Once a node session is dead, every
  generation below its prefix is debris; matching only the [final
  generation] would … permanently strand overlapping older generations after
  a same-ID restart" (`dead_node_reconciliation.rs:25-31`). Retry delay is a
  saturated doubling backoff so "a damaged store [cannot] turn reconciliation
  into a tight retry loop" (`dead_node_reconciliation.rs:10-17`).
- `crates/celld/dead_node_gc.rs` is its executor: "Wake entries and lazy
  ownership takeover provide serving correctness. This adapter retires the
  historical `node-cells/` index debris and expired node-session records"
  (`dead_node_gc.rs:3-6`), with bounded concurrency
  (`MARKER_GC_CONCURRENCY = 64`).

## Operator consequence

Bucket credentials between nodes are the fleet's root of trust: "Treat access
to the bucket and its credentials as fleet administrator access"
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
([README](README.md)). Two fleets sharing one bucket are separated only by
key prefixes, which is why `ltx_repl.rs` insists "it carries the fleet's key
prefix itself: without that, two fleets sharing one bucket would replicate
over each other" (`crates/celld/ltx_repl.rs:10-13`).
