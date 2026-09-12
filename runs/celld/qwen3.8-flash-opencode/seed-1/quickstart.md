---
type: quickstart
title: Quickstart
description: Get celld running and oriented — install or build from source, run an example app locally with celld dev, deploy to a bucket, start a node and its second node, run the first operator commands, and route common changes to the owning source files.
tags: [quickstart, setup, celld-dev, deploy, runbook]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-3fa7b94a6ed05a0c35f6ec1f
    resource: repo://crates/celld/Cargo.toml
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Quickstart

celld runs Cloudflare Workers and Durable Objects on your own machines, with a bucket you own as the fleet's durable state (README.md#L3-L13). This page gets you from zero to a serving node and points each common change at its source.

## Install, or build from source

The published path is the installer plus a container, verified against release attestations (README.md#L36-L65):

```sh
curl -fsSL https://celld.dev/install.sh | sh        # binary under ~/.local/lib/celld/releases
docker run --rm ghcr.io/denoland/celld --version    # multi-arch release image
```

From this repository the canonical build is the one CI and the image use:

```sh
cargo build --release --locked -p celld   # Dockerfile#L18; needs a toolchain >= 1.94.1 (crates/celld/Cargo.toml#L5)
target/release/celld --version            # release.yml#L58-L60 checks this matches Cargo.toml
```

For the edit-run loop, the `lab` profile gives release optimization without the fat-LTO relink (Cargo.toml#L16-L27; see [Build and Release Pipeline](/openwiki/operations/build-release.md)). Worker projects deployed with `celld deploy` need `esbuild` on `PATH`; asset-only projects do not (README.md#L47-L48).

## Run an application locally

```sh
git clone https://github.com/denoland/celld && cd celld
celld dev examples/counter
```

`celld dev` starts one node on a local SQLite object store — no Docker, no cloud bucket — serving the Worker at `http://127.0.0.1:9876` (`--port`, `--host`; the operator listener stays on loopback). Durable state lives in `.celld/dev` under the project and survives restarts; delete it to reset. The command rebuilds on source changes, keeps serving through a failed build, and hides node logs until `--logs` (docs/README.md#L94-L115). The `examples/` corpus is a progressive tour: `hello`, `webapi`, `counter`, `vectordb`, `d1`, `r2`, `kv`, `async`, `body`, `router`, `wsecho`, `wsclient`, `alarm`, `cron`, `workflow`, `rpc`, `wasm` (examples/README.md#L3-L24). Full contract: [Deploy and Local Development](/openwiki/operations/deploy-develop.md).

## Deploy to a real fleet

```sh
export CELLD_BUCKET=s3://my-cells-bucket          # + AWS credentials via the standard chain
cd examples/counter
celld deploy . --bucket "$CELLD_BUCKET"           # add --endpoint/--region for R2-style stores
```

Deploy bundles with esbuild, validates the Wrangler config against the accepted key list, and writes manifest + pointer objects to the bucket (README.md#L180-L187, docs/README.md#L220-L240).

## Start nodes and make them fast

```sh
celld --bucket "$CELLD_BUCKET" \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

Put the public listener behind your ingress and keep the internal listener on a trusted private network; celld does not terminate TLS and rejects a literal public advertise IP without `--unsafe-public-advertise` (README.md#L189-L197). A single node proves every write through the bucket (one storage round trip); start a second node against the same bucket — no extra configuration, no join step — and writes acknowledge when the follower's fsync lands, which is an order of magnitude faster (README.md#L133-L141, docs/guarantees.md#L151-L167). Operate and roll out per [Fleet Operations](/openwiki/operations/fleet-operations.md).

## First operator commands

```sh
celld diagnose --bucket "$CELLD_BUCKET"           # lease + signed peer probes + resource samples
celld cell list --bucket "$CELLD_BUCKET"          # Class:ID scopes (first 1000; --after/--all/--json)
celld d1 migrations apply ledger --bucket "$CELLD_BUCKET"
celld kv bulk put sessions wrangler-export.json --bucket "$CELLD_BUCKET"
celld queue info jobs --bucket "$CELLD_BUCKET"
```

All operator output keeps data on stdout and prose on stderr, so pipes and `> ndjson` files stay clean (docs/README.md#L364-L373; [Operator CLIs](/openwiki/operations/operator-clis.md)).

## Where do I change…

| To change… | Start here | Explained in |
| --- | --- | --- |
| a coordination decision (ownership, gates, shedding, alarms) | the owning module in `crates/logic` | [Sans-IO Decision Core](/openwiki/architecture/decision-core.md) |
| the event loop, timers, effect adapters | `crates/celld/actor.rs` + `asyncrt.rs` | [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md) |
| HTTP surface, peer tunnel, WS proxying | `crates/celld/main.rs`, `main/` | [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md) |
| Worker/JS built-ins, harness behavior | `crates/celld/js.rs`, `crates/celld/js/` | [Workers and V8 Runtime](/openwiki/concepts/workers-runtime.md) |
| durability proofs / node-log tiering | `crates/celld/output_gate` callers: `node_log.rs`, `ltx_repl.rs`, `bucket.rs` | [Durability and the RPO=0 Protocol](/openwiki/concepts/durability.md) |
| replication formats, compaction, restore | `crates/ltx/src/` | [SQLite State and LTX Replication](/openwiki/concepts/sqlite-ltx.md) |
| deploy build or bucket contract types | `crates/celld/deploy.rs`, `protocol.rs` | [Deploy and Local Development](/openwiki/operations/deploy-develop.md) |
| a Workers API or binding | `crates/celld/js/` + harness, cross-check the status table | [Cloudflare Compatibility Surface](/openwiki/concepts/cloudflare-compat.md) |

## Before you go further

Read [what celld guarantees](/openwiki/concepts/durability.md), and treat the repo docs as the operational source: `docs/README.md` (runbook), `docs/security.md`, `docs/limitations.md`, `docs/testing.md`. celld is alpha: security fixes apply to the latest release only, and single-tenant fleets are the supported model (docs/security.md#L3-L11).

Related: [Architecture Overview](/openwiki/architecture/overview.md), [Build and Release Pipeline](/openwiki/operations/build-release.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
