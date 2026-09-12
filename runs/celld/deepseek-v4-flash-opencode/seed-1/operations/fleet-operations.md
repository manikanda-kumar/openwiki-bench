---
type: operations
title: Operating a node and a fleet
description: How a node starts, serves health, handles overload, sheds under memory pressure, shuts down gracefully with a handoff and the drain token, gates its first readiness, and how the operator CLI subcommands (diagnose, cell list, d1, kv, queue) inspect and control a fleet.
tags: [operations, shutdown, pressure, drain, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-55e133f02ad99db05fcca8ad
    resource: repo://crates/celld/d1_cli.rs
  - id: openwiki-source-22743a54f7646819f332cb9f
    resource: repo://crates/celld/drain_token.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-c81fdc2f30dd12566a2750ea
    resource: repo://crates/celld/runtime.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Operating a node and a fleet

A node is one `celld` process, and the nodes that share one bucket are a
fleet. This page covers the operational lifecycle: startup, health, overload,
memory-pressure shedding, graceful shutdown and handoff, rollout, and the
operator CLI.

## Startup

`main` binds both listeners before storage or V8 work starts
(`crates/celld/startup.rs:3-9`): the public Worker listener and the internal
peer/operator listener. The internal listener defaults to `127.0.0.1:0` (a
loopback ephemeral port), and `--advertise` gives peers the address that
reaches it. On Unix the process raises its file-descriptor limit to the hard
ceiling and warns when even that bounds residency (about 8 descriptors per
resident cell, budgeted; `crates/celld/startup.rs:112-155`). The node tests
the bucket's conditional-write contract once at startup and stops on a broken
store (see the [fleet bucket page](fleet-bucket.md)).

The node must run under a supervisor that restarts it — a fenced process exits
and only a restart returns it to the fleet. The supervisor must restart
without an attempt limit and wait at least one lease lifetime between attempts
(`docs/guarantees.md#the-supervisor`).

## Health

The public listener reserves only `/.well-known/celld/health`: a healthy node
returns 200 with `{"ok":true}`, and an unhealthy node returns 503 with
`{"ok":false}` (`crates/celld/main.rs:2579-2611`). The deployed Worker owns
every other public path. A fresh process holds its first healthy response until
the fleet is settled — live node lease, no active donor, memory below every
pressure low watermark on each live node, a bounded restore backlog, and
bounded ownership skew — up to `CELLD_READY_FLEET_GATE_MS` (default 120000;
`0` disables). After the first healthy response, fleet state does not remove
readiness again.

## Hot-cell overload

celld admits a maximum of 64 concurrent fetch events for one Durable Object or
Queue broker (`DEFAULT_MAX_CELL_REQUESTS`, `crates/celld/runtime.rs:43-49`;
`CELLD_MAX_CELL_REQUESTS` changes it). The response is HTTP 503 with
`Retry-After: 1` and `X-Celld-Overload: cell`, and the excess event is not
started (`crates/celld/main.rs:1417-1439`). A local or remote Queue owner uses
the same status and headers when it refuses producer admission. The runtime
writes a `cell_overload_refused` log event when a target becomes saturated.

## Memory pressure and shedding

celld enables a memory-pressure threshold at 80% of the available memory by
default (`CELLD_MAX_RSS_MB`). The measurement is the greater of the
allocator-adjusted RSS and the allocator-adjusted active cgroup working set
(`memory::sample`, `crates/celld/memory.rs:21-31`); a separate absolute cap on
the complete cgroup charge applies at 95% of the available memory, falling back
to process RSS when no cgroup is readable. Each limit latches at its own
ceiling and releases at 80% of its value, so one crossing does not hold the
node against the other (`crates/logic/pressure.rs:46-58`).

Under pressure the node durably replicates and fences the least-recently-used
idle cells, publishes them as unowned without resetting their epochs, and
refuses to reacquire new unowned cells; it does not shed a cell with active
work or a live host WebSocket. `CELLD_MAX_RSS_MB=0` disables the threshold and
the cap together. The `/state` route reports all four input measurements
(`Sample`, `crates/celld/memory.rs:12-19`).

## Graceful shutdown and handoff

celld shuts down gracefully on SIGTERM or SIGINT. The health path reports the
node unhealthy so a load balancer stops routing to it, new public requests
receive 503, and the node finishes the requests it already accepted. The
handoff works in batches: the node reserves a batch of cells (`CELLD_RELEASES`,
default 8), stops new local routes to them, proves the batch durable, tries to
publish a full L9 snapshot of each closed database, releases each ownership
record, and asks a compatible peer to acquire it. `CELLD_SHUTDOWN_DRAIN_MS`
(default 25000) is the maximum interval without a completed handoff, and
`CELLD_SHUTDOWN_TOTAL_MS` (default 40000) bounds the complete process stop. An
orchestrator stop grace must be longer than that bound.

### The drain token

A draining node claims a fleet drain token in the bucket before it releases
cells, so simultaneous stop signals hand off one node at a time. The token is
one well-known object at `drain/token.json` (`crates/celld/drain_token.rs:18-27`),
lives 120 s, and is renewed by the holder; the claim decisions are pure policy
in `celld_logic::drain`. The token is advisory: a donor that cannot claim it
within `CELLD_DRAIN_TOKEN_WAIT_MS` (default 30000; `0` disables) proceeds
anyway, because the orchestrator grace is finite and an unserialized handoff is
strictly better than a forced exit. A fresh node's first readiness reads the
same object and treats a live foreign claim as an unsettled fleet.

### Rollout

To roll out a new version, stop each node with SIGTERM, wait for its
replacement to report healthy, then move to the next node. The docs record
which upgrades are exceptions: v0.1.0→v0.2.0 and v0.3.0→v0.4.0 must not be
rolling updates (they refuse or unreadably reshape the protocol), while
v0.2.1→v0.3.0 can be, with the caveat that a v0.3.0 node cannot replicate to a
v0.2.x peer. The internal listener also provides `POST /shutdown`
(`?handoff=preserve` prepares a clean same-node reload) and `POST /reload`
(adopt the deployment pointer now).

## The operator CLI

Every operator command writes its data to stdout and its messages to stderr,
so a redirect or pipe carries only data.

- **`celld diagnose`** reads the node leases in the bucket and sends a signed
  direct probe to each live peer. It does not take a lease or change
  ownership. The report distinguishes expired records, malformed or unsafe
  advertise addresses, unreachable peers, authentication failures, and
  incompatible protocols, and keeps checking after an individual failure
  (`crates/celld/fleet.rs:306-330`). It also prints each node's resident-cell,
  WebSocket, RSS, CPU, file-descriptor, pressure, and shedding sample.
- **`celld cell list`** lists the Durable Object instances (one `Class:ID`
  scope per line), bounded to 1000 per storage request with `--after` to
  continue and `--all` to walk everything; `--json` marks reserved classes
  (`crates/celld/cell_cli.rs:8-70`).
- **`celld d1`** runs SQL and migrations against a deployed D1 database. It
  walks the node leases, reads the shared fleet secret, and sends the SQL to a
  live node's authenticated `/runtime/` route, which forwards to the owner
  (`crates/celld/d1_cli.rs:8-20`).
- **`celld kv`** reads, writes, lists, and deletes KV namespace values; bulk
  commands use the Wrangler file format, and the listing is bounded with
  `--after`/`--all`/`--json`.
- **`celld queue`** inspects and controls a deployed Queue (info, peek, purge,
  pause, resume, redrive). A queue can continue to accept messages while
  delivery is paused.

## Related pages

- [Quickstart](../quickstart.md) — the minimal commands to run a node and a fleet.
- [Configuration surface](configuration.md) — every tuning variable named here.
- [Architecture: cell lifecycle and ownership](../architecture/cell-lifecycle.md) — the phases behind eviction, activation, and drain.
- [Security and networking boundaries](security.md) — the listener and peer surfaces an operator must protect.
