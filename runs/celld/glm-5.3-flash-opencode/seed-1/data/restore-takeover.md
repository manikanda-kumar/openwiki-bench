---
type: data
title: Restore and takeover
description: How an inactive or failed cell comes back — cold activation, node-log recovery of open sessions, full-prefix restore, dead-node GC, and the graceful handoff with its drain token.
tags: [restore, takeover, recovery, drain, handoff]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-9956f428da052d89a6fb042f
    resource: repo://crates/celld/dead_node_gc.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Restore and takeover

## Cold activation chooses a restore source

Activation restores a cell's SQLite from the newest **safe** source — a
local eviction snapshot or the replicated bucket — and which source is a
durability decision, not merely an availability one: pick a stale source
and "the cell serves lost writes"; pick a needlessly remote one and pay
dozens of sequential round trips. The repo measures the cost before the
previous-epoch optimization: 46 round-trips, 0 local reuses in 910
activations [crates/logic/restore.rs](repo://crates/logic/restore.rs#L3-L12).

The pure predicate is `previous_epoch_reusable(epoch, took_over)`: an
ordinary idle eviction advances the epoch, so its snapshot cache sits under
`epoch - 1` and is safe to reuse **only when the node did not take the
cell over from another node** — a takeover means someone else may have
written the cell while the snapshot was stale, so their newer durable
state wins. Epoch 1 has no previous epoch
[crates/logic/restore.rs](repo://crates/logic/restore.rs#L24-L31).

The restore reads the bucket via the rule covered on
[Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md): the
newest epoch prefix with LTX data and the full contiguous chain from
transaction zero [docs/guarantees.md](repo://docs/guarantees.md#L185-L198).

## Takeover recovery: node-log records

A single-node fleet proves every write against the bucket, so a restore
is straightforward. A fleet (the default `CELLD_DURABILITY=fleet`) can
acknowledge before the bucket upload finishes — so each process session
creates a conditional node-log record first. A cold activation checks the
prior owner's records **before** reading the bucket
[docs/guarantees.md](repo://docs/guarantees.md#L168-L183):

- **Absent record**: the session never acknowledged past the bucket.
- **Sealed record**: recovery already completed.
- **Open or recovering record**: the activation runs recovery — it
  compare-and-swap-fences the record, seals the reachable followers,
  uploads their retained segments and bundles into the per-cell prefixes,
  then marks the record sealed. The activation cannot restore until this
  sequence completes.

A deadline-cut handoff can still leave a node-log recovery for the
replacement; one process reads and uploads the dead session and the
others wait, and a waiting process may replace an unresponsive recovery
after 30 seconds, so a failed recovery cannot block the fleet
[docs/README.md](repo://docs/README.md#L496-L502).

## Graceful shutdown and the handoff batch

SIGTERM/SIGINT begin a graceful drain. The health path reports unhealthy
(503) so load balancers stop routing, new requests get 503, accepted
public requests finish, and versioned peer traffic continues for cells
not yet handed off
[docs/README.md](repo://docs/README.md#L429-L437).

Handoff works in batches
[docs/README.md](repo://docs/README.md#L444-L456):

1. The node reserves a batch of cells and stops new local routes to them.
2. It proves the batch durable and tries to publish one **full snapshot**
   (an L9 object) per closed database — the successor skips replaying the
   transaction history; the remote L0 chain is the additive fallback if
   the snapshot retry window expires.
3. It releases each ownership record and asks a compatible peer to
   acquire the cell. The peer acknowledges after the ownership update and
   keeps the cell **dormant** — the handoff does not restore an unused
   runtime; a later request starts the cell under the activation limits.
4. The donor starts the next batch after each acknowledgement.

Four settings pace it
[docs/README.md](repo://docs/README.md#L458-L470):

- `CELLD_RELEASES` (default 8): max concurrent complete handoffs.
- `CELLD_ACTIVATIONS`: limit for demand-driven restore/startup work.
- `CELLD_SHUTDOWN_DRAIN_MS` (default 25000): max interval without a
  completed handoff; each successor acknowledgement restarts it.
- `CELLD_SHUTDOWN_TOTAL_MS` (default 40000): bound for the complete
  process stop. Orchestrator stop grace must exceed it.

The same-node `handoff=preserve` operation uses the drain interval as its
semantic limit because it has no successor acknowledgements
[docs/README.md](repo://docs/README.md#L469-L470).

## The fleet drain token

Simultaneous stop signals must not flood surviving nodes. A draining node
claims a fleet drain **token** before releasing cells, so concurrent
donors hand off one node at a time
[docs/README.md](repo://docs/README.md#L472-L477).

Implementation splits cleanly between core and adapter:

- The **core** (`crates/logic/drain.rs`) is sans-I/O policy. Its doc
  states the threat model: "a node drain, a cluster upgrade, a spot
  reclaim... hand off one node at a time instead of flooding the
  survivors", and the safety stance: "The token is advisory. Correctness
  never depends on it: a donor that cannot claim it within a bounded wait
  proceeds unserialized, a fresh node's gate falls open after a bounded
  wait, and a dead holder's claim lapses by TTL"
  [crates/logic/drain.rs](repo://crates/logic/drain.rs#L3-L10).
- The **adapter** (`crates/celld/drain_token.rs`) adds the bucket IO. The
  well-known key is `drain/token.json`, deliberately **outside** `nodes/`
  so lease listings and dead-node GC never see it. `TOKEN_TTL_MS` is
  120000 ms, renewed before expiry so only a dead holder lets the token
  lapse; claims retry every 1 000 ms while another donor holds; the
  holding etag guards renewals and release so a takeover cannot clobber a
  live claim [crates/celld/drain_token.rs](repo://crates/celld/drain_token.rs#L13-L33).

A donor that cannot claim the token within `CELLD_DRAIN_TOKEN_WAIT_MS`
(default 30000; 0 disables) proceeds without it, since "a handoff without
the token is still safe" [docs/README.md](repo://docs/README.md#L473-L477).

## First-readiness gate

A fresh process holds its first healthy response until the fleet is
settled: its live node lease, no active donor, memory below every pressure
low watermark on each live node, a total restore backlog within one
`CELLD_ACTIVATIONS` budget, and ownership counts within one equal successor
share above the fleet mean. Unsettled conditions hold readiness up to
`CELLD_READY_FLEET_GATE_MS` (default 120 000; 0 disables); after the gate
expires the process reports healthy with a `ready_gate_expired` event;
after the first healthy response, fleet state never removes readiness
again [docs/README.md](repo://docs/README.md#L479-L494).

## Dead-node GC

`crates/celld/dead_node_gc.rs` is "compatibility garbage collection for
dead celld process generations": wake entries and lazy ownership takeover
provide serving correctness on their own; this adapter retires the
historical `node-cells/` index debris and expired node-session records
left in shared fleet buckets
[crates/celld/dead_node_gc.rs](repo://crates/celld/dead_node_gc.rs#L3-L9).

The GC respects the durability ladder: the node-log record "IS the fleet
log's root of truth, so retirement must respect its state and the
tombstone must carry it through unchanged", and every other lease field is
preserved verbatim "a crash between the tombstone and the delete must
never publish a record poorer than the one it fences"
[crates/celld/dead_node_gc.rs](repo://crates/celld/dead_node_gc.rs#L17-L30).

## Related pages

- [Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md) —
  the CAS claims the takeover builds on.
- [Replication and durability](/openwiki/data/replication-durability.md) —
  the durability proofs a takeover must re-prove.
- [Node command surface and graceful shutdown](/openwiki/operations/node-cli.md) —
  the operator API for `/shutdown` and rolling rollouts.
