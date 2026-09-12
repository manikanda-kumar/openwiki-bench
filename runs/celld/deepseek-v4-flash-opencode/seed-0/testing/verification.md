---
type: testing
title: Testing and Verification
description: How celld verifies its three promises — acknowledged writes are durable, one writer per cell, Cloudflare compatibility — through differential workerd conformance, TLA+ specifications, deterministic simulation of the decision core, live-fleet fault injection, and the internal test build flags.
tags: [testing, conformance, simulation, tla+, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Testing and Verification

celld makes three promises: an acknowledged write is durable; a cell has
one writer at a time, never two; and code written for Cloudflare Workers
and Durable Objects operates the same on celld. Each promise is attacked
at the layer where a failure shows most clearly — the API contract by
differential execution against the Cloudflare runtime, the coordination
protocol by an exhaustively model-checked specification and by
deterministic simulation, and the full system by fault injection on live
fleets (docs/testing.md#L3-L15).

## Conformance: two runtimes, one output

The compatibility promise is tested differentially. Each Workers and
Durable Objects program runs twice — once on workerd, the runtime binary
Cloudflare operates in production, and once on celld, on identical bytes —
and the two outputs must be equal. This shows two facts at once: the
program is real Cloudflare code, because workerd accepts it, and celld
obeys the contract, because the outputs are equal. A test cannot agree
with celld's own runtime by accident (docs/testing.md#L17-L25). The corpus
only grows: new API surfaces add fixtures, and celld also ports test
suites from workerd itself (docs/testing.md#L27-L33).

## Specification: exhaustive at small size

The coordination protocol is also specified in TLA+. The model was
written against celld v0.1.0, and its model checking found four bugs and
a split-brain that lost an acknowledged write — none of which had surfaced
in review or testing (docs/testing.md#L37-L42).

Where simulation samples schedules, the checker enumerates them: at a
small configuration it visits every reachable state, and the model grants
the implementation a linearizable object store and perfect shared clocks,
so a violation it finds needs no clock skew and no storage anomaly. The
invariants are the first two promises — one writer for each epoch, and no
acknowledged write lost (docs/testing.md#L43-L50).

Every configuration carries a pinned expected verdict, and most verdicts
are failures: each failing configuration models a bug the protocol once
had, and the model must produce the counterexample — a configuration that
stops failing has lost its tooth. The checker has also removed code: the
epoch seal at restore was deleted because the verdicts showed it defended
only a write that was never acknowledged (docs/testing.md#L52-L67).

The specifications are a hand-synced snapshot, deliberately not in
continuous integration: a silently stale gate is worse than none.
Simulation remains the per-commit ratchet, and the model is its exhaustive
small-configuration complement (docs/testing.md#L73-L79).

## Simulation: the protocol under adversarial schedules

The dangerous bugs live in the coordination — a crash during an ownership
handoff, a lease renewal that races a takeover, an alarm that fires
against a partially restored cell — and these windows are nanoseconds wide
and open rarely, so a test cannot wait for them. The coordination protocol
is therefore a pure decision core with no I/O of its own: the clock, the
randomness, and the object store are interfaces, and a simulator drives
the core. The simulated store injects latency, compare-and-swap races, and
lost responses; the clocks drift apart; a node can crash at each await
point; scripted adversaries play the cells. V8 stays out of the
simulation, because V8 is not deterministic (docs/testing.md#L81-L95).

A seeded scheduler drives each run, so a failure is not a fluke: the seed
replays it exactly, and the seed is kept until the bug is dead. Properties
cover safety (two writers in one epoch, a lost acknowledged write, an
expired lease that comes back) and liveness (each armed alarm fires,
ownership settles after a crash), and the core protocols have run through
millions of schedules (docs/testing.md#L97-L103). The checkers are tested
too: deliberately broken variants of the protocol must be found by the
properties, because a suite that stays green against a broken protocol is
a broken suite (docs/testing.md#L105-L108).

## Live fleets: what simulation cannot see

The third layer is a permanent fleet lab: standard VMs, a real bucket,
and workloads that rotate — chat rooms under many WebSocket connections,
working sets that shift across tens of thousands of cells, deployment
cutovers under load, and runs that fill nodes to the memory limit. The
lab qualifies each release and pushes density and fault coverage between
releases (docs/testing.md#L110-L124).

Faults are injected between verification passes, and a pass fetches each
cell through different nodes and compares the durable state exactly. The
scenarios attack every known seam: SIGKILL mid-write-stream with the local
database deleted; freezing an owner while other nodes write to its cells
and then unfreezing it; cutting a node off from the bucket so it fences
itself; throttling the bucket with 429s; and stopping a full host at the
provider level (docs/testing.md#L126-L155). Across every run of every
scenario, no acknowledged write was lost and no committed state was
damaged (docs/testing.md#L155).

Measured numbers include: 500 claimants / 5,500 attempts at one epoch with
zero violations; a warm resident request at p50 ~1.1 ms and p99 ~7 ms with
zero bucket operations; a fleet proof around 25 ms versus a bucket proof
around 600 ms in a loaded lab; and ten 4-vCPU/8-GB nodes holding 10,000
resident cells and 20,000 concurrent WebSockets, with every cell's data
available again on another node in ~11 s at the tail after two nodes
stopped (docs/testing.md#L162-L186).

## The internal test build

The decision core and the library crates compile no unit-test target of
their own (`test = false` in `crates/logic/Cargo.toml` and
`crates/ltx/Cargo.toml`); the test suites live in the `celld` crate and
are gated behind the `celld_internal_tests` cfg. The `celld` library
`include!`s the conformance suites from the environment (`CELLD_CONFORMANCE_*`,
`CELLD_INTERNAL_ASYNCRT`, `CELLD_INTERNAL_ASYNCRT_TESTS`,
`CELLD_INTERNAL_SQLITE_FAULT`, `CELLD_INTERNAL_MEMORY_TESTS`, and a
deterministic-simulation asyncrt replacement) so the harness binary builds
the same world the in-crate suites see while shipped and harness builds
keep the real asyncrt (crates/celld/lib.rs#L300-L318,
crates/celld/lib.rs#L365-L430). `celld-logic` deliberately has no I/O, no
async, no clocks, no randomness, and no locks
(crates/logic/Cargo.toml#L5-L7).

## The failure edges the lab records

The reserve-headroom edge is measured on both sides on purpose: a fleet
that is full to its resident limit has no space for the cells of a lost
node, so a failure of more than one node at the limit degrades the
service, and a fleet with headroom does not (docs/testing.md#L189-L196).
