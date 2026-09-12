---
type: concept
title: Cell lifecycle, routing, alarms, cron, and WebSockets
description: How a Durable Object cell moves through its states (inactive, dormant/hibernated, resident, remote, fenced), the decision-core phase machine, request routing, alarm wake entries, cron triggers, and the WebSocket kinds a cell can hold.
tags: [cell-lifecycle, routing, alarms, cron, websockets, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-2f36a204fbf1f86adbe0d189
    resource: repo://crates/celld/wake.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Cell lifecycle, routing, alarms, cron, and WebSockets

A cell is a Durable Object: a named server with its own SQLite database that
runs one event at a time. This page describes how a cell moves through its
lifecycle, how requests and wakes reach it, and what it can hold while it is
resident.

## Cell states

A cell has the same states as a Cloudflare Durable Object
(docs/README.md#L22-L34):

- **Resident** — in memory: **active** while it does work, **idle** when it
  waits. celld removes an idle cell from memory.
- **Hibernated** — out of memory but keeping its hibernatable WebSocket
  clients, and still on its node.
- **Inactive** — owned by nobody, only an object in the bucket. Every cell
  starts in this state and costs almost zero while inactive.
- **Remote** — owned by another node; this node forwards the request.

The authoritative state machine lives in `celld-logic` as the `Phase` enum.
The production executor and the deterministic simulator share the exact same
phases, and each phase has a stable reported name published by `/state` and
`celld diagnose` (crates/logic/lib.rs#L212-L240). The phases in order of a
cold activation are: `inactive`, `waiting_activation`, `reading_owner`,
`reading_node_lease`, `recovering_owner_log`, `reading_capacity`,
`waiting_capacity`, `acquiring`, `reconciling_acquire`, `restoring`,
`starting`, `publishing`, `ensuring_durability`, `cleaning`, `dormant`,
`adopting`, `resident`, `remote`, `fenced` (crates/logic/lib.rs#L113-L190).

`Resident` covers active and idle (states 1-3). `Dormant` is out of memory
but still owned by this node — a dormant cell with surviving hibernatable
sockets is *hibernated*. `Inactive` is out of memory and owned by nobody
(crates/logic/lib.rs#L98-L111). Note the naming difference from Cloudflare:
celld *evicts* a cell out of memory (producing `Dormant`), and shedding is
what then publishes it unowned.

## The per-cell state record

The core tracks each cell in a `Cell` struct that holds the phase, the
quiescing flag (set when the shutdown drain reserves the cell for a handoff
batch), the set of in-flight requests, the map of open WebSockets by kind,
the pending activation (a `Claim` or a `RestoreSpec`), the alarm state, the
isolate holding the cell's realm, the application generation, and a
`last_used_mono_ms` timestamp that drives eviction order
(crates/logic/lib.rs#L304-L358). The eviction order exists so a node under
sustained pressure sheds the least-recently-used cell rather than the same
alphabetically-first cell over and over (crates/logic/lib.rs#L350-L357).

A cell's alarm is tracked in its own SQLite database. `AlarmState` is
`Armed { at_ms, generation, covered }` while waiting and `Firing` while the
handler runs; the `covered` flag records whether a durable wake entry
already covers the alarm (crates/logic/lib.rs#L360-L376). When a cell
arrives from another node — or wakes cold — the isolate has not re-armed the
restored alarm yet, so `RestoreOutcome` reports the restored database's
armed alarm and whether a wake entry covers it
(crates/logic/types.rs#L255-L278).

## The activation path

A cold activation is ordinary work, not an emergency procedure. The core
routes each request through ownership resolution and emits effects
(`ReadOwner`, `CasOwner`, `Restore`, `StartRuntime`, `Publish`) that the
adapter performs, then reports versioned completions back. Capacity is
bounded: `Config::max_activations` limits concurrent cold activations, and
`Config::max_resident` caps resident cells plus activation reservations
(crates/logic/types.rs#L63-L86). A cell parked behind the admission gate is
watched by a `QueuedActivation` timer keyed by cell and generation, so the
queue is the one stall that has a bound (crates/logic/types.rs#L306-L314).

## Routing

A request routes either `Local` (the owner is this node) or `Remote` with
the owner node, address, epoch, and peer protocol version
(crates/logic/types.rs#L699-L708). celld is at-most-once for remote
dispatch: the `Dispatcher` decides whether a failed peer attempt may be
re-sent. A connection that was never established carried no request bytes
and may be retried; a timeout after the request was written, a truncated
body, or a decode error is ambiguous and must not be re-sent, because the
owner may have run it and lost the reply (crates/logic/routing.rs#L3-L30).
Each recoverable failure class gets one retry, counted separately, so a route
that is both stale and unreachable still terminates
(crates/logic/routing.rs#L32-L59).

A call that targets a cell this node does not own is handed to the runtime,
which resolves the owner and HTTP-proxies the fetch over the peer transport
(crates/celld/js.rs#L83-L108). A peer that answers that it no longer owns
the cell triggers `InvalidateRemote`, which retires the exact cached route
(crates/logic/types.rs#L683-L689).

## Alarms and the wake index

A cell's alarm lives in its own SQLite. To survive fence, crash, and deploy,
the committed alarm state is also mirrored into the bucket as
`wake/<YYYY-MM-DDTHH:MM>/<cell>`, bucketed at minute precision in UTC and
lexicographically ordered so a waker lists due buckets in order
(crates/logic/wake.rs#L28-L39; crates/celld/wake.rs#L3-L9). The key scheme
and the reconcile ordering rules are pure logic in
`celld_logic::wake` (`WakeCore`/`Reconcile`), shared by the production
flusher and the deterministic fake so the rules cannot diverge
(crates/logic/wake.rs#L3-L10).

The invariants, verified by deterministic simulation: arming durable implies
an entry exists within one sweep tick of the commit; only a completed
activation or a durable consume deletes an entry (a stale entry costs one
spurious wake, a missing entry costs a lost wake); and the flusher never
touches the request path because it reads the lock-free `next_alarm_ms`
mirror on the existing 5-second sweep tick (crates/celld/wake.rs#L11-L16).
The core emits `ReconcileWakeEntry` wherever the alarm settles — an arm needs
an entry, and a consumed alarm needs its entry gone, or every later due scan
finds a hint for an alarm that already fired and wakes a cell with nothing
to do (crates/logic/types.rs#L798-L802).

When an event sets an alarm before its response boundary, celld does not send
a successful response until a durable wake entry covers the alarm; a later
`waitUntil` alarm cannot delay another event's response (docs/README.md#L67-L69).

## Eviction and shedding

`StopCause::Evict { rebalance }` distinguishes the two eviction flavors. An
idle eviction keeps the ownership record (the next activation here renames
the local file into place instead of paying a full remote restore); a
`rebalance` eviction releases the record so the cell hands to the fleet
(crates/logic/types.rs#L929-L952). `Config::idle_evict_ms` (`CELLD_IDLE_EVICT_S`)
gives back cells that sit unused with no pressure involved, and
`Config::alarm_resident_ms` (`CELLD_ALARM_RESIDENT_MS`, default 3600000)
holds a cell resident when its alarm is due sooner than the wake cycle would
cost (crates/logic/types.rs#L124-L128; crates/celld/wake.rs#L26-L35).

Under memory pressure the node durably replicates and fences the
least-recently-used idle cells, publishes them as unowned without resetting
their epochs, and refuses to reacquire new unowned cells; it does not shed a
cell with active work or a live host WebSocket (README.md#L288-L295). A
cell that cannot prove its replica durable goes back to residency, and the
core records the refusal so the eviction order prefers cells that have not
just failed (crates/logic/lib.rs#L323-L332).

## WebSocket kinds

A cell can hold three kinds of WebSocket, distinguished because each pins
the cell differently (crates/logic/types.rs#L389-L399):

- **Hibernatable** — a client socket that survives eviction; the cell can go
  dormant and keep its clients.
- **Regular** — a client socket that pins its resident runtime; a live
  transport cannot move with ownership, so it closes if the cell moves.
- **Outbound** — a transport the cell opened itself with `new WebSocket(url)`.
  It pins its cell exactly as a regular socket does, but it is created by
  application code at a rate the application chooses, so how much of the node
  it may hold is budgeted: at most 50% of the resident cap may be pinned by
  outbound sockets, and each cell is limited to
  `CELLD_MAX_OUTBOUND_WEBSOCKETS` (default 32)
  (crates/logic/pressure.rs#L279-L296; crates/celld/machine.rs#L42-L44).

The core learns of sockets through `WebSocketOpened`/`WebSocketClosed`
events (crates/logic/types.rs#L544-L551). A frame from a `webSocketMessage`
handler on a hibernatable socket is captured by the host and released from
the cell's barrier queue (`Channel::WsHibernatable`); a frame on a socket the
isolate opened and polls itself cannot be captured, because the handler may
be awaiting the reply to the very frame being held, so it waits on a
durability ticket instead (`Channel::WsSelf`)
(crates/logic/types.rs#L334-L354).

## Cron triggers

A `triggers.crons` entry becomes one reserved cell per script, named
`.cron:<script>`, whose alarm is armed at the next occurrence
(crates/logic/cron.rs#L27-L43). Ownership CAS on that one name is what makes
a cron fire once per fleet rather than once per node, and the stable name is
what lets a deploy change the schedule without stranding the alarm the old
schedule armed. Resolution is one minute and the zone is UTC, matching both
Cloudflare's cron triggers and the minute buckets the wake index uses
(crates/logic/cron.rs#L11-L14). The dialect is Cloudflare's, read out of
`saffron` rather than a POSIX cron manual, because the two disagree on the
day-of-week numbers (crates/logic/cron.rs#L16-L22).

celld runs one handler at a time for each script, retries a failed handler
until the next occurrence unless the handler calls `noRetry()`, runs the most
recent missed occurrence once after fleet downtime, and rejects a descending
range such as `SAT-SUN` or a `*` inside a list
(docs/cloudflare-compat.md#L60-L68).

## Tests that pin the lifecycle

The wake reconciler invariants are verified by deterministic simulation
(crates/celld/wake.rs#L11-L16), and the whole phase machine is exercised by
the conformance and simulation suites behind `celld_internal_tests`
(crates/celld/lib.rs#L394-L418). The routing at-most-once rule is a pure
decision in `crates/logic/routing.rs` that the executor and tests share.
