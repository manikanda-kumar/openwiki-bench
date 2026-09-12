---
type: guide
title: Quickstart
description: What celld is, how to build, run, and test it locally, how to deploy a first Worker project, and where to go next in the wiki.
tags: [quickstart, onboarding, getting-started]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
  - id: openwiki-source-91ebcfb0c1bd214cf2ea78f8
    resource: repo://examples/counter/wrangler.jsonc
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Quickstart

## What celld is

celld is an open-source daemon that runs **Cloudflare Workers and
Durable Objects** on your own machines as a self-hosted fleet. Each
object is a **cell**: a named server with its own SQLite database. The
nodes sharing one bucket form a **fleet**; the bucket you own
(S3-compatible, Google Cloud Storage, or Azure Blob) holds the
deployments, the cell state, and small ownership records. "A cell that
nothing is serving costs almost nothing"
[README.md](repo://README.md#L4-L12).

There is no control plane and no consensus service: a conditional
bucket write gives a node ownership of a cell, so exactly one node owns
a cell at a time, and bucket leases provide discovery
[README.md](repo://README.md#L17-L22). Codewise, the workspace splits
into three crates — a pure decision core (`crates/logic`), the daemon
(`crates/celld`), and the embedded SQLite replication engine
(`crates/ltx`) [Cargo.toml](repo://Cargo.toml#L1-L3).

## From source

```sh
cargo build --release --locked        # the shipped profile
target/release/celld --version
```

The workspace ships two tuned profiles: `release` (fat LTO,
`panic = "abort"`, stripped) and `lab` (thin LTO, incremental, unstripped
with line tables) for faster iteration
[Cargo.toml](repo://Cargo.toml#L7-L27). The `lab` profile passes through
the Dockerfile as `CELLD_PROFILE=lab`
[Dockerfile](repo://Dockerfile#L6-L9).

## Local development without a bucket

```sh
celld dev                      # in a Wrangler project directory
```

This starts one node against a local object store in `.celld/dev` —
no Docker, no cloud bucket. Worker listener defaults to
`http://127.0.0.1:9876`. `--port`, `--host`, `--logs`, and
`NO_COLOR` are honored. The watcher rebuilds on source/config change,
a failed build keeps the current app running, and a successful restart
retains durable state
([docs/README.md](repo://docs/README.md#L276-L337), and the
[tooling page](/openwiki/operations/tooling-cli.md)).

## A first deployment

Install esbuild on PATH (Worker projects need it; asset-only does not),
then from a Wrangler project:

```sh
export CELLD_BUCKET=s3://YOUR-BUCKET          # gs:// and az:// also work
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=auto
celld deploy . --bucket "$CELLD_BUCKET"
celld --bucket "$CELLD_BUCKET" --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 --advertise 10.0.0.12:8081
```

Nodes find each other through bucket leases, so a second node needs no
extra configuration. Expose only the public listener; keep the internal
one on the trusted private network
([docs/README.md](repo://docs/README.md#L221-L255),
[README.md](repo://README.md#L122-L141)). The bucket credential governs
the fleet — treat it as admin credentials; details at
[Fleet model](/openwiki/architecture/fleet-model.md) and
[Security boundary](/openwiki/architecture/security-boundary.md).

A single node proves each write through the bucket (about 90 ms for a
region-local store); **two or more nodes** prove a write as soon as a
follower holds it on disk (about 25 ms in the references fleet), so
run more than one node when write latency matters
[README.md](repo://README.md#L134-L147).

## Smoke-test an example

`examples/` ships small Wrangler projects, e.g.
[examples/counter](repo://examples/counter/wrangler.jsonc):

```sh
cd examples/counter && celld dev --port 9876
```

with the full list at [examples/README.md](repo://examples/README.md#L1-L33)
(hello, webapi, counter, vectordb, d1, r2, kv, async, body, router,
wsecho, wsclient, alarm, cron, workflow, rpc, wasm).

## Run tests

```sh
cargo test --locked          # crates and conformance harnesses
cargo clippy --locked -D warnings
```

The Docker image's `test` stage runs exactly these plus tests/lints
inside a container before the release image can build
[Dockerfile](repo://Dockerfile#L20-L45). The multi-layer verification
strategy (differential conformance vs workerd, deterministic
simulation, TLA+ model checking, live fleet lab) is documented at
[Testing and conformance](/openwiki/testing/conformance.md).

## Where to go next

| Want to… | Read |
| --- | --- |
| Understand the crate split and build profiles | [Workspace layout](/openwiki/architecture/workspace-layout.md) |
| Add nodes / understand leases / peer tunnels | [Fleet model](/openwiki/architecture/fleet-model.md) |
| Learn the durability guarantees | [Ownership, epochs, and fencing](/openwiki/data/ownership-fencing.md), [Replication and durability](/openwiki/data/replication-durability.md) |
| Debug a cold cell or a recovery | [Restore and takeover](/openwiki/data/restore-takeover.md) |
| Configure the node from env | [Configuration](/openwiki/operations/configuration.md) |
| Drop into operator/D1/KV/queue tooling | [Developer and operator tooling](/openwiki/operations/tooling-cli.md) |
| Read the log/telemetry surface | [Observability](/openwiki/operations/observability.md) |
| Run node operations (`/state`, `/reload`, `/shutdown`) | [Node command surface and graceful shutdown](/openwiki/operations/node-cli.md) |
| Understand memory-pressure behavior | [Resident capacity, pressure shedding, and overload](/openwiki/runtime/admission-pressure.md) |
| See which Workers APIs are supported | [JS/V8 host surfaces](/openwiki/runtime/js-v8-host.md) |
| Plan releases and container images | [Build and release pipeline](/openwiki/release/build-pipeline.md) |
