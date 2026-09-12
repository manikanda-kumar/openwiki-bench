---
type: concept
title: "Testing strategy: conformance, model checking, simulation, and live fleets"
description: How celld tests its three promises — an acknowledged write is durable, a cell has one writer at a time, and Cloudflare Workers code operates the same — across four layers.
tags: [testing, conformance, tla-plus, simulation, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Testing strategy: conformance, model checking, simulation, and live fleets

celld makes three promises: an acknowledged write is durable, a cell has one
writer at a time (never two), and code written for Cloudflare Workers and
Durable Objects operates the same on celld. Each promise is attacked "at the
layer where a failure shows most clearly"
(docs/testing.md#L3-L15): differential execution against the Cloudflare
runtime, an exhaustively model-checked specification, deterministic
simulation, and fault injection on live fleets.

## Conformance: two runtimes, one output

The compatibility promise is tested differentially: each Workers and Durable
Objects program runs twice, once on workerd (the runtime binary Cloudflare
operates in production) and once on celld, on identical bytes, and the two
outputs must be equal. This shows two facts at once — the program is real
Cloudflare code, because workerd accepts it, and celld obeys the contract,
because the outputs are equal (docs/testing.md#L17-L33).

The corpus only grows. When celld gets a new API surface, fixtures for that
surface are added, and the fixtures must give equal output on the two
engines. The corpus also ports test suites from workerd itself: the Durable
Objects contract, the web-platform globals, and the upstream Web Platform
Tests. Before a release, scenarios are replayed through the full `celld`
binary in each deployment mode: storage, SQL, alarms, streams, WebSockets,
and lifecycle (docs/testing.md#L27-L33).

## Specification: exhaustive at small size

The coordination protocol is also specified in TLA+. Heyang Zhou wrote the
specifications against celld v0.1.0, and the model checking found four bugs
and a split-brain that lost an acknowledged write — all fixed, none surfaced
in celld's own review or testing (docs/testing.md#L35-L40).

Where simulation samples schedules, the checker enumerates them: at a small
configuration it visits every reachable state. The model grants the
implementation a linearizable object store and perfect shared clocks, so a
violation it finds needs no clock skew and no storage anomaly to occur. The
invariants are the first two promises: one writer for each epoch, and no
acknowledged write lost. The fencing argument itself — that a stale owner's
late writes cannot cost an acknowledged write because the epoch in the key
keeps its lineage apart — is checked, not asserted (docs/testing.md#L41-L52).

Every configuration carries a pinned expected verdict, and most of the
verdicts are failures: each failing configuration models a bug the protocol
once had, or a deliberately broken checker, and the model must produce the
counterexample. A configuration that stops failing has lost its tooth; one
tooth had already fallen out when the specifications arrived and was
repaired (docs/testing.md#L53-L59).

Some specifications model a proposed protocol before it is built. When the
fence on write acknowledgments was redesigned, the design-stage check
produced an eight-state counterexample against the version it replaced: a
dormant cell resumes at its old epoch while its release is in flight,
acknowledges a write, and the takeover that follows restores without it
(docs/testing.md#L60-L65). The checker has also removed code: celld once
sealed a cell's durable history at restore, and the verdicts showed the seal
defended only the return of a write that was never acknowledged — an outcome
celld does not promise to prevent — while its permanent cut could turn a
recoverable ordering slip into a permanent loss, so the seal is gone
(docs/testing.md#L66-L71).

The specifications are a hand-synced snapshot, deliberately not in continuous
integration: "a silently stale gate is worse than none." A delta ledger
records what the model does not yet describe, including places where the
model is weaker than the code rather than wrong. Simulation remains the
per-commit ratchet; the model is its exhaustive small-configuration
complement (docs/testing.md#L73-L79).

## Simulation: the protocol under adversarial schedules

The dangerous bugs live in the coordination — a crash during an ownership
handoff, a lease renewal that races a takeover, an alarm that fires against a
partially restored cell. These windows are nanoseconds wide and open rarely,
so a test cannot wait for them (docs/testing.md#L81-L86).

Thus the coordination protocol is a pure decision core with no I/O of its
own (docs/testing.md#L88-L95). This is the `celld-logic` crate: `on_event`
is the only way behavioral state advances, the production executor and the
deterministic simulator both feed it events and perform the returned
effects, and no adapter may mutate `State` directly
(crates/logic/lib.rs#L3-L7). A simulator drives the core: the simulated
store injects latency, compare-and-swap races, and lost responses; the clocks
drift apart; a node can crash at each await point. Scripted adversaries play
the cells — a handler that never returns, a write stream that stops halfway.
V8 stays out of the simulation because V8 is not deterministic
(docs/testing.md#L88-L95).

A seeded scheduler drives each run, so a failure is not a fluke: the seed
replays it exactly, every time, and the seed is kept until the bug is dead.
Each property is examined for safety (two writers in one epoch, a lost
acknowledged write, an expired lease that comes back) and for liveness (each
armed alarm fires, and ownership settles on one node after a crash). A
property must survive tens of thousands of seeds, and the core protocols have
run through millions of different schedules (docs/testing.md#L96-L103).

Simulation has a known failure mode — the checker that cannot fail — so the
checkers are tested too: deliberately broken variants of the protocol run
against the properties, and the properties must find the damage. "A suite
that stays green against a broken protocol is a broken suite"
(docs/testing.md#L105-L108).

In the `celld` crate the same simulated world is wired in behind the
`celld_internal_tests` cfg: the `asyncrt` module switches to a simulated
implementation, and the conformance suites and the simulated store and cell
host are included from the environment-supplied sources
(crates/celld/lib.rs#L299-L320, crates/celld/lib.rs#L394-L418). The decision
core also exposes observation hooks for tests (`AuthorityObserverSnapshot`,
`StepSafetyObserverSnapshot`) behind the same cfg
(crates/logic/lib.rs#L192-L210).

## Live fleets: what simulation cannot see

Simulation cannot see the real S3 tail latency, the real kernel and
filesystem behavior, or V8 under memory pressure. The third layer is a
permanent fleet lab: standard VMs from standard providers, a real bucket, and
rotating workloads — chat rooms under many WebSocket connections, working
sets across tens of thousands of cells, deployment cutovers under load, and
runs that fill the nodes to the memory limit. Each run makes an archived
evidence bundle, and a red run is kept with the same care as a green run,
because "a failure that the harness caught is a result, not a retry"
(docs/testing.md#L110-L124).

Faults are injected between verification passes. A pass fetches each cell
through different nodes and compares the durable state exactly: the status,
the body, and the full message ledger. A cell can be unavailable for a short
time while its ownership moves, but its committed state must stay complete
and a live node must serve that state again (docs/testing.md#L126-L131). The
scenarios attack every seam: SIGKILL in the middle of a write stream with the
local database deleted (recovery only from the bucket); freezing an owner
node, writing through other nodes, and unfreezing it (each write lands
exactly once, because one epoch has at most one writer); cutting a node off
from the bucket (it fences itself); throttling the bucket with 429s (the
engine slows to the store's write rate and does not amplify the throttle);
and stopping a full host at the provider level
(docs/testing.md#L133-L151). Across every run of every scenario, no
acknowledged write was lost and no committed state was damaged
(docs/testing.md#L153-L155).

## Numbers with their conditions

Each measured number includes the condition of its measurement, because a
number without its conditions has no value (docs/testing.md#L157-L160):

- **The epoch fence holds under contention.** Five hundred claimants tried at
  the same time to own the same cells: 5,500 attempts, one writer for each
  epoch, zero violations (docs/testing.md#L162-L165).
- **A warm resident request is local.** A request to a resident cell does
  zero bucket operations and returns p50 ~1.1 ms and p99 ~7 ms (fixed-host
  measurement); only a cold activation touches object storage
  (docs/testing.md#L165-L168).
- **A durable write waits for a durability proof.** A single node proves each
  write through the bucket (one storage round trip minimum); a fleet of two
  or more can prove a write when each follower holds it on disk, measured at
  ~600 ms for a bucket proof and ~25 ms for a fleet proof. The bucket upload
  races every fleet proof and either one proves the write, and concurrent
  writes to one cell join one shared upload
  (docs/testing.md#L169-L177).
- **Ten small nodes held real scale.** A fleet of ten 4 vCPU/8 GB nodes held
  10,000 resident cells and 20,000 concurrent WebSocket connections; stopping
  two of the ten made every cell's data available again on another node in
  ~11 s at the tail, with reserve headroom (docs/testing.md#L182-L186).

## The failure edges

The edges are recorded instead of tuned away. The clearest is the reserve
headroom: a fleet full to its resident limit has no space for the cells of a
lost node, so a failure of more than one node at the limit degrades the
service, and a fleet with headroom does not. Both sides of that line are
measured — the good restoration with reserve and the red case without —
because the measurement is part of the work
(docs/testing.md#L188-L196).

## Release pipeline

The GitHub Actions release workflow builds every native target from the
`candidate` branch, attests provenance, and requires the container image's
test stage to pass before anything can publish (release.yml#L5-L20,
release.yml#L77-L99). A pushed candidate builds and smoke-builds the image; a
published release triggers the container phase that stitches the
architecture images into a multi-architecture manifest with the same
provenance attestation as the binaries.
