---
type: "Reference"
title: "Reserved cells: D1, KV, Queues, Workflows, and cron"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-55e133f02ad99db05fcca8ad
    resource: repo://crates/celld/d1_cli.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-6d3d805980c86df360693637
    resource: repo://crates/celld/kv_cli.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Reserved cells: D1, KV, Queues, Workflows, and cron

Several Cloudflare services are backed by **reserved Durable Object classes**
that the runtime supplies rather than the application defines. Their names
start with punctuation (`__...` or `.cron`) so no exported class can collide
with them. This page covers the naming, namespace keying, and the pure policy
each relies on.

## The reserved classes

`crates/celld/deploy.rs` names the runtime-supplied classes
(`crates/celld/deploy.rs:64-81`):

- **`__D1Database`** — every D1 database runs as this class.
- **`__Workflow`** — every workflow instance runs as this class.
- **`__KvNamespace`** — every KV namespace runs as this class (the value of
  `celld_logic::kv::RESERVED_CLASS`).
- **`__Queue`** — every Queue broker runs as this class (the value of
  `celld_logic::queue::RESERVED_CLASS`).

A user config that names these classes in `durable_objects` or `migrations` is
refused, because a user binding onto a built-in would silently reach a reserved
cell instead of the user's class (`crates/celld/deploy.rs:58-63`).

## Namespace keying: fleet-wide vs script-scoped

The reserved classes differ in how their cells are keyed:

- **D1** is **fleet-wide**: several Workers can bind one D1 database, and a
  Worker rename must not rename the database, so one D1 class name is correct
  (`crates/celld/deploy.rs:92-94`).
- **KV** is **fleet-wide** for the same reason: a namespace is a resource
  several Workers bind, so `__KvNamespace` is one name
  (`crates/logic/kv.rs:32-35`).
- **Workflow** is **script-scoped**: its namespace key is
  `cells:v1:<len>:<script>:__Workflow`, because a workflow instance is
  script-scoped (`crates/celld/deploy.rs:83-91`).
- **Queue** uses the identity function: the queue name is already the
  fleet-wide resource identity, so `cell_name(queue_name)` returns it unchanged
  and a project addresses the same queue as Cloudflare
  (`crates/logic/queue.rs:41-48`).

## D1

A D1 database is a cell reachable only through the node that owns it.
`celld d1` walks the node leases in the bucket, reads the same shared secret,
and sends SQL to a live node's `/runtime/` route, which forwards to the owner.
The CLI holds no ownership logic and no SQLite; it reaches the database over
the same dispatch a Worker's `env.DB` reaches it over
(`crates/celld/d1_cli.rs:8-15`).

## KV

`crates/logic/kv.rs` holds KV's pure decisions. A KV namespace is a cell, and
this module owns the bounds, the shard function, the cell name, and the
large-value reference (`crates/logic/kv.rs:3-26`).

Key pure facts:

- `MAX_KEY_BYTES` = 512, `MAX_VALUE_BYTES` = 25 MiB, `MAX_METADATA_BYTES` =
  1024, and `MIN_EXPIRATION_TTL_MS` = 60,000 (`crates/logic/kv.rs:38-60`).
- **`MAX_INLINE_VALUE_BYTES` = 1 MiB**: above this bound the bytes go to the
  fleet bucket and the row names them — the split Cloudflare's own KV
  rearchitecture made. This is also the same 1 MiB cap a workflow step return
  uses (`crates/logic/kv.rs:47-56`).

`celld kv` is the operator surface: it reaches a namespace the way `celld d1`
reaches a database, and "the CLI implements no storage" — the cell decides
(`crates/celld/kv_cli.rs:8-24`).

## Queues

`crates/logic/queue.rs` owns Cloudflare Queue policy: a queue is one reserved
cell that owns SQL and dispatch, while this module owns the stable address, the
public bounds, the alarm deadline, concurrency admission, retry timing,
lease-generation advancement, settlement fencing, purge classification, and
deploy-time config validation (`crates/logic/queue.rs:4-9`).

Key pure facts:

- Public bounds: `MAX_MESSAGE_BYTES` = 128,000, `MAX_BATCH_MESSAGES` = 100,
  `MAX_BATCH_TIMEOUT_SECONDS` = 60, `MAX_RETRIES` = 100, `MAX_CONCURRENCY` =
  250, `MAX_DELAY_SECONDS` = 86,400 (`crates/logic/queue.rs:22-28`).
- Queue retention is deployment-independent in celld v1 (4 days)
  (`crates/logic/queue.rs:36-37`).
- The **lease generation** travels in `PlannedLease`: a caller cannot select a
  row and forget to advance its generation, because the module never returns a
  bare sequence number for a deliverable row. This prevents a late settlement
  from an expired lease acknowledging a newer delivery
  (`crates/logic/queue.rs:10-14`).

`celld queue` inspects and controls a deployed Queue; a queue can continue to
accept messages while delivery is paused (`README.md:250-257`).

## Cron

`crates/logic/cron.rs` owns cron trigger schedules. A `triggers.crons` config
entry becomes one reserved cell whose alarm is armed at the next occurrence;
everything about *when* is a pure function of the expression and a timestamp
(`crates/logic/cron.rs:3-9`). Resolution is one minute and the zone is UTC,
matching both Cloudflare and the wake index's minute buckets
(`crates/logic/cron.rs:11-15`). The dialect is Cloudflare's `saffron`, not POSIX
cron, because the two disagree on weekday numbers and silence is the worst way
to find that out (`crates/logic/cron.rs:16-21`).

The reserved class is **`.cron`**, punctuated precisely because a leading `.`
is inside `cell::valid_cell_scope`'s charset but is not a legal JavaScript
identifier start, so no exported class can collide (`crates/logic/cron.rs:27-33`).
The cron cell is keyed on the script name only: ownership CAS on that one name
is what makes a cron fire once per fleet rather than once per node, and a
stable name lets a deploy change the schedule without stranding the old
schedule's alarm (`crates/logic/cron.rs:35-40`). Every node arms the schedule;
the ownership CAS decides which one keeps the cell while the others route to it
(`crates/celld/main.rs:549-556`).

## Deploy-time feature gating

Reserved classes are gated by manifest `required_features` so a missing class
fails at deploy, not silently at request time. `D1_CLASS` absence fails loudly
because the loader refuses an unknown class; KV, workflows, queues, cron, R2,
assets, and wasm carry `FEATURE_*_V1` gates for the same reason
(`crates/celld/protocol.rs:54-99`).

---

## Related pages

- [Cells and the lifecycle state machine](/openwiki/concepts/cells.md)
- [Deploying applications and adopting generations](/openwiki/operations/deploying.md)
- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
