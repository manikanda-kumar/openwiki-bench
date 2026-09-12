---
type: quickstart
title: "Quickstart"
description: "Fastest paths to a working celld node and fleet: install or build, celld dev locally, deploy a Wrangler project, run a two-node fleet against a bucket, and where each subsystem is documented."
tags: [quickstart, install, dev, deploy, docker]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Quickstart

## What celld is, in two sentences

One `celld` process per machine is a **node**; nodes sharing one object-store
bucket are a **fleet**. Every object is a **cell** — a named server with its
own SQLite database, the Cloudflare Durable Object model — and the bucket
holds deployments, cell state, and ownership/lease records
([README.md](../README.md), "How it works").

## Install

An installer puts a single binary on PATH and each release under
`~/.local/lib/celld/releases` with one symlink
([README.md](../README.md), "Install"):

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

Worker projects deployed with `celld deploy` need
[esbuild](https://esbuild.github.io) on `PATH`; asset-only projects do not.

## Build from source

The Dockerfile defines the canonical build (`Dockerfile:6-19`):
`cargo build --profile release --locked -p celld`, then installs
`target/release/celld`. The test stage in the same image is the engine's CI
gate — "a break in the engine's tests or lints stops the build":
`cargo test --profile $CELLD_PROFILE --locked && cargo clippy …
--all-targets --locked -- -D warnings` (`Dockerfile:26-40`).

```sh
cargo build --profile release --locked -p celld
```

## Run locally (no cloud bucket)

```sh
celld dev
```

"Starts one celld node and uses a local object store. It does not require
Docker or a cloud bucket. The Worker listener uses `http://127.0.0.1:9876`"
([README.md](../README.md), "Run it"). `--port PORT`, `--host IP`,
`--logs` (default hides info logs, errors stay visible), `NO_COLOR` /
`FORCE_COLOR` control output (`main/cli.rs` passes these through). State
lives in `.celld/dev`; the watcher rebuilds on change, "keeps the current
application running if a build fails", and retains durable state across
restarts ([README.md](../README.md)).

Try the `/examples` at increasing depth: `hello/` (stateless Worker), then
`counter/` (SQLite-backed DO), `wsecho/` (hibernation), `d1/`, `kv/`,
`r2/`, `cron/`, `alarm/`, `workflow/`
([examples/README.md](../examples/README.md)).

```sh
cd examples/hello && celld deploy . --bucket s3://my-cells-bucket
```

## Run a fleet against a bucket

One node proves each write through the bucket; a second node makes writes
finish "as soon as the second node holds the data on its disk"
([README.md](../README.md)):

```sh
celld --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise 10.0.0.12:8081
```

Constraints that matter ([README.md](../README.md)): keep the internal
listener and every advertised address on a trusted private network or an
encrypted overlay, never publish the internal port; the second node needs
no extra configuration because fleet discovery is via bucket leases.

## Container

```sh
docker volume create celld-state
docker run --rm --network host \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
  -e CELLD_WATCH=/var/lib/celld/state \
  -v celld-state:/var/lib/celld \
  ghcr.io/denoland/celld \
  --bucket s3://my-cells-bucket \
  --endpoint https://ACCOUNT.r2.cloudflarestorage.com \
  --region auto \
  --listen 0.0.0.0:8080 --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

([README.md](../README.md), "Container.") Drop `--endpoint`/`--region` for
AWS S3; `gs://` and `az://` buckets have their own credential rules. The
image builds with `CELLD_PROFILE` (`release` or the faster `lab` profile for
profiling, `Dockerfile:9-11`).

## First diagnosis

```sh
celld diagnose --bucket s3://my-cells-bucket
```

Enumerates node leases, runs the signed direct probe of each live peer, and
reports resident-cell/WebSocket/RSS/CPU/pressure samples while "keeping
checking after an individual failure" ([README.md](../README.md), "Operate
a fleet"). With no bucket tests yet, this is also the first check that your
store implements conditional writes — the storage test sends four
conditional writes, two of which must fail ([docs/guarantees.md](../docs/guarantees.md)).

## Where to go next

| Needs | Page |
|---|---|
| Overall design, logic/effect split | [architecture](architecture.md) |
| Cell states, alarms, cron, queues | [cell-lifecycle](cell-lifecycle.md) |
| Why a write is safe before you get the ack | [replication-durability](replication-durability.md) |
| Why two nodes can't argue over one cell | [ownership-fencing](ownership-fencing.md) |
| Config surface, env vars | [cli-operations](cli-operations.md) |
| Deploy mechanics | [deployment](deployment.md) |
| Which bucket providers work | [storage-backends](storage-backends.md) |
| What celld does *not* promise | [security](security.md), [docs/limitations.md](../docs/limitations.md) |
| How the guarantees get tested | [testing](testing.md) |

`celld --help` is the complete command line, and its help text is a stable
published surface (`crates/celld/main/cli.rs:5-7`).
