---
type: testing
title: Testing and verification strategy
description: The four verification layers — differential conformance against workerd, exhaustive TLA+ model checking, deterministic simulation of the pure decision core, and fault-injection live fleets — and the in-repository hooks that make them possible.
tags: [testing, simulation, model-checking, conformance, tla]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Testing and verification strategy

celld makes three promises that are tested as such: an acknowledged write is
durable, a cell has one writer at a time (never two), and code written for
Cloudflare Workers and Durable Objects operates the same on celld
(`docs/testing.md:1-9`). Each promise is attacked at the layer where a failure
shows most clearly. The full account is `docs/testing.md`; this page anchors
the strategy in the repository.

## Four layers

The strategy has four layers, in increasing distance from the code:

1. **Differential conformance** — the compatibility promise, tested against
   the real Cloudflare runtime.
2. **TLA+ model checking** — exhaustive at small size, for the coordination
   protocol.
3. **Deterministic simulation** — the decision core under adversarial
   schedules, per commit.
4. **Live fleets with fault injection** — what simulation cannot see: real S3
   tail latency, real kernel and filesystem behavior, and V8 under memory
   pressure.

## Differential conformance against workerd

Each Workers and Durable Objects program is run twice — once on workerd, the
runtime Cloudflare operates in production, and once on celld, on identical
bytes — and the outputs must be equal. This shows two facts at once: the
program is real Cloudflare code because workerd accepts it, and celld obeys
the contract because the outputs are equal (`docs/testing.md:17-25`). A test
cannot agree with celld's own runtime by accident. The corpus only grows:
when celld gets a new API surface, fixtures are added for that surface and
must give equal output on the two engines; test suites are also ported from
workerd (the Durable Objects contract, the web-platform globals, and the
upstream Web Platform Tests). Before a release, scenarios are replayed through
the full `celld` binary in each deployment mode.

The in-repository conformance harness is the `include!`-based test modules
behind `cfg(celld_internal_tests)` in `crates/celld/lib.rs:299-430`
(`conformance_core_loop_tests`, `conformance_world_tests`, the S1/S2/S3/S5
world suites, and the `conformance_sim_store` / `conformance_sim_cell_host`
simulation modules). Under the internal-tests flag the `asyncrt` facade is
replaced by a simulated implementation, so the external engine-tests harness
sees the same simulated world the in-crate suites see
(`crates/celld/lib.rs:305-320`).

## TLA+ model checking

The coordination protocol is also specified in TLA+. The specifications were
written against celld v0.1.0, and model checking found four bugs and a
split-brain that lost an acknowledged write — all fixed, none surfaced in
review or testing (`docs/testing.md:35-40`).

Where simulation samples schedules, the checker enumerates them: at a small
configuration it visits every reachable state, and the model grants the
implementation a linearizable object store and perfect shared clocks, so a
violation it finds needs no clock skew and no storage anomaly. The invariants
are the first two promises: one writer for each epoch, and no acknowledged
write lost. Every configuration carries a pinned expected verdict, and most of
the verdicts are failures — each failing configuration models a bug the
protocol once had or a deliberately broken checker, and the model must produce
the counterexample. A configuration that stops failing has lost its tooth
(`docs/testing.md:52-64`).

The specifications are a hand-synced snapshot, deliberately not in continuous
integration: a silently stale gate is worse than none. A delta ledger records
what the model does not yet describe, including places where the model is
weaker than the code rather than wrong (`docs/testing.md:73-79`).

## Deterministic simulation of the decision core

The dangerous bugs live in the coordination — a crash during an ownership
handoff, a lease renewal that races a takeover, an alarm that fires against a
partially restored cell. These windows are nanoseconds wide, so the
coordination protocol is a pure decision core with no I/O of its own: the
clock, the randomness, and the object store are interfaces
(`crates/logic/Cargo.toml:8`), and a simulator drives the core. The simulated
store injects latency, compare-and-swap races, and lost responses; the clocks
drift apart; a node can crash at each await point; and scripted adversaries
play the cells (`docs/testing.md:81-96`). V8 stays out of the simulation
because V8 is not deterministic.

A seeded scheduler drives each run, so a failure is not a fluke: the seed
replays it exactly, and the seed is kept until the bug is dead. Properties are
checked for safety (two writers in one epoch, a lost acknowledged write, an
expired lease that comes back) and for liveness (each armed alarm fires, and
ownership settles on one node after a crash), and a property must survive tens
of thousands of seeds. The core protocols have run through millions of
schedules (`docs/testing.md:97-104`).

The in-repository hooks that make this deterministic are visible in the core:
the authority and structural snapshots (`authority_observer_snapshot`,
`step_safety_observer_snapshot`, `crates/logic/lib.rs:763-793`), the
`State::validate` invariant check that runs after every event
(`crates/logic/lib.rs:1073+`), and the `fault` module that injects SQLite
failures under the internal-tests flag (`crates/celld/lib.rs:332-337`).

The checkers are themselves tested: deliberately broken variants of the
protocol are run against the properties, and the properties must find the
damage — a suite that stays green against a broken protocol is a broken suite
(`docs/testing.md:105-108`).

## Live fleets with fault injection

Simulation cannot see the real S3 tail latency, the real kernel and
filesystem behavior, or V8 under memory pressure, so the third layer is a
permanent fleet lab: standard VMs from standard providers and a real bucket.
The workloads rotate — chat rooms under many WebSocket connections, working
sets that shift across tens of thousands of cells, deployment cutovers under
load, and runs that fill the nodes to the memory limit. Each run makes an
archived evidence bundle, and a red run is kept with the same care as a green
run, because a failure the harness caught is a result, not a retry
(`docs/testing.md:110-124`).

Faults are injected between verification passes. A pass fetches each cell
through different nodes and compares the durable state exactly — status, body,
and the full message ledger. The scenarios attack every known seam:
`SIGKILL` in the middle of a write stream with the local database deleted,
freezing an owner while writes land through other nodes, cutting a node off
from the bucket (it fences itself), throttling the bucket with 429s, and
stopping a full host at the provider level. Across every run of every
scenario, no acknowledged write was lost and no committed state was damaged
(`docs/testing.md:133-155`).

## Measured numbers

Each number includes the condition of its measurement (`docs/testing.md:157-186`):

- The epoch fence holds under contention: 500 claimants, 5,500 attempts, one
  writer for each epoch, zero violations.
- A warm resident request is local: zero bucket operations, p50 ~1.1 ms and
  p99 ~7 ms; only a cold activation touches object storage.
- A fleet of two or more nodes proves a write faster than the bucket: a lab
  fleet measured ~600 ms for a bucket proof and ~25 ms for a fleet proof, and
  concurrent writes to one cell join one shared upload.
- Ten nodes (4 vCPU / 8 GB each) held 10,000 resident cells and 20,000
  concurrent WebSocket connections; after stopping two nodes, the data of
  every cell was available on another node in ~11 s at the tail.

## The failure edges

The strategy also records where a policy stops: the clearest edge is reserve
headroom — a fleet full to its resident limit has no space for the cells of a
lost node, so a failure of more than one node at the limit degrades the
service, and a fleet with headroom does not. Both sides of that line are
measured (`docs/testing.md:190-196`).

## Related pages

- [Architecture: cell lifecycle and ownership](../architecture/cell-lifecycle.md) — the phases the simulation exercises.
- [Durability, fencing, and the output gate](../architecture/durability-protocol.md) — the invariants the models check.
- [V8 runtime and Cloudflare Workers compatibility](../architecture/workers-runtime.md) — the surface the conformance corpus covers.
