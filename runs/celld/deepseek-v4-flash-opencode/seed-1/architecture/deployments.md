---
type: architecture
title: Deployments and in-place code adoption
description: How celld deploy bundles a Wrangler project and publishes manifests, module blobs, asset indexes, and the deploy/current.json pointer to the fleet bucket, and how every node loads a DeploymentGraph, builds a Generation, and adopts new code in place without restarting.
tags: [deployment, wrangler, generations, code-versioning]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-278001c559216d321bc30f18
    resource: repo://crates/celld/assets.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-293923b46324b9d01b8b88b2
    resource: repo://crates/logic/lib.rs
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Deployments and in-place code adoption

A fleet runs one application. Deployment is the durable publication of that
application's code and bindings into the fleet bucket, and a running node
adopts new code in place without restarting. This page covers the write side
(`celld deploy`) and the read side (pointer watcher, `DeploymentGraph`,
`Generation`), plus the cron and queue-consumer wiring that rides along.

## The write side: `celld deploy`

`celld deploy` builds a Wrangler project and writes it to the fleet bucket.
The module doc and the config-key allowlist in `crates/celld/deploy.rs:8-56`
make the contract explicit: bundling is esbuild's job; this module does
config, identity, and durable bucket publication; and config keys are an
allowlist — anything not modeled is refused, never silently dropped. The
accepted top-level keys are `$schema`, `name`, `main`, `compatibility_date`,
`compatibility_flags`, `durable_objects`, `migrations`, `assets`, `services`,
`triggers`, `vars`, `d1_databases`, `kv_namespaces`, `queues`, `workflows`,
`r2_buckets`, and `no_bundle`. The config file must be `wrangler.jsonc` or
`wrangler.json`; `wrangler.toml` is refused with an explicit error
(`resolve_config`, `crates/celld/deploy.rs:931-953`).

Worker projects are bundled with esbuild from `PATH` (`run_esbuild`,
`crates/celld/deploy.rs:2110-2166`); `no_bundle` reads the entry as-is because
a pre-bundled Vite build would be corrupted by another esbuild pass. Asset-only
projects need no esbuild.

### Deployment identity

A deployment version is not a hash of the raw upload framing. `deployment_version`
(`crates/celld/protocol.rs:418-451`) hashes the sorted module contents plus the
exact serialized metadata plus the asset index. Cron trigger expressions are
deliberately **not** an input: a version names the code and its bindings, and a
schedule is configuration layered on top, which is how Cloudflare models it.
The result is a 16-hex-character version, and the deployment prefix is
`deploy/<script>/<version>`.

### What gets written, and in what order

`deploy::build` produces a `Manifest` (`crates/celld/deploy.rs:432-559`) whose
`required_features` list names each capability the deployment depends on
(`assets-v1`, `cron-v1`, `d1-v1`, `kv-v1`, `queues-v1`, `r2-v1`,
`sqlite-vec-v1`, `wasm-v1`, `workflows-v1`). `deploy::write`
(`crates/celld/deploy.rs:561-621`) then publishes in a careful order:

1. Read the queue-consumer attachments first, so a competing consumer is a
   deploy refusal that leaves no half-published version behind.
2. Finish every content-addressed asset body (`deploy-blobs/assets/sha256/...`)
   before publishing the deployment-local `assets.json` index.
3. Write the module blobs and the index, then the `manifest.json`, all under
   `deploy/<script>/<version>/`.
4. Publish the queue-consumer attachments, which name this exact immutable
   prefix.
5. Move the named pointer `deploy/<script>/current.json` (resolves
   service-binding components), then the fleet-wide `deploy/current.json`
   (the sole application selector) **last**.

`put_pointer` (`crates/celld/deploy.rs:783-797`) is a compare-and-swap, so a
concurrent deploy produces a loser rather than a lost write; a lost race is
reported to the operator as a "re-run `celld deploy`" error.

A node that predates a required feature rejects the deployment up front rather
than partially deserializing the manifest and failing at worker load
(`validate_required_features`, `crates/celld/protocol.rs:291-303`), so a mixed
fleet fails at deploy time.

### Queue consumers

A push queue can have exactly one consumer script, recorded at
`deploy/queues/<queue>/consumer.json` as a `QueueConsumerAttachment` naming an
exact deployment (`script_name`, `version`, `prefix`) —
`crates/celld/protocol.rs:101-166`. The attachment is published with a
conditional write after the deployment prefix is complete, so a node can never
resolve a consumer to a half-uploaded deployment; a competing consumer script
is a deploy refusal (`prepare_queue_attachments`, `crates/celld/deploy.rs:631-680`).

## The read side: loading a deployment

