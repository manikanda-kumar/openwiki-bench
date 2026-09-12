---
type: process
title: "Testing strategy"
description: "The three promises and the four test layers that protect them: differential execution against workerd, TLA+ model checking, deterministic simulation of celld-logic, and fault injection on a live fleet lab."
tags: [testing, differential, tlplus, simulation, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-55ec5a6f535496955b66f4ff
    resource: repo://crates/celld/host_services.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Testing strategy

[docs/testing.md](../docs/testing.md) opens with the three promises and the
layering principle: "We try to break each promise at the layer where a
failure shows most clearly."

- An acknowledged write is durable.
- A cell has one writer at a time.
- Code written for Cloudflare Workers and Durable Objects operates the same
  on celld.

## Differential conformance against workerd

"We test the compatibility promise differentially. We run each Workers and
Durable Objects program twice: once on workerd, the runtime binary that
Cloudflare operates in production, and once on celld, on identical bytes.
The two outputs must be equal" ([docs/testing.md](../docs/testing.md)). The
value of identical bytes from an independent runtime explains itself: "A test
cannot agree with our own runtime by accident." The corpus only grows — every
new API surface adds fixtures that must give equal output on both engines —
and workerd's own suites are ported (the Durable Objects contract, web
platform globals, upstream Web Platform Tests). Before a release, "we also
replay scenarios through the full `celld` binary in each deployment mode:
storage, SQL, alarms, streams, WebSockets, and lifecycle."

Where it lives in code: the conformance and fault test modules are inside
`crates/celld/lib.rs` (`conformance_core_loop_tests`, `conformance_world_*`,
`oil-oracle`-style module groups at `crates/celld/lib.rs:299-390`), and the
sans-IO pure predicates they check are the `crates/logic` modules.

## TLA+ specification: exhaustive at small size

"The coordination protocol is also specified in TLA+." Model checking found
"four bugs and a split-brain that lost an acknowledged write. All are fixed.
None had surfaced in our own review or testing"
([docs/testing.md](../docs/testing.md), "Specification"). Key properties of
the setup:

- The model grants a linearizable store and perfect clocks, so a violation
  needs no clock skew and no storage anomaly.
- Invariants checked: one writer per epoch; no acknowledged write lost; the
  fencing argument ("a stale owner's late writes … the epoch in the key
  keeps its lineage apart") is **checked, not asserted**.
- "Every configuration carries a pinned expected verdict, and most of the
  verdicts are failures" — each failing configuration models a past bug or a
  deliberately broken checker; "A configuration that stops failing has lost
  its tooth."
- The design-stage check caught an eight-state counterexample in the
  write-acknowledgment fence design before it shipped.
- Checking has **removed code**: an epoch-seal object was deleted because
  its permanent cut "could turn a recoverable ordering slip into a permanent
  loss" while guarding only a never-promised outcome.
- The TLA+ snapshot is "deliberately not in continuous integration: a
  silently stale gate is worse than none"; a delta ledger records what the
  model does not yet describe.

## Deterministic simulation

The coordination layers are the pure decision core — "a
[pure decision core](https://github.com/denoland/celld/tree/main/crates/logic)
with no I/O of its own: the clock, the randomness, and the object store are
interfaces, and a simulator drives the core" ([docs/testing.md](../docs/testing.md)).
The simulated store "injects latency, compare-and-swap races, and lost
responses; the clocks drift apart; a node can crash at each await point.
Scripted adversaries play the cells … V8 stays out of the simulation,
because V8 is not deterministic." Hypotheses are seeded: "the seed replays
it exactly, every time", and properties must survive tens of thousands of
seeds (millions of schedules for the core protocols), checked for safety
(two writers per epoch, lost acked write, resurrected expired lease) and
liveness (alarms fire, ownership settles after a crash).

The simulation itself is also checked: "we run deliberately broken variants
of the protocol against the properties, and the properties must find the
damage. A suite that stays green against a broken protocol is a broken
suite."

The clean design seam making this possible is the single `on_event`/`State`
door with injectable `asyncrt`/`HostServices` backends (see the
architecture page: "A deterministic domain installs [one service set] per
simulated node", `crates/celld/host_services.rs:3-6`).

## Live fleet fault injection

Simulation cannot see "the real S3 tail latency, the real kernel and
filesystem behavior, or V8 under memory pressure", so a permanent fleet lab
with real VMs and buckets rotates workloads (WebSocket chat, shifting
working sets with per-cell checksums, deployment cutovers, memory saturation)
and "qualifies each release". Faults are injected **between verification
passes**, where a pass "fetches each cell through different nodes and
compares the durable state exactly" — a clean before/after picture per fault
([docs/testing.md](../docs/testing.md)). Representative attacks, and what
each proves:

- `SIGKILL` mid-write-stream + local DB deletion ⇒ "Every acknowledged
  write comes back, because the output gate held each response until the
  write was durable."
- Freeze the owner, write through other nodes, unfreeze ⇒ the frozen node
  "refuses to serve the old state" (lease moved), one epoch ≤ one writer.
- Bucket cut-off ⇒ self-fencing.
- Bucket throttling (429) ⇒ the engine "slows to the write rate of the store
  and does not amplify the throttle".
- Whole-host stop ⇒ cells move; returning host rejoins.

Evidence bundle per run: configuration, sweeps, journals, kernel logs, phase
timings; "We keep a red run with the same care as a green run."

## Running it

The repo does not publish a CI recipe in this tree beyond the GitHub
workflows directory (`.github/workflows/`); the differential suite runs the
`celld` binary against workerd fixtures, the simulation drives `celld-logic`
via seeded schedulers, and [docs/testing.md](../docs/testing.md) is the
authoritative description of harness behavior. Exact fixture corpora are
not present in this checkout.
