---
type: workflow
title: "Deployment pipeline"
description: "How celld deploy bundles a Worker project with esbuild, refuses unsupported wrangler config, publishes manifests to the bucket, and how nodes adopt generations."
tags: [deploy, esbuild, wrangler, generation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Deployment pipeline

`celld deploy` builds a Wrangler project and writes it to the fleet bucket.
Bundling is **esbuild's** job; the module "does config, identity, and durable
bucket publication. Nothing here shells out to wrangler or speaks a
Cloudflare-shaped API" (`crates/celld/deploy.rs:10-13`).

## Config: an allowlist, not a filter

"Config keys are an allowlist: anything we do not model is refused, never
silently dropped" (`crates/celld/deploy.rs:12-13`). The rationale is stated
where `SUPPORTED_KEYS` is defined: "Anything else is an error: refusing is
compat-safe, guessing produces confusing activation failures later"
(`crates/celld/deploy.rs:36-38`). The modeled keys are `$schema`, `name`,
`main`, `compatibility_date`, `compatibility_flags`, `durable_objects`,
`migrations`, `assets`, `services`, `triggers`, `vars`, `d1_databases`,
`kv_namespaces`, `queues`, `workflows`, `r2_buckets`, `no_bundle`
(`crates/celld/deploy.rs:38-57`).

## Reserved Durable Object classes

The runtime supplies several DO classes itself, and a deployment is refused
if user code takes their names:

- `__D1Database` (every D1 database), `__Workflow`, the KV class, and the
  Queue class are `RESERVED_CLASSES` (`crates/celld/deploy.rs:60-89`).
- The workflow class is **script-scoped**: its namespace key is
  `cells:v1:<len>:<script>:__Workflow`, so two co-hosted scripts address
  different cells. The comment records why: both used to register *the same*
  class name, "a deployment's class registry is one flat map, so the second
  script collided with the first and the node refused to start at all"
  (`crates/celld/deploy.rs:89-102`).
- D1 is deliberately **fleet-wide** — "a namespace is a resource several
  Workers bind, so two scripts naming one namespace mean to reach one set of
  cells" (`crates/celld/deploy.rs:76-80`).
- The `.a.b`-style separator choice is triple-constrained: a JS class name
  cannot contain `.`, it must not be `:` (cell-scope parser splits on it),
  and it must be within `valid_cell_scope`'s security-fence charset
  (`crates/celld/deploy.rs:100-110`).

## Bundling

Worker projects require `esbuild` on PATH; asset-only projects do not
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
(`crates/celld/deploy.rs:193-205`, [README](README.md)). With
`no_bundle: true` the entry is read as-is — "Already bundled by the caller's
toolchain. Read it as it is; running esbuild over a Vite build is what
corrupts it. A pre-bundled entry carries no sibling wasm"
(`crates/celld/deploy.rs:442-457`). esbuild emits one JS module plus a copy
of every wasm file the bundle imports, shipped as sibling modules
(`crates/celld/deploy.rs:462-466`).

## Publication to the bucket

Deployed objects are the documented types in `crates/celld/protocol.rs`:
`Manifest`, per-feature markers (`FEATURE_ASSETS_V1`, `FEATURE_CRON_V1`,
`FEATURE_D1_V1`, `FEATURE_KV_V1`, `FEATURE_QUEUES_V1`,
`FEATURE_SQLITE_VEC_V1`, `FEATURE_R2_V1`, `FEATURE_WASM_V1`,
`FEATURE_WORKFLOWS_V1`; `crates/celld/protocol.rs:55-99`), asset indices
(see `crates/celld/assets.rs`), and queue-consumer attachments. Publication
writes the per-script pointer `deploy/<script>/current.json` and then the
fleet pointer `deploy/current.json`
(`crates/celld/deploy.rs:615-619`). Queues are reconciled as the union of
desired consumers and whatever the previous deployment attached
(`crates/celld/deploy.rs:640-641`). Every node "loads its latest successfully
committed deployment from `deploy/current.json`"
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
([README](README.md)); there is no account or join service — fleet discovery
is through bucket leases and peer-auth records.

## Generations: boot and reload share one path

`crates/celld/generation.rs` defines a `Generation` as "everything a node
derives from a deployment: the compiled Worker configurations, the isolate
pools they run in, the Durable Object class registry, the service-binding
graph, the asset resolvers, and the cron schedule. A node serves exactly one
current generation and reaches it through a snapshot, so a request that
started on one generation finishes on it even after the node adopts another"
(`crates/celld/generation.rs:3-8`). "Boot and reload construct a generation
through the same two functions, [`DeploymentGraph::load`] and
`Generation::build`. Nothing else reads a deployment manifest into runtime
state. A value a deployment implies therefore has one place it can be
computed, and a reload cannot miss what a boot did, because there is no
second path for it to miss" (`crates/celld/generation.rs:10-14`).

Generation ids are per-process, "monotonic from one at boot; never reused,
never persisted, and never compared across nodes — the fleet-wide identity of
a deployment is its version string" (`crates/celld/generation.rs:16-19`).
A running node reloads through a `ReloadRequest` arriving over an
`UnboundedSender`, answered with a `ReloadOutcome` (`crates/celld/generation.rs:37-70`).

`celld dev` uses this machinery to watch the project and rebuild on change,
"keeping the current application running if a build fails, and a successful
<!-- openwiki: broken internal link [README.md] file "README.md" does not exist. Fix the href or restore the target, then delete this comment. -->
restart retains the durable state" ([README](README.md)).

## Uncertainty

- Exact asset publishing internals (`build_assets`, gzip blobs, content
  addressing) live in `crates/celld/assets.rs`; this page cites only what
  deploy.rs and protocol.rs state directly.
- Rollback semantics beyond keeping the previous per-script pointer are not
  established by code comments read here; `deploy/current.json` is the
  authoritative pointer both this repo's README and `fleet::read_current_pointer`
  (`crates/celld/main.rs:685`) rely on.
