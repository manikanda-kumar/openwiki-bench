---
type: change-guide
title: "Maintenance and change guides"
description: "Source-grounded, task-focused guides for common maintenance changes: adding a JS builtin shim, extending the deploy config allowlist, bumping the peer protocol version, and supporting another storage dialect."
tags: [change-guide, maintenance, peer-auth, deploy, bucket]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-7d2850b80d963ec49d089c22
    resource: repo://crates/celld/bucket.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-baacc4e4e20c8fef472f1cd8
    resource: repo://crates/celld/js/modules.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Maintenance and change guides

These are representative maintenance tasks grounded in the actual call sites
and invariants. Where the repo does not establish a safe path, the guide says
so rather than inventing one.

## Add or extend a JS builtin shim

1. Write the shim as an ES module in `crates/celld/js/` (examples:
   `node_buffer.js`, `crypto.js`, `url.js`).
2. Register the specifier mapping in `crates/celld/js/modules.rs`'s stub
   table; external builtins are `node:*`, `cloudflare:*`, and bare node
   specifiers (`crates/celld/js/modules.rs:56-62`). Builtins are lazy: "a
   module compiles the first time something reads its global" (`modules.rs:3-7`),
   so a stub costs nothing until used.
3. If the shim needs native ops, mirror the pattern of
   `crates/celld/js/storage_ops.rs` / `r2_ops.rs` (Rust ops registered into
   the isolate) and keep the JS async wrapper contract: storage is "async in
   JS, synchronous underneath" (`crates/celld/js.rs:14-15`).
4. If the behavior depends on the manifest date/flags, add a `Compat` switch
   rather than branching on versions: "Per-worker compatibility switches…
   `Default` is every switch off; production derives real values in `main`"
   (`crates/celld/js.rs:1680-1686`).
5. Add differential fixtures: the repo policy is the "corpus only grows…
   fixtures must give equal output on the two engines" ([docs/testing.md](../docs/testing.md))
   and "An unsupported feature that does not cause an error is a defect"
   ([docs/cloudflare-compat.md](../docs/cloudflare-compat.md)). Update the
   corresponding row of that page.

Invariant to respect: module stub registries are isolate slots, not
thread-locals (`crates/celld/js/modules.rs:36-44`).

## Add a config key to the deploy allowlist

Wrangler config parsing is an explicit allowlist: unknown keys are a
deploy-time error (`crates/celld/deploy.rs:36-57`). To model a new key:

1. Add it to `SUPPORTED_KEYS` and parse it in `crates/celld/deploy.rs`.
2. Decide identity: if it names a Durable Object class, check
   `RESERVED_CLASSES` collision rules — reserved runtime classes are
   `__D1Database`, `__Workflow`, KV, Queue (`crates/celld/deploy.rs:82-86`);
   fleet-wide vs script-scoped naming matters and has broken startup before
   (`crates/celld/deploy.rs:89-102`).
3. Propagate any new manifest facts through `crates/celld/protocol.rs` (a
   `FEATURE_*_V1` marker when it changes what a runtime must support,
   `crates/celld/protocol.rs:55-99`).
4. Boot/reload must both see it: build the value inside
   `DeploymentGraph::load`/`Generation::build` — "Nothing else reads a
   deployment manifest into runtime state… a reload cannot miss what a boot
   did" (`crates/celld/generation.rs:10-14`).

The repo does not document a conformance fixture path for new wrangler keys
beyond the general differential program; verify with a real `celld deploy`
against dev mode.

## Change the peer protocol version

Protocol version lives in `crates/celld/peer_auth.rs`:
`PROTOCOL_VERSION: u16 = 5`, `PROTOCOL_VERSION_TEXT = "5"`, response header
`x-cells-peer-version`. Requests carry the version in the HMAC-signed string
(`crates/celld/peer_auth.rs:16-17`, `262-266`); a mismatched version
response line is validated (`peer_auth.rs:187`). To bump it:

- Advance both constants **and** every place the signed domain string
  embeds the version (`peer_auth.rs:258-266`), so old peers fail closed.
- Search the peer HTTP call sites (`crates/celld/main/peer_tunnel.rs`,
  routing in `crates/logic/routing.rs`, `Remote { peer_protocol }` phase in
  `crates/logic/lib.rs:183-190`) for assumptions about the wire value.
- The repo does not establish a version-negotiation ladder (no fallback
  branches are present where a version mismatch is checked); treat a bump as
  fleet-wide-atomic until a comment says otherwise.

## Add another storage dialect/vendor

`crates/celld/bucket.rs` deliberately supports **two** conditional-write
dialects behind one opaque-CAS surface: the etag dialect (`s3://`, `az://`,
local) and the GCS generation dialect (`gs://` with
`x-goog-if-generation-match`), because "GCS accepts S3-style requests on the
same host but does not apply If-Match to a PUT, so only the generation
dialect can fence there" (`crates/celld/bucket.rs:5-20`).

To add a dialect:

1. Extend `StorageBackend` (`S3`, `Gcs`, `Azure`, `Local`; schemes `s3`,
   `gs`, `az`, `dev` at `crates/celld/bucket.rs:76-89`) with your vendor's
   spec prefix parsing and dialect mapping.
2. Preserve the error contract: "`put_cas` answers `Ok(None)` only for a
   clean 412/409 rejection; every other failure is ambiguous — the write may
   have committed — and surfaces as `Err`"; likewise a missing CAS token is
   an error "never an empty token a later conditional write would trust"
   (`crates/celld/bucket.rs:16-21`). A vendor whose conditional headers are
   silently ignored self-fences nodes into a loop — the storage probe
   (`CELLD_STORAGE_PROBE`, default on) exists to catch this
   (`crates/celld/main/cli.rs:166-168`).
3. Qualify against [docs/guarantees.md](../docs/guarantees.md)'s
   conditional-create/overwrite + read-after-write requirements and add the
   store to the qualified list only with evidence.

## Removing or changing a guarantee-design constant

Constants like `MAX_CELL_SCOPE`, `RETRY_CEILING`, `BATCH_ROWS`,
`MAX_ACQUIRE_RECONCILES` are pure, tested values inside `crates/logic`
(`crates/logic/alarm.rs:8-11`, `crates/logic/lib.rs:104-110`). Change them
in logic, not adapters — "No adapter may mutate [`State`] directly, and the
simulator drives the same transitions" (see the architecture page). If a
change touches the durability/fencing argument, [docs/guarantees.md](../docs/guarantees.md)
is the spec you must keep true, and its reference testing path is the
authority for validating the change.

## Workspace-level changes

- Dependencies belong in `[workspace.dependencies]` so members "can never
  drift onto two versions of the same crate" (`Cargo.toml:25`).
- Release binaries use `panic = "abort"`, stripped fat-LTO; the `lab`
  profile exists for profiling with symbols (`Cargo.toml:8-21`). Don't add
  anything requiring unwinding to release-consumed code paths.
