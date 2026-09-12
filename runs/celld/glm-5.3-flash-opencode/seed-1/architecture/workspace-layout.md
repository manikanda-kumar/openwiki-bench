---
type: architecture
title: Workspace layout and crate ownership
description: The three-crate workspace — pure decision core (celld-logic), effect executor/adapter host (celld), and the vendored replication engine (celld-ltx) — plus dependency policy and build profiles.
tags: [architecture, workspace, crates, ownership, build]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-3fa7b94a6ed05a0c35f6ec1f
    resource: repo://crates/celld/Cargo.toml
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-fb3f4a433a44fb71aaaecdf1
    resource: repo://crates/ltx/Cargo.toml
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Workspace layout and crate ownership

## Three crates, one workspace

The workspace has `resolver = "2"` and members `crates/*`. Its top comment
states the design: "`crates/logic` owns all behavioral state and decisions;
`crates/celld` is only an effect executor and adapter host"
[Cargo.toml](repo://Cargo.toml#L1-L5).

| Crate | Cargo name | Role |
| --- | --- | --- |
| `crates/logic` | `celld-logic` | Pure decision core; no async, I/O, clocks, randomness, locks, or dependencies |
| `crates/celld` | `celld` | The daemon: effect executor, V8 host, HTTP/peer surfaces, adapters; produces the `celld` binary |
| `crates/ltx` | `celld-ltx` | In-process SQLite→object-store replication engine (LTX format); vendored |

## The decision core (celld-logic)

`notes` in `crates/logic/lib.rs` define the contract precisely:

> `on_event` is the only way behavioral state advances. The production
> executor and deterministic simulator both feed it events and perform the
> returned effects. No adapter may mutate `State` directly.
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L4-L7)