Every node loads the deployment the pointer names. `DeploymentGraph::load`
(`crates/celld/generation.rs:128-235`) resolves the fleet-wide pointer, then
walk the dependencies: a service binding names a script whose own pointer names
its deployment, and a queue dependency names a queue whose consumer attachment
names an exact deployment. The walk refuses a script that resolves twice and a
queue attached to a deployment other than the one already loaded, because
either would give one script two bodies in one process. The graph holds the
primary script plus every cohosted service-binding target and queue consumer.

The manifest is decoded and validated on load: version and script name must
match the pointer (`load_worker_at_pointer`, `crates/celld/fleet.rs:704-757`),
required features and queue manifest are validated
(`crates/celld/fleet.rs:727-728`), and an asset-only deployment gets a
synthetic `fetch` that returns 404 so the runtime construction path stays
uniform.

### A node fires only its own schedule

When a service-binding target declares cron triggers, the node logs that they
never run here (`crates/celld/generation.rs:216-230`): the reserved cron class
is one key, so a second script's cron cell would resolve to the first script's
config and run the wrong `scheduled` handler. Dropping the schedule is the safe
half of that trade.

## The Generation: what a node runs

A `Generation` is everything a node derives from a deployment: the compiled
Worker configurations, the isolate pools they run in, the Durable Object class
registry, the service-binding graph, the asset resolvers, and the cron
schedule (`crates/celld/generation.rs:1-16`). Generations are process-local and
monotonic from `FIRST_GENERATION`; the fleet-wide identity of a deployment is
its version string, never a generation id. Boot and reload construct a
generation through the same two functions — `DeploymentGraph::load` and
`Generation::build` — so a reload cannot miss what a boot did.

Adoption (`adopt_deployment`, `crates/celld/main.rs:590-654`) loads the graph,
builds the generation on a blocking thread (compiling every script), and calls
`runtime.adopt` only after the build succeeds. A build that fails leaves the
current generation serving; nothing has changed until adopt.

### The pointer watcher

A dedicated task polls `deploy/current.json` every `CELLD_DEPLOY_POLL_S`
(default 30 s) and adopts what the pointer names
(`start_pointer_watcher`, `crates/celld/main.rs:656-749`). `POST /reload` on
the internal listener forces the same path now and reports the outcome
(`internal_reload`, `crates/celld/main.rs:754-815`). A version that failed to
build is remembered and not retried until the pointer names something else or
a reload is forced, so a broken bundle does not recompile every interval on
every node. A request that started on one generation finishes on it, because
each generation is reached through a snapshot.

## Moving cells onto the new code

After adoption the core is told via `Event::GenerationChanged`, and resident
cells move to the new generation at a safe point: no request runs in the cell,
no alarm handler runs, no output waits for durability, and no regular WebSocket
is open. The move keeps the cell's storage, its epoch, and its hibernatable
WebSockets, and it does not read or write the bucket. A cell that reaches no
safe point within `CELLD_DEPLOY_MAX_AGE_S` (default 60) is forced: its running
work is cancelled and its regular WebSockets close with code 1012, matching
what a Cloudflare deployment does to every object. The engine's reserved
classes are forced at once (eager classes), because they hold no application
state worth waiting for (`crates/celld/generation.rs:95-105` and the swap
fields in `crates/logic/lib.rs:620-637`).

## Assets

Static assets are content-addressed and fleet-wide: the body key is derived
from the SHA-256 digest (`asset_blob_key`, `crates/celld/protocol.rs:386-399`),
so identical bytes upload once and any deployment can reference them. The
per-deployment `assets.json` index (`AssetIndex`, `crates/celld/protocol.rs:334-369`)
is the canonical, immutable file list. The runtime `AssetResolver`
(`crates/celld/assets.rs:28-60`) serves requests against the index and keeps a
fallback source so a rolling restart can adopt a newer deployment's index when
content-hashed asset paths miss.

## Cron wiring

A deployment with `triggers.crons` needs somebody to make the first call,
because a cron cell has no client to wake it. Every node arms the reserved
cron cell through the ordinary Durable Object routing path
(`spawn_cron_arm`, `crates/celld/main.rs:549-588`); the ownership
compare-and-swap decides which node keeps the cell while the others route to
that owner. Boot and adoption both come through here, so a schedule change
arrives with the deployment that carries it, and a failed arm is retried with
bounded backoff.

## Related pages

- [V8 runtime and Cloudflare Workers compatibility](workers-runtime.md) — how a Generation materializes into isolate pools and class registries.
- [The fleet bucket and object storage](../operations/fleet-bucket.md) — the bucket, key prefixes, and conditional writes that make deployment publication safe.
- [Operating a node and a fleet](../operations/fleet-operations.md) — rolling updates and the deployment modes they require.
