---
type: guide
title: celld Quickstart
description: Practical orientation — run an application locally with `celld dev`, start a two-node fleet against a bucket, and which wiki page to read for a particular task.
tags: [guide, quickstart, getting-started, dev]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# celld Quickstart

celld is a self-hosted, distributed Durable Objects daemon. A node (one `celld`
process per machine) embeds V8 and executes Wrangler bundles; the nodes that
share one bucket are a fleet, and the bucket holds the deployments, the cell
state, and small ownership records (`README.md:16-22`). The authoritative
README and `docs/README.md` are the source for the connector specifics; this
page points you to the fastest path from zero to a running application and then
to the right page for a given task.

## Run an application locally

`celld dev` starts one node against a persistent local store — no Docker, no
cloud bucket (`README.md:90-104`, `crates/celld/dev.rs:3-7`). It opens a local
object store, deploys the application, and runs the Worker listener on
`http://127.0.0.1:9876` by default (`crates/celld/dev.rs:24`). Its durable state
lives in `.celld/dev`, so a later invocation reuses the same data:

```sh
celld dev
```

`--port` selects the Worker port, `--host` an interface, and `--logs`
shows the node warnings that are hidden by default. `NO_COLOR` / `FORCE_COLOR`
control color output, with `NO_COLOR` winning (`README.md:104-111`). The command
watches the project and rebuilds after a source or configuration change, keeping
the current application running while a build fails, and retaining durable state
across a successful restart. Worker projects need `esbuild` on `PATH`; asset-only
projects do not (`README.md:112-117`, `docs/README.md:274-337`).

## Start a two-node fleet

Deploy an application to a bucket, then start nodes against the same bucket:

```sh
celld deploy . --bucket s3://my-cells-bucket
celld --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 --internal-listen 10.0.0.12:8081 --advertise 10.0.0.12:8081
celld --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 --internal-listen 10.0.0.13:8081 --advertise 10.0.0.13:8081
```

The nodes find each other through the leases in the bucket; there is no join
command and no fixed membership list (`docs/README.md:410-415`). One node proves
each write through the bucket; a second node makes the node serve the write as
soon as that node holds the data on disk, which is much faster than the bucket
round trip (`README.md:134-147`). The internal listener and its advertised
addresses must be on a trusted private network, and an explicit advertised
address requires an explicit internal-listener address
(`README.md:188-200`, `docs/README.md:400-408`).

`--bucket gs://` selects Google Cloud Storage and `--bucket az://` selects Azure
Blob; both reject an S3 `--endpoint` and ignore the region
(`README.md:149-178`). Every node loads the latest committed deployment from
`deploy/current.json` each `CELLD_DEPLOY_POLL_S` (30 s) and adopts it in place
(`docs/README.md:245-255`).

## Practical orientation

Generate a node lease and serve traffic; the fleet bucket is the root of
authority (`docs/security.md:137-145`).

## Where to read next for a given task

| Task | Page |
| --- | --- |
| Understand the decision core (phases, output gate, shedding) | [architecture/decision-core](architecture/decision-core.md) |
| How ownership/leases/replication make a write durable | [architecture/ownership-and-replication](architecture/ownership-and-replication.md) |
| The SQLite replication and LTX library | [architecture/sqlite-replication-ltx](architecture/sqlite-replication-ltx.md) |
| How V8 runs Workers and the DO API surface | [architecture/v8-isolate-hosts](architecture/v8-isolate-hosts.md) |
| Every CELLD_* variable and CLI option | [operations/configuration](operations/configuration.md) |
| Operating nodes, diagnose, D1/KV/Queue, shutdown | [operations/fleet](operations/fleet.md) |
| Traces/logs via Parquet or OTLP | [operations/telemetry](operations/telemetry.md) |
| Threats, the internal listener, and the fleet HMAC | [security](security.md) |
| The four-layered testing approach | [testing](testing.md) |
| Adding a Worker/DO API | [change-guides/adding-a-worker-api](change-guides/adding-a-worker-api.md) |
| Tuning resident-cell and memory limits | [change-guides/tuning-resource-limits](change-guides/tuning-resource-limits.md) |

## Uncertainty note

The README and `docs/README.md` are the operator-facing ground truth for the
developer and fleet experience described here; concrete behavior such as the
default port (9876), the `.celld/dev` durable directory, and the lease-based
peer discovery are evidenced and stable. Anything not stated there or in the
cited code — for example the performance of a specific store — is left to the
guarantees, testing, and telemetry pages rather than asserted here.
