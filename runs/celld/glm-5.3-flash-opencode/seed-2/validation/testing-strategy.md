---
type: validation
title: Testing strategy
description: The four verification layers — differential conformance against workerd, TLA+ model checking, deterministic simulation, and live fleet fault injection — plus the build/check ladder.
tags: [testing, conformance, simulation, tla, fault-injection]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Testing strategy

celld is tested at the layer where a failure shows most clearly, against
its three promises: an acknowledged write is durable; a cell has one
writer at a time; and code written for Cloudflare operates the same
(repo://docs/testing.md#L3-L8). The repository has four verification
layers plus a `.github/workflows/release.yml` release pipeline with a
candidate/publish split that runs the tests.

## Layer 1: Differential conformance against workerd

The compatibility promise is checked differentially: each Workers and
Durable Objects program runs twice — once on workerd (Cloudflare's
production runtime) and once on celld — on *identical bytes*, and the
outputs must be equal. This proves two facts at once: workerd accepting
the program proves it is real Cloudflare code, and the outputs' equality
proves celld obeys the contract. The corpus only grows: a new API surface
adds fixtures that must give equal output on both engines; test suites
are also ported from workerd itself and the Web Platform Tests. Before a
release, scenarios replay through the full `celld` binary in each
deployment mode: storage, SQL, alarms, streams, WebSockets, and
lifecycle (repo://docs/testing.md#L10-L33).

The compatibility gulf is documented and enforced in
`docs/cloudflare-compat.md`: **Yes** = fully implements; **Partial** =
some gaps enumerated; **No** = not implemented; and "celld must reject an
unsupported configuration or API at deployment or first use. An
unsupported feature that does not cause an error is a defect"
(repo://docs/cloudflare-compat.md#L5-L12).

## Layer 2: TLA+ model checking

The coordination protocol is specified in TLA+ (specifications written by
Heyang Zhou against celld v0.1.0). Model checking found four bugs and a
split-brain that lost an acknowledged write — all fixed, none surfaced by
review or testing (repo://docs/testing.md#L44-L49). Each configuration
carries a pinned expected verdict; *most verdicts are failures* — each
failing configuration models a bug the protocol once had (or a
deliberately broken checker), and the model must produce the
counterexample. A configuration that stops failing has lost its tooth.
The specifications are deliberately not in continuous integration; a
silently stale gate is worse than none, so they are hand-synced with a
delta ledger of what the model does not yet describe, including places
the model is weaker than the code rather than wrong
(repo://docs/testing.md#L58-L79).

## Layer 3: Deterministic simulation

The dangerous coordination bugs live in nanosecond-wide windows that a
test cannot wait for, so the concurrency skeleton is a pure decision core
(`crates/logic`) whose clock, randomness, and object store are
interfaces. A simulator scripts the adversarial schedule: injected
latencies, CAS races, lost responses, drifting clocks, and crashes at
every await point; scripted adversaries play cells that never return or
write streams that stop halfway. V8 stays out of simulation because V8 is
not deterministic. Seeded schedulers replay every failure, and properties
— safety (two writers in one epoch, a lost acknowledged write, an expired
lease returning) and liveness (alarms fire, ownership settles after a
crash) — must survive tens of thousands of seeds. Deliberately broken
protocol variants are also run so the properties can prove they would
find real damage, guarding against "the checker that cannot fail"
(repo://docs/testing.md#L84-L106).

## Layer 4: Live fleet fault injection

Simulation cannot see real S3 tail latency, kernel/filesystem behavior, or
V8 under memory pressure. The fourth layer is a permanent fleet lab of
real VMs and a real bucket, with rotating workloads (chat rooms under many
WebSockets, shifting working sets across tens of thousands of cells,
deployment cutovers under load, node-saturating runs). Faults are injected
between verification passes so each pass compares the durable state
exactly:

- `SIGKILL` mid-write-stream with local-database deletion — every
  acknowledged write comes back via the output gate.
- Freeze an owner, write through other nodes, unfreeze — the node sees
  its lease moved and refuses to serve the old state.
- Bucket unreachable — the node self-fences (a node that cannot
  replicate must not own cells).
- Bucket throttled (429s) — the engine slows to the store's write rate
  without amplifying the throttle.
- Full host stop at provider level — cells move to other nodes and the
  host re-joins with no duplicate residency.

(repo://docs/testing.md#L108-L145)

The lab qualifies each release; each run leaves an archived evidence
bundle with configuration, sweeps, node journals, kernel logs, and phase
timings, and failures-as-results (red runs) are kept with the same care
as green ones (repo://docs/testing.md#L108-L112).

## The build and check ladder

Developers run the lighter layers locally:

1. `cargo build --locked -p celld` — the workspace pins dependencies in
   `Cargo.lock` (repo://Dockerfile#L19-L25).
2. `cargo test` — the Dockerfile test stage runs plain `cargo test`
   including the LTX fault-injection oracle (which shells out to the
   `sqlite3` CLI) plus `cargo clippy --all-targets --locked -- -D
   warnings`; a break in tests or lints stops the release build
   (repo://Dockerfile#L16-L45).
3. The conformance and simulation suites live *inside* `crates/celld` but
   compile only under `cfg(celld_internal_tests)`. The gate selects
   include!-ed files by path, e.g.
   `#[cfg(all(test, celld_internal_tests))] mod conformance_world_tests
   { include!(env!("CELLD_CONFORMANCE_WORLD_TESTS")); }`. A normal
   `cargo test` skips them, so validating a decision change needs the
   internal-test build (repo://crates/celld/lib.rs#L299-L435).
4. Lint discipline matches the layering rule: `crates/logic`'s Cargo.toml
   warns on `unexpected_cfgs` and `crates/celld` forbids
   `disallowed_macros`; the clippy config forbids Rocket-facing
   disallowed methods for the execution boundary: `tokio::spawn` →
   `celld::asyncrt::spawn`, tokio time → `celld::asyncrt`, `std::fs::*`
   read paths → the injected whole-node filesystem
   (repo://clippy.toml#L1-L30). New code must respect this boundary or
   carry an explicit allow with a reason, and each `clippy.toml` entry
   carries that reasoning.
5. Release: a push to a candidate ref builds every native target, attests
   provenance, uploads a draft release, publishes after human approval,
   then builds/pushes architecture images from the tagged commit and
   a multi-arch manifest (repo://.github/workflows/release.yml#L5-L20).

## What simulation *cannot* see (and the edges we intend to find)

The clearest documented edge is reserve headroom: a fleet full to its
resident limit has no space for a lost node's cells, so a multi-node
failure at the limit degrades the service while a fleet with headroom
does not — both sides of that line are measured, good restoration with
reserve and the red case without (repo://docs/testing.md#L160-L168).
