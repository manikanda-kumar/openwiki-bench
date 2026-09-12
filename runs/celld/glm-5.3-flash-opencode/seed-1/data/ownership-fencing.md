---
type: data
title: Ownership, epochs, and fencing
description: How celld guarantees exactly one writer per cell — ownership records via CAS, fencing epochs in replication key prefixes, lease renewal, and self-fencing with exit code 3.
tags: [ownership, fencing, epoch, lease, durability]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Ownership, epochs, and fencing

The two promises: exactly one node serves a cell at a time, and no
acknowledged write is ever lost. Fencing is what keeps the first promise
true when a node is slow, paused, or cut off — celld refuses that node's
writes rather than trusting it to notice it lost the cell
[docs/guarantees.md](repo://docs/guarantees.md#L1-L15).

## The ownership record and the CAS protocol

Each cell has one ownership record at `cells/<cell>/own.json`. It names the
owner node's session and carries a fencing epoch. A node acquires a cell
with a conditional write — a create (`CasGuard::Absent`) when no record
exists, a compare-and-swap on the previous record otherwise — and the
bucket accepts one such write, so two nodes cannot acquire the same cell
[docs/guarantees.md](repo://docs/guarantees.md#L108-L115)
[crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L401-L420).

Releases are equally guarded. `release_owner` does read-then-CAS and blanks
the record only when it still names *this* node at *this* epoch; "a
takeover in the meantime means the cell is someone else's now, and blanking
it would strip a live owner's claim. Rejection is an ordinary outcome, not
an error" [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L379-L398).

## Epochs are the fence

Every activation advances the epoch — a takeover and a local wake alike —
so each owner replicates under a fresh epoch and an epoch never has two
writers [docs/guarantees.md](repo://docs/guarantees.md#L114-L118). The
replicator copies each cell's SQLite data to the bucket under
`cells/<cell>/ltx/e<epoch>/` with plain unconditional PUTs; the epoch in
the key is the fence, so a node that lost ownership may keep writing, but
its writes land in a superseded prefix that a restore never selects
[docs/guarantees.md](repo://docs/guarantees.md#L120-L128).

Cell-scope naming itself is treated as a security fence: the scope becomes
a path component and an object-store key (`cells/<scope>/ltx/e<epoch>`),
so its charset is restricted to ASCII alphanumerics plus `_ - . : $`,
bounded at 255 bytes (`MAX_CELL_SCOPE`), rejecting `.` and `..` so a scope
can never escape the data directory or the bucket prefix
[crates/logic/cell.rs](repo://crates/logic/cell.rs#L1-L47).

## Node leases and self-fencing

Each node holds a lease in the bucket (`nodes/<node>.json`) carrying an
expiry. The node renews it after one third of the lifetime
(`CELLD_TTL_MS`, default 10000 ms — `positive_or("CELLD_TTL_MS", 10_000)`
in `actor.rs` and `machine.rs`). A renewal that does not reach the bucket
does not fence the node: it retries while the published expiry has not
passed. When its published expiry passes — i.e. it cannot reach the bucket,
so it cannot renew or replicate — it fences itself: it stops each active
cell and fails every request it has not completed. A node whose lease
record another writer replaced or removed fences at once
[docs/guarantees.md](repo://docs/guarantees.md#L197-L217)
[crates/celld/actor.rs](repo://crates/celld/actor.rs#L2091-L2091)
[crates/celld/machine.rs](repo://crates/celld/machine.rs#L54-L54).

Key properties of the fenced state:

- The fence writes **nothing** to the bucket; each peer already reads the
  lease as dead or replaced, and each request is safe even before the
  fence runs because routing compares the current time against the
  published expiry [docs/guarantees.md](repo://docs/guarantees.md#L214-L218).
- A fenced node logs a line beginning `SELF-FENCE:` and stops with exit
  code 3. Other internal failures report with the same prefix and code, and
  the line names the cause. The fenced state is terminal; only a restart
  returns the node to the fleet
  [docs/guarantees.md](repo://docs/guarantees.md#L219-L224).
  The code emits this line in several internal-failure positions in
  `main.rs` — e.g. a core actor that "exited unexpectedly" or a
  replication process health check failing
  [crates/celld/main.rs](repo://crates/celld/main.rs#L4215-L4228).
- Exit uses `exit_flushed(code)` — `std::process::exit` after dropping the
  log guard — a deliberate hard exit
  [crates/celld/main.rs](repo://crates/celld/main.rs#L118-L121).
- The supervisor must restart without an attempt limit and wait at least
  one lease lifetime between attempts; a node that cannot acquire a lease
  at startup retries and does not exit, so the fence cycle stays
  observable [docs/guarantees.md](repo://docs/guarantees.md#L86-L98).

## The acknowledgement rule (RPO=0)

A gate holds each write response until a durability proof covers the
write:

- After a **bucket proof**, celld reads the ownership record once and
  acknowledges only if the record still names this node at this epoch. The
  check reads the record rather than comparing a clock, so a paused
  process or a skewed clock cannot pass it
  [docs/guarantees.md](repo://docs/guarantees.md#L133-L146).
- A **fleet proof** skips that read: the owner sends the write to one or
  two followers, each follower fsyncs, and a takeover seals the prior
  node-log session before restoring, so the stale owner cannot complete
  another fleet proof
  [docs/guarantees.md](repo://docs/guarantees.md#L141-L149).

The ensemble rule: a node recruits up to two followers from the other
nodes (never itself), one follower is enough, so a fleet needs two running
nodes before any fleet proof completes; three or more nodes hold three
copies; the ensemble keeps acknowledging while one follower remains
[docs/guarantees.md](repo://docs/guarantees.md#L151-L167).

## The takeover recovery gate

Because a fleet proof can acknowledge before the bucket upload finishes,
each process session creates a conditional node-log record before its
first fleet-durable acknowledgement. A cold activation checks the prior
owner's log records before reading the bucket: an absent record proves
the session never acknowledged past the bucket; a sealed record proves
recovery completed; an open or recovering record forces a recovery
sequence (CAS-fence the record, seal reachable followers, upload their
retained segments, mark sealed) before the cell can restore
[docs/guarantees.md](repo://docs/guarantees.md#L168-L183).

## Full-prefix restore rule

A restore selects the newest epoch prefix containing LTX data and reads
the full contiguous chain from transaction zero. Epoch-seal objects are
gone (legacy `e<epoch>.seal.json` does not limit the chain). A fenced node
can append an unacknowledged tail to an older prefix; that does not
violate the contract, because a failed or absent acknowledgement does not
prove the write absent — reading the full chain prevents hiding an
acknowledged tail added later
[docs/guarantees.md](repo://docs/guarantees.md#L185-L198).

## Verification status

The fencing argument is model-checked, not asserted: the TLA+
specifications check "one writer for each epoch" and "no acknowledged
write lost", including the specific argument that a stale owner's late
writes cannot cost an acknowledged write because the epoch prefix keeps
its lineage apart [docs/testing.md](repo://docs/testing.md#L46-L50). The
live-fleet tests exercise it too: a frozen owner seeing its lease move
refuses to serve old state, and a node cut off from the bucket fences
itself [docs/testing.md](repo://docs/testing.md#L139-L144).

## Where the code lives

- Ownership CAS protocol: `OwnershipStore::cas_owner`,
  `release_owner`, `read_owner`
  [crates/celld/ownership_store.rs](repo://crates/celld/ownership_store.rs#L288-L420).
- The CAS primitive underneath: `Bucket::put_cas` and its clean-rejection
  classification, on the
  [bucket contract page](/openwiki/data/bucket-contract.md).
- Output gate ownership and durability semantics live in the logic core
  (`crates/logic/output_gate.rs`, internal module) and are described on
  [Replication and durability](/openwiki/data/replication-durability.md).
