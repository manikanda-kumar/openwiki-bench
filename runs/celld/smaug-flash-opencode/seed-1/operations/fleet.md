---
type: operations
title: Operating a Fleet and Node Lifecycle
description: Starting nodes, adding capacity, diagnosing a fleet, listing cells, D1/KV/Queue operator commands, node-lease behavior, memory-pressure shedding, the /state route, and the graceful shutdown drain.
tags: [operations, fleet, nodes, lifecycle, diagnosis, shedding]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Operating a Fleet and Node Lifecycle

A fleet is the set of nodes that share one bucket, and a node discovers its
peers through the node leases in that bucket — there is no join command and no
fixed membership list (`docs/README.md:410-415`). This page covers starting
nodes, diagnosis, the operator commands, and the lifecycle behaviors (lease,
pressure shedding, and shutdown drain) an operator observes.

## Start and add nodes

`celld --bucket s3://name` starts a node. Each node needs a public Worker
listener (`--listen`, public side) and an internal peer/operator listener
(`--internal-listen`, private side) with a matching `--advertise` address that
other nodes can reach (`docs/README.md:400-408`). Add capacity by starting
another node against the same bucket with the same bucket settings; the nodes
find each other through the leases (`docs/README.md:410-415`).

The bucket supplies discovery and authority, not network reachability. Cell
fetch and RPC traffic carries a protocol version but has no content signature,
so the private network and its code are the security boundary. Peer-control and
reserved-cell operator requests use the fleet HMAC, but celld does not
terminate TLS. The advertised addresses must be on a trusted private network or
an encrypted overlay, and the unauthenticated internal operator API must not
reach the public internet (`docs/README.md:417-425`).

## Diagnose a fleet

`celld diagnose` reads the node leases in the bucket and sends a signed direct
probe to each live peer (`crates/celld/fleet.rs`, `docs/README.md:553-564`). It
does not take a lease and does not change ownership. Pass `--peer NODE_ID` one
or more times to probe only those nodes. The report distinguishes expired
records, unsafe or incorrect advertised addresses, unreachable peers,
authentication failures, and incompatible protocol versions.

Each node line also prints `restoring`: the count of cold routes that hold an
activation permit or wait for one. During a rolling update, wait for every node
to report `restoring=0` before restarting the next node, so one restart's cold
work finishes before the next restart removes more warm capacity
(`docs/README.md:571-576`).

The startup storage probe is part of the same story: `celld diagnose` sends four
conditional writes and requires two to fail, and each node re-runs the test once
at startup (`docs/guarantees.md:59-83`).

## List Durable Objects

`celld cell list` lists the Durable Object instances in the bucket
(`crates/celld/cell_cli.rs`, `docs/README.md:578-636`). Each line is a
`Class:ID` cell scope, printed one per line or as JSON with `--json`. An
instance appears after the first event reaches it, because its owner then
writes an ownership record. The listing is bounded: one storage request returns
at most 1000 instances, so the command stops there and writes a
`--after SCOPE` hint to stderr; pass `--all` to read the whole listing. celld's
own cells (a D1 database, a KV namespace, a Workflow) are marked reserved in the
JSON output.

## Operate D1, KV, and Queue

`crates/celld/d1_cli.rs`, `kv_cli.rs`, and `queue_cli.rs` implement the
operator subcommands. They find a node through the node leases and that node
sends the work to the node that owns the database/namespace/queue
(`README.md:234-257`). `celld kv bulk put` uses the Wrangler file format so a
Wrangler export can migrate directly into celld; `celld queue pause`/`resume`
control delivery while a queue can still accept messages.

## Node-lease behavior and readiness

Each node holds a lease in the bucket (`NodeLeaseWire`, `ownership_store.rs:32`)
and renews it after one third of `CELLD_TTL_MS` (default 10000 ms). `node_lease_cache`
keeps expiry and invalidation deterministic, and the decision core decides
whether the node is authoritative and ready (`State::ready_to_serve`). A node
whose lease lapses self-fences and exits (see
[what celld guarantees](../architecture/ownership-and-replication.md)).

