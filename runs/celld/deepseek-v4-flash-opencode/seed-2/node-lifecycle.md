---
type: "Reference"
title: "Node lifecycle: lease, fencing, graceful shutdown, and rolling updates"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-9956f428da052d89a6fb042f
    resource: repo://crates/celld/dead_node_gc.rs
  - id: openwiki-source-22743a54f7646819f332cb9f
    resource: repo://crates/celld/drain_token.rs
  - id: openwiki-source-4e2df396109dfd4edefa6079
    resource: repo://crates/logic/drain.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---


# Node lifecycle: lease, fencing, graceful shutdown, and rolling updates

A node is one `celld` process. It holds no permanent authority: it earns the
right to serve by holding a lease in the bucket, and it gives its cells back
in batches when it stops. This page covers the lease protocol, self-fencing,
the first-readiness gate, graceful shutdown with handoff, the drain token,
dead-node GC, and the per-version upgrade constraints.

## The node lease

Each node holds a lease in the bucket. The lease record lives at
`nodes/<node>.json` and carries the node's address, expiry, peer protocol
version, a per-process generation, the folded node-log state, and the load
the node publishes on every renewal (crates/celld/ownership_store.rs#L31-L55).
The node renews it after one third of the lifetime (`CELLD_TTL_MS`, default
10000 ms); a renewal that does not reach the bucket does not fence the node,
because the node retries while the published expiry has not passed
(docs/guarantees.md#L201-L206).

A node that cannot reach the bucket cannot renew and cannot replicate, so it
must not own cells. When its published expiry passes, it fences itself: it
stops each active cell and fails every request it has not completed. A node
whose lease record another writer replaced or removed fences at once,
because that record proves the authority moved (docs/guarantees.md#L208-L212).
The fence writes nothing to the bucket — each peer already reads the lease as
dead or replaced, so a peer can acquire the cells through the ownership
records — and a request is safe even before the fence runs, because celld
compares the current time against the published expiry each time it routes a
request (docs/guarantees.md#L214-L218).

A fenced node logs a line that starts with `SELF-FENCE:` and exits with code
3; the fenced state is terminal, and only a restart returns the node to the
fleet, through the same cold-activation path that a peer failure uses
(docs/guarantees.md#L220-L224).

The lease state machine lives in the decision core. `NodeAuthority` is
`Unstarted`, `Reading`, `Writing`, `Held`, `Retrying`, `Failed`, or `Fenced`
(crates/logic/lib.rs#L417-L443). If the initial acquisition fails, the node
retries rather than staying up with no authority and answering every request
`NodeUnavailable` for its whole lifetime (crates/logic/lib.rs#L429-L440).

## Self-fencing as failure handling

The failure of a node is a normal input, not a recovery procedure
(docs/guarantees.md#L226-L228). A partition that cuts a node off from the
bucket makes it fence itself, because a node that cannot replicate must not
own cells (docs/testing.md#L143-L144). The supervisor contract matters: you
must run celld under a supervisor that restarts the process, it must restart
without an attempt limit, and it must wait at least one lease lifetime
between attempts so a repeated fence cycle is slow enough to observe
(docs/guarantees.md#L86-L98).

## First-readiness gate

A fresh process holds its first healthy response until the fleet is settled.
The process requires its live node lease, no active donor, and memory below
every pressure low watermark on each live node; a total restore backlog no
larger than one `CELLD_ACTIVATIONS` budget; and incumbent ownership within
one equal successor share above the fleet mean
(docs/README.md#L479-L487). The gate logic is pure in `celld_logic::drain`:
`fleet_status` evaluates the drain token, self-publication, memory headroom,
the restore backlog, and the ownership-skew envelope
(crates/logic/drain.rs#L74-L153). A joining node can satisfy the skew
condition when it advertises paced-handoff support and owns fewer cells than
the busiest incumbent (crates/logic/drain.rs#L52-L72).

An unreadable fleet or an unsettled condition holds readiness for up to
`CELLD_READY_FLEET_GATE_MS` milliseconds (default 120000; `0` disables the
gate), after which the process reports healthy with a `ready_gate_expired`
event. After the first healthy response, fleet state does not remove
readiness again (docs/README.md#L489-L494).

## Graceful shutdown and the handoff

celld shuts a node down gracefully on SIGTERM or SIGINT. The
`/.well-known/celld/health` path reports the node unhealthy so a load
balancer stops routing to it; new public requests receive a 503, celld
finishes the requests it accepted before shutdown, and it continues to
accept versioned peer traffic for cells it has not handed off
(docs/README.md#L429-L436).

The handoff works in batches. The node reserves a batch of cells and stops
new local routes to them; it proves the batch durable and tries to publish
one full snapshot of each closed database (an L9 object, so the successor
does not replay the complete transaction history). If the snapshot retry
window expires, the node releases the cell with its proven L0 chain. The
node then releases each ownership record and asks a compatible peer to
acquire it; the peer acknowledges after the ownership update and keeps the
cell dormant, so the handoff does not restore an unused runtime
(docs/README.md#L444-L456).

Four settings pace the work: `CELLD_RELEASES` (default 8) bounds complete
handoffs in progress; `CELLD_ACTIVATIONS` limits the demand-driven restore
and startup work; `CELLD_SHUTDOWN_DRAIN_MS` (default 25000) sets the maximum
interval without a completed handoff; and `CELLD_SHUTDOWN_TOTAL_MS` sets a
40000 ms default bound for the complete process stop (docs/README.md#L458-L468).
An orchestrator stop grace must be longer than the total bound
(docs/README.md#L438-L442).

A deadline-cut handoff can leave a node-log recovery for the replacement.
One process reads and uploads that dead session, the other processes wait
for its result, and a waiting process can replace an unresponsive recovery
after 30 seconds so a failed recovery cannot block the fleet permanently
(docs/README.md#L496-L502).

The internal operator API exposes the same drain: `POST /shutdown` starts
the graceful handoff, and `POST /shutdown?handoff=preserve` prepares a clean
same-node reload and keeps the ownership records (docs/README.md#L546-L551).
The `/state` response reports the handoff and restore counters during the
drain (docs/README.md#L504-L506).

## The fleet drain token

A draining node claims a fleet drain token in the bucket before it releases
cells, so concurrent donors hand off one node at a time
(docs/README.md#L471-L473). The token is one well-known bucket object at
`drain/token.json` with a 120-second TTL (crates/celld/drain_token.rs#L18-L24).
The token is advisory: correctness never depends on it — a donor that cannot
claim it within `CELLD_DRAIN_TOKEN_WAIT_MS` milliseconds (default 30000; `0`
disables the token) proceeds unserialized, a dead holder's claim lapses by
TTL, and a handoff without the token is still safe
(docs/README.md#L474-L477; crates/celld/drain_token.rs#L3-L11). The claim
and settled decisions are pure logic in `celld_logic::drain`
(crates/logic/drain.rs#L3-L17).

## Dead-node garbage collection

The `dead_node_gc` adapter retires historical `node-cells/` index debris and
expired node-session records left in fleet buckets. The retirement respects
the folded node-log state: the tombstone must carry the record's log field
through unchanged, because the lease record is the fleet log's root of truth
(crates/celld/dead_node_gc.rs#L20-L36). The GC runs one pass while renewing
the advisory fleet-waker role, so dropping a lost-role pass cancels remaining
I/O (crates/celld/dead_node_gc.rs#L67-L70).

## Rolling updates

To roll out a new version, stop each node with SIGTERM, wait for its
replacement to report healthy, then move to the next node; celld paces the
cell handoffs inside each shutdown, and the first-readiness gate paces the
update against fleet recovery (docs/README.md#L508-L512). Some upgrades are
exceptions and cannot be a rolling update:

- **v0.1.0 → v0.2.0**: stop every node first. v0.2.0 nodes advertise the
  internal listener, so ownership records that v0.1.0 nodes wrote name an
  address v0.1.0 peers cannot follow, and v0.2.0 compacts replicated data
  into block objects a v0.1.0 reader cannot restore
  (docs/README.md#L514-L522).
- **v0.2.1 → v0.3.0**: a rolling update is safe. v0.3.0 changes the default
  durability from `bucket` to `fleet`; a mixed fleet stays safe, but a
  v0.3.0 node cannot replicate to a v0.2.x peer, so it acknowledges through
  the bucket and retries. Do not downgrade to v0.2.x unless the shutdown log
  contains `node-log close: sealed epoch`, because the downgrade can lose
  acknowledged writes (docs/README.md#L523-L534).
- **v0.3.0 → v0.4.0**: stop every node first. v0.4.0 moves every proxied
  cell call onto one tunneled connection that carries plain HTTP, and the
  peer protocol refuses a different version, so the two versions cannot
  proxy calls to each other; v0.4.0 also stores each new large KV value under
  its ownership epoch, which a v0.3.0 node cannot read
  (docs/README.md#L535-L544).

## Tests

The kill tests exercise the failure path directly: stop a node with SIGKILL
in the middle of a write stream and delete its local database, freeze an
owner and write through other nodes, cut a node off from the bucket, and
stop a full host — each scenario verifies that no acknowledged write is lost
and no committed state is damaged (docs/testing.md#L133-L155).
