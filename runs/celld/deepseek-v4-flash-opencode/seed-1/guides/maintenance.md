---
type: "Reference"
title: "Change guides for representative maintenance tasks"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-e6322422e1c8e2c48045d76e
    resource: repo://crates/celld/fleet.rs
  - id: openwiki-source-2b489837080be727c597563b
    resource: repo://crates/celld/lib.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-a45458b28710cc8c687437f3
    resource: repo://crates/celld/ownership_store.rs
  - id: openwiki-source-874458f76e93f948340a7b1c
    resource: repo://crates/celld/peer_auth.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-07c5b49fc7fa2c9cade18b16
    resource: repo://crates/logic/cell.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-bf27fb010957bd7d3b81f9b1
    resource: repo://docs/testing.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---


# Change guides for representative maintenance tasks

These are focused guides for the changes a maintainer is most likely to make.
Each one names the files that own the decision and the invariants that a
change must preserve. The guiding rule of the codebase is that `celld-logic`
owns every behavioral decision and the shell (`crates/celld`) merely executes
it — a change that splits a decision across both crates is the shape that has
historically caused bugs.

## Adding a Worker runtime API

A new Workers/Durable Objects API touches several layers, and the compatibility
rule is that an unsupported feature must fail loudly at deployment or first
use, never silently (`docs/cloudflare-compat.md:11-13`).

1. **The JS surface.** Most APIs are implemented in the harness
   (`crates/celld/js/harness.js`, the Durable Object object model and runtime
   surface) or one of the prelude files (`crates/celld/js/*.js`). A `node:`
   builtin needs its specifier listed in `BARE_NODE_BUILTINS`
   (`crates/celld/js.rs:29-70`).
2. **The Rust glue.** Host operations and the `env` binding surface live in
   `crates/celld/js.rs`; synchronous storage ops are exposed to V8 there and
   wrapped in `async` by the harness (see `crate::storage`).
3. **Compatibility switches.** If the API is gated by a compatibility flag,
   add it to `worker_compat` (`crates/celld/lib.rs:483-522`), which maps
   `compatibility_flags` and `compatibility_date` to the runtime `Compat`
   switches.
4. **Deployment capability.** If the API is a deployment capability (a
   binding type, a reserved class, a module kind), gate it with a
   `FEATURE_*_V1` entry in `SUPPORTED_DEPLOYMENT_FEATURES`
   (`crates/celld/protocol.rs:54-99`) so an older node refuses the deployment
   up front. The manifest's `required_features` list is the mechanism
   (`validate_required_features`, `crates/celld/protocol.rs:291-303`).
5. **Documentation.** Update `docs/cloudflare-compat.md` — the status tables
   are the authoritative boundary — and add a fixture to the conformance
   corpus. The testing page's rule: "When celld gets a new API surface, we add
   fixtures for that surface, and the fixtures must give equal output on the
   two engines" (`docs/testing.md:26-32`).

## Changing an environment variable

