---
type: quickstart
title: Quickstart
description: Build celld from source, run an example app with celld dev, deploy to a qualified bucket, start fleet nodes, and find the right wiki page per engineering task.
tags: [quickstart, build, dev, deploy, run, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-3fa7b94a6ed05a0c35f6ec1f
    resource: repo://crates/celld/Cargo.toml
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-d1f8171ced840731654fd4ea
    resource: repo://docs/limitations.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Quickstart

celld is one Rust workspace producing one binary that is simultaneously the
node, the deploy tool, and the operator CLI. This page gets you from a clone
to a running app and points at the deep page for each task. Source and
`docs/` are the contract; everything here is verified against `main/cli.rs`
and `dev.rs`.

## Build from source

Prerequisites the repository itself establishes: the pinned toolchain is Rust
1.97.1 (Dockerfile and release workflow; crate MSRVs are 1.94.1), and the build
links `v8` (rusty_v8) and bundled SQLite — so a working cargo environment with
crate access is assumed ([Dockerfile#L3-L19](repo://Dockerfile#L3-L19),
[.github/workflows/release.yml#L26-L60](repo://.github/workflows/release.yml#L26-L60),
[crates/celld/Cargo.toml#L5](repo://crates/celld/Cargo.toml#L5)):

```sh
cargo build --release --locked -p celld     # shipped profile (fat LTO, slow link)
cargo build --profile lab --locked -p celld # fast loop: thin LTO, incremental, symbols kept
```

The `lab` profile exists for exactly this loop; shipped artifacts stay on
`release` ([Cargo.toml#L7-L28](repo://Cargo.toml#L7-L28)). Containers build
from the same Dockerfile, whose final image depends on the `test` stage
(`cargo test` + `cargo clippy -D warnings`), so a broken lint gate fails the
image ([Dockerfile#L21-L34](repo://Dockerfile#L21-L34)). Release binaries are
provided for Linux x86-64, Linux ARM64, and Apple Silicon — Windows is not
supported ([.github/workflows/release.yml#L32-L43](repo://.github/workflows/release.yml#L32-L43),
[docs/limitations.md#L45-L48](repo://docs/limitations.md#L45-L48)).

## Run an example: `celld dev`

From a project directory — the repository's own examples work out of the box:

```sh
cd examples/counter
cargo run -p celld -- dev        # or: celld dev ./examples/counter from the repo root
```

`celld dev` opens a persisted local object store, deploys the application, and
starts one supervised node; no Docker, no cloud bucket
([docs/README.md#L274-L283](repo://docs/README.md#L274-L283)).
Key surface, verified in `crates/celld/dev.rs` and
[docs/README.md#L274-L337](repo://docs/README.md#L274-L337):

- Worker listener defaults to `http://127.0.0.1:9876`
  ([crates/celld/dev.rs#L24](repo://crates/celld/dev.rs#L24)); `--port`
  changes it, `--host` moves the interface (the internal operator listener
  stays loopback).
- State lives in `.celld/dev` under the project; keep it and the durable data
  survives across runs, delete it (while stopped) to reset.
- The project is watched; a source change rebuilds and restarts the node, a
  failed build keeps the current app serving, and a successful restart keeps
  durable state.
- Default display hides node warn/info logs (`--logs` shows them);
  `NO_COLOR`/`FORCE_COLOR` control color.
- Worker projects need **esbuild on `PATH`** (or `CELLD_ESBUILD`);
  asset-only projects do not ([crates/celld/deploy.rs#L199-L201](repo://crates/celld/deploy.rs#L199-L201)).

Then, per [examples/README.md#L25-L37](repo://examples/README.md#L25-L37):

```sh
curl 'http://127.0.0.1:9876/increment?name=alpha'   # a Durable Object per name
```

The local store is not exposed as a fleet option: a regular node or an
operator subcommand must use a supported cloud bucket
([docs/README.md#L326-L327](repo://docs/README.md#L326-L327)).

## Deploy to a bucket and run nodes

```sh
export CELLD_BUCKET=s3://my-cells-bucket           # gs:// and az:// also supported
celld deploy ./examples/counter --bucket "$CELLD_BUCKET" \
  --endpoint "$S3_ENDPOINT" --region auto
celld --bucket "$CELLD_BUCKET" --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 --advertise node-a.internal:8081
```

The full walkthrough (S3/R2/GCS/Azure credentials, the qualified stores, the
bucket conditional-write requirement) is
[docs/README.md#L110-L219](repo://docs/README.md#L110-L219). Rules the parser
enforces: an explicit `--advertise` requires an explicit `--internal-listen`;
a public-IP advertise needs `--unsafe-public-advertise`; and every node runs
the storage probe at startup (`CELLD_STORAGE_PROBE=0` skips it)
([crates/celld/startup.rs#L227-L248](repo://crates/celld/startup.rs#L227-L248),
[crates/celld/fleet.rs#L282-L295](repo://crates/celld/fleet.rs#L282-L295)).
Run **two or more nodes** if write latency matters: a lone node proves every
write through the bucket, while a second node lets the fleet ensemble ack in
tens of milliseconds instead of hundreds
([README.md#L133-L147](repo://README.md#L133-L147)). Nodes find each other
through bucket leases — no join command ([docs/README.md#L410-L414](repo://docs/README.md#L410-L414)).
Put the internal listener on a trusted private network; it also carries an
unauthenticated operator API ([docs/security.md#L47-L54](repo://docs/security.md#L47-L54)).

The CLI is one binary; subcommands (from
[crates/celld/main/cli.rs#L29-L56](repo://crates/celld/main/cli.rs#L29-L56)):
bare `celld` = run a node; `celld diagnose`; `deploy`, `dev`, `cell`, `d1`,
`kv`, `queue` operator tools; and the managed-path trio `connect`, `token`,
`credentials`, `disconnect` (the alpha celld.dev control plane — see
[deploy and rollout](deployments/deploy-and-rollout.md#managed-control-plane-alpha)).
Operator commands write data to stdout and prose to stderr
([crates/celld/main/cli.rs#L60-L71](repo://crates/celld/main/cli.rs#L60-L71));
`celld --help` lists every variable beyond the table in
[docs/README.md#L660-L702](repo://docs/README.md#L660-L702).

## Day-one checks

```sh
celld diagnose --bucket "$CELLD_BUCKET"          # leases + signed peer probes + storage test
celld cell list --bucket "$CELLD_BUCKET"         # Class:ID scopes, --json, --all
curl 127.0.0.1:8081/state                        # internal operator view
```

`celld diagnose` takes no lease and changes no ownership
([docs/README.md#L553-L569](repo://docs/README.md#L553-L569)); rolling an
update means SIGTERM per node, waiting the replacement healthy and every
`restoring=0` before the next ([docs/README.md#L506-L513](repo://docs/README.md#L506-L513)).
Run nodes under a supervisor that restarts without an attempt limit
([docs/guarantees.md#L87-L98](repo://docs/guarantees.md#L87-L98)).

## Where to change what

| Task | Read |
| --- | --- |
| Orientation, crate boundaries | [architecture](architecture.md) |
| Any lifecycle/concurrency decision | [decision core](architecture/decision-core.md) |
| I/O, adapters, the actor, the asyncrt fence | [actor and execution boundary](architecture/actor-execution.md) |
| Cell states, activation, eviction, alarms | [cell lifecycle](concepts/cell-lifecycle.md) |
| Ownership, epochs, output gate, leases, recovery | [durability and fencing](concepts/durability-and-fencing.md) |
| LTX capture/compaction/restore | [the ltx engine](persistence/ltx-engine.md) |
| Worker API surface, heap limits, wasm | [V8 runtime](runtime/v8-workers.md) |
| Listeners, peer tunnel, HMAC, WebSockets | [listeners and peers](networking/listeners-and-peers.md) |
| Deploy objects, generations, upgrades | [deploy and rollout](deployments/deploy-and-rollout.md) |
| D1/KV/Queue/cron/Workflow/assets | [reserved classes](platform/reserved-classes.md) |
| Config, pressure, shutdown, diagnose | [node operations](operations/node-operations.md) |
| OTel/Parquet/OTLP, process logs | [telemetry](operations/telemetry-and-logs.md) |
| Recipes and what verification really runs | [change guide](development/change-guide.md) |