`pub fn on_event(state: &mut State, event: Event) -> Vec<Effect>` is the
single entry point [crates/logic/lib.rs](repo://crates/logic/lib.rs#L5215-L5215).
The crate's own Cargo.toml declares "[lib] test = false" and its header
comment reads "Pure decision core: no async, I/O, clocks, randomness,
locks, or dependencies"
[crates/logic/Cargo.toml](repo://crates/logic/Cargo.toml#L6-L9). Its module
list covers the behavioral domains: alarms, cache, cells, cron, dead-node
reconciliation, drain, gates, HTTP routing, isolation, KV, log eviction,
log tiering, peers, pressure, queues, restore, routing, scheduling,
SQLite, sweep, and wake
[crates/logic/lib.rs](repo://crates/logic/lib.rs#L11-L32).

This purity is what enables the simulation strategy documented in
[Testing and conformance](/openwiki/testing/conformance.md): "the
coordination protocol is a pure decision core with no I/O of its own: the
clock, the randomness, and the object store are interfaces, and a simulator
drives the core" [docs/testing.md](repo://docs/testing.md#L88-L90).

## The effect executor and adapter host (celld)

`crates/celld` is the daemon. It produces `lib.rs` plus the `celld` binary
from `main.rs` [crates/celld/Cargo.toml](repo://crates/celld/Cargo.toml#L4-L15).
Its module surface (from `lib.rs` groups the runtime's effect domains:

- Runtime & V8: `actor`, `js` (and the `js/` submodules for crypto,
  storage, WebSockets, zlib, R2...), `host_services`, `asyncrt`,
  `pool`, `ws_client`.
- Fleet & bucket effects: `bucket`, `storage`, `fleet`, `deploy`,
  `ownership_store`, `lease`, `drain_token`, `dead_node_gc`,
  `peer_auth`, `peer_probe`.
- Replication: `ltx_repl`, `replication`, `node_log`, `generation`,
  `wake`.
- Command-line/CLI/CLI-out tooling: `cli_options`, `cli_output`, `cell_cli`,
  `d1_cli`, `kv_cli`, `queue_cli`, `dev`, `deploy`, `startup`,
  `telemetry`, `otlp`, `memory`, `machine`, `protocol`.
[crates/celld/lib.rs](repo://crates/celld/lib.rs#L299-L363)

Note the effect boundary: procedures like the diagnostic CLI run **outside**
the Actor execution domain — `fleet.rs` opens with a scoped permit:
`// Fleet CLI and peer-diagnostic work executes outside the Actor execution
// domain. #![allow(clippy::disallowed_methods)]`
[crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L3-L5).

## The replication engine (celld-ltx)

`crates/ltx` is `celld-ltx`, described as "in-process SQLite→object-store
replication for celld". `crates/ltx/Cargo.toml` records its provenance:

> Vendored 2026-08-03 from rustyriver (github.com/mikenomitch/rustyriver,
> Apache-2.0), itself a Rust reimplementation of Litestream v0.5
> (github.com/benbjohnson/litestream, Apache-2.0) and the LTX format
> (github.com/superfly/ltx, Apache-2.0). celld owns and evolves this
> snapshot; it does not track an upstream branch. It serves celld's RPO=0
> durability goal for every cell write.
[crates/ltx/Cargo.toml](repo://crates/ltx/Cargo.toml#L1-L7)
[crates/ltx/src/lib.rs](repo://crates/ltx/src/lib.rs#L1-L14)

The library doc carries the same point on the inside:
"It captures WAL data as LTX segments, reads and writes replica storage,
restores databases, compacts levels, and reads bundle objects. The original
replication behavior is a from-scratch Rust reimplementation of Litestream
v0.5.11. The block format follows LTX v0.5.2"
[crates/ltx/src/lib.rs](repo://crates/ltx/src/lib.rs#L1-L8).

Its features choose the object-store backend: `default = ["s3"]` with
optional `gcs` and `azure`
[crates/ltx/Cargo.toml](repo://crates/ltx/Cargo.toml#L20-L24). The `celld`
crate enables only the `s3` feature of `celld-ltx`
(`celld-ltx = { workspace = true, features = ["s3"] }`)
[crates/celld/Cargo.toml](repo://crates/celld/Cargo.toml#L22-L22).

## Dependency policy

Every direct dependency is declared once in `[workspace.dependencies]`, so
member crates "can never drift onto two versions of the same crate"; each
member adds its own features
[Cargo.toml](repo://Cargo.toml#L33-L35).

Version pinning is deliberate where behavior-critical:

- `fastwebsockets` is exactly `=0.8.1` because the tunnel needs the
  unstable `unstable-split` read/write halves (a WebSocket read is not
  cancel-safe and must survive while the same socket is written); Deno Land
  maintains the crate, and "the version is exact to keep the upgrade a
  decision rather than a surprise" [Cargo.toml](repo://Cargo.toml#L50-L59).
- `urlpattern` is exactly `=0.4.2`
  [Cargo.toml](repo://Cargo.toml#L136-L136).
- `sqlite-vec` is pinned to the audited C amalgamation `=0.1.9` because the
  project is pre-v1 and its Rust binding is outside its compatibility
  policy [Cargo.toml](repo://Cargo.toml#L116-L118).
- Crypto-crate versions and features follow deno's `ext/node_crypto`, where
  they do (p256/p384/p521/x25519-dalek/rsa/pkcs8/dsa)
  [Cargo.toml](repo://Cargo.toml#L84-L102).
- `v8` is `152.1`, chosen because shared isolates need `v8::Locker` and
  Send Globals shipped in that version ("no path override, and no
  hand-built archive") [Cargo.toml](repo://Cargo.toml#L137-L140).

Lint rails keep the boundary visible: member crates
`#![warn(clippy::disallowed_methods, clippy::disallowed_types)]`
[crates/ltx/src/lib.rs](repo://crates/ltx/src/lib.rs#L1-L1) and forbid
`disallowed_macros` [crates/ltx/Cargo.toml](repo://crates/ltx/Cargo.toml#L25-L27);
a maintained `clippy.toml` sits at the workspace root.

## Build profiles

The workspace tunes its profiles for latency-sensitive behavior:

- **`release`**: `lto = "fat"`, `codegen-units = 1`, `opt-level = "s"`,
  `panic = "abort"`, `strip = true`. The header comment explains the
  choices: fat LTO prunes unused dependency code, panic=abort drops unwind
  tables, and `opt-level "s"` (not `"z"`) with "measure RPS before trading
  further" [Cargo.toml](repo://Cargo.toml#L7-L14). The release profile stays
  stripped, while the lab profile keeps symbols so `perf` can attribute CPU
  by function.
- **`lab`** (a fast rebuild loop): inherits release but uses `lto = "thin"`,
  `codegen-units = 16`, `incremental = true`, `strip = false`, and
  `debug = "line-tables-only"` so lab sessions rebuild faster and still
  attribute CPU samples. Shipped artifacts always build on `release`
  [Cargo.toml](repo://Cargo.toml#L15-L27).
- **Dev crypto speed-up**: `[profile.dev.package.sha2]` and
  `[profile.dev.package.rsa]` are set to `opt-level = 3`, so those two
  crypto packages stay optimized even in dev builds
  [Cargo.toml](repo://Cargo.toml#L28-L31).

The repository does not document a separate dedicated CI test profile; the
`lab` profile description is "the lab fast loop" and the release pipeline
(CI) builds with `cargo build --release --locked` in
[.github/workflows/release.yml](repo://.github/workflows/release.yml).
