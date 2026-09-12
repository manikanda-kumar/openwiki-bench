---
type: "Reference"
title: "Operating a fleet: CLI, diagnostics, and memory pressure"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-d271645e8d40f1fc2d0c8902
    resource: repo://crates/celld/dev.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-cb45cb88385401a2b1df7330
    resource: repo://crates/celld/queue_cli.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-4e2df396109dfd4edefa6079
    resource: repo://crates/logic/drain.rs
  - id: openwiki-source-4af608c5555c34fa6d010c30
    resource: repo://crates/logic/pressure.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Operating a fleet: CLI, diagnostics, and memory pressure

This page covers how operators start and run a fleet, the CLI surface, graceful
shutdown, readiness gating, and memory-pressure shedding.

## Node startup and the two listeners

A node is one `celld` process, and the nodes that share one bucket are a
fleet (`README.md:16-18`). celld opens **two** HTTP listeners: the public
Worker listener (`--listen`) and the internal peer/operator listener
(`--internal-listen`, default `127.0.0.1:0`). Use `--advertise` to give peers
an address that reaches the internal listener; the advertised address must be
routed to the internal listener and not the public one
(`docs/README.md:389-408`). An explicit advertised address requires an explicit
internal-listener address, and an explicit non-loopback public listener without
an internal one is rejected — a check against an obsolete one-listener
configuration. `crates/celld/startup.rs` owns this policy and listener
creation (`crates/celld/startup.rs:3-9`). Push the public listener and worker
requests to a load balancer; keep the internal listener private. The internal
listener also has an unauthenticated operator API, so it must not reach the
public internet (`docs/README.md:424-425`).

## The operator CLI

The CLI is defined in `crates/celld/main/cli.rs` (`Action`):
`Run`, `Diagnose`, `Deploy`, `Dev`, `Cell`, `D1`, `Kv`, `Queue`, `Connect`,
`Credentials`, `Token`, `Disconnect`, `Help`, `Version`
(`crates/celld/main/cli.rs:31-54`). Fleet flags (`--bucket`, `--endpoint`,
`--region`) and their env fallbacks (`CELLD_BUCKET`, `S3_ENDPOINT`, `AWS_REGION`,
`AWS_DEFAULT_REGION`) are shared through `crates/celld/cli_options.rs`
(`crates/celld/cli_options.rs:6-17`).

Data-to-stdout rule: a node's stdout is its log stream, but a subcommand's
stdout is its answer. `Action::stdout_is_data` is true for every subcommand
except `Run`, `Dev`, `Help`, and `Version`, so operator data is never polluted
with process warnings (`crates/celld/main/cli.rs:56-70`).

- **`celld diagnose`** reads the node leases in the bucket and probes each live
  peer; it does not take a lease or change ownership. The report distinguishes
  expired records, unsafe/incorrect advertised addresses, unreachable peers,
  authentication failures, and protocol-version mismatches
  (`docs/README.md:553-577`).
- **`celld cell list`** lists the Durable Object instances in the fleet bucket
  (`docs/README.md:578-636`). A listing is unbounded in principle: one `LIST`
  request returns at most ~1000 children, so the default answer costs one
  request, `--after` resumes, and `--all` is the explicit whole walk
  (`crates/celld/cell_cli.rs:8-16`).
- **`celld d1`** runs SQL/migrations against a deployed D1 database
  (`crates/celld/d1_cli.rs`), and **`celld kv`** inspects a KV namespace
  (`crates/celld/kv_cli.rs`).
- **`celld queue info|pause|resume`** inspects and controls a deployed Queue
  (`README.md:250-257`), reaching the reserved queue cell through the
  authenticated fleet operator route (`crates/celld/queue_cli.rs:6-11`).

## Graceful shutdown and the handoff protocol

celld shuts a node down gracefully on SIGTERM or SIGINT. It reports the node
unhealthy over `/.well-known/celld/health`, stops new public requests, finishes
accepted HTTP requests, and continues accepting versioned peer traffic for
cells it has not handed off (`docs/README.md:429-437`). Set an orchestrator
stop grace longer than the shut-down bounds.

The handoff works in batches (`docs/README.md:444-470`): the node reserves a
batch of cells, stops new local routes, proves the batch durable, tries to
publish one full snapshot (an L9 object so the successor does not replay the
full history), releases each ownership record, and asks a compatible peer to
acquire it. The successor keeps the cell dormant; a later request starts it
under the peer activation limit.

