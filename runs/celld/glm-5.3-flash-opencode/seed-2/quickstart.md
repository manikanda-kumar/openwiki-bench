---
type: quickstart
title: Quickstart
description: Get a celld fleet running end to end — build, dev mode, a minimal bucket-backed fleet with two nodes, deploy an example, and check health with diagnose.
tags: [quickstart, install, dev, deploy, fleet]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-bb1ebe868e35e9e500714501
    resource: repo://Dockerfile
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-c8b39dcd2a245cd9301a976a
    resource: repo://examples/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Quickstart

`celld` is a self-hosted daemon that runs Cloudflare Workers and Durable
Objects on your machines. Quickstart here covers local development, the
smallest correct production fleet, and the first checks.

## Prerequisites (state these up front)

- **esbuild on `PATH`** for Worker projects deployed with `celld deploy`;
  asset-only projects do not need it (repo://README.md#L45-L48).
- **A supervisor that restarts the process** (systemd, Docker with a
  restart policy, Kubernetes) with no attempt limit and at least one lease
  lifetime between attempts — after a self-fence, only a restart returns
  the node to the fleet (repo://docs/guarantees.md#L63-L69).
- **A qualified bucket**: the store must implement conditional-create,
  conditional-overwrite, and read-after-write consistency; qualified
  stores are Amazon S3, Cloudflare R2, Tigris, Google Cloud Storage, and
  Azure Blob Storage (repo://docs/guarantees.md#L36-L41).

## 1. Run an application locally without a bucket

```sh
celld dev
```

`celld dev` starts one node using a *local* object store — no Docker, no
cloud bucket. The Worker listener listens at `http://127.0.0.1:9876`;
`--port` and `--host` change it. It watches the project and rebuilds on
source or config change, keeping the current application if a build
fails and retaining durable state across restarts in `.celld/dev`
(repo://README.md#L94-L110).

For a real request to route through a Durable Object, try the `counter`
<!-- openwiki: broken internal link [examples/README.md] file "examples/README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
example from [examples/](examples/README.md), which defines a SQLite-backed
`Counter` class:

```sh
curl 'http://127.0.0.1:8080/increment?name=alpha'
```

The `name` query parameter selects the cell instance, demonstrating that
independent cells hold independent storage
(repo://examples/README.md#L27-L43).

## 2. Build from source (optional)

Building from source requires the Rust toolchain and compiles the
workspace:

```sh
cargo build --profile release --locked -p celld
```

(repo://Dockerfile#L19-L25 — this is exactly what the release image
builds from the Cargo workspace; releases are also installed prebuilt via
the `install.sh` one-liner in the README.)

## 3. Deploy an application

```sh
celld deploy . --bucket s3://my-cells-bucket
```

`celld deploy` invokes esbuild, normalizes the Wrangler config (an
allowlist; anything unmodeled is refused, never silently dropped), and
writes the manifest plus `deploy/current.json` to the fleet bucket —
changing the pointer IS the deploy; every node converges on what it
names (repo://crates/celld/deploy.rs#L10-L16,
repo://crates/celld/protocol.rs#L402-L412). Non-`s3://` buckets follow
the gs:// and az:// dialects with their own credential chains; `--endpoint`
and `--region` are for S3-compatible stores like R2
(repo://crates/celld/main/cli.rs#L276-L291).

## 4. Run a node (bucket-backed)

```sh
celld --bucket s3://my-cells-bucket \
  --listen 0.0.0.0:8080 \
  --internal-listen 10.0.0.12:8081 \
  --advertise 10.0.0.12:8081
```

One node proves each write durable through the bucket — one storage
round trip per write (repo://README.md#L134-L139). The internal listener
serves peer and operator traffic; it must not be published (see
<!-- openwiki: broken internal link [/architecture/overview.md] file "/architecture/overview.md" does not exist. Fix the href or restore the target, then delete this comment. -->
[Quickstart's Architecture](/architecture/overview.md) and the network
notes in [Peer network and fleet authentication](
/integration/peer-network-and-auth.md)).

## 5. Add a second node

Start a second node against the *same* bucket with its own `--listen`,
`--internal-listen`, and `--advertise`. No extra configuration is
required because a node finds its peers through the bucket. With two
nodes, fleet durability engages: the owner sends each write to a follower
and answers when the follower holds it on disk — about 25 ms measured on
a loaded lab fleet versus ~600 ms for a bucket round trip. Two or more
nodes is when write latency matters; one node is always slower.
(repo://README.md#L134-L148, repo://docs/guarantees.md#L158-L166).

## 6. Check health

- Task-level health: `curl` the public listener at
  `/.well-known/celld/health` — `{"ok":true}` only when fleet-ready,
  healthy, and not draining (repo://crates/
  celld/main.rs#L2606-L2612).
- Fleet-level checks: `celld diagnose --bucket s3://my-cells-bucket`
  probes the bucket's conditional-write properties and every other node
  by a direct signed probe; it names *which* conditional write failed if
  the bucket is not qualified, so a late and silent failure never
  reaches production unnoticed (repo://docs/guarantees.md#L83-L99).
- `GET /state` on the internal listener reports the live cell and
  memory sample for capacity work
  (repo://crates/celld/main.rs#L2635-L2636).

## 7. Where to go next

- The full environment-variable table: `docs/README.md`'s
  ["Environment variables"] section (repo://docs/README.md#L665-L708).
- Guarantees and what the fence means to you: `docs/guarantees.md`
  (repo://docs/guarantees.md).
- The limitation set before operating a public fleet: `docs/
  limitations.md`, `docs/security.md` (repo://docs/
  security.md#L5-L22).
