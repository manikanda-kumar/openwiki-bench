---
type: operations
title: Developer and operator tooling
description: The non-serve commands — deploy (esbuild bundling and durable bucket publication), dev (local store, supervised node, watcher), diagnose (signed peer probes), cell list, and the d1/kv/queue operator subcommands.
tags: [cli, deploy, dev, diagnose, tooling]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-0d6e1a1251e54f3519e4e37d
    resource: repo://crates/celld/peer_probe.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Developer and operator tooling

## `celld deploy` — build and publish

`celld deploy` bundles a Wrangler-shaped Worker project and writes the
deployment objects to the fleet bucket. Its responsibility split is
explicit: "Bundling is esbuild's job; this module does config, identity,
and durable bucket publication. Nothing here shells out to wrangler or
speaks a [Wrangler wire format]"
[crates/celld/deploy.rs](repo://crates/celld/deploy.rs#L10-L11).

The build contract and behavior
[crates/celld/deploy.rs](repo://crates/celld/deploy.rs#L193-L201)
[docs/cloudflare-compat.md]:

- The project directory is checked for `wrangler.jsonc` or `wrangler.json`.
- Worker projects require `esbuild` on `PATH` (or `CELLD_ESBUILD`);
  asset-only projects do not.
- A Vite pre-bundled entry is detected and esbuild is skipped — "running
  esbuild over a Vite build is what corrupts it" (a pre-bundled entry
  carries no sibling wasm; esbuild's copy would break relative module
  resolution) [crates/celld/deploy.rs](repo://crates/celld/deploy.rs#L448-L459).
- Deploy progress is a narrative on **stderr**, while the version is the
  datum release scripts read back and stays a **stdout row** (`Deployed`
  record) [crates/celld/fleet.rs](repo://crates/celld/fleet.rs#L27-L38).

What a deployment can carry is the `protocol.rs` manifest and the
`required_features` gate: the manifest declares `assets-v1`, `cron-v1`,
`d1-v1`, `kv-v1`, `queues-v1`, `sqlite-vec-v1`, `r2-v1`, `wasm-v1`,
`workflows-v1`; a node running an older build must reject a manifest
requiring an unknown feature up front, "because an older node would
otherwise deserialize the manifest partially and fail (or misbehave) at
worker load" [crates/celld/protocol.rs](repo://crates/celld/protocol.rs#L50-L99).
Deploy adoption on a running node (`deploy/current.json` polling, safe
points, forced moves, `/reload`) is covered under
[Node command surface](/openwiki/operations/node-cli.md).

## `celld dev` — local application stack

`crates/celld/dev.rs` is "the local application stack behind `celld
dev`". Its shape [crates/celld/dev.rs#L3-L16]:

- Development uses the same standalone deployment, ownership, and LTX
  paths as production; this module adds only the infrastructure: one
  persisted local object store and one **supervised** celld node.
- The default internal (Worker) port is `DEFAULT_PORT = 9876`.
- The local bucket is named `celld-dev` and is opened through
  `open_local_bucket` -> `Bucket::open_dev`, "the narrow bridge used by
  the supervised binary process. The public fleet parser never receives
  this path, so no regular subcommand can select it" — a dev store
  cannot leak into a production invocation
  ([crates/celld/dev.rs](repo://crates/celld/dev.rs#L19-L26)
  [crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L248-L256)).
- Project watching uses `notify` crate (`RecursiveMode::Watcher`);
  `.celld`, `.git`, `node_modules`, and `target` trees are excluded at
  each depth; Worker projects rebuild with esbuild, asset-only projects
  rebuild without it
  ([docs/README.md](repo://docs/README.md#L312-L337)
  [crates/celld/dev.rs](repo://crates/celld/dev.rs#L18-L18)).
- Build behavior on watch: a source or configuration change builds a new
  deployment and restarts the local node, keeping the current
  application running during the build; a failed build does not replace
  it; a successful restart retains durable state
  [docs/README.md](repo://docs/README.md#L329-L337).
- State persistence and color handling are in `.celld/dev`, with
  `NO_COLOR`/`FORCE_COLOR` display defaults
  [docs/README.md](repo://docs/README.md#L320-L338).

## `celld diagnose` — signed, real-wire probes

`crates/celld/peer_probe.rs` is a challenge-bound proof that a diagnostic
reached the node named by a lease:

- The probe answer binds a server challenge (`PROBE_DOMAIN =
  "cells-peer-probe-v1"`, a random 32-byte challenge) and the responder's
  node + advertise address, signed with Ed25519; a bogus responder
  cannot claim another node's lease
  ([crates/celld/peer_probe.rs](repo://crates/celld/peer_probe.rs#L9-L21)).
- The signing key is installed for the re-exec diagnostic process via a
  private env var (`CELLD_REEXEC_PROBE_SIGNING_KEY`) — only source code
  and the facet are allowed to install it; a fleet flag never selects it.
- Every probe passes through the fleet HMAC path as well (establishes
  who may open the connection at all; see
  [Security boundary](/openwiki/architecture/security-boundary.md)).

The fleet-wide report enumerates node leases and distinguishes expired
records, malformed/unsafe advertise addresses, unreachable peers, and
incompatible protocols; per-node lines also show the coarse load sample
and `restoring` count
[docs/README.md](repo://docs/README.md#L559-L577).

## `celld cell list` — bounded listing

`crates/celld/cell_cli.rs` documents the cost model: "A fleet bucket can
hold millions of cells, and one `LIST` request returns at most a thousand
children. So a listing's cost is set by how many cells exist, not by how
many the operator asked to see. The default answer therefore costs one
request, `--after` resumes, and `--all` is the explicit request for the
whole walk" [crates/celld/cell_cli.rs](repo://crates/celld/cell_cli.rs#L9-L15).

Output rows are `Class:ID` scope strings, with reserved cells (D1/KV/
Workflows/Queues broker, named with `__`) marked `reserved` in JSON so a
script can select only application cells
[docs/README.md](repo://docs/README.md#L596-L606). The listing reflects
the `cells/<cell>/own.json` ownership records — an instance appears
after the first event reaches it
[docs/README.md](repo://docs/README.md#L588-L595).

## d1, kv, queue — routed operator data planes

The `d1`, `kv`, and `queue` subcommands run against a deployed fleet
through the fleet bucket rather than by direct DB/network access: each
command finds a node through the node leases and that node routes the
work to the cell that owns the object (D1 database, KV namespace, or
Queue broker) [docs/README.md](repo://docs/README.md#L553-L558).

- **d1**: SQL and migrations (`d1 migrations apply`, `d1 execute
  --command SQL`). Wrangler migration files work directly.
- **kv**: point reads/writes plus bulk commands using the Wrangler
  file format — "so a Wrangler export can migrate directly into celld"
  and `wrangler kv bulk get` output feeds `celld kv bulk put`.
  `kv list` prints at most 1000 keys by default, with `--after`/`--all`
  and `--json` row output [docs/README.md](repo://docs/README.md#L349-L361).
- **queue**: `info|peek|purge|pause|resume|redrive` administration of a
  deployed Queue; pause/resume control delivery without stopping
  production
  ([crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L281-L281)
  [docs/README.md](repo://docs/README.md#L250-L257)).

All operator subcommands keep data on stdout and messages on stderr so
pipes and redirects carry only data
[docs/README.md](repo://docs/README.md#L363-L372).

## Related pages

- [Bucket contract](/openwiki/data/bucket-contract.md) — the bucket
  spec/prefix every subcommand resolves against.
- [Configuration](/openwiki/operations/configuration.md) — deployment
  adoption and polling knobs.
- [JS/V8 host surfaces](/openwiki/runtime/js-v8-host.md) — what the
  deployed bundles run on.
