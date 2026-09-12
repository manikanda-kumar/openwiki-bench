---
type: "Reference"
title: "Change guide: common maintenance tasks"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---


# Change guide: common maintenance tasks

These walkthroughs map representative maintenance tasks to the places in
this repository that own them and to the verification each change needs.
celld's layering rule — `crates/logic` decides, `crates/celld` executes —
determines *where* each change lands (repo://Cargo.toml#L1-L2).

## 1. Update a coordination or lifecycle decision

Changes to when a node acquires/renews/leases, sheds cells, plans an alarm
wake, or drives the fleet log tier usually go through **both** layers:

1. **Decision** — edit the relevant module(s) in `crates/logic`
   (`crates/logic/*.rs`), the same modules the deterministic simulator and
   the TLA+ specifications cover. Respect the crate purity contract: keep
   the change free of async, I/O, clocks, randomness, locks, and
   dependencies (repo://crates/logic/Cargo.toml#L10-L14). Conversely, the
   raw V8 adapter and its child modules are explicitly *outside* the Actor
   execution domain (repo://crates/celld/js.rs#L1-L3).
2. **Effect plumbing** — add or adjust the `Effect` rendering in
   `crates/celld/actor.rs` / `actor/production.rs` so the executor actually
   performs what the core decided. If a new effect requires I/O or async
   spawning, it must route through `celld::asyncrt` rather than raw tokio —
   the disallowed-methods lints enforce `tokio::spawn` →
   `celld::asyncrt::spawn`, `tokio::time::*` → `celld::asyncrt`, clock
   access → the execution-domain wall/monotonic clocks, and filesystem
   access → the injected whole-node filesystem
   (repo://clippy.toml#L1-L30).

**Validation**: build with the internal test gates. The conformance suites
(`conformance_core_loop_tests`, `conformance_world_*`, simulation arms) only
compile under `cfg(celld_internal_tests)`, selected at build time via
`CELLD_INTERNAL_*` env-driven `include!`s — a normal `cargo test` skips them,
so a decision change needs the internal-test build that assembles the
conformance corpus (repo://crates/celld/lib.rs#L299-L435). The Dockerfile's
test stage runs `cargo test` plus `cargo clippy --all-targets --
-D warnings` and installs the `sqlite3` CLI for the LTX fault-injection
oracle (repo://Dockerfile#L31-L45). `panic = "abort"` in `profile.release`
means releases cannot unwind; new code must not rely on catch_unwind
behavior (repo://Cargo.toml#L5-L11).

## 2. Add an environment variable / operational knob

1. Add the variable's parse and validation where it controls behavior —
   numeric limits usually go through `celld::env_vars::positive_or` family
   or are parsed in `crates/celld/machine.rs`
   (`lease_ttl_ms_from_environment`, `pressure_config_from_environment`,
   etc., repo://crates/celld/machine.rs#L53-L131).
2. If the variable is *decision-relevant* (it changes when the core sheds,
   arms, or renews), the value must be observed by the decision core via an
   event, not read by the core itself — the core cannot call
   `std::env::var` because `crates/logic` has no I/O
   (repo://crates/logic/Cargo.toml#L10-L14).
3. Update `crates/celld/env_vars.rs`'s `validate()` allow/deny lists if the
   variable belongs there, and document it in `docs/README.md`'s environment
   table; the doc table is the user-facing contract
   (repo://crates/celld/env_vars.rs#L16-L36, repo://docs/README.md#L665-L708).

**Validation**: the startup contract is that invalid values exit during
startup (repo://docs/README.md#L706-L708); a focused unit test at the parse
site plus a boot smoke (`celld dev`) usually suffices for config-only
plumbing.

## 3. Implement a Workers / Durable Objects API surface

1. Extend and test the surface differentially. The testing contract: run
   each Workers program on workerd (Cloudflare's production runtime) and on
   celld on identical bytes and require exactly equal output
   (repo://docs/testing.md#L10-L33). A program cannot pass by agreeing with
   itself: workerd accepting it proves the program is real Cloudflare code.
2. Implement the behavior in `crates/celld/js.rs` (and child modules
   `websocket`, `crypto`, `zlib`, `r2_ops`, `storage_ops`,
   `v8_strings`), which is the JS engine that runs one isolate per cell and
   implements the runtime APIs (repo://crates/celld/js.rs#L7-L77).
3. Derive per-worker capabilities from the manifest's
   `compatibility_date` / `compatibility_flags` through the `Compat` switch
   struct so behavior tracks workerd's
   (repo://crates/celld/js.rs#L1680-L1700,
   repo://crates/celld/deploy.rs#L1811-L1826).
4. Update `docs/cloudflare-compat.md` — every gap must be listed
   (repo://docs/cloudflare-compat.md#L5-L12).
5. Verify the deployment pipeline handles any new manifest field or asset
   kind: `crates/celld/deploy.rs` builds the bundle and emits `manifest.json`
   (repo://crates/celld/protocol.rs#L15-L44).

**Validation**: differential conformance fixtures for the new surface (they
must give equal output on both engines, repo://docs/testing.md#L27-L29),
plus the full-fleet release scenarios — the pre-release replay runs storage,
SQL, alarms, streams, WebSockets, and lifecycle through the whole `celld`
binary in each deployment mode (repo://docs/testing.md#L31-L33).

## 4. Touch the ownership / replication / durability protocol

This is the highest-risk lane. The protocol has its own verification stack:

- Changes belong nowhere but the decision core + its executor: ownership,
  fencing, replication, and log-tier policy in `crates/logic` (with the
  executor side in `crates/celld/{ownership_store,node_log,ltx_repl,
  replication}.rs`).
- The TLA+ specifications and simulation properties guard two invariants:
  one writer per epoch, and an acknowledged write is never lost
  (repo://docs/testing.md#L52-L68). Simulation runs property checks across
  tens of thousands of seeds; a change to ownership or the log tier should
  sustain that (repo://docs/testing.md#L92-L100).
- Design-stage model checking is used for proposed protocol changes: when
  the write-ack fence was redesigned, the checker produced a counterexample
  before code existed (repo://docs/testing.md#L64-L70).
- Never weaken a pinned failure: most checker verdicts are *expected bug
  counterexamples*, and a configuration that stops failing has lost its
  tooth (repo://docs/testing.md#L58-L61).
- ` CELLD_STORAGE_PROBE=0` and the `celld diagnose --read-only` path exist
  for storage-side verification against a qualified store
  (repo://docs/guarantees.md#L88-L102).

## 5. Run the test ladder

From heavy to light:

1. Live-fleet fault injection lab — the release qualification layer (real
   bucket, real latencies, SIGKILLs, freezes; repo://docs/testing.md#L108-L124).
2. Differential conformance against workerd (repo://docs/testing.md#L10-L33).
3. Deterministic simulation of the decision core under adversarial
   schedules (repo://docs/testing.md#L92-L105).
4. `cargo test && cargo clippy --all-targets --locked -- -D warnings` in
   the container test stage (repo://Dockerfile#L31-L44).
5. Local smoke: `celld dev` plus an example like `examples/counter` to drive
   a real Durable Object end-to-end (repo://examples/README.md#L37-L49).