A fresh node holds its first healthy response until the fleet is settled
(`docs/README.md:479-494`): it requires its live node lease, no active donor,
memory below every pressure low watermark on each live node, and a total
restore backlog no larger than one `CELLD_ACTIVATIONS` budget. This gate waits
up to `CELLD_READY_FLEET_GATE_MS` (default 120000; `0` disables) before the
node becomes healthy with a `ready_gate_expired` event. After the first healthy
response, fleet state does not remove readiness again.

## Memory-pressure shedding

Under memory pressure a node sheds rather than being killed. The shedding latch
and the pressure watermarks live in `crates/logic/pressure.rs`; the node
measures allocator-adjusted RSS and the active cgroup working set and classifies
the sample in the decision core. `CELLD_MAX_RSS_MB` sets the ordinary threshold
(default 80% of available memory; `0` disables), and a separate absolute cap
applies to the complete cgroup charge at 95% of available memory. The `/state`
route reports all four input measurements.

A node under pressure durably replicates and fences the least-recently-used
idle cells, publishes them as unowned without resetting their epochs, refuses to
reacquire new unowned cells, and does not shed a cell with active work or a live
host WebSocket. The thresholds release at 80% of their value each
(`README.md:288-295` explains the limits; the /state measurements and cap are
described at `README.md:267-286`).

## The `/state` route

`/state` on the internal listener reports node state (resident-cell, WebSocket,
RSS, CPU, file-descriptor, pressure, and shedding samples), the deployment a
node serves, the deployments it still drains, the objects that are moving, and
the deployment each resident object runs (`docs/README.md:269-272`). It is part
of the alpha operator API and can change between releases
(`docs/README.md:546-551`). During a shutdown drain the internal listener keeps
answering `/state`, and the public health response identifies the active drain
with a 503 status.

## Shutdown handoff and rolling out a node

celld shuts a node down gracefully on SIGTERM or SIGINT
(`docs/README.md:427-436`). The health path reports unhealthy, new public
requests get a 503, and the node finishes the HTTP requests it accepted and
keeps serving versioned peer traffic for cells it has not handed off.

The handoff works in batches (`docs/README.md:444-469`): the node reserves a
batch of cells, stops new local routes to them, proves the batch durable, tries
to publish one full snapshot (an L9 object) of each closed database, releases
each ownership record, and asks a compatible peer to acquire it. The peer keeps
the cell dormant, so the handoff does not restore an unused runtime. Four
settings pace the work: `CELLD_RELEASES` (default 8 complete handoffs),
`CELLD_ACTIVATIONS` (demand-driven restore), `CELLD_SHUTDOWN_DRAIN_MS` (default
25000 no-progress interval), and `CELLD_SHUTDOWN_TOTAL_MS` (default 40000 bound
for the whole stop).

Simultaneous stop signals do not flood the surviving nodes: a draining node
claims a fleet drain token in the bucket before it releases cells, so concurrent
donors hand off one node at a time. A donor that cannot claim the token within
`CELLD_DRAIN_TOKEN_WAIT_MS` (default 30000; `0` disables) proceeds without it.
The token is advisory: a dead holder's claim expires, and a handoff without the
token is still safe (`docs/README.md:471-477`).

Because handoffs are paced, a rolling update is safe for most upgrades
(`docs/README.md:508-544`): stop each node with SIGTERM, wait for its
replacement to report healthy, then move to the next. Exceptions require a full
fleet stop (v0.1→v0.2, v0.3→v0.4); v0.2→v0.3 can roll because it only changes
the default durability posture.

## Cell-admission overload

celld admits a maximum of 64 concurrent fetch events for one Durable Object or
Queue broker (`CELLD_MAX_CELL_REQUESTS`). A saturated target returns HTTP 503
with `Retry-After: 1` and `X-Celld-Overload: cell`, and the runtime writes a
`cell_overload_refused` log event (`docs/README.md:638-656`).
