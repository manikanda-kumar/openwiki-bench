---
type: concept
title: Durability, fencing, and leases
description: celld keeps two promises — one owner per cell and RPO=0 acknowledgement — using bucket conditional writes for ownership, fencing epochs stamped into replication prefixes, an output gate that proves durability (bucket read-back or fleet node-log ensemble) before any egress, and lease-expiry self-fencing.
tags: [durability, fencing, ownership, output-gate, node-log, lease, rpo-zero]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-93e5bac71854233e4df4d7a1
    resource: repo://crates/celld/replication.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Durability, fencing, and leases

The promises, verbatim from the operator docs: "Exactly one node serves a
cell at a time, so two machines never write the same database. And celld does
not answer a write until that write survives a failure, so nothing you were
told succeeded is lost" ([docs/guarantees.md#L3-L6](repo://docs/guarantees.md#L3-L6)).
Both claims rest on the object store. This page walks each mechanism and names
the code that enforces it; the cell-side flow is on
[cell lifecycle](cell-lifecycle.md) and the file mechanics on
[the ltx engine](../persistence/ltx-engine.md).

## What the bucket must provide

celld needs conditional create, conditional overwrite, and read-after-write
consistency; qualified stores are Amazon S3, Cloudflare R2, Tigris, Google
Cloud Storage, and Azure Blob Storage, and stores without real conditional
writes (Backblaze B2, Hetzner, DigitalOcean Spaces) can end up with two
owners of one cell ([docs/guarantees.md#L18-L41](repo://docs/guarantees.md#L18-L41)).
Because a store can accept a precondition header and ignore it, celld asks
the store directly: `Bucket::probe_cas_steps` provokes the two rejections a
conforming store must produce against a unique `probe/cas-…` object, and the
verdicts separate a store `Violation` (never clears; may stop a node) from an
ambiguous transport error (may be retried past)
([crates/celld/bucket.rs#L1355-L1400](repo://crates/celld/bucket.rs#L1355-L1400)).
Every node runs this once at startup before serving, skippable only via
`CELLD_STORAGE_PROBE=0` ([crates/celld/main.rs#L3299-L3305](repo://crates/celld/main.rs#L3299-L3305),
[crates/celld/fleet.rs#L282-L295](repo://crates/celld/fleet.rs#L282-L295)).

The client contract that the fence depends on is explicit: `put_cas` answers
`Ok(None)` only for a clean 412/409 rejection; every other failure is
ambiguous — the write may have committed — and a response with no CAS token is
an error, never an empty token a later conditional write would trust
([crates/celld/bucket.rs#L20-L24](repo://crates/celld/bucket.rs#L20-L24)).
Three dialects share the opaque-token surface: S3 etag `If-Match`/
`If-None-Match`, Azure Put Blob honoring the same headers, and GCS XML
`x-goog-if-generation-match` — the dialect, not the endpoint, is what fences
([crates/celld/bucket.rs#L8-L19](repo://crates/celld/bucket.rs#L8-L19)).

## The ownership record and the fencing epoch

Each cell owns one bucket record, `cells/<cell>/own.json`, whose body is just
`{node, epoch}` — and `node: None` is a deliberately released, fenced record
whose epoch is *never reset*
([crates/celld/ownership_store.rs#L17-L24](repo://crates/celld/ownership_store.rs#L17-L24),
[crates/celld/ownership_store.rs#L289](repo://crates/celld/ownership_store.rs#L289),
[crates/logic/types.rs#L139-L144](repo://crates/logic/types.rs#L139-L144)).
Acquisition is a conditional write — create when absent, compare-and-swap on
the read etag otherwise — so the bucket accepts at most one winner
([docs/guarantees.md#L110-L115](repo://docs/guarantees.md#L110-L115)). Every
activation advances the epoch: even re-claiming your own released record takes
`record.epoch + 1` ([crates/logic/lib.rs#L3227-L3244](repo://crates/logic/lib.rs#L3227-L3244)).
An ambiguous CAS answer is reconciled at most three times before the request
fails ([crates/logic/lib.rs#L92-L96](repo://crates/logic/lib.rs#L92-L96)).

The epoch is also the data-path fence: a cell's SQLite replica ships to
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs, so a stale owner
"writes only into a superseded prefix" — the module header calls this out
directly ([crates/celld/replication.rs#L1-L8](repo://crates/celld/replication.rs#L1-L8)).

## The output gate: the acknowledgement rule

Nothing that reveals cell state leaves the process while a write is unproven;
a response is held at the gate and released only by a proven durability op
([crates/logic/output_gate.rs#L5-L17](repo://crates/logic/output_gate.rs#L5-L17)).
A local write opens its own barrier and emits `Effect::AwaitDurable { cell,
epoch, position }`; a read-only output trails the newest open barrier on its
cell, because "a reader can start after a write commits and before its proof
lands" ([crates/logic/output_gate.rs#L78-L90](repo://crates/logic/output_gate.rs#L78-L90),
[crates/logic/output_gate.rs#L142-L160](repo://crates/logic/output_gate.rs#L142-L160)).
If the request is no longer a live activity on a Resident cell at the writing
epoch, the output fails `DurabilityUnproven` rather than falsely acknowledging
([crates/logic/output_gate.rs#L102-L118](repo://crates/logic/output_gate.rs#L102-L118)).
The shell holds every gated response — including per-WebSocket write barriers
so a client never sees a frame trailing an unproven write — and releases only
on the core's `Release` ([crates/celld/actor.rs#L1752-L1762](repo://crates/celld/actor.rs#L1752-L1762)).
`CELLD_OUTPUT_GATE=0` makes the shell skip the gate entirely, accepting the
documented loss risk ([crates/logic/output_gate.rs#L25](repo://crates/logic/output_gate.rs#L25),
[crates/celld/actor.rs#L1151-L1155](repo://crates/celld/actor.rs#L1151-L1155)).

When `DurableReached` arrives, the proof source decides what else is needed:

- **Bucket proof** — `durable >= position` is *not* enough; the core emits
  `Effect::VerifyOwnership`, a single **read** of the ownership record. The
  shell's comment gives the linearization argument: if the record still names
  us, no takeover linearised before this read, the LTX went up before it, so
  any later takeover restores a lineage containing the write
  ([crates/logic/output_gate.rs#L184-L195](repo://crates/logic/output_gate.rs#L184-L195),
  [crates/celld/actor.rs#L3458-L3468](repo://crates/celld/actor.rs#L3458-L3468)).
  A record that no longer names this node at this epoch fails the write like
  an unproven one — "refuse and reset, never acknowledge into an orphaned
  lineage" ([crates/logic/output_gate.rs#L198-L212](repo://crates/logic/output_gate.rs#L198-L212)).
- **Fleet proof** — settles without the read: the ensemble arbitrated it, and
  a takeover seals a member before restoring, so a stale owner's ack-all
  fails closed ([crates/logic/output_gate.rs#L184-L189](repo://crates/logic/output_gate.rs#L184-L189)).

## The fleet ensemble and the node log

`CELLD_DURABILITY` defaults to `fleet` ([crates/celld/main.rs#L3721-L3726](repo://crates/celld/main.rs#L3721-L3726)).
The tier streams each node's not-yet-uploaded L0 LTX segments to one or two
follower nodes over the signed peer transport; a write is fleet-durable when
*every* member holds it on disk — write-all, ack-all — or when the ordinary
bucket upload proves first, whichever wins, and the bucket path stays the
tiering mechanism so recovery re-creates exactly the objects the dead leader
would have uploaded ([crates/celld/node_log.rs#L3-L12](repo://crates/celld/node_log.rs#L3-L12)).
Recruiting targets three copies with two followers and keeps acknowledging
while one member remains
([crates/celld/node_log.rs#L3940](repo://crates/celld/node_log.rs#L3940),
[crates/celld/node_log.rs#L4043](repo://crates/celld/node_log.rs#L4043));
a follower failure degrades the node to bucket-proof acks until a periodic
re-recruit CASes a fresh ensemble ([crates/celld/node_log.rs#L20-L22](repo://crates/celld/node_log.rs#L20-L22)).
Followers fsync persisted append batches rather than one fsync per entry
([crates/celld/node_log.rs#L1095-L1105](repo://crates/celld/node_log.rs#L1095-L1105)).
Slow appends can be hedged with a second copy — idempotent per sequence —
defaulting to an adaptive wait derived from the ensemble's slowest recent
append (`CELLD_LOG_HEDGE_MS` overrides; `0` disables)
([crates/celld/node_log.rs#L1710-L1714](repo://crates/celld/node_log.rs#L1710-L1714),
[docs/README.md#L694](repo://docs/README.md#L694)), and sustained stragglers
are evicted by the gray-follower policy in `celld_logic::log_evict`
([crates/logic/log_evict.rs#L3-L8](repo://crates/logic/log_evict.rs#L3-L8),
[crates/celld/node_log.rs#L208-L210](repo://crates/celld/node_log.rs#L208-L210)).

The membership record was **folded into the node lease**: `nodes/<node>.json`
carries a `log` object (`state: open|recovering|sealed`, `epoch`,
`ensemble`, `tiered`, `active`), and a session's identity is the record's
generation — a replaced record is a recovered-then-superseded session, and
absence keeps meaning "complete"
([crates/celld/node_log.rs#L235-L246](repo://crates/celld/node_log.rs#L235-L246),
[crates/celld/ownership_store.rs#L46-L64](repo://crates/celld/ownership_store.rs#L46-L64)).
A live session writes only through the core's lease chain — one writer per
process — while recovery writes dead sessions' fields by CASing the full wire
record, extending nothing, so it "can only fence, never revive"
([crates/celld/node_log.rs#L241-L246](repo://crates/celld/node_log.rs#L241-L246),
[crates/celld/node_log.rs#L314-L318](repo://crates/celld/node_log.rs#L314-L318)).
Segment data waiting for upload rides under `log/<session>/bundle/e<epoch>-<seq>.ltxb`
([crates/celld/node_log.rs#L4716-L4755](repo://crates/celld/node_log.rs#L4716-L4755)).

## The takeover recovery gate

Because fleet mode can acknowledge before the bucket upload lands, a cold
activation consults the *prior owner's* folded log state before reading the
bucket. The pure rule: no record, or a sealed record → `BucketComplete`;
anything else (open, recovering, or superseded-session reads) →
`RecoverFirst` — the `RecoveringOwnerLog` phase from
[cell lifecycle](cell-lifecycle.md) ([log_tier::takeover_gate](repo://crates/logic/log_tier.rs#L208-L217),
[crates/logic/lib.rs#L124-L130](repo://crates/logic/lib.rs#L124-L130)).
Recovery then: refuses if the dead lease went live again, CASes `open →
recovering`, seals the reachable followers (a sealed member is refused forever
after, even across restarts), uploads retained segments and bundles into the
per-cell prefixes, and CASes to `sealed` with a certified tiered offset — and
"every recovery step is a CAS or an idempotent upload; a lost CAS re-reads and
converges on the rival's outcome"
([crates/celld/node_log.rs#L3489-L3535](repo://crates/celld/node_log.rs#L3489-L3535),
[crates/celld/node_log.rs#L3730-L3760](repo://crates/celld/node_log.rs#L3730-L3760)).
Recovery is single-flight per process per dead session
([crates/celld/node_log.rs#L2681-L2688](repo://crates/celld/node_log.rs#L2681-L2688));
the cross-process "wait or replace after 30 seconds" behavior is documented in
[docs/README.md#L497-L503](repo://docs/README.md#L497-L503). A recovery store
error leaves the session unsealed so a later recovery re-reads every retained
bundle — the gate fails closed.

## Full-prefix restore, seal-free

A restore selects the newest epoch prefix under `cells/<cell>/ltx/` that holds
any LTX data and replays the **full contiguous chain from transaction zero**;
the epoch seal object that once capped this read was deleted, and a legacy
`e<epoch>.seal.json` does not limit the chain
([crates/celld/ltx_repl.rs#L1195](repo://crates/celld/ltx_repl.rs#L1195),
[crates/celld/ltx_repl.rs#L1309-L1312](repo://crates/celld/ltx_repl.rs#L1309-L1312),
[docs/guarantees.md#L186-L198](repo://docs/guarantees.md#L186-L198)).
Reading the whole chain matters because node-log recovery or a bundle drain
can append an acknowledged tail *after* an earlier restore; stopping at the
older cut would hide that tail and lose acknowledged data. Conversely, a
fenced node's unacknowledged tail can also appear — which does not violate the
contract, "because a failed or absent acknowledgement does not prove that the
write is absent" ([docs/guarantees.md#L192-L198](repo://docs/guarantees.md#L192-L198)).

## The node lease and self-fencing

Each node publishes `nodes/<node>.json` — address, peer protocol, per-process
generation, load sample, folded log state, and an `expires_ms` — and renews it
at one third of the TTL (`CELLD_TTL_MS`, default 10,000 ms)
([crates/celld/actor.rs#L2091](repo://crates/celld/actor.rs#L2091),
[crates/celld/ownership_store.rs#L29-L53](repo://crates/celld/ownership_store.rs#L29-L53),
[docs/guarantees.md#L202-L205](repo://docs/guarantees.md#L202-L205)).
The core treats renewal timing as a fence, not a hiccup: a renewal that lands
at or after the *prior* lease's expiry does not resurrect authority — peers
were already entitled to read the record dead and seize the cells, and
rewriting the lease cannot retract a takeover whose CAS is guarded on the
*ownership* record's etag — so the node fences itself
([crates/logic/lib.rs#L1861-L1899](repo://crates/logic/lib.rs#L1861-L1899)).
The first-lease acquisition that lands expired never becomes authoritative and
just retries ([crates/logic/lib.rs#L1893-L1899](repo://crates/logic/lib.rs#L1893-L1899)).
A node whose lease record another writer replaced or removed fences at once,
because that record proves authority moved
([docs/guarantees.md#L211-L213](repo://docs/guarantees.md#L211-L213)).
Fencing writes nothing to the bucket; it stops cells, fails incomplete
requests, logs `SELF-FENCE:` and exits 3 (see
[actor and execution boundary](../architecture/actor-execution.md)), and the
state is terminal — only a restart returns through the cold-activation path
([docs/guarantees.md#L214-L224](repo://docs/guarantees.md#L214-L224)).
Every request path compares wall time against the published expiry, so routing
is safe even before the fence executes
([docs/guarantees.md#L216-L218](repo://docs/guarantees.md#L216-L218)).

Shedding and graceful handoff reuse the same records: a shed cell is
published unowned **without resetting its epoch** and the node refuses to
reacquire it ([README.md#L288-L292](repo://README.md#L288-L292)); shutdown
releases ownership records and asks a successor to adopt (see
[node operations](../operations/node-operations.md)).

## Operator-relevant knobs

| setting | effect |
| --- | --- |
| `CELLD_DURABILITY` (`fleet` default, `bucket`) | how a write is proven before ack ([crates/celld/main.rs#L3721-L3726](repo://crates/celld/main.rs#L3721-L3726)) |
| `CELLD_OUTPUT_GATE` (`1` default) | set `0` to acknowledge without proof — documented data-loss risk |
| `CELLD_TTL_MS` (10,000) | node-lease lifetime; renewals at one third |
| `CELLD_STORAGE_PROBE` (`1` default) | startup conditional-write test |
| `CELLD_LTX_DURABILITY_TIMEOUT_SECS` (10) | durability-proof and final-snapshot retry window ([docs/README.md#L699](repo://docs/README.md#L699)) |
| `CELLD_LOG_HEDGE_MS` | fixed hedging wait; unset derives adaptively, `0` disables ([docs/README.md#L694](repo://docs/README.md#L694)) |

The supervisor contract closes the loop: fenced nodes exit, so celld requires
a restart supervisor with no attempt limit and a wait of at least one lease
lifetime between attempts ([docs/guarantees.md#L87-L98](repo://docs/guarantees.md#L87-L98)).

Related: [architecture hub](../architecture.md) ·
[decision core](../architecture/decision-core.md) ·
[cell lifecycle](cell-lifecycle.md) ·
[ltx engine](../persistence/ltx-engine.md) ·
[node operations](../operations/node-operations.md)
