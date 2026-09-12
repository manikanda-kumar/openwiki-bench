---
type: system
title: "Durability and LTX replication"
description: "How celld proves writes durable before acknowledging: LTX capture of SQLite WAL, bucket proofs and the follower ensemble (RPO=0), the output gate, node-log recovery on takeover, and compaction."
tags: [durability, ltx, replication, output-gate, restore]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-9f6270d214b8ff6c345f5424
    resource: repo://crates/logic/log_evict.rs
  - id: openwiki-source-14c59c40a117e323329d24cd
    resource: repo://crates/logic/log_tier.rs
  - id: openwiki-source-14c8e44fe4499f118f07da4c
    resource: repo://crates/logic/output_gate.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Durability and LTX replication

The second guarantee: "celld does not answer a write until the data survives
a failure, so nothing you were told succeeded is lost" — RPO=0
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
([docs/guarantees.md](../docs/guarantees.md) header, [README](README.md)).
The mechanism rests on SQLite WAL capture expressed in the LTX transaction
format.

## The engine: celld-ltx

`crates/ltx` "captures WAL data as LTX segments, reads and writes replica
storage, restores databases, compacts levels, and reads bundle objects…
The original replication behavior is a from-scratch Rust reimplementation of
Litestream v0.5.11. The block format follows LTX v0.5.2"
(`crates/ltx/src/lib.rs:4-9`). `crates/celld/ltx_repl.rs` embeds it
in-process: "One shared `object_store` client for the whole node, and a
managed `celld_ltx::Db` per resident cell that captures the cell's committed
WAL and uploads it on demand. No external process, no directory-watch lag —
a just-written cell is registered the instant it activates, so the output
gate can prove a fresh cell durable with no cold-start window"
(`crates/celld/ltx_repl.rs:4-8`).

**Object layout**: `cells/<cell>/ltx/e<epoch>/` in the bucket, "mirroring the
local `<watch>/<cell>/ltx/e<epoch>/db.sqlite` tree" — and the prefix is
epoch-scoped, which is the store-side protection against a lagging prior
owner's writes reaching the current copy (`crates/celld/ltx_repl.rs:10-13`;
[docs/guarantees.md](../docs/guarantees.md), "prefix protects the new owner's
data from stale writes").

## The two durability proofs

([docs/guarantees.md](../docs/guarantees.md), "The acknowledgement rule")

- **Bucket proof**: a gate holds each write response until a durability
  proof covers it; after a bucket proof, celld reads the ownership record
  once and acknowledges only if it still names this node at this epoch —
  "The check reads the record instead of comparing a clock, so a paused
  process or a skewed clock cannot pass it."
- **Fleet proof**: the owner sends each write to one or two followers; that
  set is the ensemble, and "Every follower must fsync the write, and a
  takeover seals the prior node-log session before it restores, so the
  stale owner cannot complete another fleet proof."

"One follower is enough, therefore a fleet needs two running celld nodes
before any node can complete a fleet proof. `CELLD_DURABILITY=fleet` is the
default, so a fleet of one node requests the fleet posture and does not get
it" — it correctly degrades to bucket proofs, which cost an object store
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
round trip per write ([README](README.md): a region-local store takes ~90 ms,
a measured second node brought a non-local store from ~600 ms to ~25 ms). A
recruited ensemble holds up to three copies and "keeps acknowledging while
one follower remains".

## The log tier (node_log)

`crates/celld/node_log.rs` is "v0 of the in-fleet replicated log tier
(`CELLD_DURABILITY=fleet`)": each leader "streams the per-cell L0 LTX
segments it has captured but not yet uploaded to a small follower ensemble…
A write acknowledges when every member holds its segment on disk —
write-all, ack-all — or when the ordinary bucket upload proves it first,
whichever wins. The bucket upload path is unchanged and remains the tiering
mechanism, so node-log recovery re-creates exactly the objects the dead
leader would have uploaded" (`node_log.rs:4-12`). The CAS-guarded record
`log/<node>.json` "is created before the node's first fleet-durable ack and
never deleted, so a takeover that finds no record may treat the bucket as
complete" (`node_log.rs:13-17`). Deliberate v0 limits: base64 JSON entries;
a follower failure degrades to bucket acks until a periodic re-recruit;
recovery needs at least one reachable sealed member (`node_log.rs:14-19`).
One slow follower would stall every ack, so the **gray-follower eviction
policy** evicts on suspicion and rejoins — "a false positive cost[s] one
flush plus one CAS" (`crates/logic/log_evict.rs:3-8`); its decisions are in
`crates/logic/log_tier.rs`, where "(design stage; not yet wired into the
engine)" for some parts notes the boundary between decision core and
executor.

## Takeover recovery gate

A cold activation "checks the prior owner's log records before it reads the
bucket": absent record ⇒ the session never acknowledged past the bucket;
sealed ⇒ recovery completed; **open or recovering ⇒ run recovery first** —
"CAS-fence the record, seal the reachable followers, upload their retained
segments and bundles into the per-cell prefixes, then mark the record
sealed. The activation cannot restore until this sequence completes"
([docs/guarantees.md](../docs/guarantees.md), stage in
`Phase::RecoveringOwnerLog`, `crates/logic/lib.rs:136-140`).

## Full-prefix restore

"A restore selects the newest epoch prefix that contains LTX data, and it
reads the full contiguous chain from transaction zero. A fenced node can
append an unacknowledged tail to an older prefix… a failed or absent
acknowledgement does not prove that the write is absent. The rule reads the
full chain because a node-log recovery or a bundle drain can add an
acknowledged tail after an earlier restore" ([docs/guarantees.md](../docs/guarantees.md)).
The restore **source choice** (local snapshot vs bucket replica) is the
pure predicate in `crates/logic/restore.rs` described on the cell-lifecycle
page.

## The output gate

`crates/logic/output_gate.rs` is "one choke point every egress passes
through. Nothing that reveals a cell's state may leave this process while
that cell has a write it cannot prove durable. A client told about a write
that a crash then discards has been told something false, and no later
message can retract a side effect that has already left"
(`output_gate.rs:5-10`). The shell holds each effect and sends
`Event::Output` per `Channel` route; the core applies one rule to all routes
and returns `Effect::Release`. `CELLD_OUTPUT_GATE=0` bypasses it entirely.
Durability for responses is a per-request ticket flow — durability tickets
that the output gate waits on with a request sequence counter
(`crates/celld/ltx_repl.rs:578-579`).

## Compaction and pressure

L0 segments accumulate fast enough that without compaction "a takeover …
would contain thousands of L0 files, so serial reads turn a takeover into
minutes" (`crates/celld/ltx_repl.rs:60-70`); threshold compaction runs under
a worker group with requeuing, and the drain path serializes with a final
handoff snapshot (`ltx_repl.rs:490-547`). Level compaction itself is the
`celld-ltx` `compactor`/`compaction_level` library; configuration comes from
`CELLD_LTX_COMPACTION*` env vars ([cli-operations](cli-operations.md)).

Memory pressure is the other durability-adjacent control:
`crates/logic/pressure.rs` is a pure classifier of a memory sample plus the
hysteresis latch, answering only "is this node out of memory and must give
cells back to recover?" (`pressure.rs:3-9`); residency caps are enforced at
admission instead.

## What this page does not establish

- Exact fsync semantics per follower platform (`node_log.rs` v0 says
  "holds its segment on disk"), WAL read-follower behavior — the
  guarantees doc is the spec; deviations would be defects there.
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
- The measured latency figures quoted in [README](README.md) (~90 ms, ~600
  ms, ~25 ms) are lab measurements, not code constants.
