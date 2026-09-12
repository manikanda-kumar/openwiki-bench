---
type: concept
title: Durability and the RPO=0 Protocol
description: How celld keeps its two promises — one writer per cell and no acknowledged write lost — through the output gate, bucket and fleet durability proofs, ownership verification, node-log takeover recovery, full-prefix restore, and self-fencing.
tags: [durability, rpo0, output-gate, replication, fencing, node-log]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
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
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Durability and the RPO=0 Protocol

celld makes two promises: exactly one node serves a cell at a time, and a write is not answered until it survives a failure, so "nothing you were told succeeded is lost" (docs/guarantees.md#L3-L7). Both rest on the object store providing conditional create, conditional overwrite, and read-after-write consistency — the qualified stores are S3, R2, Tigris, GCS, and Azure; B2, Hetzner, and DigitalOcean Spaces cannot fence and "celld is not correct on such a store" (docs/guarantees.md#L17-L34). This page is the protocol; the bucket client itself is under [Fleet Operations](/openwiki/operations/fleet-operations.md) and the segment mechanics under [SQLite State and LTX Replication](/openwiki/concepts/sqlite-ltx.md).

## The output gate: one choke point

The rule is absolute: "Nothing that reveals a cell's state may leave this process while that cell has a write it cannot prove durable," because no later message can retract a side effect that already left (crates/logic/output_gate.rs#L5-L10). Every egress passes through one core function:

- The shell sends `Event::Output { request, channel, position }` for each held effect; `State::output` stores the channel and **never branches on it**, so all six channels obey one rule, and a per-channel `match` in the core would "split the invariant into six independent rules" (crates/logic/output_gate.rs#L29-L32, #L68-L95).
- A write (position `Some`) opens its own barrier and emits `Effect::AwaitDurable`; a read-only output (position `None`) trails the newest open barrier on its cell — a reader can start after a write commits and before its proof lands, so its own positions decide nothing — and releases immediately when the cell has nothing outstanding (crates/logic/output_gate.rs#L78-L95, #L137-L165).
- Alarm commits open barriers in the same map (`GateOwner::Alarm`) so read-only outputs trail an alarm's unproven write too; earlier designs that proved the alarm write without a barrier let readers miss it (crates/logic/output_gate.rs#L42-L57).
- A streaming response body is gated once, when the response is released; later chunks do not pass again (crates/logic/output_gate.rs#L59-L63).
- Setting `CELLD_OUTPUT_GATE=0` removes the replication wait — and accepts possible loss of an acknowledged write — by having the shell simply never send `Event::Output` (crates/logic/output_gate.rs#L21-L27, docs/README.md#L690).

## Proving durability: bucket and fleet

`durable_reached` acknowledges only when the reported position actually *covers* the gated write — "a shorter proof (a lagging or lying replicator) fails it rather than acknowledging a write the node cannot actually restore" — and any error fails it (crates/logic/output_gate.rs#L167-L183). The two proof mechanisms fence differently (docs/guarantees.md#L131-L149, crates/logic/types.rs#L371-L379):

- **Bucket proof.** After the epoch-prefixed LTX upload lands, the core emits `Effect::VerifyOwnership`: read `own.json`, and acknowledge only if it still names this node at this epoch. A partitioned node can replicate into its superseded prefix, but the read shows the new owner and the write fails with `DurabilityUnproven`; the check reads the record rather than comparing clocks, so skew cannot pass it (crates/logic/output_gate.rs#L184-L196, docs/guarantees.md#L131-L143).
- **Fleet proof.** The owner streams each captured L0 segment to one or two follower nodes ("write-all, ack-all": `next` may acknowledge only when every ensemble member has confirmed it at the leader's fragment epoch), and the ack needs no ownership read because "a takeover seals a member before restoring, so a stale owner's ack-all fails closed" (crates/logic/log_tier.rs#L127-L138, docs/guarantees.md#L144-L149). Each process session creates its conditional log record before its first fleet-durable acknowledgement (docs/guarantees.md#L170-L178). A single-node fleet requests the fleet posture but has nobody to send to, so every write waits for the bucket (docs/README.md#L51-L59, docs/guarantees.md#L151-L157). The follower set is the node's ensemble; a node recruits up to two followers, keeps acknowledging while one remains, and degrades to bucket-proof acks until a periodic re-recruit CASes a fresh ensemble (docs/guarantees.md#L158-L167, crates/celld/node_log.rs#L18-L22). The log state is folded into the node-lease record `nodes/<node>.json` — "the record moved into the lease, the shape did not change" (crates/celld/ownership_store.rs#L48-L56).
- **Hedging and gray followers.** `CELLD_LOG_HEDGE_MS` defaults to an adaptive wait derived from the slowest recent append (4×, floor 250 ms, below the eviction backstop); an append is idempotent per sequence so the second copy is safe (docs/README.md#L694). The eviction rule is pure and windowed: evict a follower whose append-latency tail exceeds `max(absolute budget, k × sibling median)` sustained briefly, or whose append sits past a hard backstop, with flapping bounded by rate-capping reconfigurations rather than excluding the member (crates/logic/log_evict.rs#L3-L12).

When a gate settles unproven, the cell is **reset**: `settle_gate` calls `reset_cell`, and the runtime stops with `StopCause::Reset` — keep no local snapshot, restore from the bucket next time — because after telling the caller the write failed, "continuing to serve them is the divergence, not the failure" (crates/logic/output_gate.rs#L281-L284, crates/logic/types.rs#L941-L946).

## Takeover recovery gate

A cold activation checks the prior owner's folded log state before reading the bucket: `takeover_gate` answers `BucketComplete` for an absent or sealed record (absent "proves that the session never acknowledged past the bucket") and `RecoverFirst` for anything else (crates/logic/log_tier.rs#L208-L220, docs/guarantees.md#L170-L186). Recovery fences the record with a CAS, seals the reachable followers, uploads their retained segments and bundles into the per-cell prefixes, and marks the record sealed; the activation cannot restore until this completes (docs/guarantees.md#L178-L184, crates/logic/types.rs#L769-L778). A store error during recovery keeps the session unsealed, so a later recovery re-reads every retained bundle (docs/README.md#L497-L502).

## Full-prefix restore

A restore selects the newest epoch prefix that contains LTX data (`highest_nonempty_epoch` under `cells/<cell>/ltx/`) and replays the **full contiguous chain from transaction zero**; celld no longer writes epoch seal objects and a legacy `e<epoch>.seal.json` does not limit the chain (crates/celld/ltx_repl.rs#L1195-L1197, #L1309-L1340, docs/guarantees.md#L188-L198). The reason it reads the whole chain: a node-log recovery or bundle drain can append an acknowledged tail *after* an earlier restore, and a restore that stopped at the earlier cut would hide that tail and lose acknowledged data (docs/guarantees.md#L193-L198).

## Self-fencing: the failure end of the protocol

Each node holds the `nodes/<node>.json` lease and renews after one third of its lifetime (`CELLD_TTL_MS`, default 10000 ms); a failed renewal does not fence while the *published* expiry still stands, because the node retries (docs/guarantees.md#L200-L208). When the published expiry passes — or the record is replaced or removed, "because that record proves the authority moved" — the core emits `Effect::Halt`: the Actor logs `SELF-FENCE: node lease not renewed within TTL — halting` and the process exits with code 3; the state is terminal until restart (docs/guarantees.md#L210-L224, crates/celld/actor.rs#L3729-L3738, crates/celld/main.rs#L113-L120). A request is safe even before the fence runs, because routing compares the current time against the published expiry each time (docs/guarantees.md#L216-L218).

What this buys is measured, not assumed: five hundred claimants racing the same cells produced one writer per epoch and zero violations; a warm resident request performs zero bucket operations; and a lab fleet acknowledged at ~25 ms with a second node holding the write versus ~600 ms for a bucket proof (docs/testing.md#L157-L178). These are conditions of specific runs, not guarantees.

Related: [Cells, Ownership, and Fencing](/openwiki/concepts/cells-ownership.md), [SQLite State and LTX Replication](/openwiki/concepts/sqlite-ltx.md), [Sans-IO Decision Core](/openwiki/architecture/decision-core.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
