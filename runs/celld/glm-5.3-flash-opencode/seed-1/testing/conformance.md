---
type: testing
title: Testing and conformance strategy
description: The four-layer verification strategy — differential conformance against workerd, exhaustively model-checked TLA+ specifications, deterministic simulation of the pure decision core, and a live fleet lab with fault injection.
tags: [testing, conformance, simulation, tla-plus, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Testing and conformance strategy

celld makes three promises the strategy targets ([docs/testing.md](repo://docs/testing.md#L3-L15)):

1. An acknowledged write is durable.
2. A cell has one writer at a time.
3. Code written for Cloudflare Workers and Durable Objects operates the
   same on celld.

The tests aim at each promise "at the layer where a failure shows most
clearly": differential execution against the real Cloudflare runtime,
exhaustive model checking of the coordination protocol, deterministic
simulation, and fault injection on live fleets.

## Layer 1 — differential conformance

Each Workers/DO program runs **twice on identical bytes**: once on
**workerd** (the production Cloudflare runtime) and once on celld. "The
two outputs must be equal. This shows two facts at once: the program is
real Cloudflare code, because workerd accepts it, and celld obeys the
contract, because the outputs are equal. A test cannot agree with our
own runtime by accident" [docs/testing.md](repo://docs/testing.md#L17-L25).

The corpus only grows: new API surfaces add fixtures, and test suites
ported from workerd itself (Durable Objects contract, web-platform
globals, Web Platform Tests) join it. Before release, scenarios replay
through the full `celld` binary in each deployment mode (storage, SQL,
alarms, streams, WebSockets, lifecycle) [docs/testing.md](repo://docs/testing.md#L27-L33).

## Layer 2 — TLA+ model checking at small size

The coordination protocol is also specified in TLA+ (written by Heyang
Zhou against celld v0.1.0). "His model checking found four bugs and a
split-brain that lost an acknowledged write. All are fixed. None had
surfaced in our own review or testing" [docs/testing.md](repo://docs/testing.md#L36-L41).

Where simulation samples schedules, the model **enumerates** them: at a
small configuration it visits every reachable state. The model grants
the implementation a linearizable object store and perfect shared
clocks, so a violation needs no clock skew or storage anomaly to occur.
The invariants are the promises themselves — one writer per epoch, no
acknowledged write lost — including the fencing argument that a stale
owner's late writes cannot cost an acknowledged write because the
epoch prefix keeps its lineage apart. That argument is checked, not
asserted [docs/testing.md](repo://docs/testing.md#L43-L50).

Every configuration has a pinned verdict, and **most are failures** —
each failing configuration models a bug the protocol once had, or a
deliberately broken checker, and must produce the same counterexample;
"a configuration that stops failing has lost its tooth"
[docs/testing.md](repo://docs/testing.md#L52-L57).

The checker has also **removed code**: celld once sealed a cell's
durable history at restore, and the verdicts showed the seal defended
only against the return of a write that was never acknowledged (an
outcome celld does not promise to prevent) while its permanent cut could
turn a recoverable ordering slip into permanent loss — the seal is gone
[docs/testing.md](repo://docs/testing.md#L66-L72).

The specifications are a **hand-synced snapshot, deliberately not in
CI**: "a silently stale gate is worse than none". A delta ledger records
what the model does not yet describe, including places where the model
is **weaker** than the code rather than wrong
[docs/testing.md](repo://docs/testing.md#L73-L79).

## Layer 3 — deterministic simulation

The dangerous bugs live in coordination: a crash during ownership
handoff, a lease renewal racing a takeover, an alarm firing against a
partially restored cell — "windows [that] are nanoseconds wide and open
rarely, so a test cannot wait for them"
[docs/testing.md](repo://docs/testing.md#L82-L86).

"Thus the coordination protocol is a pure decision core ... with no I/O
of its own: the clock, the randomness, and the object store are
interfaces, and a simulator drives the core." (See
[Workspace layout](/openwiki/architecture/workspace-layout.md) for the
crate that makes this possible, and the `on_event` entry point.) The
simulated store injects latency, compare-and-swap races, and lost
responses; clocks drift; a node can crash at each await point;
scripted adversaries play the cells. **V8 stays out of the
simulation, because V8 is not deterministic.**
[docs/testing.md](repo://docs/testing.md#L88-L95).

Each run is seeded, "so a failure is not a fluke: the seed replays it
exactly, every time, and we keep the seed until the bug is dead".
Properties are checked for safety (two writers in one epoch, lost
acknowledged write, expired-lease resurrection) and liveness (each
armed alarm fires; ownership settles after a crash). A property must
survive "tens of thousands of seeds", and the core protocols have run
"through millions of different schedules"
[docs/testing.md](repo://docs/testing.md#L97-L103).

Because a checker that cannot fail is itself a failure mode, celld
"also test[s] the checkers: we run deliberately broken variants of the
protocol against the properties, and the properties must find the
damage. A suite that stays green against a broken protocol is a broken
suite" [docs/testing.md](repo://docs/testing.md#L105-L108).

## Layer 4 — the live fleet lab

"Simulation cannot see the real S3 tail latency, the real kernel and
filesystem behavior, or V8 under memory pressure" — so the third layer
is a permanent fleet lab: standard VMs and a real bucket, rotating
workloads (chat rooms under many WebSockets, working sets shifting
across tens of thousands of cells with per-cell checksums, deployment
cutovers under load, memory-limit runs) and archived evidence bundles
(configuration, verification sweeps, node journals, kernel logs, phase
timings). "We keep a red run with the same care as a green run"
[docs/testing.md](repo://docs/testing.md#L110-L124).

Fault injection attack seams between verification passes — a pass
fetches each cell through different nodes and compares durable state
exactly (status, body, full message ledger), giving a clean picture
before and after each fault [docs/testing.md](repo://docs/testing.md#L126-L131).
Documented scenarios:

- SIGKILL mid-write-stream plus local-database deletion — every
  acknowledged write comes back (the output gate held each response).
- Freeze an owner, write through other nodes, unfreeze — the node sees
  its lease moved and refuses the old state; each cross-node write
  lands exactly once.
- Cut a node off from the bucket — it fences itself.
- Throttle the bucket with 429s — the engine slows to the store's
  write rate without amplifying.
- Stop a full host mid-workload — cells move to other nodes and the
  returning host re-joins with no duplicate residency
  [docs/testing.md](repo://docs/testing.md#L133-L152).

"Across every run of every scenario, no acknowledged write was lost and
no committed state was damaged; the verification sweeps show zero body
faults, zero status faults, and zero lost messages"
[docs/testing.md](repo://docs/testing.md#L153-L156).

## Trusted numbers carry their measurement conditions

Each number in the docs includes its measurement condition
[docs/testing.md](repo://docs/testing.md#L158-L196):

- 500 concurrent claimants, 5,500 attempt total: **one writer for each
  epoch, zero violations**.
- Warm resident request: p50 ~1.1 ms, p99 ~7 ms, **zero bucket
  operations**; only a cold activation touches storage.
- Durability: a bucket proof is at least one storage round trip; a lab
  fleet measured ~600 ms bucket vs ~25 ms fleet; the bucket upload
  races every fleet proof, and concurrent writes to one cell share one
  upload.
- Ten 4-vCPU/8 GB nodes held 10,000 resident cells and 20,000
  concurrent WebSockets; stopping two of ten restored every cell in
  ~11 s at the tail (with reserve headroom).
- Record in the doc page is also what the **failure edge** means: a
  fleet at its resident limit has no space for a lost node's cells, so
  a multi-node failure at the limit degrades; a fleet with headroom
  does not.

## How the layers attach to the code

- The pure core that simulation drives is `crates/logic`
  ([decision-core page](/openwiki/architecture/workspace-layout.md)).
- Within `crates/celld/lib.rs` an explicit `celld_internal_tests` cfg
  wires the conformance and simulation harnesses to the same shipped
  code: contract tests, world tests, an O3 oracle, sim store, and cell
  host modules, deliberately excluded from the public build so
  "the shipped and harness builds keep the real asyncrt"
  [crates/celld/lib.rs](repo://crates/celld/lib.rs#L299-L384).
- The Docker test stage (which the release image depends on) runs
  `cargo test` and clippy under the release profile
  ([build pipeline page](/openwiki/release/build-pipeline.md)).
