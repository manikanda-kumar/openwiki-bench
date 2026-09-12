---
type: "Reference"
title: "Reserved classes — D1, KV, Queues, cron, Workflows, assets"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-278001c559216d321bc30f18
    resource: repo://crates/celld/assets.rs
  - id: openwiki-source-55e133f02ad99db05fcca8ad
    resource: repo://crates/celld/d1_cli.rs
  - id: openwiki-source-7f02c2051ff00998d2ad485e
    resource: repo://crates/celld/deploy.rs
  - id: openwiki-source-d57586ce8ed11263fd48b3ae
    resource: repo://crates/celld/js.rs
  - id: openwiki-source-2ea4abd833d1e17f4ec74f58
    resource: repo://crates/celld/js/harness.js
  - id: openwiki-source-71a9e960c45e5efe230ee7b5
    resource: repo://crates/celld/js/storage_ops.rs
  - id: openwiki-source-6d3d805980c86df360693637
    resource: repo://crates/celld/kv_cli.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-6c4e31d2bf3e043b470c02ee
    resource: repo://crates/celld/operator_cell.rs
  - id: openwiki-source-b4f496d967b16d12245499e6
    resource: repo://crates/celld/protocol.rs
  - id: openwiki-source-cb45cb88385401a2b1df7330
    resource: repo://crates/celld/queue_cli.rs
  - id: openwiki-source-5a6cbf6f6333a36a693f815b
    resource: repo://crates/logic/cron.rs
  - id: openwiki-source-d2d7d8ace8d959adef6686ac
    resource: repo://crates/logic/kv.rs
  - id: openwiki-source-5238b9aafd153b49d22d0084
    resource: repo://crates/logic/queue.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---


# Reserved classes — D1, KV, Queues, cron, Workflows, assets

