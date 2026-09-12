---
type: "Reference"
title: "Change guides: representative maintenance tasks"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-9adfa4329f90a51f50e97ef0
    resource: repo://crates/logic/sweep.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Change guides: representative maintenance tasks

This page gives practical, scoped change guides for engineers who must safely
change celld. Each guide names the narrowest validation the repository
supports so a change is proven without running the whole lab.

## Where decisions and effects live

Before any change, recall the split: behavioral decisions go in
`celld-logic` (pure, no I/O, no clocks); the `celld` crate performs `Effect`s
as adapters. The `State::validate` invariant gate runs after every event in
both executors (`crates/logic/lib.rs:1073`). If a change alters decision state,
it must extend the `Event`/`Effect` vocabulary in `crates/logic/types.rs` and
drive it through `on_event` (`crates/logic/lib.rs:5215`); it must not mutate
`State` from an adapter.

## Adding a Worker API surface

The JS surface is added in the harness and the host ops. The two places a new
API must land, and must agree:

1. **The harness** (`crates/celld/js/harness.js`) registers the global and the
   host op that implements it.
2. **The Rust side** (`crates/celld/js.rs` and friends, e.g.
   `crates/celld/js/crypto.rs`, `crates/celld/js/r2_ops.rs`, `crates/celld/js/storage_ops.rs`)
   implements the op.

The conformance corpus is the narrowest validation: each new surface must have
fixtures that yield equal output on workerd and on celld (`docs/testing.md:17-23`).
"Equal output on the two engines" is what proves the contract
(`docs/testing.md:24-29`). A surface that does not produce a fixture set on
workerd is not yet conformance-tested.

## Tuning durability and write latency

Durability posture is an environment switch plus policy:

- `CELLD_OUTPUT_GATE` gates the whole output gate (default `1`)
  (`docs/README.md:690`).
- `CELLD_DURABILITY` selects `fleet` (default) vs `bucket`
  (`docs/README.md:691`).
- `CELLD_LTX_COMPACTION`, `CELLD_LTX_COMPACTION_MIN_TXIDS`, and
  `CELLD_LTX_COMPACTIONS` tune the additive L1 compaction
  (`docs/README.md:696-698`).
- `CELLD_LTX_DURABILITY_TIMEOUT_SECS` is the durability-proof deadline and the
  final-snapshot retry window (`docs/README.md:699`).

These are read through `crates/celld/env_vars.rs`, which validates each typed
variable before the runtime starts so a malformed value is a startup error, not
a silent behavior change (`crates/celld/env_vars.rs:3-15`). When you add a new
`CELLD_*` knob, add it to the validation pass in `env_vars.rs` and to the
documented table in `docs/README.md`, and decide whether it is an ordinary
probability or belongs in a different parse class.

## Adding a cell-backed feature

A new cell-backed feature (like KV or Queues) follows the reserved-cell pattern:

1. Define a reserved class name starting with `__` (e.g. in
   `crates/logic/`), gated by a `required_features` value so a missing class
   fails at deploy rather than at request time (`crates/celld/protocol.rs:54-99`).
2. Put the pure address/policy decisions in the matching `crates/logic/*.rs`
   module. Note the stated rule: a second implementation is a second set of
   answers, so the bounds ship as *data* the harness compares against, and
   failed duplicate Rust checks were removed (`crates/logic/kv.rs:3-26`). Reuse
   this pattern: keep one source of truth for bounds.
3. Never leave an unbounded cleanup loop: shared cell reclamation is bounded
   per cell turn by `sweep::BATCH_ROWS` (256 rows), which Kv and Queues use
   with the same harness executor (`crates/logic/sweep.rs:3-9`).

The narrowest validation is the conformance corpus plus the in-crate unit
slices; a full lifecycle surface belongs in the fault-injection lab.

## Upgrading between releases

Not every release is a rolling update. The current boundaries are documented in
`docs/README.md:514-544`:

- v0.1.0 → v0.2.0 must not be a rolling update (listener address and block-object
  changes).
- v0.2.1 → v0.3.0 can use a rolling update, but a v0.3.0 node cannot replicate
  to a v0.2.x peer; stage the binary on every node.
- v0.3.0 → v0.4.0 must not use a rolling update (all proxied cell calls move
  onto one tunneled connection and the peer protocol refuses a different
  version).

Before changing the peer wire, update `peer_auth::PROTOCOL_VERSION`
(`crates/celld/peer_auth.rs:16`) and consider whether the change can negotiate
(the tunnel establishment carries the version, so a later protocol change can
negotiate instead of refuse). A protocol mismatch must surface as
`Unavailable`/`PeerIncompatible`, never authorize a takeover
(`crates/logic/types.rs:110-111`).

## Validating a change without the full lab

The layered approach (`docs/testing.md` and the testing page):

- **Edit-time invariant gate**: keep `State::validate` green after every event.
- **Deterministic simulation**: run the core against a seeded scheduler; the
  sim store injects latency, CAS races, and lost responses. Keep the seed until
  a bug is dead (`docs/testing.md:83-104`).
- **Conformance**: for any JS surface change, run the workerd-vs-celld corpus.
- **The lab** is required for fault injection (kill, freeze, bucket-throttle)
  and for release qualification (`docs/testing.md:110-131`).

---

## Related pages

- [Architecture: the decision core, the effect executor, and replication](/openwiki/concepts/architecture.md)
- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
- [Testing and the deterministic simulation](/openwiki/testing/overview.md)
