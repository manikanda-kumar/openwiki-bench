---
type: operations
title: Deploy and Local Development
description: The celld deploy pipeline (esbuild bundling, content-addressed versions, manifest and pointer objects in the bucket), the bucket contract in protocol.rs that nodes consume, and the celld dev loop with its SQLite-backed local object store and rebuild-on-change supervisor.
tags: [deploy, esbuild, wrangler, bucket-contract, dev, local-store, rollout]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
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
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---

# Deploy and Local Development

A deployment is not a process event: "`celld deploy` invokes `esbuild` from `PATH` for Worker code, accepts the supported Wrangler config subset… and writes the deployment objects directly" (README.md#L180-L187). Nodes then converge on the bucket pointer. This page covers the build, the bucket contract, and the local `celld dev` loop.

## Building: esbuild plus an allowlisted config

"Bundling is esbuild's job; this module does config, identity, and durable bucket publication. Nothing here shells out to wrangler or speaks a Cloudflare-shaped API. Config keys are an allowlist: anything we do not model is refused, never silently dropped" (crates/celld/deploy.rs#L10-L13). The build path (`deploy::build`, crates/celld/deploy.rs#L432-L470) reads the Wrangler config, and for a plain source entry runs `esbuild`; a project whose entry is already bundled (e.g. a Vite build) is imported without re-bundling — "running esbuild over a Vite build is what corrupts it" — and esbuild's emitted wasm siblings are collected as modules (crates/celld/deploy.rs#L256-L259, #L448-L465, docs/README.md#L235). The CLI offers `--config`, `--bucket`, `--endpoint`, `--region`, `--dry-run` (bundle and print without writing), and `--json` (crates/celld/deploy.rs#L193-L204).

## The bucket contract

The contract is `crates/celld/protocol.rs`: "Durable types on the bucket contract between deployment tools and celld. These objects are the interface; nothing else is exchanged" (crates/celld/protocol.rs#L3-L4). The load-bearing pieces:

- **`deploy/<script>/<version>/manifest.json`** — the normalized thing a node reads to know what to run; the script name is deployment identity, not a fleet selector (one fleet, one current application), and it carries `main_module` (absent for asset-only), DO classes, the SQLite-backed subset, and required `features` (crates/celld/protocol.rs#L9-L25). `validate_required_features` is applied identically on both load paths, so a node that predates `wasm-v1` refuses at load time with "upgrade celld" rather than at request time (crates/celld/protocol.rs#L290-L302, docs/wasm.md#L26-L30).
- **Version identity** — `deployment_version` is a truncated SHA-256 over *sorted* module names+bytes plus the exact serialized metadata (and the asset index when present), "never the raw upload framing (which is not deterministic)"; cron expressions are deliberately excluded because a version names code and bindings while the schedule is configuration layered on top — every sender must agree or identical code deploys as two versions (crates/celld/protocol.rs#L424-L451).
- **Modules and asset blobs** — each module is content-hashed (`ModuleRef { name, bytes, sha256, kind }`, with `wasm` bytes becoming a module whose default export is a compiled `WebAssembly.Module` per Wrangler's `CompiledWasm` rule); static assets go to the immutable fleet-wide key `deploy-blobs/assets/sha256/<xx>/<64-hex>` validated by `asset_blob_key`, and publication ensures a blob only when head proves an existing object with the exact digest and size (crates/celld/protocol.rs#L306-L324, #L386-L398, crates/celld/deploy.rs#L769-L777).
- **`deploy/current.json`** — the `DeployPointer { script_name?, version, prefix, rollout }` with a `Rollout { percent }`; "changing this is a deploy; nodes converge to it" (crates/celld/protocol.rs#L402-L420, crates/celld/fleet.rs#L628).
- **Reserved prefixes** — `probe/`, `cells/`, `nodes/`, `node-cells/`, `fleet/`, `deploy/`, `deploy-blobs/`, `wake/`, and `telemetry/` belong to celld and an application must not write under them (docs/guarantees.md#L76-L81).

The node side is covered in [Workers and V8 Runtime](/openwiki/concepts/workers-runtime.md): boot and `reload` both go through `DeploymentGraph::load` + `Generation::build`, each node reads the pointer every `CELLD_DEPLOY_POLL_S` seconds (default 30), and `POST /reload` on the internal listener forces a poll now (crates/celld/generation.rs#L36-L91, docs/README.md#L245-L255). "Nodes adopt this version at their next pointer poll, without a restart" (crates/celld/fleet.rs#L607). Adoption builds beside the serving generation; requests pin their generation; resident DOs move at a safe point or force after `CELLD_DEPLOY_MAX_AGE_S` (docs/README.md#L256-L272).

## `celld dev`: the local stack

`celld dev` "supplies only the infrastructure those [production] paths require: one persisted local object store and one supervised celld node" (crates/celld/dev.rs#L3-L8) — development exercises the same deploy, ownership, and LTX code, not a fake.

- **State**: all local objects and work files live in `PROJECT/.celld/dev`; a normal shutdown keeps the directory so the next invocation sees the same durable state, and deleting it while stopped resets (docs/README.md#L320-L325, crates/celld/dev.rs#L291).
- **The local store is a real transactional object store**: the supervisor and the node are separate processes that both write during a reload, and "SQLite supplies the cross-process transaction that a directory of files cannot: a conditional update checks its ETag and installs the new object in one commit." It implements the `object_store::ObjectStore` surface for one machine only — "it is not a shared-filesystem production mode" — and a regular node or operator subcommand cannot select it (crates/celld/local_store.rs#L3-L11, docs/README.md#L326-L327).
- **Listeners and display**: the Worker listener defaults to `127.0.0.1:9876` (`DEFAULT_PORT`), with `--port`/`--host`; `--host` to a non-loopback IP exposes only the Worker listener while the internal operator listener stays loopback; the default display hides node warn/info logs (`--logs` shows them), and `NO_COLOR` beats `FORCE_COLOR` (crates/celld/dev.rs#L28, docs/README.md#L98-L110).
- **The loop**: a recursive `notify` watcher on the project directory debounces change events; each change "builds a new deployment and restarts the local node. The current application continues to run during the build, and a failed build does not replace it. The restart retains the durable application state" (crates/celld/dev.rs#L106-L125, #L372-L392, docs/README.md#L329-L337). The watcher ignores `.celld`, `.git`, `node_modules`, and `target` at each depth and never watches outside the project directory; esbuild remains the only external tool Worker projects need (docs/README.md#L334-L338).

`celld dev` therefore inherits every durability property of a fleet node (one writer per cell, output-gated writes) with the bucket replaced by the SQLite store — the conditional-write guarantee is exercised locally, while a production store must still pass `celld diagnose`'s storage test (see [Fleet Operations](/openwiki/operations/fleet-operations.md)).

Related: [Quickstart](/openwiki/quickstart.md), [Cloudflare Compatibility Surface](/openwiki/concepts/cloudflare-compat.md), [SQLite State and LTX Replication](/openwiki/concepts/sqlite-ltx.md), [Fleet Operations](/openwiki/operations/fleet-operations.md).
