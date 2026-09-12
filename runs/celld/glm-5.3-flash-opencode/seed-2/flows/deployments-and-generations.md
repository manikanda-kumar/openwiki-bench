---
type: deployment-flow
title: Deployments and generations
description: How a code change travels from a Wrangler project to every node — esbuild builds, bucket manifests, the deploy/current.json pointer, and per-node in-place Generation adoption.
tags: [deployment, generations, esbuild, rollout, reload]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-278001c559216d321bc30f18
    resource: repo://crates/celld/assets.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Deployments and generations

## The deploy path

`celld deploy` builds a Wrangler project and writes it to the fleet bucket.
The module contract in `crates/celld/deploy.rs` is explicit about scope:

> Bundling is esbuild's job; this module does config, identity, and durable
> bucket publication. Nothing here shells out to wrangler or speaks a
> Cloudflare-shaped API. Config keys are an allowlist: anything we do not
> model is refused, never silently dropped.

(repo://crates/celld/deploy.rs#L10-L16)

Worker projects require `esbuild` on `PATH`; asset-only projects do not
(repo://crates/celld/deploy.rs#L193-L201). The deploy writes
`deploy/<script>/<version>/manifest.json` plus immutable content-addressed
module and asset blobs, and updates the pointer(s). The manifest's typed
shape (`protocol::Manifest`) carries the module list, Durable Object and
SQLite-backed classes, assets, cron expressions, and queue consumers —
these bucket objects are the whole interface between tools and nodes
(repo://crates/celld/protocol.rs#L15-L44).

Deployment identity is defined by sorted module contents plus the
serialized metadata — never the raw upload framing, so every deploy of
identical code produces the same version identity regardless of transport
noise (repo://crates/celld/protocol.rs#L413-L415).

## The pointer and adoption

`deploy/current.json` is the fleet-wide pointer; changing it *is* the
deploy, and nodes converge to it (repo://crates/celld/protocol.rs#L402-L412).
Every node reads the pointer on startup, and one in-process watcher keeps
reading it afterwards (repo://crates/celld/main.rs#L653-L658):

> It polls on a slow interval and adopts what the pointer names through
> `adopt_deployment`; a `POST /reload` or a managed notification only makes
> it look now. The pointer is the authority, so a missed nudge degrades to
> "adopts one interval later". A version that failed to build is remembered
> and not retried until the pointer names something else or a reload is
> forced: a broken bundle must not recompile every interval on every node.

(repo://crates/celld/main.rs#L653-L658)

Adoption is *in place*: a node builds a new `Generation`, tells the decision
core via `Message::GenerationChanged` so resident cells move at their safe
points, and reserved cells move first so the cron arm can reach a cell
already running the new schedule (repo://crates/celld/main.rs#L640-L647).
The poll interval is `CELLD_DEPLOY_POLL_S` (default 30 s); a resident cell
may keep previous-deployment code for `CELLD_DEPLOY_MAX_AGE_S` (default 60,
0 forces at once) before celld forces the move
(repo://docs/README.md#L683-L685).

## Generations

A `Generation` is the per-process materialization of one deployment:

> A [`Generation`] is everything a node derives from a deployment: the
> compiled Worker configurations, the isolate pools they run in, the
> Durable Object class registry, the service-binding graph, the asset
> resolvers, and the cron schedule. A node serves exactly one current
> generation and reaches it through a snapshot, so a request that started
> on one generation finishes on it even after the node adopts another.

(repo://crates/celld/generation.rs#L7-L14)

Key invariants:

- One construction path: boot and reload both build a generation through
  `DeploymentGraph::load` and `Generation::build`; nothing else reads a
  deployment manifest into runtime state, so a reload cannot miss what a
  boot did (repo://crates/celld/generation.rs#L16-L18).
- Generation ids are monotonic from one *within a process*, never reused,
  never persisted, and never compared across nodes: the fleet-wide identity
  of a deployment is its version string
  (repo://crates/celld/generation.rs#L46-L52).
- A runtime stop can carry `StopCause::Swap`, moving a cell's runtime to a
  new-generation isolate at the *same epoch* with no ownership change, no
  restore, and no replication release
  (repo://crates/logic/types.rs#L947-L953).

## Reserved classes are deploy-time concepts

Several "services" are not application Durable Objects but fleet runtime
infrastructure, implemented as reserved DO classes that the deployment
pipeline materializes:

- `__D1Database` (repo://crates/celld/deploy.rs#L64-L65) — fleet-wide by
  design: a D1 namespace outlives any one Worker's binding, so multiple
  scripts declaring `d1_databases` share one registry entry
  (repo://crates/celld/deploy.rs#L107-L114).
- `__Workflow` plus per-script `__Workflow.<script>` classes
  (repo://crates/celld/deploy.rs#L68-L69, L101-L105).
- The KV and Queue classes come from `celld-logic`
  (`celld_logic::kv::RESERVED_CLASS`, `celld_logic::queue::RESERVED_CLASS`)
  (repo://crates/celld/deploy.rs#L72-L78).
- Cron: the manifest's `crons` are deployment state read by a reserved cron
  cell, so changing a schedule needs no migration of an already-armed alarm
  (repo://crates/celld/protocol.rs#L26-L35); the node re-arms the reserved
  cron cell after each adoption through its internal `/arm` endpoint
  (repo://crates/celld/main.rs#L517-L546).

Scope validation is a security fence: class/scope character sets are
enforced because names become path components and bucket keys
(repo://crates/celld/deploy.rs#L96-L99). Features gate mixed-version
rollouts — each capability has a feature string (`assets-v1`, `d1-v1`,
`cron-v1`, `wasm-v1`, …) that a node without it refuses at deploy time,
failing before requests, not during them
(repo://crates/celld/deploy.rs#L19-L20, repo://crates/celld/protocol.rs#L53-L63).

## Rolling out a mixed fleet

The pointer carries a `Rollout { percent }` so a deploy can move gradually
(repo://crates/celld/protocol.rs#L414-L418). Mixed-version nodes converge
on the same manifest and refuse unknown features at adoption time.
Assets carry a small pointer-observation fallback so an adopter can still
serve an older node's HTML even mid-rollout
(repo://crates/celld/assets.rs#L35-L37).

## Asset behavior

`AssetResolver` decodes asset paths, honors `run_worker_first` config to
decide whether a Worker runs before asset serving, and reports
`asset_only` for projects with no Worker code
(repo://crates/celld/assets.rs#L188-200).
