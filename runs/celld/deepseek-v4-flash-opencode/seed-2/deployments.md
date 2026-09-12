---
type: concept
title: Deployments, Wrangler configuration, and in-place adoption
description: How celld deploy builds a Wrangler project into durable bucket objects (manifest, pointer, assets), the supported config allowlist and feature gates, and how running nodes adopt a new deployment in place through generations.
tags: [deployments, wrangler, manifest, assets, generations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-278001c559216d321bc30f18
    resource: repo://crates/celld/assets.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---

# Deployments, Wrangler configuration, and in-place adoption

A deployment is the durable record in the fleet bucket of what the fleet
runs. `celld deploy` builds a Wrangler project and writes it there, and every
node reads the same fleet-wide pointer and adopts new deployments in place —
no node restarts when the application changes.

## What `celld deploy` writes

`celld deploy` is described in its module doc as "config, identity, and
durable bucket publication": bundling is esbuild's job, and the module never
shells out to wrangler or speaks a Cloudflare-shaped API
(crates/celld/deploy.rs#L8-L13). The durable objects are the interface, and
nothing else is exchanged (crates/celld/protocol.rs#L3-L5):

- **`deploy/<script>/<version>/manifest.json`** — the normalized `Manifest` a
  node reads to know what to run: schema version, script name, main module,
  Durable Object classes, SQLite-backed classes, module refs, assets, cron
  expressions, queue consumers, required features, and the raw Wrangler
  metadata (crates/celld/protocol.rs#L11-L44).
- **`deploy/current.json`** — the fleet-wide `DeployPointer` a node reads on
  startup; changing it is a deploy, and nodes converge to it. It names the
  version and prefix and carries a `Rollout { percent }`
  (crates/celld/protocol.rs#L401-L417).
- **`deploy/<script>/<version>/assets.json`** — the immutable asset index,
  and **`deploy-blobs/assets/sha256/<aa>/<hash>`** — content-addressed asset
  bodies keyed by SHA-256 (crates/celld/protocol.rs#L333-L339,
  crates/celld/protocol.rs#L393-L398).
- **`deploy/queues/<queue>/consumer.json`** — the one deployment allowed to
  consume a fleet-global queue (crates/celld/protocol.rs#L103-L113).

A version's identity is deterministic: `deployment_version` hashes the
sorted module contents, the serialized metadata, and the asset index, never
the raw upload framing. Cron expressions are deliberately not an input — a
version names the code and its bindings, and a schedule is configuration
layered on top (crates/celld/protocol.rs#L420-L435).

## The Wrangler config allowlist

`celld deploy` accepts `wrangler.jsonc` or `wrangler.json`; it does not
accept `wrangler.toml` (docs/cloudflare-compat.md#L321-L322). The accepted
top-level keys are the `SUPPORTED_KEYS` allowlist in `deploy.rs`:
`$schema`, `name`, `main`, `compatibility_date`, `compatibility_flags`,
`durable_objects`, `migrations`, `assets`, `services`, `triggers`, `vars`,
`d1_databases`, `kv_namespaces`, `queues`, `workflows`, `r2_buckets`, and
`no_bundle` (crates/celld/deploy.rs#L36-L56). Each other top-level key,
including `routes`, stops the deployment
(docs/cloudflare-compat.md#L331-L334). An asset-only project can omit `main`.

## Feature gates

Each deployable surface is gated by a `FEATURE_*_V1` constant, and a manifest
requiring a feature this build cannot load is rejected up front
(crates/celld/protocol.rs#L50-L99, crates/celld/protocol.rs#L291-L299). The
gates exist to move a failure from request time to deploy time: for example,
a build without the reserved cron cell would otherwise load the manifest,
ignore `crons`, and silently never fire — "the quiet failure the gate exists
to prevent" (crates/celld/protocol.rs#L71-L75). Both load paths — a managed
control-plane deployment and a fleet pointer load — apply the same gate
(crates/celld/protocol.rs#L291-L299).

## Reserved runtime classes

D1, Workflows, KV, and Queues run as cells supplied by the runtime, not by
the Worker. The reserved classes are `__D1Database`, `__Workflow`,
`__KvNamespace`, and `__Queue` (crates/celld/deploy.rs#L58-L81). A user
config naming a reserved class in `durable_objects` or `migrations` is
refused, because a user binding onto it would silently reach a runtime cell
instead of the user's class (crates/celld/deploy.rs#L58-L63). A workflow
instance class is script-scoped (`__Workflow.<script>`) because its namespace
key already is, while D1 and KV stay fleet-wide so several Workers can bind
one database or namespace (crates/celld/deploy.rs#L83-L106).

## Static assets

The asset resolver serves the immutable, content-hashed asset index. During
a rolling restart an upgraded node serves HTML whose content-hashed asset
paths an un-restarted node has never heard of; the blobs are
content-addressed and fleet-visible, so only the index is stale, and the
resolver adopts a newer foreign index through a fallback source
(crates/celld/assets.rs#L35-L47). The default asset cache is 512 MiB
(crates/celld/assets.rs#L28). The asset functions include the assets
binding, HTML handling, not-found handling, worker-first routes, `_headers`,
and `_redirects` (docs/README.md#L236-L243).

## In-place adoption

A running node does not restart for a new deployment. Each node reads
`deploy/current.json` every `CELLD_DEPLOY_POLL_S` seconds (default 30) and
adopts a new deployment in place, and `POST /reload` on the internal
listener makes a node adopt the pointer now (docs/README.md#L245-L248). A
node builds the new deployment beside the one it serves and switches new
requests to it in one step; a request that started on the previous deployment
finishes on it, and a deployment that does not build leaves the current one
serving (docs/README.md#L249-L253).

A **generation** is "everything a node derives from a deployment": the
compiled Worker configurations, the isolate pools, the Durable Object class
registry, the service-binding graph, the asset resolvers, and the cron
schedule. A node serves exactly one current generation and reaches it through
a snapshot, so a request that started on one generation finishes on it even
after the node adopts another (crates/celld/generation.rs#L3-L16). Boot and
reload construct a generation through the same two functions —
`DeploymentGraph::load` and `Generation::build` — so a reload cannot miss
what a boot did, because there is no second path for it to miss
(crates/celld/generation.rs#L12-L16).

A Durable Object that is not resident runs the new deployment at its next
activation. A resident object moves to the new deployment at a safe point: no
request runs in it, no alarm handler runs in it, no output waits for
durability, and no regular WebSocket is open. The move keeps the object's
storage, its epoch, and its hibernatable WebSockets, and it does not read or
write the bucket (docs/README.md#L258-L263). An object that reaches no safe
point in `CELLD_DEPLOY_MAX_AGE_S` seconds (default 60) is forced: celld
cancels its running work and closes its regular WebSockets with code 1012,
which is what a Cloudflare deployment does to every object; a value of 0
forces every resident object at the adoption (docs/README.md#L263-L268).

In the adoption window a request on one deployment can call a Durable Object
on the other, so two adjacent versions must accept each other's calls
(docs/README.md#L268-L271). `POST /reload` also rebuilds an unchanged
deployment, so an edit to `CELLD_VARS_FILE` (or a `CELLD_VAR_*` override)
takes effect without a restart (docs/README.md#L253-L255). The `/state`
response reports the deployment a node serves, the deployments it still
drains, the objects that are moving, and the deployment each resident object
runs (docs/README.md#L269-L272).

## Tests

Deployment manifests carry schema versions and every durable object is
validated before it becomes runtime state — for example
`validate_queue_manifest` re-runs the authoritative `celld-logic` checks on a
loaded manifest so a malformed producer cannot become a missing binding
(crates/celld/protocol.rs#L168-L205). The deployment version hash guarantees
identical code deploys as one version regardless of the upload path
(crates/celld/protocol.rs#L420-L428).
