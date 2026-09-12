---
type: workflow
title: Deployment pipeline and generations
description: celld deploy builds a Wrangler project with esbuild and publishes content-addressed objects plus a current.json pointer to the fleet bucket; nodes poll the pointer, build a new Generation beside the serving one, switch atomically, and migrate resident cells at safe points with a forced swap after CELLD_DEPLOY_MAX_AGE_S.
tags: [deploy, generation, bucket-protocol, rollout, features]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-7091fbd5baa39fe548c0e34d
    resource: repo://crates/celld/control_plane.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-927120ddf46d64238ba27c62
    resource: repo://crates/celld/local_store.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Deployment pipeline and generations

One fleet runs one application. The deployment path is deliberately bucket
mediated: `celld deploy` writes durable objects, running nodes adopt them, and
nothing shells out to wrangler or speaks a Cloudflare API
([crates/celld/deploy.rs#L8-L12](repo://crates/celld/deploy.rs#L8-L12)).
This page covers the contract in `protocol.rs`, the CLI builder, the runtime
generation switch, discovery, the `celld dev` reuse of the whole stack, and
the managed control-plane path.

## The bucket contract (`protocol.rs`)

The deployment objects "are the interface; nothing else is exchanged"
([crates/celld/protocol.rs#L3-L4](repo://crates/celld/protocol.rs#L3-L4)):

- `deploy/<script>/<version>/manifest.json` — the normalized thing a node
  reads: version, script name, optional main module, Durable Object classes
  and the SQLite-backed subset, module refs, an asset index ref, cron
  expressions, queue consumers, and `required_features`
  ([crates/celld/protocol.rs#L10-L42](repo://crates/celld/protocol.rs#L10-L42)).
  Cron expressions are deployment state, so changing a schedule needs no
  migration of an already-armed alarm.
- `DeployPointer { script_name?, version, prefix, rollout }` at
  `deploy/current.json` (and per-script pointers) — the thing a node polls;
  the named-script pointer omits `script_name` on older writers
  ([crates/celld/protocol.rs#L404-L415](repo://crates/celld/protocol.rs#L404-L415),
  [crates/celld/fleet.rs#L628](repo://crates/celld/fleet.rs#L628)).
- Asset blobs live at `deploy-blobs/assets/sha256/…` keyed by content digest
  ([crates/celld/protocol.rs#L395](repo://crates/celld/protocol.rs#L395)).
- **Version identity**: `deployment_version` is the first 16 hex chars of
  SHA-256 over sorted module contents plus the exact serialized metadata (and
  the asset index when present) — never upload framing, and *deliberately not*
  cron expressions, so native and managed paths agree on what a version is
  ([crates/celld/protocol.rs#L417-L451](repo://crates/celld/protocol.rs#L417-L451)).
- **Feature gating**: `SUPPORTED_DEPLOYMENT_FEATURES` is the set this build
  can load — `assets-v1`, `cron-v1`, `d1-v1`, `kv-v1`, `queues-v1`,
  `sqlite-vec-v1`, `wasm-v1`, `workflows-v1`, `r2-v1` — and a manifest
  requiring anything else is rejected up front, because `ModuleRef` tolerates
  unknown fields and an older node would otherwise deserialize partially and
  misbehave at worker load
  ([crates/celld/protocol.rs#L50-L66](repo://crates/celld/protocol.rs#L50-L66),
  [crates/celld/protocol.rs#L294](repo://crates/celld/protocol.rs#L294)).
  A mixed fleet fails at deploy time, not at request time
  ([docs/wasm.md#L24-L27](repo://docs/wasm.md#L24-L27)).

## `celld deploy`: config, identity, publication

The command's rule set:

- **Wrangler config is an allowlist.** `SUPPORTED_KEYS` names every accepted
  key (`name`, `main`, `durable_objects`, `migrations`, `assets`, `services`,
  `triggers`, `vars`, `d1_databases`, `kv_namespaces`, `queues`, `workflows`,
  `r2_buckets`, `no_bundle`, …); an unmodeled key stops the deploy — "refusing
  is compat-safe, guessing produces confusing activation failures later"
  ([crates/celld/deploy.rs#L35-L56](repo://crates/celld/deploy.rs#L35-L56),
  [docs/README.md#L235-L240](repo://docs/README.md#L235-L240)).
- **Bundling is esbuild's job**, required on `PATH` (or `CELLD_ESBUILD`) for
  Worker projects and unnecessary for asset-only projects; a pre-bundled
  (`no_bundle`, e.g. Vite) entry skips esbuild because "running esbuild over
  a Vite build is what corrupts it"
  ([crates/celld/deploy.rs#L193-L201](repo://crates/celld/deploy.rs#L193-L201),
  [crates/celld/deploy.rs#L256-L259](repo://crates/celld/deploy.rs#L256-L259),
  [crates/celld/deploy.rs#L448-L459](repo://crates/celld/deploy.rs#L448-L459)).
  esbuild emits one JS module plus copies of every imported wasm file, which
  deploy uploads beside the bundle
  ([crates/celld/deploy.rs#L465](repo://crates/celld/deploy.rs#L465)).
- **Publication is content-addressed and idempotent**: asset blobs are
  written only when absent at the right size with a matching `sha256`
  metadata, then the versioned manifest and finally the pointers
  (`deploy/<script>/current.json`, `deploy/current.json`)
  ([crates/celld/deploy.rs#L572](repo://crates/celld/deploy.rs#L572),
  [crates/celld/deploy.rs#L613-L619](repo://crates/celld/deploy.rs#L613-L619),
  [crates/celld/deploy.rs#L769-L783](repo://crates/celld/deploy.rs#L769-L783)).

## Generation adoption at runtime

A node reads `deploy/current.json` on the `CELLD_DEPLOY_POLL_S` timer
(default 30 s) or immediately on `POST /reload`
([crates/celld/generation.rs#L86-L92](repo://crates/celld/generation.rs#L86-L92),
[docs/README.md#L245-L255](repo://docs/README.md#L245-L255)). One `Generation`
is everything derived from a deployment — compiled Worker configs, isolate
pools, the DO class registry, the service-binding graph, asset resolvers, and
the cron schedule — and boot and reload construct it through the same two
functions (`DeploymentGraph::load` then `Generation::build`) so "a reload
cannot miss what a boot did, because there is no second path for it to miss"
([crates/celld/generation.rs#L3-L16](repo://crates/celld/generation.rs#L3-L16)).
`DeploymentGraph::load` is the only bucket walk: it resolves the primary
script plus every service-binding and queue-consumer dependency transitively
and refuses a script that resolves twice or a queue attached to a different
deployment, "because either would give one script two bodies in one process"
([crates/celld/generation.rs#L110-L133](repo://crates/celld/generation.rs#L110-L133)).

Adoption semantics:

- The node builds the new generation **beside** the serving one, then flips
  new requests in one step; a request admitted from the old generation
  finishes on it via its snapshot
  ([crates/celld/generation.rs#L10-L12](repo://crates/celld/generation.rs#L10-L12),
  [docs/README.md#L249-L251](repo://docs/README.md#L249-L251)).
- A deployment that does not build leaves the current one serving; the
  failure appears in the log and in the `/reload` response
  ([docs/README.md#L251-L255](repo://docs/README.md#L251-L255)).
- `POST /reload` **forces a rebuild** even when the pointer is unchanged — the
  documented way to pick up a `CELLD_VARS_FILE` edit without a restart —
  while a poll tick and a managed nudge skip unchanged pointers
  ([crates/celld/generation.rs#L35-L42](repo://crates/celld/generation.rs#L35-L42),
  [docs/README.md#L254-L255](repo://docs/README.md#L254-L255)).
- Resident Durable Objects move at a safe point (no request, alarm handler,
  unproven output, or regular WebSocket open); the move keeps storage, epoch,
  and hibernatable sockets and touches no bucket; after
  `CELLD_DEPLOY_MAX_AGE_S` (default 60; `0` forces at the flip) the swap is
  forced: activity cancelled and regular WebSockets closed with 1012
  ([docs/README.md#L257-L266](repo://docs/README.md#L257-L266),
  [crates/celld/generation.rs#L94-L104](repo://crates/celld/generation.rs#L94-L104)).
  In the window two adjacent generations can call each other, so releases
  must accept each other's calls. `/state` reports the serving generation,
  drained generations, and swapping cells
  ([docs/README.md#L267-L272](repo://docs/README.md#L267-L272),
  [crates/celld/actor.rs#L1128-L1133](repo://crates/celld/actor.rs#L1128-L1133)).

## Discovery and the fleet secret

There is no join service: "every node discovers owners and peers from bucket
leases" ([README.md#L184-L187](repo://README.md#L184-L187)). `validate_bucket`
probes the store at startup, and the first node conditionally creates
`fleet/peer-auth.json`, the 32-byte HMAC secret that signs peer-control and
reserved-cell requests (full mechanics on
[listeners and peers](../networking/listeners-and-peers.md))
([crates/celld/main.rs#L3297-L3308](repo://crates/celld/main.rs#L3297-L3308),
[crates/celld/peer_auth.rs#L20](repo://crates/celld/peer_auth.rs#L20),
[crates/celld/peer_auth.rs#L272](repo://crates/celld/peer_auth.rs#L272)).

## `celld dev`: same stack, local store

`celld dev` supplies only the infrastructure the real paths need — one
persisted local object store and one supervised node — while keeping the
standalone deployment, ownership, and LTX machinery
([crates/celld/dev.rs#L3-L7](repo://crates/celld/dev.rs#L3-L7)). The store is
SQLite because supervisor and node are separate processes and both write
during a reload: "SQLite supplies the cross-process transaction that a
directory of files cannot — a conditional update checks its ETag and installs
the new object in one commit"; it is explicitly not a production shared-
filesystem mode ([crates/celld/local_store.rs#L3-L9](repo://crates/celld/local_store.rs#L3-L9)).
The local bucket reaches the node only through a `#[doc(hidden)]` bridge
called by the supervised child, so "no regular subcommand can select it"
([crates/celld/dev.rs#L26-L32](repo://crates/celld/dev.rs#L26-L32)).
The watcher rebuilds on source changes, keeps the current application running
through a failed build, and retains durable state across restarts
([docs/README.md#L329-L337](repo://docs/README.md#L329-L337)).

## Managed control plane (alpha)

`crates/celld/control_plane.rs` is the celld.dev session client: presence
reporting, a bounded cell "explorer" over the local SQLite (25 rows, 32
columns, 2 KiB per value caps), and runtime module sync, with the deployment
fetched from the managed store or from the bucket pointers
([crates/celld/control_plane.rs#L25-L35](repo://crates/celld/control_plane.rs#L25-L35)).
Its restart-on-deployment path — replacing the process image on a new
deployment, which used to cut in-flight requests and cold-restore every
resident cell — is off by default and kept only as the
`CELLD_CLOUD_RESTART_ON_DEPLOY` escape hatch, scheduled for removal; normal
adoption is the in-place pointer reload above
([crates/celld/control_plane.rs#L37-L44](repo://crates/celld/control_plane.rs#L37-L44)).

## Upgrade invariants recorded by the repository

The repo records these release-to-release rules (from
[docs/README.md#L513-L544](repo://docs/README.md#L513-L544)); they are the
canonical examples of deployment-object compatibility constraints:

- **v0.1.0 → v0.2.0: stop the whole fleet first** — v0.2.0 advertises the
  internal listener (old records name unreachable addresses) and compacts
  into block objects old readers cannot restore.
- **v0.2.1 → v0.3.0: rolling works** — the durability default changes to
  `fleet`; a v0.3.0 node cannot replicate to a v0.2.x peer and falls back to
  bucket acks; downgrading back after an open node-log session "can lose
  acknowledged writes."
- **v0.3.0 → v0.4.0: stop the whole fleet first** — all proxied cell calls
  move onto one versioned tunnel that refuses mismatched peers, and large KV
  values become epoch-qualified so a v0.3.0 node cannot read them.

Related: [architecture hub](../architecture.md) ·
[node operations](../operations/node-operations.md) ·
[reserved classes](../platform/reserved-classes.md) ·
[listeners and peers](../networking/listeners-and-peers.md) ·
[quickstart](../quickstart.md)
