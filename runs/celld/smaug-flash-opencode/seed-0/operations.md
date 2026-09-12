---
type: "Reference"
title: "Fleet Operations, Diagnostics, and Configuration"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-22743a54f7646819f332cb9f
    resource: repo://crates/celld/drain_token.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-49c00e5a87547e08ff8bcb7d
    resource: repo://docs/guarantees.md
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---


# Fleet Operations, Diagnostics, and Configuration

This page is the operator-facing companion to the
[architecture page](architecture.md). It covers how a fleet is run on the
ground: leases and readiness, graceful shutdown and improvement handoff, the
operator CLI subcommands, the internal operator API, memory-pressure shedding,
deployment adoption, and the primary configuration surface.

## Node leases and first readiness

Nodes discover each other through bucket leases; there is no account or join
service (README lines 185-187). Each node holds a lease that "carries an
expiry, and the node renews it after one third of the lifetime"
(`docs/guarantees.md` lines 200-203).

A fresh process holds its first healthy response until the fleet is settled
(`docs/README.md` lines 479-487): it requires a live node lease, no active
donor, memory below every pressure low watermark on each live node, a total
restore backlog no larger than one `CELLD_ACTIVATIONS` budget, and incumbent
ownership counts within one equal successor share of the fleet mean. Unreadable
fleet or an unsettled condition holds readiness up to `CELLD_READY_FLEET_GATE_MS`
(default 120000; 0 disables). After the first healthy response, fleet state does
not remove readiness again (lines 489-494).

## Graceful shutdown and the drain token

celld shuts down gracefully on SIGTERM or SIGINT (`docs/README.md` lines
428-429). The `/.well-known/celld/health` path reports unhealthy during the
drain so a load balancer stops public routing, new public requests receive 503,
and accepted requests finish (lines 431-436).

A draining node claims a **fleet drain token** in the bucket before releasing
cells, so simultaneous stop signals hand off one node at a time
(lines 470-477). `drain/token.json` is the well-known token key
(`crates/celld/drain_token.rs`), and the token is advisory: a donor that cannot
claim it within `CELLD_DRAIN_TOKEN_WAIT_MS` proceeds, a dead holder's claim
expires by TTL, and a handoff without it is still safe.

The handoff runs in batches paced by four settings: `CELLD_RELEASES` (max
complete handoffs in progress, default 8), `CELLD_ACTIVATIONS` (demand-driven
restore/startup), `CELLD_SHUTDOWN_DRAIN_MS` (max interval without a completed
handoff, default 25000), and `CELLD_SHUTDOWN_TOTAL_MS` (complete process-stop
bound, default 40000) (`docs/README.md` lines 458-466). Each successor
acknowledgement restarts the drain interval.

An explicit advertised address requires an explicit internal-listener address,
and celld rejects an explicit non-loopback public listener without an internal
one because that "identifies an obsolete one-listener configuration"
(`docs/README.md` lines 399-404).

## Deployment adoption

A running node does not restart for a new deployment. Each node reads
`deploy/current.json` every 30 seconds (`CELLD_DEPLOY_POLL_S`) and adopts a new
deployment in place; `POST /reload` adopts it now (`docs/README.md` lines
245-255). A node builds the new deployment beside the one it serves and
switches new requests in one step; a request that started on the previous
deployment finishes on it; a deployment that does not build leaves the old one
serving newest. `POST /reload` also rebuilds an unchanged deployment, so an
edit to `CELLD_VARS_FILE` takes effect without a restart.

A resident Durable Object moves to the new deployment at a safe point (no
request, no alarm, no pending output, no regular WebSocket); if it reaches
none within `CELLD_DEPLOY_MAX_AGE_S` (default 60), it is forced — celld cancels
its work and closes regular WebSockets with code 1012, "which is what a
Cloudflare deployment does to every object" (lines 256-272). `0` forces every
resident object at the adoption.

## The operator CLI subcommands

- **`celld diagnose`** enumerates every node lease and performs a signed direct
  probe of each live peer, distinguishing expired records, malformed or unsafe
  advertise addresses, unreachable peers, and incompatible protocols; it prints
  each node's resident-cell, WebSocket, RSS, CPU, fds, pressure, and shedding
  sample. One or more `--peer NODE_ID` restrict the check. It does not take a
  lease or change ownership (`docs/README.md` lines 554-576).
- **`celld cell list`** lists Durable Object instances in the fleet bucket. The
  listing is bounded at 1000 (`--after` to continue, `--all` for the whole
  walk); the default costs one request, by design of the listing rules
  (`crates/celld/cell_cli.rs`). Each `Class:ID` appears after the first event
  reaches it, because its owner then writes an ownership record
  (`docs/README.md` lines 578-594).
- **`celld d1`** runs SQL and migrations against a deployed D1 database. It
  finds a node through the leases, and that node routes to the database
  cell over the authenticated `/runtime/<scope>` route; the CLI holds no
  ownership logic and no SQLite (`crates/celld/d1_cli.rs`).
- **`celld kv`** reads and writes a deployed KV namespace; bulk commands use the
  Wrangler file format, and `kv list` is bounded at 1000 with `--after`/`--all`
  (`docs/README.md` lines 347-378).
- **`celld queue`** inspects and controls a deployed Queue: `info`, `pause`,
  `resume`, etc., reaching the reserved Queue cell through the authenticated
  fleet operator route (`crates/celld/queue_cli.rs`).

Every command writes data to stdout and messages to stderr, so `>` or a pipe
carries only data; `celld --help`, `--version`, and listener announcements use
the same output sink (`crates/celld/cli_output.rs`).

## The internal operator API

