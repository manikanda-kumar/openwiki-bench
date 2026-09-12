---
type: "Reference"
title: "Deploying applications and adopting generations"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Deploying applications and adopting generations

This page explains the deployment contract: the supported Wrangler config
surface, the manifest and versioning, the fleet pointer, and how a running
node adopts a new deployment in place across generations.

## `celld deploy`: config, identity, and durable publication

`celld deploy` builds a Wrangler project and writes it to the fleet bucket.
Bundling is esbuild's job; this module does config, identity, and durable
bucket publication. Config keys are an **allowlist** — anything not modeled is
refused, never silently dropped (`crates/celld/deploy.rs:10-13`). The supported
keys include `name`, `main`, `compatibility_date`, `compatibility_flags`,
`durable_objects`, `migrations`, `assets`, `services`, `triggers`, `vars`,
`d1_databases`, `kv_namespaces`, `queues`, `workflows`, `r2_buckets`, and
`no_bundle` (`crates/celld/deploy.rs:14-24`). Worker projects need `esbuild` on
`PATH`; asset-only projects do not too.

## Deploy → bucket object layout

`crates/celld/deploy.rs` writes the deployment objects directly using the
documented types in `crates/celld/protocol.rs`. The layout:

- `deploy/<script>/<version>/manifest.json` — the normalized thing celld reads
  to know what to run (`crates/celld/protocol.rs:11-13`). The script name is
  deployment identity; one fleet runs one current application.
- `deploy/<script>/<version>/assets.json` — the immutable canonical asset index
  for asset-bearing deployments (`crates/celld/protocol.rs:333-339`).
- `deploy-blobs/assets/sha256/<xx>/<sha256>` — immutable asset body blobs
  (`crates/celld/protocol.rs:384-399`).
- `deploy/current.json` — the fleet-wide pointer a node reads on startup;
  changing this is a deploy and nodes converge to it (`crates/celld/protocol.rs:401-403`).
- `deploy/queues/<queue>/consumer.json` — the one deployment allowed to consume
  a fleet-global queue (`crates/celld/protocol.rs:103-107`).

## Deployment identity

`deployment_version` hashes sorted module contents plus the serialized
metadata (never the raw upload framing, which is not deterministic) and the
asset index, truncated to 16 hex chars. Cron trigger expressions are
**deliberately not** an input: a version names the code and its bindings, while
a schedule is configuration layered on top, as Cloudflare models it
(`crates/celld/protocol.rs:418-451`).

## The manifest and feature gating

`Manifest` carries the script name, main module, `do_classes`, `sqlite_classes`,
modules, assets, crons, queue consumers, `required_features`, and raw metadata
(`crates/celld/protocol.rs:14-44`). A manifest requiring a feature this build
does not support is rejected up front so an older node cannot deserialize
partially and fail at worker load (`crates/celld/protocol.rs:50-53`).
`validate_required_features` (`crates/celld/protocol.rs:294-303`) gates the
supported `FEATURE_*_V1` list.

## The fleet pointer and in-place adoption

A running node does not restart for a new deployment. Each node reads
`deploy/current.json` every `CELLD_DEPLOY_POLL_S` (default 30 s) and adopts a
new deployment in place; `POST /reload` on the internal listener makes a node
adopt the pointer now (`docs/README.md:245-256`). The pointer watcher
(`crates/celld/main.rs:665-749`) is the node's one reader of the pointer after
boot. A version that failed to build is remembered and not retried until the
pointer names something else or a reload is forced, so a broken bundle does not
recompile every interval on every node (`crates/celld/main.rs:659-663`).

The node builds the new deployment beside the one it serves and then switches
new requests in one step; a request that started on the previous deployment
finishes on it. A deployment that does not build leaves the current deployment
serving (`docs/README.md:253-255`).

## Generations and how resident objects move

`crates/celld/generation.rs` models one running deployment as a `Generation`:
the compiled Worker configurations, isolate pools, class registry, service
bindings, asset resolvers, and the cron schedule (`crates/celld/generation.rs:3-9`).
A node serves exactly one current generation and reaches it through a snapshot,
so a request that started on one generation finishes on it even after the node
adopts another (`crates/celld/generation.rs:7-10`). Generation ids count up from
`FIRST_GENERATION` (1) and are never compared across nodes — the fleet-wide
identity of a deployment is its version string (`crates/celld/generation.rs:28-31`).

A resident Durable Object moves to the new deployment at a safe point: no
request runs in it, no alarm handler runs, no output waits for durability, and
no regular WebSocket is open. The move keeps the object's storage, epoch, and
hibernatable WebSockets and does not read or write the bucket. An object that
reaches no safe point in `CELLD_DEPLOY_MAX_AGE_S` seconds (default 60) is
forced: celld cancels its running work and closes its regular WebSockets with
code 1012. A value of 0 forces every resident object at the adoption
(`docs/README.md:257-271`).

## Cron arm and reserved classes

Boot and adoption arm the current deployment's cron schedule. Every node makes
the first call to the cron cell; the ownership CAS decides which one keeps the
cell while the others route to it. A schedule change arrives with the
deployment that carries it (`crates/celld/main.rs:549-557`). Reserved classes
(`__D1Database`, `__Workflow`, `__KvNamespace`, `__Queue`) are supplied by the
runtime and are subject to the deploy-time feature gates described on the
reserved-cells page.

---

## Related pages

- [Reserved cells: D1, KV, Queues, Workflows, and cron](/openwiki/concepts/reserved-cells.md)
- [The V8 JS runtime: isolates, the input gate, alarms, and WebSockets](/openwiki/concepts/js-runtime.md)
- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