Four settings pace this work: `CELLD_RELEASES` (max complete handoffs, default
8), `CELLD_ACTIVATIONS` (demand-driven restore limit), `CELLD_SHUTDOWN_DRAIN_MS`
(max interval without a completed handoff, default 25000), and
`CELLD_SHUTDOWN_TOTAL_MS` (total process-stop bound, default 40000).

## The fleet drain token

A draining node claims a fleet drain token in the bucket before it releases
cells, so concurrent donors (a node drain, a cluster upgrade, a spot reclaim)
hand off one node at a time instead of flooding the survivors
(`docs/README.md:472-477`). The token is **advisory**: a donor that cannot
claim it within `CELLD_DRAIN_TOKEN_WAIT_MS` proceeds unserialized, a fresh
node's gate falls open after a bounded wait, and a dead holder's claim lapses
by TTL (`crates/celld/drain_token.rs:3-12`, `crates/logic/drain.rs:10-17`). The
key is `drain/token.json`, outside `nodes/` so lease listings and dead-node GC
never see it (`crates/celld/drain_token.rs:20-21`).

## Fleet readiness gating

A fresh process holds its first healthy response until the fleet is settled.
The process requires its live node lease, no active donor, and memory below
every pressure low watermark on each live node; it also requires a total
restore backlog no larger than one `CELLD_ACTIVATIONS` budget and incumbent
ownership within one equal successor share of the fleet mean
(`docs/README.md:480-487`). An unreadable fleet or unsettled condition holds
readiness for up to `CELLD_READY_FLEET_GATE_MS` (default 120000; `0` disables
the gate), after which the process reports healthy with a
`ready_gate_expired` event (`docs/README.md:491-494`). After the first healthy
response, fleet state does not remove readiness again.

## Memory-pressure shedding

Pressure shedding is a pure classifier over a memory sample plus the prior
shedding latch, in `crates/logic/pressure.rs` (`crates/logic/pressure.rs:3-14`).
Residency is deliberately not here — it is a hard cap enforced at admission.

Two ceilings, applied to different measurements (`crates/logic/pressure.rs:20-44`, `crates/logic/pressure.rs:95-122`):

- **Ordinary** (`high_bytes`, `CELLD_MAX_RSS_MB`, default 80% of available
  memory): the greater of allocator-adjusted RSS and the allocator-adjusted
  active cgroup working set (`memory.current - inactive_file`).
- **Absolute cap** (`rss_hard_bytes`): a fixed 95% of the machine (never
  derived from the ceiling), applied to the complete cgroup charge with process
  RSS as the fallback when no cgroup is readable.

Each latch engages at its ceiling and releases at 80% of that ceiling, so one
crossing cannot hold the node against the other's watermark
(`crates/logic/pressure.rs:46-58`, `crates/logic/pressure.rs:203-219`). The
effective limit is the lower of the two; `CELLD_MAX_RSS_MB=0` disables both.

Under pressure, celld durably replicates and fences the least-recently used
idle cells, publishes them unowned without resetting their epochs, and refuses
to reacquire new unowned cells; a spare node acquires a released cell through
the same bucket protocol (`README.md:288-295`). Eviction is bounded (`occupied`
vs `max_resident`) so a node refuses admission rather than running into memory
exhaustion.

## Local development: `celld dev`

Run an application locally without a bucket: `celld dev` starts one node with a
local SQLite object store, listens on `http://127.0.0.1:9876`, and keeps
durable state in `.celld/dev` (`README.md:94-105`). The local store is a
`celld-ltx`-shaped `LocalStore` opened only through the dev supervisor
(`crates/celld/dev.rs:30-33`); a regular node or operator subcommand cannot
select it (`docs/README.md:326-327`). The command watches the project and
rebuilds after a source/config change, keeping the current app running on a
failed build.

---

## Related pages

- [Ownership, fencing, durability, and the output gate](/openwiki/concepts/durability.md)
- [Deploying applications and adopting generations](/openwiki/operations/deploying.md)
- [Security and trust model](/openwiki/security/trust-model.md)
- [Telemetry: traces and logs to the bucket or OTLP](/openwiki/telemetry/overview.md)
