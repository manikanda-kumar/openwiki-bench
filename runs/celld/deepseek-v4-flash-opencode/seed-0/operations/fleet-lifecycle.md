---
type: operations
title: Fleet Lifecycle and Graceful Handoff
description: Startup listener reservation and the storage probe, the first-readiness fleet gate, graceful shutdown and the batched cell handoff, the fleet drain token, dead-node garbage collection, and rolling updates.
tags: [operations, shutdown, handoff, drain, rolling-update, readiness]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-9956f428da052d89a6fb042f
    resource: repo://crates/celld/dead_node_gc.rs
  - id: openwiki-source-22743a54f7646819f332cb9f
    resource: repo://crates/celld/drain_token.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-4e2df396109dfd4edefa6079
    resource: repo://crates/logic/drain.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Fleet Lifecycle and Graceful Handoff

This page covers how a node joins the fleet, how it leaves it without
losing acknowledged writes, and how the fleet paces that process so a
shutdown or an upgrade does not flood the survivors.

## Startup

Both HTTP listeners are reserved before storage or V8 work starts, and
the executor receives an already-validated peer address for the internal
socket (crates/celld/startup.rs#L3-L9). The listener binds a larger
backlog than the socket2 default because a routine reconnect cohort fills
an accept queue of 128 at fleet density
(crates/celld/startup.rs#L20-L26).

Each node tests the bucket's conditional write contract once at startup,
with the same four-write probe `celld diagnose` uses; a node that finds a
broken store stops. `CELLD_STORAGE_PROBE=0` disables the startup test
(docs/guarantees.md#L59-L74).

## First-readiness gate

A fresh process holds its first healthy response until the fleet is
settled. It requires its live node lease, no active donor, and memory
below every pressure low watermark on each live node; a total restore
backlog no larger than one `CELLD_ACTIVATIONS` budget; and incumbent
ownership counts within one equal successor share above the fleet mean —
unless the joining node advertises paced handoff support and owns fewer
cells than the busiest incumbent, in which case it can absorb the skew
itself during the next donor handoff (docs/README.md#L480-L487,
crates/logic/drain.rs#L122-L152).

An unreadable fleet or an unsettled condition holds readiness for up to
`CELLD_READY_FLEET_GATE_MS` milliseconds (default 120000; `0` disables
the gate). The process then reports healthy with a `ready_gate_expired`
event, and after the first healthy response, fleet state does not remove
readiness again (docs/README.md#L488-L494).

## Graceful shutdown

celld shuts a node down gracefully on SIGTERM or SIGINT — the signals that
`systemctl stop`, `docker stop`, and a Kubernetes pod delete send — exactly
as `POST /shutdown` does (docs/README.md#L429-L430,
crates/celld/main.rs#L4048-L4049). The `/.well-known/celld/health` path
reports the node unhealthy, a load balancer stops public routing to it,
new public requests receive a 503, and accepted requests finish. The node
continues to accept versioned peer traffic for cells it has not handed
off (docs/README.md#L431-L436).

You must set a longer orchestrator stop grace (systemd `TimeoutStopSec` or
Kubernetes `terminationGracePeriodSeconds`) than the internal bound, or
the orchestrator can send SIGKILL before the handoff completes
(docs/README.md#L438-L442).

## The batched handoff

The handoff works in batches of at most `CELLD_RELEASES` (default 8). The
node reserves a batch of cells and stops new local routes to them: an
accepted request stays local until it finishes, and a new request waits
for the successor route. The node proves each batch durable and tries to
publish one full L9 snapshot of each closed database, so the successor
does not replay the complete transaction history. It then releases each
ownership record and asks a compatible peer to acquire it; the peer
acknowledges after the ownership update and keeps the cell dormant, so
the handoff does not restore an unused runtime
(docs/README.md#L447-L456).

In the decision core this is the `draining` flag and `pump_release`: at
most `max_releases` handoffs in flight — each counted through durability,
release, and successor acceptance — so a node holding thousands of cells
does not turn its own shutdown into the restore storm the eviction bound
exists to prevent (crates/logic/lib.rs#L4331-L4434).

Two settings pace the work. `CELLD_SHUTDOWN_DRAIN_MS` (default 25000) sets
the maximum interval without a completed handoff; each successor
acknowledgement starts the interval again. `CELLD_SHUTDOWN_TOTAL_MS`
(default 40000) bounds the complete process stop
(docs/README.md#L458-L469).

## The fleet drain token

Simultaneous stop signals do not flood the surviving nodes. A draining
node claims a fleet **drain token** in the bucket at `drain/token.json`
before it releases cells, so concurrent donors hand off one node at a
time (crates/logic/drain.rs#L3-L11, crates/celld/drain_token.rs#L20).
The claim lives `TOKEN_TTL_MS` (120000 ms) without renewal, so only a
dead holder lets the token lapse (crates/celld/drain_token.rs#L22-L24).

The token is advisory: correctness never depends on it. A donor that
cannot claim it within `CELLD_DRAIN_TOKEN_WAIT_MS` (default 30000; `0`
disables the token) proceeds unserialized, because the orchestrator grace
is finite and an unserialized handoff is strictly better than a forced
exit; a dead holder's claim expires; a fresh node's readiness gate treats
a live foreign claim as an unsettled fleet and falls open after its
bounded wait (crates/celld/drain_token.rs#L3-L11,
crates/logic/drain.rs#L13-L17).

## Rolling updates

Use your orchestrator's rolling update: stop each node with SIGTERM, wait
for its replacement to report healthy, then move to the next node. celld
paces the cell handoffs inside each shutdown, and the first-readiness gate
paces the update against fleet recovery, so a deployer does not need a
separate fleet-level handoff gate (docs/README.md#L508-L512).

Some upgrades are exceptions, and the release notes call them out:
- v0.1.0 → v0.2.0 must not be a rolling update (internal-listener
  advertisement and block-object compaction make a mixed fleet unsafe).
- v0.2.1 → v0.3.0 can be a rolling update, but a v0.3.0 node cannot
  replicate to a v0.2.x peer, and a v0.2.x binary must not be started
  after a v0.3.0 node unless the shutdown log shows `node-log close:
  sealed epoch`.
- v0.3.0 → v0.4.0 must not be a rolling update (all proxied cell calls
  moved onto one tunneled connection, and the peer protocol refuses a
  different version).

## Dead-node garbage collection

Wake entries and lazy ownership takeover provide serving correctness; the
`dead_node_gc` adapter retires the historical `node-cells/` index debris
and expired node-session records left in fleet buckets shared with celld
(crates/celld/dead_node_gc.rs#L3-L7). The retirement respects the folded
node-log state and preserves every other lease field verbatim, because the
node record is the fleet log's root of truth
(crates/celld/dead_node_gc.rs#L20-L36).
