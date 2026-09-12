---
type: operations
title: Deployment and Application Generations
description: How a Wrangler project becomes a running application — celld deploy, the Wrangler config allowlist, esbuild bundling, the bucket deployment objects, static assets, and how each node builds and adopts a generation in place.
tags: [deployment, deploy, wrangler, generation, assets, reload]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
  - id: openwiki-source-15dd3a9eca59512f78123727
    resource: repo://docs/cloudflare-compat.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Deployment and Application Generations

A fleet runs one application. `celld deploy` builds a Wrangler project and
writes deployment objects directly to the fleet bucket; each node reads
`deploy/current.json` and adopts a new deployment in place, so a running
node does not restart for a deploy.

## `celld deploy`

`celld deploy` bundles a Wrangler project and writes it to the fleet
bucket. Bundling is esbuild's job — the tool must be on `PATH` for Worker
code, though an asset-only project does not need it (README.md#L47-L48) —
and the module does config, identity, and durable bucket publication.
Nothing here shells out to wrangler or speaks a Cloudflare-shaped API
(crates/celld/deploy.rs#L8-L13).

Config keys are an **allowlist**: `SUPPORTED_KEYS` names the understood
top-level keys (`$schema`, `name`, `main`, `no_bundle`,
`compatibility_date`, `compatibility_flags`, `durable_objects`,
`migrations`, `assets`, `services`, `triggers`, `vars`, `d1_databases`,
`kv_namespaces`, `queues`, `workflows`, `r2_buckets`), and anything else —
including `routes` — stops the deployment. Refusing is compat-safe;
guessing produces confusing activation failures later
(crates/celld/deploy.rs#L36-L56, docs/cloudflare-compat.md#L319-L333).

A deployment can reference immutable asset blobs, whose key is
content-addressed: `deploy-blobs/assets/sha256/<first-two>/<sha256>`
(crates/celld/protocol.rs#L384-L399).

## The bucket deployment protocol

The durable types on the bucket contract are defined in `protocol.rs`;
they are the interface, and nothing else is exchanged
(crates/celld/protocol.rs#L3-L4):

- `deploy/<script>/<version>/manifest.json` — the normalized deployment:
  the version, the script name, the main module, Durable Object classes
  (and which are SQLite-backed from migrations), the module list, an
  optional asset index reference, cron expressions, queue consumers, and
  the required-features list (crates/celld/protocol.rs#L11-L44).
- `deploy/current.json` — the fleet-wide pointer a node reads on startup;
  changing it is a deploy, and nodes converge to it. It names the script,
  version, prefix, and a rollout percentage
  (crates/celld/protocol.rs#L401-L416).
- `deploy/queues/<queue>/consumer.json` — the single deployment allowed
  to consume a fleet-global queue
  (crates/celld/protocol.rs#L103-L113).
- `deploy/<script>/<version>/assets.json` — the asset index, referencing
  content-hashed blobs with their SHA-256, sizes, content types, and the
  asset config (`run_worker_first`, HTML and not-found handling,
  `_headers`, `_redirects`) (crates/celld/protocol.rs#L324-L382).

The deployment **version** is deployment identity: a SHA-256 over the
sorted module contents plus the serialized metadata — never the raw
upload framing, so identical code deploys as one version regardless of the
path used. Cron expressions are deliberately not an input, because a
version names the code and its bindings and a schedule is configuration
layered on top (crates/celld/protocol.rs#L418-L434).

A manifest can require deployment features (`assets-v1`, `d1-v1`,
`cron-v1`, `r2-v1`, `kv-v1`, `queues-v1`, `wasm-v1`, `workflows-v1`,
`sqlite-vec-v1`); a node that cannot load a required feature rejects the
deployment up front, moving a would-be runtime failure to the deploy
(crates/celld/protocol.rs#L50-L99).

## Reserved classes

D1, Workflows, KV, and Queues are each implemented as a cell in a
runtime-supplied Durable Object class (`__D1Database`, `__Workflow`, the
KV class, and the Queue class). A user config naming a reserved class is
refused; a workflow class is script-scoped (`__Workflow.<script>`) so two
co-hosted scripts do not collide, while D1, KV, and Queues are fleet-wide
resources that several Workers bind on purpose
(crates/celld/deploy.rs#L58-L117).

## Static assets

An asset project can include a Worker or be asset-only. The asset
resolver serves the `assets` binding, HTML handling, not-found handling,
worker-first routes, `_headers`, and `_redirects`
(docs/README.md#L235-L243). celld refuses a symlink or special file in an
asset directory, and `.assetsignore` requires Wrangler
(docs/cloudflare-compat.md#L331-L333). The asset cache is bounded by
`CELLD_ASSET_CACHE_BYTES` (default 512 MiB)
(crates/celld/assets.rs#L24). During a rolling restart a newer node can
adopt a foreign asset index so it serves content-hashed paths an
un-restarted node has never heard of
(crates/celld/assets.rs#L25-L44).

## Generations and in-place adoption

A **generation** is everything a node derives from a deployment: the
compiled Worker configurations, the isolate pools, the Durable Object
class registry, the service-binding graph, the asset resolvers, and the
cron schedule. A node serves exactly one current generation and reaches it
through a snapshot, so a request that started on one generation finishes
on it even after the node adopts another
(crates/celld/generation.rs#L3-L10).

Boot and reload construct a generation through the same two functions,
`DeploymentGraph::load` and `Generation::build`, so a reload cannot miss
what a boot did (crates/celld/generation.rs#L12-L16).

Adoption is triggered by a poll — `CELLD_DEPLOY_POLL_S`, default 30
seconds — or by `POST /reload` on the internal listener, which forces a
rebuild so an edit to `CELLD_VARS_FILE` takes effect without a restart
(crates/celld/generation.rs#L36-L44, crates/celld/generation.rs#L86-L93).
A deployment that does not build leaves the current generation serving and
reports the failure in the log and the `/reload` response
(crates/celld/generation.rs#L61-L67).

## Moving resident cells to the new deployment

A resident Durable Object moves to the new deployment at a safe point: no
request runs in it, no alarm handler runs in it, no output waits for
durability, and no regular WebSocket is open
(crates/logic/lib.rs#L4130-L4147). The move keeps the object's storage,
its epoch, and its hibernatable WebSockets, and it does not read or write
the bucket (docs/README.md#L257-L266).

Cells whose class was named eager, or that never reach a safe point
within `CELLD_DEPLOY_MAX_AGE_S` seconds (default 60), are forced: their
activity is cancelled and their regular WebSockets are closed with code
1012, which is what a Cloudflare deployment does to every object. A value
of 0 forces every resident cell at the adoption
(docs/README.md#L263-L268, crates/logic/lib.rs#L4149-L4228). The swap
pump moves cells at most `max_releases` at a time, and a cell whose swap
is not yet complete can accept calls from the other deployment, so two
adjacent versions must accept each other's calls
(docs/README.md#L268-L272).
