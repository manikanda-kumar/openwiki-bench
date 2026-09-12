---
type: storage-contract
title: The bucket object contract
description: The JSON and LTX objects celld keeps in the fleet bucket, their key schemes, conditional ownership semantics, and the reserved key prefixes.
tags: [storage, object-store, ownership, protocol, cas]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-9956f428da052d89a6fb042f
    resource: repo://crates/celld/dead_node_gc.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-2f36a204fbf1f86adbe0d189
    resource: repo://crates/celld/wake.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# The bucket object contract

A celld fleet keeps all durable coordination and long-term data in one object
store bucket that the operator owns. The objects on that bucket are the
interface between independent nodes — there is no control plane to otherwise
consult — so the key layout and the JSON shapes are a de facto wire contract
between concurrently running node versions and between deployment tools and
the daemon. This page maps that layout. The conditional-write mechanics per
<!-- openwiki: broken internal link [/integration/object-stores.md] file "/integration/object-stores.md" does not exist. Fix the href or restore the target, then delete this comment. -->
provider live in [Object store integrations](/integration/object-stores.md);
what the records mean for correctness lives in
<!-- openwiki: broken internal link [/flows/ownership-and-leasing.md] file "/flows/ownership-and-leasing.md" does not exist. Fix the href or restore the target, then delete this comment. -->
[Ownership, leases, and fencing](/flows/ownership-and-leasing.md).

## Reserved key prefixes

The fleet bucket is shared between celld's own objects and, potentially, the
application's R2/KV backing storage — not its R2 bindings, which live in the
managed store, but the bucket is a place operators look. For that reason the
documentation names the reserved prefixes explicitly:

> celld reserves `probe/` together with `cells/`, `nodes/`, `node-cells/`,
> `fleet/`, `deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/`, and it
> deletes objects under some of them, so an application must not write under
> any of these prefixes.

