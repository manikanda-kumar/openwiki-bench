---
type: "Reference"
title: "Node operations and memory pressure"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-74510bca427f93999e1bbdd0
    resource: repo://crates/celld/cli_output.rs
  - id: openwiki-source-22743a54f7646819f332cb9f
    resource: repo://crates/celld/drain_token.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-02acfd4182787268658ca557
    resource: repo://crates/celld/memory.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-93e5bac71854233e4df4d7a1
    resource: repo://crates/celld/replication.rs
  - id: openwiki-source-4e2df396109dfd4edefa6079
    resource: repo://crates/logic/drain.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---


# Node operations and memory pressure

This page is the operator's view of one node and its fleet: how configuration
is parsed, how the node gives memory back, how it dies politely, and how you
inspect it. The protocol behind the handoff — leases, epochs, the node log —
is on [durability and fencing](../concepts/durability-and-fencing.md).

## Configuration parsing

Every `CELLD_*` setting is read through `crates/celld/env_vars.rs`: unset
takes the documented default, and a supplied value must parse — "a typo
cannot silently change the configuration of a running node"
([crates/celld/env_vars.rs#L3-L7](repo://crates/celld/env_vars.rs#L3-L7)).
Booleans accept only `0`/`1` ([crates/celld/env_vars.rs#L115-L121](repo://crates/celld/env_vars.rs#L115-L121));
`env_vars::validate()` enumerates every typed variable and runs at process
start, so an invalid value exits during startup rather than falling back to a
default at the point of use
([crates/celld/env_vars.rs#L11-L56](repo://crates/celld/env_vars.rs#L11-L56),
[crates/celld/main.rs#L2989](repo://crates/celld/main.rs#L2989),
[docs/README.md#L706-L708](repo://docs/README.md#L706-L708)).
The primary table is in [docs/README.md#L660-L702](repo://docs/README.md#L660-L702);
`celld --help` lists the rest.

## Memory pressure and shedding

The measurement is dual-source on purpose: process RSS, jemalloc's
`in_use` (RSS minus pages the allocator keeps but no cell uses), and the
cgroup's `memory.current` and working set (`memory.current` minus
`inactive_file` from `memory.stat`) are all sampled by `crates/celld/memory.rs`
([crates/celld/memory.rs#L3-L29](repo://crates/celld/memory.rs#L3-L29),
[README.md#L267-L276](repo://README.md#L267-L276)). The classifier is pure
(`celld_logic::pressure`) and keeps two independent watermarks
([crates/logic/pressure.rs#L3-L16](repo://crates/logic/pressure.rs#L3-L16)):

- **The threshold** (`CELLD_MAX_RSS_MB`, default 80% of the machine) applies
  to the greater of allocator-adjusted RSS and the allocator-adjusted cgroup
  working set; the same allocator slack is subtracted from the cgroup number
  so retained pages cannot recreate an admission wedge
  ([crates/logic/pressure.rs#L96-L107](repo://crates/logic/pressure.rs#L96-L107)).
- **The absolute cap** is a fixed 95% of the machine, never derived from the
  threshold, applied to the complete `memory.current` charge (RSS fallback)
  because eviction can return working-set memory but may never move the
  kernel-side charge ([crates/logic/pressure.rs#L30-L42](repo://crates/logic/pressure.rs#L30-L42),
  [crates/logic/pressure.rs#L142-L173](repo://crates/logic/pressure.rs#L142-L173)).
  When the machine size is unreadable the cap falls back to 125% of an
  explicit threshold, and when the threshold is set at or above the cap, the
  cap becomes the effective limit — a configuration the node reports at
  startup ([crates/logic/pressure.rs#L146-L193](repo://crates/logic/pressure.rs#L146-L193),
  [README.md#L277-L286](repo://README.md#L277-L286)).

Each watermark latches on its own crossing and releases at 80% of its own
value; the latches are two booleans, not the reported reason, because a
shared derivation "lets a hard-cap crossing arm the ordinary ceiling, and then
a node stays closed on a ceiling it never crossed"
([crates/logic/pressure.rs#L46-L55](repo://crates/logic/pressure.rs#L46-L55),
[crates/logic/pressure.rs#L192-L200](repo://crates/logic/pressure.rs#L192-L200)).
`CELLD_MAX_RSS_MB=0` disables both. While shedding, the node durably
replicates and fences LRU idle cells, publishes them unowned without resetting
epochs, and refuses to reacquire new unowned cells; cells with active work or
live host WebSockets are not shed, and the walk-down stops when the projected
cut has landed ([README.md#L288-L296](repo://README.md#L288-L296),
[cell lifecycle](../concepts/cell-lifecycle.md)). The four input
measurements and the shed state are reported by `/state` and republished in
the node lease `load` so peers rank this node honestly
([crates/celld/ownership_store.rs#L74-L110](repo://crates/celld/ownership_store.rs#L74-L110),
[crates/celld/actor.rs#L2389-L2405](repo://crates/celld/actor.rs#L2389-L2405)).

## Graceful shutdown and rollout

SIGTERM/SIGINT (what `systemctl stop`, `docker stop`, and pod deletion send)
start the same graceful path as `POST /shutdown`
([docs/README.md#L429-L433](repo://docs/README.md#L429-L433),
[crates/celld/main.rs#L2642-L2654](repo://crates/celld/main.rs#L2642-L2654)):
health goes 503 so the load balancer moves, public requests stop being
accepted, in-flight ones finish, and versioned peer traffic continues until
each cell is handed off ([docs/README.md#L429-L437](repo://docs/README.md#L429-L437)).
The handoff is batched: the core keeps at most `CELLD_RELEASES` (default 8)
complete handoffs in flight — activity cancellation, durability proof, the
final snapshot, ownership release, successor adoption — while
`CELLD_ACTIVATIONS` bounds demand-driven restores
([docs/README.md#L444-L462](repo://docs/README.md#L444-L462),
[crates/logic/lib.rs#L4330-L4360](repo://crates/logic/lib.rs#L4330-L4360)).
Each released cell's closed database is published as one full **L9 snapshot**
so the successor does not replay the whole transaction history; if the
snapshot retry window (inside `CELLD_LTX_DURABILITY_TIMEOUT_SECS`) expires,
the cell is released with its proven additive L0 chain as the fallback
([docs/README.md#L447-L451](repo://docs/README.md#L447-L451),
[crates/celld/replication.rs#L20-L26](repo://crates/celld/replication.rs#L20-L26),
[crates/celld/ltx_repl.rs#L1969-L2019](repo://crates/celld/ltx_repl.rs#L1969-L2019)).

Timing bounds: `CELLD_SHUTDOWN_DRAIN_MS` (25 s default) is the maximum
interval *without a completed handoff* — every successor acknowledgement
restarts it; `CELLD_SHUTDOWN_TOTAL_MS` (40 s) bounds the whole stop, and the
orchestrator grace must exceed it
([docs/README.md#L462-L469](repo://docs/README.md#L462-L469),
[crates/celld/main.rs#L4054-L4056](repo://crates/celld/main.rs#L4054-L4056)).

Simultaneous stops are serialized by the **fleet drain token**: one bucket
object claimed before releasing cells, with `CELLD_DRAIN_TOKEN_WAIT_MS`
(default 30 s; `0` disables) as the bounded wait, after which a donor proceeds
unserialized because the grace is finite. The token is advisory — a dead
holder's claim expires and a handoff without it is still safe — and a fresh
node treats a live foreign claim as an unsettled fleet
([crates/celld/drain_token.rs#L3-L12](repo://crates/celld/drain_token.rs#L3-L12),
[crates/logic/drain.rs#L3-L18](repo://crates/logic/drain.rs#L3-L18),
[docs/README.md#L471-L478](repo://docs/README.md#L471-L478)).

The other half of rollout pacing is **first readiness**: a fresh process
withholds its first health 200 until the fleet is settled — live lease, no
active donor, headroom below every pressure low watermark on each live node,
restore backlog within one `CELLD_ACTIVATIONS` budget, and ownership counts
within one equal-successor share of the fleet mean — bounded by
`CELLD_READY_FLEET_GATE_MS` (120 s; a `ready_gate_expired` event then lets it
report healthy) ([docs/README.md#L479-L495](repo://docs/README.md#L479-L495),
[crates/celld/main.rs#L3870-L3876](repo://crates/celld/main.rs#L3870-L3876),
[crates/celld/actor.rs#L1158-L1167](repo://crates/celld/actor.rs#L1158-L1167)).
It is one-shot: after opening, fleet state never demotes readiness. A
deadline-cut handoff can leave a node-log recovery for the replacement; one
process reads and uploads that dead session, others wait, and a waiting
process can replace an unresponsive recovery after 30 seconds
([docs/README.md#L497-L503](repo://docs/README.md#L497-L503)).

Rolling updates are the normal shape **except** where the deployment-object
compatibility contract forbids mixing versions — see
[deploy and rollout](../deployments/deploy-and-rollout.md#upgrade-invariants-recorded-by-the-repository)
([docs/README.md#L506-L513](repo://docs/README.md#L506-L513)).

## Inspecting: diagnose and the operator API

`celld diagnose` reads the node leases in the bucket — without taking a lease
or changing ownership — and sends each live peer a signed direct probe,
reporting expired records, unsafe advertise addresses, unreachable peers,
authentication failures, and protocol mismatches; it keeps checking after an
individual failure and prints each node's coarse resident-cell, WebSocket,
RSS, CPU, fd, pressure, and shedding sample
([docs/README.md#L553-L569](repo://docs/README.md#L553-L569),
[README.md#L204-L218](repo://README.md#L204-L218),
[crates/celld/peer_probe.rs#L3-L4](repo://crates/celld/peer_probe.rs#L3-L4)).
The probe is a challenge-bound proof that the response came from the node
named by the lease ([crates/celld/peer_probe.rs#L3-L4](repo://crates/celld/peer_probe.rs#L3-L4)).
Each node line's `restoring` count — cold routes holding or awaiting an
activation permit — is the rollout throttle: wait for `restoring=0` before
restarting the next node ([docs/README.md#L571-L575](repo://docs/README.md#L571-L575)).
`celld diagnose --read-only` runs the read-only checks with a credential that
cannot write ([crates/celld/fleet.rs#L249-L256](repo://crates/celld/fleet.rs#L249-L256)).

The operator subcommands reuse the same machinery: `celld cell list` (bounded
at 1000 rows, `--after`/`--all` paging, `__`-prefixed reserved classes marked
`"reserved"`) ([README.md#L217-L233](repo://README.md#L217-L233),
[docs/README.md#L577-L625](repo://docs/README.md#L577-L625)), and
`celld d1`/`celld kv`/`celld queue`, which find a live node through the
leases and forward to the owner over the HMAC-authenticated
`/runtime/` route ([crates/celld/operator_cell.rs#L3-L7](repo://crates/celld/operator_cell.rs#L3-L7)).
All operator commands keep stdout as pure data and stderr for human output —
a rule enforced centrally in `crates/celld/cli_output.rs` ("stdout carries
data, stderr carries everything a person reads"), with listings bounded by
default and a closed stdout pipe treated as a successful stop
([crates/celld/cli_output.rs#L7-L14](repo://crates/celld/cli_output.rs#L7-L14),
[docs/README.md#L363-L372](repo://docs/README.md#L363-L372)).
The node-side alpha operator API (`/state`, `POST /reload`,
`POST /shutdown[?handoff=preserve]`) stays reachable during a drain;
`handoff=preserve` prepares a same-node reload while keeping ownership, and
the API may change between releases
([docs/README.md#L504-L551](repo://docs/README.md#L504-L551)).

## Release engineering in this repository

`.github/workflows/release.yml` is the only CI beyond the OpenWiki refresh:
a push to `candidate` builds every native target (Linux x86-64/ARM64, Apple
Silicon) with `cargo build --release --locked` on Rust 1.97.1, smoke-builds
the container **including its test stage**, gzips reproducible assets,
attests build provenance, and creates a draft release; only a human-
*approved* publish runs the container phase that builds architecture images
and stitches a multi-arch manifest — a failed candidate is deleted and `main`
never moves ([.github/workflows/release.yml#L1-L12, L31-L110](repo://.github/workflows/release.yml#L1-L12)).
The installer keeps releases under `~/.local/lib/celld/releases` behind one
symlink, and provenance is verifiable with `gh attestation verify`
([README.md#L36-L56](repo://README.md#L36-L56)).

Related: [quickstart](../quickstart.md) ·
[durability and fencing](../concepts/durability-and-fencing.md) ·
[deploy and rollout](../deployments/deploy-and-rollout.md) ·
[telemetry](telemetry-and-logs.md) ·
[listeners and peers](../networking/listeners-and-peers.md)
