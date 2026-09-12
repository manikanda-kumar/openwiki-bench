---
type: "Reference"
title: "Change guide and verification"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-e119253b3c3737247dc63f2a
    resource: repo://.openwikiignore
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-e28533de6827635caf8da428
    resource: repo://clippy.toml
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-21adc106d1045e80037ebe52
    resource: repo://crates/logic/Cargo.toml
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-fb3f4a433a44fb71aaaecdf1
    resource: repo://crates/ltx/Cargo.toml
  - id: openwiki-source-10a3ca6704a0d403c63dff35
    resource: repo://crates/ltx/README.md
  - id: openwiki-source-a8a1e30fb844726b73892292
    resource: repo://crates/ltx/src/lib.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
  - id: openwiki-source-988163704c46e5140d5f9050
    resource: repo://docs/wasm.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---


# Change guide and verification

This page is for the engineer who must "understand, operate, debug, and safely
change" the repository. Start from the ownership rule in the workspace header:
`crates/logic` owns behavioral state and decisions; `crates/celld` is an effect
executor and adapter host ([Cargo.toml#L1-L5](repo://Cargo.toml#L1-L5)). A
change that moves a decision from the shell into a pure module is nearly always
the right shape; the reverse is nearly always wrong.

## What verification actually exists in this snapshot

This matters because the repository's own docs promise more than a plain
checkout can run, and guessing wrongly wastes review time:

- **No `#[test]` attribute exists in the visible source.** The in-crate test
  and observer bodies are injected from *external* files via
  `include!(env!("CELLD_..."))` behind `cfg(celld_internal_tests)`
  ([crates/celld/lib.rs#L299-L317](repo://crates/celld/lib.rs#L299-L317),
  [crates/celld/lib.rs#L366-L367](repo://crates/celld/lib.rs#L366-L367)), and
  those corpus files are not part of this snapshot. The library test harnesses
  are additionally disabled in the manifests
  ([crates/logic/Cargo.toml#L11](repo://crates/logic/Cargo.toml#L11),
  [crates/ltx/Cargo.toml#L19](repo://crates/ltx/Cargo.toml#L19)).
  So `cargo test` from a clean checkout compiles and runs (almost) nothing; it
  is not the ratchet it appears to be.
- **The compile-visible guards are real.** `cargo build --locked` is the CI
  build ([.github/workflows/release.yml#L52-L60](repo://.github/workflows/release.yml#L52-L60)),
  and the Dockerfile's test stage gates every image on
  `cargo test --locked` **plus** `cargo clippy --all-targets --locked --
  -D warnings` ([Dockerfile#L23-L34](repo://Dockerfile#L23-L34)). `clippy.toml`
  is an architecture enforcement file, not style: within the actor boundary it
  forbids ambient `tokio::spawn`, `tokio::time`, `std` clocks, `rand::random`,
  `std::process::id`, and `std::fs`, each with a reason naming the execution-
  domain substitute ([clippy.toml#L1-L24](repo://clippy.toml#L1-L24)). A new
  `#![allow(clippy::disallowed_methods)]` is a design comment — write the why,
  like the existing ones do.
- **The stage installs `sqlite3` "for the ltx fault-injection oracle" to diff
  databases** ([Dockerfile#L26-L28](repo://Dockerfile#L26-L28)); the oracle
  itself rides on the crate's `doc(hidden)` `internal` API, which exists to
  "support external verification tools" with no compatibility guarantee
  ([crates/ltx/src/lib.rs#L28-L36](repo://crates/ltx/src/lib.rs#L28-L36)).
- **`docs/testing.md` describes layers that are not in this repository**: the
  TLA+ specifications, the seeded deterministic simulation, the workerd
  differential conformance corpus, and the live-fleet lab
  ([docs/testing.md#L29-L130](repo://docs/testing.md#L29-L130)). The
  repository establishes the strategy and claims, not runnable harnesses; do
  not assume any local command exercises them, and do not treat a protocol
  change as validated by a green local build alone.
- **End-to-end checks a developer *can* run here**: `cargo run -p celld -- dev`
  against any project in `examples/` (each is a runnable Wrangler project, e.g.
  `examples/counter`), `celld --version`/`--help` via `celld dev`, and
  `celld diagnose` (including `--read-only`) for a real bucket
  ([examples/README.md#L3-L28](repo://examples/README.md#L3-L28),
  [crates/celld/bucket.rs#L1395-L1399](repo://crates/celld/bucket.rs#L1395-L1399)).

## Where a change belongs

| Change | Goes in | Because |
| --- | --- | --- |
| New lifecycle/concurrency/addressing decision | `crates/logic/<module>.rs` as a pure predicate/transition + a `types.rs` `Effect`/`Event` | adapters "must not rediscover or guess" what the core decided ([crates/logic/lib.rs#L49-L52](repo://crates/logic/lib.rs#L49-L52)) |
| New I/O, wire format, SDK behavior, error classification | `crates/celld/<adapter>.rs`, completing via versioned mailbox events | the actor is the only `on_event` caller ([crates/celld/lib.rs#L5-L9](repo://crates/celld/lib.rs#L5-L9)) |
| LTX file format, capture, compaction, restore | `crates/ltx` | it owns the on-disk/object format; keep Litestream file compatibility in mind ([crates/ltx/README.md#L49-L61](repo://crates/ltx/README.md#L49-L61)) |
| Anything observable by operators | docs table + CLI help + `/state`/diagnose output | `/state` and `celld diagnose` publish phase names as stable vocabulary ([crates/logic/lib.rs#L212-L214](repo://crates/logic/lib.rs#L212-L214)) |

## Recipe: add or change a `CELLD_*` variable

1. Read it through a `crates/celld/env_vars.rs` helper, never `std::env::var`
   directly at a call site: an unset variable takes its documented default,
   and "a typo cannot silently change the configuration of a running node"
   ([crates/celld/env_vars.rs#L3-L7](repo://crates/celld/env_vars.rs#L3-L7)).
2. Register the name in `env_vars::validate()`'s flag/positive/optional list
   so the process exits during startup on an invalid value
   ([crates/celld/env_vars.rs#L11-L56](repo://crates/celld/env_vars.rs#L11-L56),
   [crates/celld/main.rs#L2989](repo://crates/celld/main.rs#L2989),
   [docs/README.md#L706-L708](repo://docs/README.md#L706-L708)); this is what
   makes synchronous call sites infallible
   ([crates/celld/env_vars.rs#L12-L15](repo://crates/celld/env_vars.rs#L12-L15)).
   Booleans accept only `0`/`1` ([crates/celld/env_vars.rs#L115-L121](repo://crates/celld/env_vars.rs#L115-L121)).
3. Update `celld --help`'s environment list
   ([crates/celld/main/cli.rs#L330-L375](repo://crates/celld/main/cli.rs#L330-L375))
   and the `docs/README.md` variables table
   ([docs/README.md#L660-L704](repo://docs/README.md#L660-L704)).
4. If the value belongs in the core `Config`, pass it through the edge→
   `Config` path (see how `pressure::PressureConfig` is "built once from the
   environment by the caller; the core never reads the environment itself"
   [crates/logic/pressure.rs#L17-L19](repo://crates/logic/pressure.rs#L17-L19))
   rather than reading env inside `crates/logic`.

## Recipe: add a Workers/DO API surface

1. Bind it in the V8 layer (`crates/celld/js.rs` plus `js/bootstrap.rs` /
   harness JS) and keep the Rust↔JS contract synchronous-underneath where the
   Durable Object API is local SQLite (`storage.rs` exposes sync Rust ops, the
   JS harness wraps them in `async`)
   ([crates/celld/storage.rs#L6-L12](repo://crates/celld/storage.rs#L6-L12)).
2. If the feature changes what a deployment may require, add the feature
   string to `SUPPORTED_DEPLOYMENT_FEATURES` and make `celld deploy` mark
   manifests with it, so an old node refuses at deploy time instead of
   misbehaving at request time
   ([crates/celld/protocol.rs#L54-L66](repo://crates/celld/protocol.rs#L54-L66),
   [docs/wasm.md#L24-L27](repo://docs/wasm.md#L24-L27)).
3. Add a runnable example under `examples/` and register it in
   `examples/README.md` ([examples/README.md#L3-L23](repo://examples/README.md#L3-L23)).
4. Update `docs/cloudflare-compat.md`; its rule is that celld must reject an
   unsupported configuration or API at deployment or first use, and "an
   unsupported feature that does not cause an error is a defect"
   ([docs/cloudflare-compat.md#L3-L13](repo://docs/cloudflare-compat.md#L3-L13)).

## Recipe: change a bucket-resident object

The deployment and state objects are a fleet-wide compatibility contract, not
implementation details ([crates/celld/protocol.rs#L3-L4](repo://crates/celld/protocol.rs#L3-L4)).
Before changing a wire type:

- Every mixed-version reader must still parse the record: use
  `#[serde(default)]`/skip patterns the way `NodeLeaseWire` does — a silent
  absence must not read as a meaningful zero ("a consumer that ranks nodes
  must not read a silent zero as the emptiest node in the fleet for the length
  of a rolling upgrade"
  [crates/celld/ownership_store.rs#L83-L90](repo://crates/celld/ownership_store.rs#L83-L90)).
- Decide explicitly between rolling-safe and stop-all. The repo's own history
  is the checklist: advertised-address semantics and unreadable block objects
  forced a stop-all for v0.2.0; the peer tunnel and epoch-qualified KV rows
  forced one for v0.4.0 ([docs/README.md#L513-L544](repo://docs/README.md#L513-L544)).
- A format change that old readers cannot use needs a feature gate (deploy
  refuses) or an env kill-switch for mixed fleets, like
  `CELLD_LTX_COMPACTION=0` "until all nodes can read block files"
  ([crates/ltx/README.md#L57-L61](repo://crates/ltx/README.md#L57-L61)).
- Remember the two prefixes you cannot change quietly: ownership keys
  (`cells/<cell>/own.json`) carry epochs that never reset
  ([crates/logic/types.rs#L139-L143](repo://crates/logic/types.rs#L139-L143)),
  and the epoch prefix `cells/<cell>/ltx/e<epoch>/` is the fence itself
  ([crates/celld/replication.rs#L4-L7](repo://crates/celld/replication.rs#L4-L7)).

## Recipe: extract a policy into the core

The established shape (see any `logic/*.rs` module): write the decision as a
pure function or transition over observed facts; the executor performs I/O,
reports results as events, and cannot make the decision itself; document the
rationale and the rejected alternative in the module header, as
`cache.rs` ([crates/logic/cache.rs#L3-L16](repo://crates/logic/cache.rs#L3-L16)),
`gate.rs` ([crates/logic/gate.rs#L30-L53](repo://crates/logic/gate.rs#L30-L53)),
and `routing.rs` ([crates/logic/routing.rs#L14-L18](repo://crates/logic/routing.rs#L14-L18))
do; add the invariants to `State::validate` if they are
cross-cutting ([crates/logic/lib.rs#L1073-L1090](repo://crates/logic/lib.rs#L1073-L1090)).
Keep inputs as *observations*: the module headers are emphatic that the shell
reports and the core decides
([crates/logic/isolate.rs#L24-L26](repo://crates/logic/isolate.rs#L24-L26)).

## Contributing

The repository disables pull requests outright — the stated reason is review
cost — and asks for focused `git format-patch` attachments emailed to
`ry@deno.com`, with an implicit CLA on submission
([README.md#L313-L327](repo://README.md#L313-L327)). Keep patches small,
respect the review time you are asking for, and prefer the narrowest
validation that proves the changed behavior.

A housekeeping note: `AGENTS.md`, `CLAUDE.md`, and the `openwiki-update`
workflow under `.github/workflows/` are OpenWiki-generated host integration
files and are excluded from the evidence base by `.openwikiignore`
([.openwikiignore#L1-L4](repo://.openwikiignore#L1-L4)); source code and tests
remain authoritative.

Related: [quickstart](../quickstart.md) ·
[architecture hub](../architecture.md) ·
[actor boundary](../architecture/actor-execution.md) ·
[decision core](../architecture/decision-core.md) ·
[ltx engine](../persistence/ltx-engine.md)