Environment is read at the edge and validated once; the core never reads the
environment itself (`crates/logic/isolate.rs:54-55` makes the pattern
explicit: "built once from configuration by the caller. The core never reads
the environment itself").

1. **Add the parser and the validation.** `crates/celld/env_vars.rs` is the
   single home for the strict parsers — `value`, `flag` (Booleans accept only
   `0` or `1`), `positive`, `positive_or`, `with_default`, `optional` — and
   `validate()` runs the cross-checks. An invalid value stops startup with a
   clear message (`crates/celld/env_vars.rs:75-100` shows the pattern for
   ranged values).
2. **Consume at the edge.** The setting is read where the process learns about
   its environment: `crates/celld/machine.rs` (leases, pressure, outbound
   sockets), `crates/celld/main.rs` (listeners, limits), `generation.rs`,
   `ltx_repl.rs` (compaction, WAL truncate), or `telemetry.rs`. If the setting
   feeds a behavioral decision, pass it into the core through the `Config`
   struct (`crates/logic/types.rs:63`) rather than letting the shell decide.
3. **Document it.** The help text in `crates/celld/main/cli.rs` and the
   environment table in `docs/README.md` are both public descriptions of the
   configuration surface.

## Evolving the peer protocol version

The peer protocol version is a hard gate, and the current value is 5
(`crates/celld/peer_auth.rs:16-18`). A node refuses to talk to a peer with a
different version: the signed header `x-cells-peer-version` is checked in
`verify` (`crates/celld/peer_auth.rs:186-190`) and on responses
(`validate_response`, `crates/celld/peer_auth.rs:321-332`); the version is
published in the node lease (`NodeLeaseWire.peer_protocol`), and a forwarding
node refuses a route whose cached owner speaks a different version
(`dispatch_do_call` and `dispatch_rpc_call` check
`peer_protocol == peer_auth::PROTOCOL_VERSION` before forwarding).

The tension is between additive fields and the hard gate:

- **New lease fields must be additive.** Wire records use `#[serde(default)]`
  on new fields (for example `paced_handoff`, the folded `log` object, and
  `ownership_index_generation` in `crates/celld/ownership_store.rs:42-55`) so
  an older node can still read a newer node's lease during a mixed-version
  rollout.
- **A protocol that refuses** (the tunnel introduced in v0.4.0) means the two
  versions cannot proxy calls to each other, so the upgrade cannot be a
  rolling update (`docs/README.md` documents the per-version upgrade rules).
- **Rollout discipline.** The documentation records which upgrades must stop
  every node first (v0.1.0→v0.2.0, v0.3.0→v0.4.0) and which allow a rolling
  update (v0.2.1→v0.3.0). Read that section before bumping the version.

## Changing the bucket key layout

The bucket key layout is the fleet's interface, and it is spread over the
modules that own each prefix. celld reserves `probe/`, `cells/`, `nodes/`,
`node-cells/`, `fleet/`, `deploy/`, `deploy-blobs/`, `wake/`, and
`telemetry/`, and an application must not write under any of them
(`docs/guarantees.md:76-81`). The owners:

- `cells/<cell>/own.json` — ownership records (`crates/celld/ownership_store.rs:288-420`).
- `cells/<cell>/ltx/e<epoch>/` — LTX replication, epoch-in-prefix is the data fence (`crates/celld/ltx_repl.rs:1183-1212`).
- `nodes/<node>.json` — node leases carrying the folded log and load (`crates/celld/ownership_store.rs:422-467`).
- `deploy/current.json`, `deploy/<script>/<version>/...`, `deploy/queues/<queue>/consumer.json` — deployments (`crates/celld/protocol.rs`, `fleet.rs:628-757`).
- `deploy-blobs/assets/sha256/<xx>/<sha256>` — content-addressed asset bodies (`crates/celld/protocol.rs:386-399`).
- `wake/<bucket>/<cell>` — alarm wake entries (`crates/celld/wake.rs`).
- `telemetry/traces`, `telemetry/logs` — Parquet telemetry (`crates/celld/telemetry.rs:31-33`).

Rules a change must honor:

- **Additive first.** New objects must not break an old reader; new lease
  fields carry `#[serde(default)]`. A layout change that an older node cannot
  read forces a fleet-wide upgrade (the v0.2.0 block-object and v0.4.0
  epoch-qualified KV value cases in `docs/README.md`).
- **Scope is a security fence.** Any key built from a cell scope must pass
  through `valid_cell_scope` first (`crates/logic/cell.rs:43-51`) — the scope
  is a path component and an object-store key, and `/` or `\` would escape both.
- **Prefixes that can be deleted** (ownership, wake entries, telemetry
  retention) must never delete a record the fleet still needs; the fail-closed
  rule is "never delete the last local copy of state the bucket cannot
  restore" (`epoch_replicated`, `crates/celld/ltx_repl.rs:1214-1220`).

## Adding a reserved runtime class

A reserved class is a runtime-supplied Durable Object class (D1, KV, Queues,
Workflows, cron). The current set is `RESERVED_CLASSES`
(`crates/celld/deploy.rs:80-81`). The pattern to follow:

1. **Name the class and its scope discipline.** D1, KV, and Queues are
   fleet-wide shared classes (`is_shared_reserved_class`,
   `crates/celld/deploy.rs:108-117`); the Workflow class is script-scoped and
   its name carries the script (`workflow_class`, `crates/celld/deploy.rs:104-106`),
   so two co-hosted scripts address different cells.
2. **Register the refusal.** Add the class to `RESERVED_CLASSES`. That alone
   makes `/do/<ID>` refuse it — `is_reserved_scope` (`crates/celld/deploy.rs:154-156`)
   is deliberately one question, so every reserved class closes the
   unauthenticated route with no new code. Add an `operator_hint` entry
   (`crates/celld/deploy.rs:163-174`) for the helpful message.
3. **Put the policy in the core.** Follow the KV/Queue/Cron pattern
   (`crates/logic/kv.rs`, `queue.rs`, `cron.rs`): the pure core owns the
   stable address (`RESERVED_CLASS`, the cell-name function), the public
   bounds, and the lifecycle decisions; the harness and storage execute them.
4. **Gate the deployment capability.** Add a `FEATURE_*_V1` entry to
   `SUPPORTED_DEPLOYMENT_FEATURES` so an older node rejects a deployment that
   needs the new class.
5. **Wire the binding.** The binding flows through `deploy.rs` (config
   validation), `fleet.rs` (bindings from the manifest `raw_metadata`), and
   the harness (`env` construction). Add a fixture to the conformance corpus
   and an example under `examples/` following the existing ones.

## Related pages

- [System architecture and ownership boundaries](../architecture/overview.md) — the decision/execution split every change must respect.
- [Deployments and in-place code adoption](../architecture/deployments.md) — manifests, features, and generation adoption.
- [The fleet bucket and object storage](../operations/fleet-bucket.md) — dialects, prefixes, and the storage probe.
- [Configuration surface](../operations/configuration.md) — where environment variables are parsed and documented.