(repo://docs/guarantees.md#L74-L81)

`node-cells/` is deprecated: the compatibility GC
(`crates/celld/dead_node_gc.rs`) retires leftover `node-cells/` markers and
expired node-session records from buckets shared with older celld
generations (repo://crates/celld/dead_node_gc.rs#L5-L8).

## Ownership records: `cells/<cell>/own.json`

Each cell with a known owner has one small JSON record at
`cells/<cell>/own.json` (repo://crates/celld/ownership_store.rs#L289-L295).
Its body is two fields, written as `{"node": "...", "epoch": N}`
(repo://crates/celld/ownership_store.rs#L20-L24). The owner record is created
and mutated only through conditional writes: an acquire is a
create-if-absent or a compare-and-swap against the previous record, so the
bucket, not a clock or a membership protocol, decides which of two contending
nodes wins (repo://docs/guarantees.md#L110-L120).

The record's serialized node value is also the release convention: an empty
`node` string deserializes as an ownerless record
(repo://crates/celld/ownership_store.rs#L287-L294, mapping `""` to `None`),
so an evicting node publishes the cell as unowned by rewriting the record's
node field rather than deleting it.

## Node lease records: `nodes/<node>.json`

Each live node session holds a lease record at
`nodes/<node>.json` (repo://crates/celld/ownership_store.rs#L350-L352). Its
wire body carries more than a timestamp — it is the fleet's shared address
book and carries folded coordinators inside:

- `node`, `expires_ms` — identity and the published lease expiry that peers
  read before routing a request (repo://crates/celld/ownership_store.rs#L27-L55).
- `addr` — the advertised internal address other nodes POST to.
- `peer_probe` public key — the signed probe challenge key.
- `peer_protocol` — the negotiated wire version (`5` today).
- `ownership_index_generation` — a process-generation marker.
- `log` — the folded node-log tier state (`open`/`recovering`/`sealed`,
  epoch, ensemble, tiered offset) used by takeover recovery
  (repo://crates/celld/ownership_store.rs#L47-L57,
  repo://crates/celld/ownership_store.rs#L59-L72).
- `load` — the advisory resident-cell/WebSocket/RSS sample that `diagnose`
  and capacity-aware placement consume.

The lease is consolidated: repairing a dead follower's log state can be done
by CAS-ing this one record because the log state travels inside it
(repo://crates/celld/dead_node_gc.rs#L27-L36).

## Replicated data: `cells/<cell>/ltx/e<epoch>/`

A cell's SQLite data is replicated as LTX segments under an epoch-prefixed
key, `cells/<cell>/ltx/e<epoch>/`, mirroring the local
`<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree
(repo://crates/celld/ltx_repl.rs#L11-L12). Writes into this prefix are plain
unconditional PUTs; the fence is the epoch in the key — a stale owner that
lost its CAS keeps writing, but into a superseded prefix that no restore
selects (repo://docs/guarantees.md#L122-L130). Restore reads the newest
epoch prefix containing LTX data and replays the full contiguous chain from
transaction zero (repo://docs/guarantees.md#L205-L214).

## Deploys: `deploy/`, `deploy-blobs/`

- `deploy/<script>/<version>/manifest.json` is the normalized deployment
  manifest a node reads to know what to run. Its typed Rust shape
  (`protocol::Manifest`) covers the module list, Durable Object classes,
  SQLite-backed classes, asset manifest, cron expressions, and queue
  consumers; these objects are the contract, nothing else is exchanged
  (repo://crates/celld/protocol.rs#L7-L44).
- `deploy/current.json` is the fleet-wide pointer a node reads on startup;
  changing it *is* the deploy, and nodes converge on it
  (repo://crates/celld/protocol.rs#L402-L412). The constant lives in
  `fleet::CURRENT_POINTER_KEY` (repo://crates/celld/fleet.rs#L628-L628).
  Each script also has a named pointer `deploy/<script>/current.json`
  (repo://crates/celld/deploy.rs#L615-L615) for sub-fleet rollouts.
- Immutable asset and module bodies land under content-addressed keys such
  as `deploy-blobs/assets/sha256/<xx>/<sha256>`, with the digest validated
  by receivers (repo://crates/celld/protocol.rs#L383-L393).
- Queue consumer state has its own slot,
  `deploy/queues/<queue>/consumer.json`
  (repo://crates/celld/protocol.rs#L124-L146).

## Alarm wake hints: `wake/`

Alarms survive detachment through wake-hint objects at
`wake/<YYYY-MM-DDTHH:MM>/<cell>`; a periodic waker scans, lists, and filters
the whole `wake/` prefix by due time (repo://crates/celld/wake.rs#L6-L10,
repo://crates/celld/wake.rs#L37-L45). A singleton `wake/waker.json` election
key prevents several nodes from scanning redundantly
(repo://crates/celld/wake.rs#L73-L76). Hint entries are deleted once the
alarm settles, which is why the prefix is one celld also prunes.

## Telemetry: `telemetry/`

The default telemetry sink writes Parquet triples under
`telemetry/traces` and `telemetry/logs`
(repo://crates/celld/telemetry.rs#L32-L33), with retention pruning by object
age.

## Fleet shared secret

`fleet/peer-auth.json` stores the fleet HMAC secret created by the first
current node (a `fleet/` prefix object rather than the manifest surface)
(repo://crates/celld/peer_auth.rs#L20-L22).

## Storage probe writes

The startup conditional-write qualification writes one tiny, never-read
object under `probe/` (repo://crates/celld/bucket.rs#L1378-L1420) — a clean
crash mid-test can leave it behind, which is harmless.

## CAS tokens as the dialect-neutral fence

All conditional coordination funnels through one client surface,
`crates/celld/bucket.rs`, which binds the provider-specific conditional-write
dialects into a single opaque contract:

> Callers never see the difference: the token is an opaque `String` a read
> answers and a conditional write consumes.

(repo://crates/celld/bucket.rs#L13-L23)

A read returns a CAS token whose concrete content depends on the dialect —
the etag under S3/Azure, the object generation under GCS — and every
subsequent conditional write consumes exactly that token. The error contract
is deliberately narrow: a clean 412/409 rejection answers `Ok(None)`, while
any ambiguous failure surfaces as `Err`, because ambiguous results cannot be
trusted as failure by the fencing logic above
(repo://crates/celld/bucket.rs#L22-L27).
