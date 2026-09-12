---
type: guide
title: Quickstart
description: Practical onboarding — what celld is, installing it, running celld dev locally, deploying an application, starting fleet nodes, and a task-routing map to the rest of the wiki.
tags: [quickstart, onboarding, install, run, deploy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Quickstart

celld is a self-hosted, distributed Durable Objects runtime. Each object is a
cell: a named server with its own SQLite database. The long-term state lives
in a bucket you own (S3-compatible, Google Cloud Storage, or Azure Blob
Storage), and the nodes that share one bucket are a fleet — there is no
serving control plane and no consensus service. The JavaScript API follows the
Cloudflare Workers and Durable Objects API.

## Install

The installer downloads the `celld` binary; provenance is verifiable with
`gh attestation verify`:

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

Put `~/.local/bin` on your `PATH` if the installer asks you to. Worker
projects deployed with `celld deploy` need [esbuild](https://esbuild.github.io)
on `PATH`; asset-only projects do not. To remove celld, delete the symlink and
the releases directory (`README.md`). A Docker image is published for Linux
x86-64 and ARM64 as `ghcr.io/denoland/celld`.

## Run an application locally without a cloud bucket

```sh
celld dev
```

`celld dev` opens a local object store, deploys the application, and starts one
celld node. It does not require Docker or a cloud bucket. The Worker listener
uses `http://127.0.0.1:9876` (`--port` and `--host` change it; a non-loopback
host exposes the Worker listener to the network while the internal operator
listener stays on loopback). The application state lives in `.celld/dev` below
the project directory, so a later invocation uses the same durable data
(`crates/celld/dev.rs:24-32`); delete `.celld/dev` while stopped to reset it.

The command watches the project directory and rebuilds the application after a
source or configuration change. The watcher waits for a quiet interval so
esbuild never reads the temporary middle of an editor save, and it ignores
`.cache`, `.celld`, `.git`, `.next`, `node_modules`, `target`, and similar
directories at each depth (`crates/celld/dev.rs:104-192`). The current
application keeps running if a build fails, and a successful restart retains
the durable state.

The default display hides the node warning and information logs; use `--logs`
to show them. Set `NO_COLOR` to disable color, or `FORCE_COLOR` to enable it;
`NO_COLOR` always takes priority (`crates/celld/dev.rs:49-63`).

## Deploy an application

From a Wrangler project, deploy to a bucket and then start a node against the
same bucket:

```sh
celld deploy . --bucket s3://my-cells-bucket
celld --bucket s3://my-cells-bucket --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 --advertise node-a.internal:8081
```

`celld deploy` accepts `wrangler.jsonc` or `wrangler.json` (not
`wrangler.toml`), bundles Worker code with esbuild, and writes the deployment
objects directly to the bucket. Every node loads its latest successfully
committed deployment from `deploy/current.json` and adopts it in place — a
running node does not restart for a new deployment. The supported Wrangler
configuration is an allowlist: an unknown key stops the deploy
(`crates/celld/deploy.rs:36-56`).

For another S3-compatible service use `--endpoint` and `--region`. A `gs://`
bucket selects Google Cloud Storage (Application Default Credentials), and an
`az://` bucket selects Azure Blob Storage (`AZURE_STORAGE_ACCOUNT_NAME` names
the account; the bucket NAME is the container). celld rejects an S3
`--endpoint` for a `gs://` or `az://` bucket and ignores the storage region
for both.

## Start and grow a fleet

A fleet is two or more nodes against the same bucket. Start each node with the
same bucket settings, give each internal listener a different address the
other nodes can reach, and set `--advertise` to that address:

```sh
celld --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

The nodes find each other through the leases in the bucket; there is no join
command and no fixed membership list. A second node needs no extra
configuration, and a fleet of two or more nodes proves each write durable
faster: the owner sends the write to another node and answers once that node
holds the data on its disk (`CELLD_DURABILITY=fleet`, the default). A single
node has nobody to send to, so every write waits for the bucket.

Put every advertised address on a trusted private network or an encrypted
overlay (WireGuard or Tailscale), keep the internal port private, and protect
the bucket credentials — they control the fleet. celld rejects a literal
public advertised IP unless you pass `--unsafe-public-advertise`
(`crates/celld/startup.rs:241-248`).

## Task-routing map

| Task | Where to go |
| --- | --- |
| Understand the crate split and the actor | [System architecture and ownership boundaries](architecture/overview.md) |
| Understand cell states, admission, and eviction | [Cell lifecycle and ownership](architecture/cell-lifecycle.md) |
| Understand RPO=0, fencing, and the output gate | [Durability, fencing, and the output gate](architecture/durability-protocol.md) |
| Understand SQLite replication and compaction | [SQLite replication and the LTX log tier](architecture/replication.md) |
| Understand the V8 runtime and the Workers surface | [V8 runtime and Cloudflare Workers compatibility](architecture/workers-runtime.md) |
| Deploy code and adopt it in place | [Deployments and in-place code adoption](architecture/deployments.md) |
| Configure the bucket, credentials, and key prefixes | [The fleet bucket and object storage](operations/fleet-bucket.md) |
| Operate a node, shut it down, roll it out | [Operating a node and a fleet](operations/fleet-operations.md) |
| Protect the listeners and the peer protocol | [Security and networking boundaries](operations/security.md) |
| Turn on tracing and query it with DuckDB | [Telemetry and observability](operations/telemetry.md) |
| Read every environment variable and CLI option | [Configuration surface](operations/configuration.md) |
| Understand how the system is verified | [Testing and verification strategy](testing/verification.md) |
| Make a specific kind of change safely | [Change guides for representative maintenance tasks](guides/maintenance.md) |

## Example applications

The `examples/` directory contains small Wrangler projects demonstrating the
supported surface progressively: `hello/` (stateless fetch), `counter/` (a
SQLite-backed Durable Object), `wsecho/` (WebSocket echo with hibernation),
`alarm/`, `cron/`, `d1/`, `kv/`, `r2/`, `queue/`-style workflows, `rpc/`,
`wasm/` (workers-rs), and more (`examples/README.md`). Deploy one from its
directory with `celld deploy . --bucket s3://my-cells-bucket`. They are
examples, not the complete compatibility test suite.

## Related pages

- [System architecture and ownership boundaries](architecture/overview.md)
- [Configuration surface](operations/configuration.md)
- [Operating a node and a fleet](operations/fleet-operations.md)
