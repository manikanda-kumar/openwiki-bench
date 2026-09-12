---
type: testing
title: Testing and Verification Strategy
description: celld's multi-layer verification — differential conformance against workerd, TLA+ model checking, deterministic simulation of the pure decision core, and live fleet fault injection — and the results the project trusts.
tags: [testing, conformance, simulation, tla-plus, verification]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Testing and Verification Strategy

celld makes three promises, and its testing is built to break each one at the
layer where a failure shows most clearly
(`docs/testing.md` lines 3-14):

- An acknowledged write is durable.
- A cell has one writer at a time; it never has two.
- Code written for Cloudflare Workers and Durable Objects operates the same on
  celld.

Four layers attack these: differential conformance, exhaustive model checking,
deterministic simulation, and live fleet fault injection.

## 1. Differential conformance against workerd

The compatibility promise is tested differentially (`docs/testing.md` lines
17-27). Each program runs twice — once on workerd (the runtime Cloudflare
operates in production) and once on celld, on identical bytes — and the two
outputs must be equal. This shows two facts at once: "the program is real
Cloudflare code, because workerd accepts it, and celld obeys the contract,
because the outputs are equal. A test cannot agree with our own runtime by
accident."

The corpus only grows. When celld gets a new API surface, fixtures are added
for that surface and must give equal output on the two engines. celld also
ports test suites from workerd itself. The conformance suites build into the
binary under `celld_internal_tests`, `include!`d from `crates/celld/lib.rs`
(e.g. `conformance_world_tests`, `conformance_world_s2_tests`,
`conformance_sim_store`, `conformance_sim_cell_host`, `conformance_o3_oracle`,
lines 365-430).

## 2. Exhaustive TLA+ model checking

The coordination protocol is specified in TLA+ (`docs/testing.md` lines
35-59). "At a small configuration it visits every reachable state" — where
simulation samples schedules, the checker enumerates them. The model grants a
linearizable object store and perfect shared clocks, so "a violation it finds
needs no clock skew and no storage anomaly to occur." The invariants are the
first two promises: one writer per epoch, and no acknowledged write lost.

Every configuration carries a pinned expected verdict, "and most of the
verdicts are failures: each failing configuration models a bug the protocol
once had ... a configuration that stops failing has lost its tooth." Model
checking against v0.1.0 found four bugs and a split-brain that lost an
acknowledged write, all fixed. The model has also removed code: it showed the
old restore-time seal defended only a write that was never acknowledged (an
outcome celld does not promise to prevent), and the seal was removed (lines
67-71).

The specifications are a hand-synced snapshot, deliberately not in CI: "a
silently stale gate is worse than none" (lines 73-77). Simulation is the
per-commit ratchet.

## 3. Deterministic simulation of the pure decision core

The dangerous bugs live where a crash, a lease race, and a half-restore
interleave. "These windows are nanoseconds wide and open rarely, so a test
cannot wait for them" (lines 81-86). The coordination protocol is therefore
"a pure decision core with no I/O of its own: the clock, the randomness, and
the object store are interfaces, and a simulator drives the core"
(lines 88-95). This is the design described on the [architecture
page](architecture.md); it is what makes the deterministic simulator possible.

The simulator (`crates/celld`'s `asyncrt` gated behind `celld_internal_tests`,
`crates/celld/lib.rs` lines 305-320; the simulated store and cell host in
`conformance_sim_store` / `conformance_sim_cell_host`) injects latency,
compare-and-swap races, and lost responses; "the clocks drift apart; a node can
crash at each await point"; scripted adversaries play the cells.

A seeded scheduler drives each run "so a failure is not a fluke: the seed
replays it exactly, every time, and we keep the seed until the bug is dead"
(lines 96-103). Properties cover safety (two writers in one epoch, a lost
acknowledged write, an expired lease that comes back) and liveness (each armed
alarm fires, ownership settles after a crash). A property must survive tens of
thousands of seeds, and the core protocols have run through millions.

"Simulation has a known failure mode: the checker that cannot fail." So the
checkers are broken on purpose — deliberately broken variants run against the
properties, and "a suite that stays green against a broken protocol is a
broken suite" (lines 105-109).

## 4. Live fleet fault injection

Simulation cannot see "the real S3 tail latency, the real kernel and filesystem
behavior, or V8 under memory pressure" (lines 111-127). The third layer is a
permanent fleet lab: standard VMs, a real bucket, and workloads that rotate
(chat rooms under many WebSockets, working sets across tens of thousands of
cells, deployment cutovers under load, runs that fill nodes to the memory
limit). Faults inject between verification passes, and each run makes an
archived evidence bundle; "we keep a red run with the same care as a green
run".

The attack scenarios (lines 133-151):

- **SIGKILL mid-write + local DB deleted** — recovery must come only from the
  bucket; every acknowledged write comes back because the output gate held
  each response until the write was durable.
- **Freeze → write via other nodes → unfreeze** — the node sees its lease
  moved and refuses the old state, and each write lands exactly once: one
  epoch, one writer.
- **Cut off from the bucket** — the node fences itself.
- **Throttle the bucket (429s)** — the engine slows to the store's write rate
  without amplifying the throttle.
- **Kill the host at the provider level** — cells move to other nodes and the
  returning host joins with no duplicate residency.

Across every run, no acknowledged write was lost and no committed state was
damaged — the verification sweeps show zero body faults, zero status faults,
and zero lost messages (lines 149-155).

## The numbers celld trusts

Each number carries its measurement conditions; "a number without its
conditions has no value" (lines 158-160). The notable tables
(lines 162-186):

- **Epoch fence under contention:** 500 claimants, 5,500 attempts to own the
  same cells, one writer per epoch, zero violations.
- **A warm resident request is local:** zero bucket operations for a request
  to a resident cell, p50 ~1.1 ms / p99 ~7 ms; only a cold activation touches
  storage.
- **A durable write waits for a durability proof:** single-node bucket proof
  is the minimum; lab fleet measured ~600 ms for a bucket proof and ~25 ms for
  a fleet proof, with the bucket upload racing the fleet proof so a slow
  follower cannot make a write slower than the bucket proof.
- **Ten small nodes held real scale:** 10,000 resident cells and 20,000
  concurrent WebSocket connections; stopping two nodes returned every cell's
  data in ~11 s at the tail.

The page explicitly does not state a restore-time number yet, because the
measured restore times came from the retired external replicator and no fleet
run has measured `celld-ltx` (lines 178-181).

## The failure edges celld intends to find

The page records where a policy stops instead of tuning the edge away (lines
188-199): the reserve headroom — a fleet full to its resident limit has no
space for a lost node's cells, so a failure of more than one node at the limit
degrades the service. Both sides of that line are measured. Bugs outside these
known edges are the report the project wants: "a schedule that breaks a
promise, a fault that we did not inject, a number that you cannot reproduce."