celld has no separate services: each Cloudflare-shaped product is a Durable
Object of a **runtime-supplied class**. The pattern has four parts — a
reserved class the harness registers in every isolate; a stable cell name that
becomes the bucket scope; policy extracted into a `celld-logic` module so
"every runtime path must agree about them exactly"
([crates/logic/kv.rs#L18-L21](repo://crates/logic/kv.rs#L18-L21)); and an
operator path that reaches the cell through its owner, never through the
bucket ([crates/celld/operator_cell.rs#L3-L12](repo://crates/celld/operator_cell.rs#L3-L12)).

## The reserved-class fence

`RESERVED_CLASSES = [__D1Database, __Workflow, __KvNamespace, __Queue]`
plus script-scoped `__Workflow.<script>` classes
([crates/celld/deploy.rs#L64-L81](repo://crates/celld/deploy.rs#L64-L81),
[crates/celld/deploy.rs#L83-L110](repo://crates/celld/deploy.rs#L83-L110)).
The fences around them are deliberate:

- A user `wrangler.jsonc` naming a reserved class in `durable_objects` is
  **refused at deploy** — the harness registers the class in every isolate, so
  a user binding would silently reach a runtime cell
  ([crates/celld/deploy.rs#L58-L63](repo://crates/celld/deploy.rs#L58-L63)).
- `/do/<ID>` (unauthenticated) refuses *any* reserved scope via one predicate,
  `is_reserved_scope`, "because a forgotten refusal is not a missing feature,
  it is an unauthenticated route onto a cell whose whole surface is an
  operator protocol"; adding a class to `RESERVED_CLASSES` closes that door
  with no new code, and `/runtime/` is the single HMAC'd entrance that serves
  reserved classes and nothing else
  ([crates/celld/deploy.rs#L144-L161](repo://crates/celld/deploy.rs#L144-L161),
  [crates/celld/main.rs#L2658-L2712](repo://crates/celld/main.rs#L2658-L2712)).
- Names are punctuated for collision math, not aesthetics: a leading `.` or a
  `.` separator cannot appear in a JavaScript class identifier, so no export
  can collide, while staying inside the cell-scope charset fence
  ([crates/celld/deploy.rs#L92-L104](repo://crates/celld/deploy.rs#L92-L104),
  [crates/logic/cron.rs#L27-L33](repo://crates/logic/cron.rs#L27-L33)).
- Sharedness is per class: D1, KV, and Queue namespaces are **fleet-wide** so
  several Workers can bind one resource (and a Worker rename cannot rename
  it), while workflow instances are **script-scoped** — the collision history
  behind `__Workflow.<script>` is recorded in the function docs
  ([crates/celld/deploy.rs#L116-L128](repo://crates/celld/deploy.rs#L116-L128),
  [crates/logic/kv.rs#L28-L34](repo://crates/logic/kv.rs#L28-L34)).

## D1

Every D1 database is a cell of `__D1Database`: the binding's database
identity is hashed into a Durable Object id under the fleet-wide namespace key
`cells:v1:d1:__D1Database`, and the harness registers the class in every
isolate
([crates/celld/js.rs#L7043-L7094](repo://crates/celld/js.rs#L7043-L7094),
[crates/celld/js/harness.js#L6878-L6970](repo://crates/celld/js/harness.js#L6878-L6970)).
SQL crosses exactly one host op — `__d1_run(cell, request)` — with typed
request/reply structures in `storage::d1_run`; nothing D1-specific leaks into
the JS bridge ([crates/celld/js/storage_ops.rs#L431-L442](repo://crates/celld/js/storage_ops.rs#L431-L442)).
The input gate's concurrency framing exists partly for D1's SQL surface
([crates/logic/gate.rs#L5-L7](repo://crates/logic/gate.rs#L5-L7)).

`celld d1 exec|query|migrations` resolves the *declaration* (binding name plus
`database_id` plus `migrations_dir`) through the bucket, finds a live node
via the node leases, signs the request with the fleet secret, and posts to
`/runtime/<scope>`, which forwards to the owner; the migration ledger lives
in the database cell itself
([crates/celld/d1_cli.rs#L3-L11](repo://crates/celld/d1_cli.rs#L3-L11),
[crates/celld/d1_cli.rs#L79-L115](repo://crates/celld/d1_cli.rs#L79-L115)).

## KV

A namespace shard is a `__KvNamespace` cell named `<namespace-id>/<shard>`;
`SHARDS` is 1 today, but the shard travels in the cell name from the first
release so raising it later is a key rehash rather than a fleet-wide cell
rename — and the FNV-1a shard function is written out in the core and pinned
by tests because changing it "moves keys between cells, [making] a namespace
written by one release unreadable by the next"
([crates/logic/kv.rs#L237-L279](repo://crates/logic/kv.rs#L237-L279)).
Validation limits are upstream's and are refused, not truncated (512-byte
keys, 25 MiB values, 60 s minimum TTL, 100-key bulk, 1000-per-page list)
([crates/logic/kv.rs#L37-L55](repo://crates/logic/kv.rs#L37-L55)).

The split storage decision: values up to **1 MiB** inline in the cell's
SQLite; above that the bytes go to the fleet bucket and the row keeps a
`BlobRef` — chosen by A/B measurement (inline faster at 1 MiB, bucket faster
at 2 MiB) and because inline bytes are paid twice, in SQLite and again in LTX
replication ([crates/logic/kv.rs#L42-L52](repo://crates/logic/kv.rs#L42-L52)).
The v2 reference format names the **ownership epoch** that wrote the object
(`v2:e<epoch>:<digest>` under `kv/blobs-v2/<cell>/e<epoch>/`), so a
collector from an older epoch cannot address a newer owner's object — this is
the v0.4.0 stop-all upgrade item "a v0.3.0 node cannot read that reference"
([crates/logic/kv.rs#L64-L101](repo://crates/logic/kv.rs#L64-L101),
[docs/README.md#L540-L544](repo://docs/README.md#L540-L544)).

`celld kv get/put/delete/bulk/list` reuses the operator machinery; bulk files
use Wrangler's format so `wrangler kv bulk get` exports feed `celld kv bulk
put` directly ([crates/celld/kv_cli.rs#L3-L7](repo://crates/celld/kv_cli.rs#L3-L7),
[README.md#L242-L248](repo://README.md#L242-L248)).

## Queues

A queue is one `__Queue` broker cell named after the queue
([crates/logic/queue.rs#L19](repo://crates/logic/queue.rs#L19),
[crates/logic/queue.rs#L46](repo://crates/logic/queue.rs#L46)), and the core
module owns the shared values: message/batch bounds (128 KB/256 KB, 100
messages, retries ≤ 100, concurrency ≤ 250, delay ≤ 24 h, defaults 10/5 s/3),
the 4-day retention, and lease/admission decisions
([crates/logic/queue.rs#L22-L37](repo://crates/logic/queue.rs#L22-L37)). The
broker dispatches consumer batches through the same cell machinery as fetch
(`dispatch_queue_batch` in the ingress, with the same 503 +
`X-Celld-Overload: cell` producer admission and the
`{"error":"cell admission refused"}` body)
([crates/celld/main.rs#L2228-L2260](repo://crates/celld/main.rs#L2228-L2260),
[docs/README.md#L644-L650](repo://docs/README.md#L644-L650)). Delivery can be
paused while producers keep accepting: `celld queue info|pause|resume|purge
[--force]|peek|redrive` maps to ops on the broker cell
([crates/celld/queue_cli.rs#L59-L72](repo://crates/celld/queue_cli.rs#L59-L72),
[README.md#L250-L257](repo://README.md#L250-L257)). Consumer attachments are
deployment objects validated against the manifest
(`QueueConsumerAttachment`/`validate_queue_manifest`)
([crates/celld/protocol.rs#L101-L176](repo://crates/celld/protocol.rs#L101-L176)).

## cron and Workflows

Each `triggers.crons` entry becomes one `.cron:<script>` cell — keyed on the
script name alone, so ownership CAS on that single name makes a cron fire once
per fleet instead of once per node, and a stable name lets a deploy change the
schedule without stranding the armed alarm
([crates/logic/cron.rs#L27-L43](repo://crates/logic/cron.rs#L27-L43)).
Expression parsing and next-occurrence walking are pure, minute-resolution,
UTC ([crates/logic/cron.rs#L3-L11](repo://crates/logic/cron.rs#L3-L11)). The
deploy keeps cron expressions as manifest state, out of the version hash
([crates/celld/protocol.rs#L26-L30](repo://crates/celld/protocol.rs#L26-L30)).

Workflows run as cells of the script-scoped `__Workflow.<script>` class: one
cell per instance, with the durable-step state in the cell's SQLite and step
returns capped at the same 1 MiB inline ceiling as KV
([crates/celld/deploy.rs#L83-L110](repo://crates/celld/deploy.rs#L83-L110),
[crates/celld/js/harness.js#L7181-L7190](repo://crates/celld/js/harness.js#L7181-L7190),
[crates/logic/kv.rs#L50-L52](repo://crates/logic/kv.rs#L50-L52)). The
`workflows-v1` feature string gates the deployment onto capable nodes
([crates/celld/protocol.rs#L87](repo://crates/celld/protocol.rs#L87)).
The `examples/workflow` project is the reference shape. (The experimental
Workers AI HTTP adapter is *not* a cell: it binds an `env` name to
`CELLD_AI_URL` directly — see the compatibility table.)
([crates/celld/fleet.rs#L899](repo://crates/celld/fleet.rs#L899),
[docs/cloudflare-compat.md#L40-L44](repo://docs/cloudflare-compat.md#L40-L44))

## Static assets

Assets are not a cell: the `celld deploy` asset pipeline content-addresses
files into `deploy-blobs/assets/sha256/...` and the runtime serves them
through `AssetResolver` — HTML handling, `_headers`, `_redirects`,
not-found routes, and `runWorkerFirst` patterns — with a bounded local cache
(`CELLD_ASSET_CACHE_BYTES`, default 512 MiB)
([crates/celld/assets.rs#L27-L28](repo://crates/celld/assets.rs#L27-L28),
[crates/celld/protocol.rs#L326-L385](repo://crates/celld/protocol.rs#L326-L385),
[crates/celld/deploy.rs#L572](repo://crates/celld/deploy.rs#L572)). One
rolling-restart wrinkle is encoded in the code: during an update a new node's
HTML references content-hashed paths an old node's index has never seen, so
the resolver can re-read a newer index from the fleet — blobs were always
visible, only the index went stale (denoland/celld#161)
([crates/celld/assets.rs#L32-L39](repo://crates/celld/assets.rs#L32-L39)).
The deploy boundary for asset projects (asset-only deployments, `_headers`,
`_redirects`, worker-first routes) is in
[docs/README.md#L235-L240](repo://docs/README.md#L235-L240).

## What appears in the bucket

`celld cell list` shows celld's own cells too: D1 databases, KV namespaces,
and Workflows are cells in reserved classes with `__`-prefixed scopes
(marked `"reserved": true` in `--json` output), and they hold real data
([docs/README.md#L596-L605](repo://docs/README.md#L596-L605)). Which is the
operational reminder that these "services" are ordinary cells — they obey
everything on [durability and fencing](../concepts/durability-and-fencing.md),
including one owner, epoch fencing, and the output gate.

Related: [runtime and bindings](../runtime/v8-workers.md) ·
[deploy and rollout](../deployments/deploy-and-rollout.md) ·
[listeners and peers](../networking/listeners-and-peers.md) ·
[node operations](../operations/node-operations.md)
