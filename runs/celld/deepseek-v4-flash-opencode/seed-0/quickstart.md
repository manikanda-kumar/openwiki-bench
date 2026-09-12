---
type: guide
title: Quickstart
description: Install celld, run an application locally with celld dev, deploy it to a bucket, start a fleet, and find the right page for the task in front of you.
tags: [quickstart, install, dev, deploy, fleet]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Quickstart

celld is a self-hosted, distributed Durable Objects runtime. A node is one
`celld` process, the nodes that share one bucket are a fleet, and a cell is
a Durable Object with its own SQLite database. This page gets you from zero
to a running application, then routes you to the page that answers the
question you actually have.

## Install

```sh
curl -fsSL https://celld.dev/install.sh | sh
```

Put `~/.local/bin` on your `PATH` if the installer asks. Worker projects
deployed with `celld deploy` need [esbuild](https://esbuild.github.io) on
`PATH`; asset-only projects do not (README.md#L36-L48). The release image
is also published for Linux x86-64 and ARM64 at
`ghcr.io/denoland/celld` (README.md#L58-L88).

## Run locally without a bucket

`celld dev` starts one node and a local object store — no Docker, no cloud
bucket:

```sh
celld dev
```

The Worker listener defaults to `http://127.0.0.1:9876`; use
`celld dev --port PORT` or `celld dev --host IP` to change it. State is
kept in `.celld/dev` below the project, so a later invocation reuses the
same durable data (delete it while stopped to reset). The command watches
the project, rebuilds after a source or configuration change, keeps the
current application running if a build fails, and preserves durable state
across a successful restart. `--logs` shows the node warning and
information logs that the default display hides
(docs/README.md#L274-L337, README.md#L92-L116).

## Deploy to a bucket

Configure object storage, then deploy from a Wrangler project. For
Cloudflare R2 (README.md#L118-L141):

```sh
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_REGION=auto
export S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
export CELLD_BUCKET=s3://YOUR-BUCKET

celld deploy . --bucket "$CELLD_BUCKET" --endpoint "$S3_ENDPOINT" --region "$AWS_REGION"
```

`gs://` and `az://` buckets use Application Default Credentials and an
Azure credential family respectively, and take no S3 endpoint
(docs/README.md#L126-L208). The bucket must provide conditional writes and
read-after-write consistency; run `celld diagnose` to test it, because a
store that silently ignores the condition cannot fence a cell
(docs/guarantees.md#L16-L74).

## Start a node and add capacity

```sh
celld --bucket "$CELLD_BUCKET" --endpoint "$S3_ENDPOINT" --region "$AWS_REGION" \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise node-a.internal:8081
```

Start each additional node against the same bucket with its own advertised
internal address; the nodes find each other through leases in the bucket,
with no join command (README.md#L374-L415). One node proves each write
through the bucket, so a write costs one storage round trip; with two or
more nodes celld sends each write to a follower and acknowledges as soon
as it holds the data on disk, which is much faster
(README.md#L134-L147). Put the advertised addresses on a trusted private
network, because peer traffic is plaintext HTTP and the fleet HMAC does
not encrypt it (docs/security.md).

## Operate

```sh
celld diagnose --bucket "$CELLD_BUCKET"     # probe every live node
celld cell list --bucket "$CELLD_BUCKET"    # list Durable Object instances
celld d1 migrations apply ledger --bucket "$CELLD_BUCKET"
celld kv list sessions --all --json --bucket "$CELLD_BUCKET"
celld queue info jobs --bucket "$CELLD_BUCKET"
```

Stop a node with SIGTERM or SIGINT and celld drains it gracefully: it
reports unhealthy, finishes accepted requests, and hands cells to
compatible peers. Set the orchestrator stop grace longer than
`CELLD_SHUTDOWN_TOTAL_MS` (default 40000) so the orchestrator cannot
SIGKILL mid-handoff (docs/README.md#L427-L512).

## Where to go next

| I want to… | Read |
| --- | --- |
| Understand the whole system | [Architecture Overview](architecture/overview.md) |
| Know how cells start, run, and are evicted | [Cell Lifecycle and Scheduling](architecture/cell-lifecycle.md) |
| Understand who owns a cell and what happens when a node dies | [Ownership, Leases, and Fencing](architecture/ownership-and-fencing.md) |
| Understand how writes are made durable | [Durability and Replication](architecture/durability-and-replication.md) |
| Configure the bucket and its credentials | [Object Store Adapter](storage/object-store.md) |
| Work with cell SQLite, KV, and D1 storage | [Cell Storage and SQLite](storage/cell-storage.md) |
| Understand V8 isolates and Worker execution | [V8 Runtime and Worker Execution](runtime/v8-runtime.md) |
| Know which Cloudflare APIs are supported | [Worker Bindings and APIs](runtime/bindings.md) |
| Understand the listeners and peer protocol | [Control Plane and Peer Protocol](runtime/control-plane.md) |
| Deploy an application | [Deployment and Application Generations](operations/deployment.md) |
| Shut down, roll out, or recover a fleet | [Fleet Lifecycle and Graceful Handoff](operations/fleet-lifecycle.md) |
| Use the operator commands | [Operator CLI](operations/operator-cli.md) |
| Tune memory limits and shedding | [Memory Pressure and Capacity](operations/memory-and-capacity.md) |
| Turn on tracing and telemetry | [Telemetry and Node Logging](operations/telemetry.md) |
| Understand the trust boundary | [Security Model](security/security-model.md) |
| See how correctness is verified | [Testing and Verification](testing/verification.md) |
| Find every flag and environment variable | [Configuration and Environment](development/configuration.md) |

## The mental model in five lines

- A **cell** is a Durable Object: a named SQLite database that exactly one
  node serves at a time.
- A **node** embeds V8, owns cells, and executes Wrangler bundles.
- A **fleet** is the nodes sharing one bucket; the bucket holds the
  deployments, cell state, and ownership records.
- A conditional bucket write grants ownership, so there is no consensus
  service (README.md#L14-L22).
- celld does not answer a write until it is proven durable, so no
  acknowledged write is lost (docs/README.md#L47-L59).

Before operating a public fleet, read the
[limitations](https://github.com/denoland/celld/blob/main/docs/limitations.md)
and [security](security/security-model.md) pages (README.md#L333-L334).
