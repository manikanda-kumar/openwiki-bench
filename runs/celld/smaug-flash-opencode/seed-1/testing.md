---
type: testing
title: Testing Strategy
description: How celld tests its three promises — differential conformance against workerd, a TLA+ model-checked specification, deterministic simulation of the decision core, and live fleet fault injection.
tags: [testing, conformance, tla-plus, simulation, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Testing Strategy

celld makes three promises (`docs/testing.md:3-6`): an acknowledged write is
durable; a cell has one writer at a time (never two); and code written for
Cloudflare Workers and Durable Objects operates the same on celld. The tests try
to break each promise at the layer where a failure shows most clearly, in four
layers (`docs/testing.md:9-15`): differential execution against the Cloudflare
runtime, a model-checked specification, deterministic simulation, and fault
injection on live fleets.

## Layer 1: Conformance — two runtimes, one output

The compatibility promise is tested differentially. Each Workers and Durable
Objects program runs twice — once on `workerd`, the runtime binary Cloudflare
operates in production, and once on celld, on identical bytes — and the two
outputs must be equal. This shows two facts at once: the program is real
Cloudflare code because workerd accepts it, and celld obeys the contract because
the outputs are equal (`docs/testing.md:17-26`). The corpus grows with each new
API surface, and test suites are also ported from workerd itself
(`docs/testing.md:27-34`).

The conformance world tests are wired in `crates/celld/lib.rs`,
which `include!`s external conformance test modules (`conformance_world_tests`,
`conformance_world_s1..s5`, `conformance_world_coverage`, and the simulated
`conformance_sim_store` / `conformance_sim_cell_host`) behind the
`celld_internal_tests` cfg (`crates/celld/lib.rs:365-429`). The `asyncrt` module
is likewise replaced by a simulated runtime under that cfg so the external
engine-tests crate sees the same simulated world the in-crate suites see
(`crates/celld/lib.rs:305-316`).

## Layer 2: Specification — exhaustive at small size

The coordination protocol is also specified in TLA+. The model-checked
specifications were written against celld v0.1.0 and found four bugs and a
split-brain that lost an acknowledged write; all are fixed and none had
surfaced in review or testing (`docs/testing.md:37-40`).

Where simulation samples schedules, the checker enumerates them: at a small
configuration it visits every reachable state. The model grants the
implementation a linearizable object store and perfect shared clocks, so a
violation it finds needs no clock skew or storage anomaly. The invariants are
the first two promises: one writer for each epoch and no acknowledged
write lost (`docs/testing.md:42-50`).

Every configuration carries a pinned expected verdict, and most verdicts are
failures — each failing configuration models a bug the protocol once had, and
the model must produce the counterexample, so a configuration that stops failing
has lost its tooth (`docs/testing.md:52-57`). The checker has also removed code:
the seal at restore was removed after the verdicts showed it could turn a
recoverable ordering slip into a permanent loss (`docs/testing.md:67-71`).

The specifications are a hand-synced snapshot deliberately not in continuous
integration — a silently stale gate is worse than none — while simulation
remains the per-commit ratchet (`docs/testing.md:73-79`).

## Layer 3: Simulation — the protocol under adversarial schedules

The dangerous bugs live in the coordination (a crash during an ownership
handoff, a lease renewal that races a takeover, an alarm against a partially
restored cell). celld's coordination protocol is a pure decision core
(`crates/logic/lib.rs`) with no I/O of its own; the clock, randomness, and
object store are interfaces, and a simulator drives the core
(`docs/testing.md:81-94`). The simulated store injects latency, compare-and-swap
races, and lost responses; clocks drift; a node can crash at each await point.
V8 stays out of the simulation because it is not deterministic.

A seeded scheduler drives each run, so a failure replays exactly; properties
check both safety (two writers in one epoch, a lost acknowledged write, an
expired lease that comes back) and liveness (each armed alarm fires, ownership
settles on one node after a crash). The core protocols have run through millions
of schedules (`docs/testing.md:95-103`). The checkers are themselves tested with
deliberately broken variants, because a suite that stays green against a broken
protocol is broken (`docs/testing.md:105-108`).

## Layer 4: Live fleets — what simulation cannot see

The permanent fleet lab attacks every seam (`docs/testing.md:109-155`): stop a
node mid-stream and delete its local database, freeze an owner while others
write and unfreeze it, cut a node off from the bucket, throttle the bucket with
429s, and stop a full host at the provider level. A verification pass fetches
each cell through different nodes before and after the fault and compares the
durable state exactly. Across every run, no acknowledged write was lost and no
committed state was damaged (`docs/testing.md:149-155`).

The fleet-lab number conditions are documented alongside the measurements
(`docs/testing.md:157-186`).

## The failure edges

The testing page records where the policy stops — most clearly the reserve
headroom edge: a fleet full to its resident limit has no space for the cells of
a lost node, so a failure of more than one node at the limit degrades the
service. Both sides of that line are measured (`docs/testing.md:188-196`).

## Uncertainty note

The TLA+ specifications themselves are not present in this repository; they are
a hand-synced snapshot maintained outside it, and `docs/testing.md` states their
location indirectly via their update practice. This page therefore evidences
the testing layers from `docs/testing.md` and the conformance wired into the
`crates/celld` build, and does not independently assert the model's current
contents.