The internal listener exposes an alpha operator API. Routes
(`docs/README.md` line 546 onwards; `crates/celld/main.rs` lines 2632-2810 for
dispatch):

- `GET /state` — node state (phases, deployments draining, objects moving).
- `POST /reload` — adopt the deployment pointer now.
- `POST /shutdown` — start the graceful handoff; `?handoff=preserve` keeps
  ownership records for a same-node reload.
- `GET /cell/<SCOPE>` — resolve or activate a cell.
- `/evict/<SCOPE>` — evict a resident cell.
- `/do/<ID>` — direct request to an ordinary Durable Object (refuses every
  reserved runtime class).
- `/runtime/<SCOPE>` — HMAC-authenticated operator access to reserved-class
  cells (D1/KV/Queues/Workflows).
- `/peer/probe` — signed peer diagnostic.
- `/.well-known/celld/health` — the public health endpoint.

The `/do/` route refuses reserved classes ("D1, Workflows, KV, and Queues") 
because their operator protocols can access application data or change runtime
state, so they route instead through `/runtime/<SCOPE>` (`docs/security.md`
lines 96-99). The operator API is alpha — "a release can change its paths or
response formats".

## Memory pressure and shedding

celld enables a memory-pressure threshold at 80% of available memory by default
and an absolute cap at 95% (`docs/README.md` lines 267-283). `CELLD_MAX_RSS_MB`
changes the threshold; `0` disables threshold and cap together. In a Linux
cgroup, the threshold uses "the greater of the allocator-adjusted RSS and the
active cgroup working set", computed as `memory.current` less `inactive_file`
from `memory.stat` (lines 270-275).

Under pressure celld "durably replicates and fences the least-recently used
idle cells, publishes them as unowned without resetting their epochs, and
refuses to reacquire new unowned cells" (lines 289-291). It does not shed a
cell with active work or a live host WebSocket. A spare node receives no
assignment; it acquires a released cell through the same bucket protocol when
traffic reaches it again.

The threshold and the cap each release separately at 80% of their value, "so a
crossing of one limit does not hold the node against the other" (lines
292-294). The pressure classifier is a pure function of a memory sample plus
the prior shedding state (the hysteresis latch), implemented sans-IO in
`crates/logic/pressure.rs` so the shell can drive the latch and a simulator can
replay it.

Each isolate also has a V8 heap limit, default 128 MB matching Cloudflare's
Durable Object limit; `CELLD_V8_HEAP_LIMIT_MB` changes it (lines 297-302). An
isolate above 90% of this limit refuses a new hibernatable WebSocket, and it
stops materializing a SQL result set; both errors name the heap. The isolate
serves again when use falls under 75% of the limit (lines 304-311).

## Key environment variables

Strict parsing applies to every typed production variable: `env_vars::validate`
exits at startup on an invalid value (`crates/celld/env_vars.rs`). The primary
settings (the README table, `docs/README.md` lines 658-708) include:

- **Bucket/storage:** `CELLD_BUCKET`, `S3_ENDPOINT`, `AWS_REGION`,
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`,
  `GOOGLE_APPLICATION_CREDENTIALS`, the `AZURE_STORAGE_*` family,
  `AZURE_STORAGE_USE_EMULATOR`.
- **Listeners/identity:** `CELLD_ADDR`, `CELLD_INTERNAL_ADDR`,
  `CELLD_ADVERTISE`, `CELLD_UNSAFE_PUBLIC_ADVERTISE`, `CELLD_NODE`,
  `CELLD_WATCH`, `CELLD_ESBUILD`, `CELLD_TRUST_FORWARDED_HEADERS`,
  `CELLD_STORAGE_PROBE`.
- **Durability/throughput:** `CELLD_OUTPUT_GATE`, `CELLD_DURABILITY`,
  `CELLD_ACTIVATIONS`, `CELLD_OPERATION_DEADLINE_MS`,
  `CELLD_MAX_CELL_REQUESTS` (default 64 so one target cannot consume hundreds
  of client slots, `crates/celld/runtime.rs`), `CELLD_MAX_RESIDENT_CELLS`,
  `CELLD_LTX_TRUNCATE_PAGES`, `CELLD_LTX_COMPACTION`,
  `CELLD_LTX_COMPACTIONS`, `CELLD_LTX_DURABILITY_TIMEOUT_SECS`,
  `CELLD_LOG_PIPELINE`, `CELLD_LOG_HEDGE_MS`, `CELLD_RELEASES`,
  `CELLD_DRAIN_TOKEN_WAIT_MS`, `CELLD_READY_FLEET_GATE_MS`.
- **Worker/activation:** `CELLD_DEPLOY_POLL_S`, `CELLD_DEPLOY_MAX_AGE_S`,
  `CELLD_WORKER_LOADER`, `CELLD_MAX_LOADED_WORKERS`,
  `CELLD_MAX_REQUEST_BODY_BYTES` (default 1 GiB),
  `CELLD_VAR_*`/`CELLD_VARS_FILE`.
- **Logging:** `RUST_LOG`.

For the complete list run `celld -h`; the help output is "the public
description of the configuration surface and remains stable across builds"
(`crates/celld/main/cli.rs`).

## Rolling upgrades

Use the orchestrator's rolling update for releases that allow it: stop each
node with SIGTERM, wait for the replacement to report healthy, then proceed
(`docs/README.md` lines 510-513). celld paces handoffs inside each node
shutdown and the first-readiness gate paces the update against fleet recovery.
The two non-rolling upgrades (v0.1→v0.2, v0.3→v0.4) and the data-format caveats
are recorded in `docs/README.md` lines 514-545 and summarized on the
[change-guides page](change-guides.md).
