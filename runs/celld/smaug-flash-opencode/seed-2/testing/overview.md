---
type: guide
title: Testing and the deterministic simulation
description: How celld protects its three promises — differential conformance vs workerd, exhaustive TLA+ model checking, deterministic simulation of the decision core, and live fleet fault injection.
tags: [testing, simulation, conformance, tla-model, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---

# Testing and the deterministic simulation

celld makes three promises: an acknowledged write is durable, a cell has one
writer at a time (never two), and code written for Cloudflare Workers and
Durable Objects operates the same on celld (`docs/testing.md:3-7`). The test
strategy attacks each promise at the layer where a failure shows most clearly
(`docs/testing.md:9-13`).

## Differential conformance vs workerd

The compatibility promise is tested differentially: each Workers/Durable Objects
program runs twice — once on **workerd**, the runtime Cloudflare operates in
production, and once on **celld** — on identical bytes, and the outputs must be
equal. This shows at once that the program is real Cloudflare code (workerd
accepts it) and that celld obeys the contract (outputs are equal); a test cannot
agree with the runtime by accident (`docs/testing.md:17-25`).

The corpus only grows. When celld gets a new API surface, fixtures for that
surface are added, and they must give equal output on the two engines. Workerd's
Durable Objects contract, web-platform globals, and upstream WPTs are also
ported (`docs/testing.md:27-32`).

## Exhaustive TLA+ model checking

The coordination protocol is also specified in TLA+. Model checking at a small
configuration visits every reachable state, killing four bugs and a split-brain
that lost an acknowledged write, none of which had surfaced in review or
testing (`docs/testing.md:37-40`). The model grants a linearizable object store
and perfect shared clocks, so a violation it finds needs no clock skew or store
anomaly (`docs/testing.md:44-46`).

Every configuration carries a pinned expected verdict, and most are failures:
each failing configuration models a bug the protocol once had, and the model must
produce the counterexample. A configuration that stops failing has lost its
tooth (`docs/testing.md:52-55`). The specifications are a hand-synced snapshot,
deliberately not in CI: a silently stale gate is worse than none
(`docs/testing.md:73-76`).

## Deterministic simulation of the decision core

The dangerous races (a crash during ownership handoff, a lease renewal racing a
takeover, an alarm against a partially restored cell) are nanosecond-wide and
rare, so the coordination protocol is a pure decision core with no I/O: the
clock, randomness, and object store are interfaces, and a simulator drives the
core (`docs/testing.md:81-91`). The simulated store injects latency,
compare-and-swap races, and lost responses; the clocks drift apart; a node can
crash at each await point. V8 stays out because it is not deterministic
(`docs/testing.md:92-94`).

A seeded scheduler drives each run, so a failure is not a fluke: the seed
replays it exactly, and the seed is kept until the bug is dead. Properties are
checked for safety (two writers in one epoch, a lost acknowledged write, an
expired lease that comes back) and liveness (each armed alarm fires, ownership
settles after a crash) (`docs/testing.md:97-102`).

Simulation has a known failure mode — a checker that cannot fail — so the
checkers themselves are tested with deliberately broken variants, and the
properties must find the damage (`docs/testing.md:105-108`).

## Live fleet fault injection

Simulation cannot see real S3 tail latency, real kernel/filesystem behavior, or
V8 under memory pressure. The third layer is a permanent fleet lab with standard
VMs and a real bucket (`docs/testing.md:110-115`). Faults are injected between
verification passes; a pass fetches each cell through different nodes and
compares the durable state exactly (`docs/testing.md:126-131`).

The scenarios attack every known seam (`docs/testing.md:133-151`):

- `SIGKILL` mid-write-stream and delete the local database, so recovery can only
  come from the bucket, and every acknowledged write comes back.
- Freeze an owner, write through other nodes, and unfreeze it: the node sees
  its lease moved, refuses the old state, and each write lands exactly once.
- Cut a node off from the bucket: it fences itself.
- Throttle the bucket: the engine slows to the write rate and does not amplify.
- Stop a full host at the provider level.

Across every run, no acknowledged write was lost and no committed state was
damaged (`docs/testing.md:153-155`).

## How a change is validated

- **Edit-time**: `State::validate` runs after every event and checks internal
  consistency (`crates/logic/lib.rs:1073`).
- **Deterministic simulation**: the core is driven by the seeded simulator;
  `celld` swaps to a simulated asyncrt under `cfg(celld_internal_tests)` while
  `test` alone keeps the real one, so shipped and harness builds keep the real
  asyncrt (`crates/celld/lib.rs:305-330`).
- **Conformance**: any JS surface change needs equal-output fixtures on the two
  engines.
- **The lab**: required for fault injection and release qualification.

## The failure edges

The policy's limits are recorded as edges: a fleet full to its resident limit
has no headroom to absorb a lost node, so a multi-node failure at the limit
degrades service, while a fleet with headroom does not (`docs/testing.md:189-195`).

---

## Related pages

- [Architecture: the decision core, the effect executor, and replication](/openwiki/concepts/architecture.md)
- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Change guides: representative maintenance tasks](/openwiki/operations/change-guides.md)
