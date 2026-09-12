---
type: guide
title: celld Quickstart
description: A practical getting-started guide covering install, a local dev node, deploying an example Worker, running a two-node fleet, and orienting to the rest of the wiki.
tags: [quickstart, install, dev, deploy, fleet]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-576e6cdf9cabafc752f391ed
    resource: repo://examples/counter/index.js
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---

# celld Quickstart

celld is a self-hosted, distributed Distributed Objects runtime: it runs
Cloudflare Workers and Durable Objects on your own machines. Each object is a
**cell**, a named server with its own SQLite database, and the long-term state
lives in an object-storage bucket you own — S3-compatible, Google Cloud
Storage, or Azure Blob Storage (`README.md:3-12`). This guide takes you from a
fresh install to a running local app and then to a two-node fleet.

## Install

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

The installer downloads the `celld` binary (provenance verifiable with
`gh attestation verify`). Put `~/.local/bin` on `PATH` if it asks
(`README.md:37-41`). Worker projects deployed with `celld deploy` need
[esbuild](https://esbuild.github.io) on `PATH`; asset-only projects do not
(`README.md:47-49`).

## Run an application locally (no cloud)

Run a local development node in a Wrangler project with one command:

```sh
cd examples/counter
celld dev
```

`celld dev` starts one celld node and uses a local object store — it does not
require Docker or a cloud bucket (`README.md:94-99`). The Worker listener uses
`http://127.0.0.1:9876` (`curl 'http://127.0.0.1:9876/increment?name=alpha'`).
Use `--port` to change the port and `--host` to change the interface
(`README.md:99-104`). The command keeps durable application state in `.celld/dev`,
so a later invocation reuses it (`README.md:103-104`).

The command watches the project and rebuilds after a source or config change; a
failed build keeps the current application running and a successful restart
retains the durable state (`README.md:112-115`).

## A Durable Object example

`examples/counter` is a SQLite-backed Durable Object. The Worker reads the
`name` query parameter, derives a Durable Object ID with `env.COUNTER.idFromName(name)`,
and forwards the fetch to that cell; the cell increments and stores a counter in
its private SQLite (`examples/counter/index.js:1-17`). Its Wrangler config
declares the `COUNTER` binding and marks `Counter` as a new SQLite class
(`examples/counter/wrangler.jsonc:1-9`). Different names produce independent
cells, each with an independent counter (`examples/README.md:32-40`).

## Deploy to a fleet bucket

Deploy a project to a bucket that nodes share. The example installs the
credentials per provider; for an S3-compatible bucket:

```sh
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=auto
export S3_ENDPOINT=https://ACCOUNT.r2.cloudflarestorage.com
export CELLD_BUCKET=s3://YOUR-BUCKET
celld deploy ./examples/counter --bucket "$CELLD_BUCKET"
```

(`docs/README.md:128-140`.) `celld deploy` writes the deployment objects (the
manifest, assets, and a fleet pointer at `deploy/current.json`) directly to the
bucket using the documented types in `crates/celld/protocol.rs`
(`README.md:180-188`).

## Run a node

Start a node against the same bucket:

```sh
celld \
  --bucket s3://YOUR-BUCKET \
  --endpoint "$S3_ENDPOINT" \
  --region auto \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

(`README.md:123-132`.) `--listen` is the public Worker listener; the
internal peer/operator listener uses `--internal-listen`, and `--advertise` is
the address peers reach it on. Route the advertised address to the internal
listener.Skip never to the public one (`docs/README.md:389-408`).

Each node loads its latest successfully committed deployment from
`deploy/current.json` every `CELLD_DEPLOY_POLL_S` (default 30 s) and adopts it
in place, without a restart (`README.md:180-186`, `docs/README.md:245-249`).

## Run a two-node fleet

Start a second node against the same bucket with a different advertised
address:

```sh
celld \
  --bucket s3://YOUR-BUCKET \
  --endpoint "$S3_ENDPOINT" \
  --region auto \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise node-b.internal:8081
```

The nodes find each other through the leases in the bucket; there is no join
command and no fixed membership list (`docs/README.md:410-415`). With two or
more nodes, write latency drops: the owner sends each write to another node,
and the write finishes once that node holds it on disk, which is much faster than
a storage round trip (`README.md:134-141`).

Verify the fleet detects the correct conditional-write behavior of the store:

```sh
celld diagnose --bucket s3://YOUR-BUCKET
```

The command enumerates every node lease and performs a signed direct probe of
each live peer, distinguishing expired records, unsafe addresses, unreachable
peers, and incompatible protocols (`README.md:202-205`).

## What's next

- [Architecture: the decision core, the effect executor, and replication](/openwiki/concepts/architecture.md) — how celld is split
  into the pure decision core, the adapter host, and the replication crate.
- [Cells, scopes, and the lifecycle state machine](/openwiki/concepts/cells.md) — what a cell is and how it moves
  through the lifecycle.
- [Deploying applications and adopting generations](/openwiki/operations/deploying.md) — the deployment contract in detail.
- [Operating a fleet](/openwiki/operations/operating-a-fleet.md) — shutdown, diagnostics, and memory pressure.

See the `examples/` directory for progressively richer Wrangler projects:
`hello/`, `webapi/`, `counter/`, `vectordb/`, `d1/`, `r2/`, `kv/`, `async/`,
`router/`, `wsecho/`, `alarm/`, `cron/`, `workflow/`, `rpc/`, and `wasm/`
(`examples/README.md:6-24`).

---

## Related pages

- [Architecture: the decision core, the effect executor, and replication](/openwiki/concepts/architecture.md)
- [Cells, scopes, and the lifecycle state machine](/openwiki/concepts/cells.md)
- [Deploying applications and adopting generations](/openwiki/operations/deploying.md)
