---
type: concept
title: Cells, Ownership, and Fencing
description: How a cell moves between inactive, cold-activating, resident, dormant/hibernated states; what the bucket ownership record and node lease contain; how epochs fence writers; and how routing, release/handoff, alarms, and cron wakes drive those transitions.
tags: [cells, durable-objects, ownership, fencing, epochs, alarms, cron]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-2f36a204fbf1f86adbe0d189
    resource: repo://crates/celld/wake.rs
  - id: openwiki-source-e5ac10d305aff4ea0756b67b
    resource: repo://crates/logic/alarm.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-6cba1b18e1dacaa7fff40e2e
    resource: repo://crates/logic/routing.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-39c3fadff98ead82ce3bac58
    resource: repo://crates/logic/wake.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Cells, Ownership, and Fencing

A cell is celld's unit of state — the Durable Object equivalent: a named server with its own SQLite database, served by exactly one node at a time (docs/README.md#L3-L15). This page covers the lifecycle states and the bucket records that enforce single ownership; the write-acknowledgement side is [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md).

## Lifecycle states

The docs define five externally visible states: resident (in memory; active while working, idle while waiting), hibernated (idle in effect, but keeping hibernatable WebSocket clients on its node), and inactive (held by nobody, "only an object in the bucket, so it costs almost zero"); a cell keeps no memory across transitions, so the constructor runs again on the next event (docs/README.md#L22-L32). Inside the core this is the per-cell `Phase` machine: `Inactive` → cold-activation phases (`WaitingActivation`, `ReadingOwner`, `ReadingNodeLease`, `RecoveringOwnerLog`, `ReadingCapacity`/`WaitingCapacity`, `Acquiring`/`ReconcilingAcquire`, `Restoring`, `Starting`, `Publishing`) → `Resident`, plus `Dormant` for out-of-memory-but-still-owned. A dormant cell whose hibernatable sockets survive is *hibernated* — `State::is_hibernated` is that predicate — and celld's "evict" means dropping to `Dormant`, while shedding publishes the cell unowned (crates/logic/lib.rs#L100-L135, #L1415-L1433). A hibernatable socket "can outlive residency," and the runtime's stop keeps it according to the cause's `keep_hibernatable` flag (crates/logic/lib.rs#L2872, crates/logic/types.rs#L823-L832).

## The bucket records

Three key families carry ownership, and the adapter in `ownership_store.rs` "deliberately contains serialization, wall-clock sampling, SDK configuration and error classification only. Ownership decisions remain in `celld-logic`" (crates/celld/ownership_store.rs#L5-L7):

- **`cells/<cell>/own.json`** — the ownership record, a two-field wire object `{ "node": …, "epoch": … }` where `node: null` is "a deliberately released, fenced record. Epochs never reset" (crates/celld/ownership_store.rs#L289, crates/logic/types.rs#L138-L144). Reads return the record plus its opaque CAS token (etag).
- **`nodes/<node>.json`** — the node lease: advertise address, `expires_ms`, peer protocol, probe key, `paced_handoff`, a per-process generation, advisory load, and the folded node-log state, where "Anything not sealed gates a takeover of this node's cells behind node-log recovery" (crates/celld/ownership_store.rs#L31-L56, crates/logic/types.rs#L146-L165). A node renews after one third of the TTL (`CELLD_TTL_MS`, default 10000 ms), and "A renewal that does not reach the bucket does not fence the node, because the node retries while the published expiry has not passed" (docs/guarantees.md#L200-L208).
- **`wake/<YYYY-MM-DDTHH:MM>/<cell>`** — minute-bucketed, lexicographically ordered alarm hints so a waker can LIST due buckets in order (crates/logic/wake.rs#L20-L40, README.md#L31-L33).

`cell::valid_cell_scope` gates every externally supplied scope because the scope is interpolated into both the data directory and the `cells/...` bucket key — admitting `/` would let a scope escape both (crates/logic/cell.rs#L3-L11).

## Claiming, taking over, and epochs

The activation decision reads `own.json` and branches on it (crates/logic/lib.rs#L3186-L3274):

- **Absent record** → conditional *create* at epoch 1 (`CasGuard::Absent` marks a "fresh" restore with no preceding replica) (crates/logic/lib.rs#L3195-L3198, #L36-L46).
- **This node is named** → CAS on the record's etag at `epoch + 1` with `takeover: false` (crates/logic/lib.rs#L3227-L3241).
- **Released record (`node: null`)** → CAS at `epoch + 1` with `takeover: true`, then capacity placement decides which node should land it (crates/logic/lib.rs#L3243-L3256).
- **A foreign node** → its lease is consulted; live-and-compatible routes remote, dead/expired authorizes takeover — "Incompatibility never authorizes takeover" (crates/logic/types.rs#L108-L111).

Every activation advances the epoch, so "each owner therefore replicates under a fresh epoch, and an epoch never has two writers" (docs/guarantees.md#L116-L118); the epoch is embedded in the replication prefix `cells/<cell>/ltx/e<epoch>/`, which is what turns a stale owner into a writer into a dead prefix (docs/guarantees.md#L120-L129). A CAS whose response was lost enters `ReconcilingAcquire`: the core re-reads, and if its own claim is present it continues the *same* acquisition (attempt count survives the round trip) rather than racing a second one (crates/logic/lib.rs#L3176-L3210).

## Routing, release, and handoff

Once resident, the cell answers `Effect::Complete { route }`; remote calls ride the peer tunnel, and a failed forward may be re-dispatched under a strict one-shot budget: `Attempt::Ambiguous` is never retried, while `NotOwner` and `NeverConnected` each get exactly one retry per dispatch (crates/logic/routing.rs#L44-L60, crates/logic/types.rs#L699-L708).

Giving up ownership has two forms. Eviction with `OwnershipOnEvict::Release` publishes the cell unowned "so any node may take it next, which is what makes a loaded node shed load rather than merely stop hosting it," while `Sticky` keeps the record so a same-node wake renames the local snapshot instead of restoring remotely (crates/logic/types.rs#L95-L103, #L226-L234). A shutting-down node runs the fuller path: prove the batch durable, publish a full L9 snapshot when it can, `ReleaseOwner`, then `AdoptReleased` — a signed request asking a compatible peer to acquire the cell while it stays dormant, so handoff does not pre-restore unused runtimes (crates/logic/types.rs#L804-L819, docs/README.md#L441-L457).

Self-fencing is the terminal exit: when the published lease expiry passes or the lease record is replaced/removed, the node stops each active cell, fails incomplete requests, logs `SELF-FENCE:`, and exits with code 3; the state is terminal until restart (docs/guarantees.md#L210-L224, crates/logic/types.rs#L236-L244).

## Alarms, cron, and wake entries

An armed alarm is mirrored into the bucket as a `wake/` entry "so a wake hint survives fence, crash, and deploy"; the sweep evicts alarm-bearing cells only behind a durable entry, and the documented invariants are "arm durable ⟹ entry exists, within one sweep tick of the commit" and "only completed activation or a durable consume deletes an entry" (crates/celld/wake.rs#L5-L16). The reconciliation itself is pure: `WakeCore::decide` plus a shared key scheme means the production async flusher and any deterministic fake obey the same ordering rules (crates/logic/wake.rs#L1-L9). A restored cell reports its alarm explicitly (`RestoreOutcome::alarm`) because the observer only fires when a *running* isolate calls `setAlarm` — a cold cell arrives with an alarm nobody on this node saw (crates/logic/types.rs#L252-L278). Failed alarm handlers follow a bounded pure backoff (base 2 s doubling, ceiling of 6 limit-counting failures) persisted in SQLite (crates/logic/alarm.rs#L1-L9).

Cron triggers are not a special clock: each `triggers.crons` entry becomes one reserved cell whose alarm is armed at the next occurrence, with minute resolution in UTC chosen to match both Cloudflare and the wake index's minute buckets — "The schedule is therefore never more precise than the alarm that carries it" (crates/logic/cron.rs#L3-L11, #L41). Legacy debris from earlier ownership indexing is retired by the dead-node garbage collector, which only reads/lists and backs off on incomplete passes (crates/celld/dead_node_gc.rs#L3-L8, crates/logic/dead_node_reconciliation.rs#L1-L9).

Related: [Sans-IO Decision Core](/openwiki/architecture/decision-core.md), [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md), [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md), [Workers and V8 Runtime](/openwiki/concepts/workers-runtime.md).
