---
type: operations
title: Configuration and Environment
description: The command-line flags and environment variables that configure a celld node and its operator commands, the strict parsing rules that reject malformed values, documented defaults, and where each setting takes effect.
tags: [configuration, environment, cli, flags, defaults]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-5582430152973ab16bc08716
    resource: repo://crates/celld/cli_options.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-c63c3ba65eb277d6c4a00723
    resource: repo://crates/celld/machine.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Configuration and Environment

celld is configured through command-line flags and environment variables.
The environment is the primary surface for a node; operator subcommands
share one set of fleet flags so `--bucket`, `--endpoint`, and `--region`
mean the same thing across every command.

## Strict parsing

Environment parsing is strict by design: an unset variable selects its
caller's documented default, and a supplied variable must contain a valid
value, so a typo cannot silently change the configuration of a running
node (crates/celld/env_vars.rs#L3-L7). Before the runtime starts, one
`validate()` pass reads every typed production variable and fails startup
on a malformed value — some consumers cache a value or read it from a
synchronous callback, so they cannot return a configuration error at the
point of use (crates/celld/env_vars.rs#L11-L27).

- A **Boolean** variable accepts only `0` or `1`
  (crates/celld/env_vars.rs#L110-L122).
- A **positive** variable must parse and be greater than zero
  (crates/celld/env_vars.rs#L154-L174).
- An **optional** variable, when unset, leaves its caller's default
  (crates/celld/env_vars.rs#L124-L144).

A node exits during startup when a supplied value is invalid
(docs/README.md#L706-L708).

## Shared fleet flags

`--bucket`, `--endpoint`, and `--region` name the same fleet whichever
command reads them, with environment fallbacks `CELLD_BUCKET`,
`S3_ENDPOINT`, and `AWS_REGION` or `AWS_DEFAULT_REGION`
(crates/celld/cli_options.rs#L6-L16, crates/celld/cli_options.rs#L71-L89).
The bucket scheme selects the backend: `s3://` is stripped (a bare name
means S3 there too), while `gs://` and `az://` are kept for the bucket
client to parse (crates/celld/cli_options.rs#L57-L69). An unset region
defaults to `us-east-1` (crates/celld/cli_options.rs#L92-L96). An empty
environment variable is treated as unset, because an empty variable is how
a shell spells "unset" in a script that always exports
(crates/celld/cli_options.rs#L20-L28).

## The node's configuration surface

The decision core's `Config` is assembled from the environment by
`machine.rs`:

- `CELLD_MAX_RESIDENT_CELLS` — the hard cap on resident cells, enforced
  at admission (crates/logic/types.rs#L63-L66,
  crates/celld/machine.rs#L110-L111).
- `CELLD_MAX_RSS_MB` — the memory threshold for pressure shedding, which
  the pressure classifier builds into `PressureConfig`
  (crates/celld/machine.rs#L110-L126).
- `CELLD_PRESSURE_OWNERSHIP` — `release` (the default) or `sticky`;
  decides whether an eviction made for room hands the cell to the fleet
  (crates/celld/machine.rs#L38-L40, crates/celld/machine.rs#L57-L66).
- `CELLD_TTL_MS` — the node-lease lifetime, default 10000 ms
  (crates/celld/machine.rs#L53-L55).
- `CELLD_MAX_OUTBOUND_WEBSOCKETS` — the per-cell ceiling on concurrent
  outbound WebSockets (crates/celld/machine.rs#L43).
- `CELLD_DURABILITY` — `fleet` (default) or `bucket`; an invalid value
  stops the process (crates/celld/main.rs#L3721-L3726).

## Listeners and networking

- `CELLD_ADDR` / `--listen` — the public Worker listener.
- `CELLD_INTERNAL_ADDR` / `--internal-listen` — the peer and operator
  listener, defaulting to `127.0.0.1:0` so celld selects an available
  loopback port at each start (docs/security.md#L28-L31).
- `CELLD_ADVERTISE` / `--advertise` — the internal address peers can
  reach. An explicit advertised address requires an explicit
  internal-listener address, and an explicit non-loopback public listener
  without an explicit internal listener is rejected as an obsolete
  one-listener configuration (docs/security.md#L32-L34).
- `CELLD_UNSAFE_PUBLIC_ADVERTISE` — permits a literal public IP in the
  advertised address.
- `CELLD_TRUST_FORWARDED_HEADERS` — lets trusted proxy `X-Forwarded-Host`
  and `X-Forwarded-Proto` headers set `request.url` (docs/security.md#L107-L110).
- `CELLD_STORAGE_PROBE` — whether a node tests the bucket's conditional
  write before it serves; on by default because a store that accepts the
  precondition and ignores it makes the node self-fence in a loop
  (crates/celld/main/cli.rs#L26-L29).

## Worker execution

- `CELLD_ACTIVATIONS` — the limit for concurrent cold-cell activations
  (default: the available CPU count or 128, whichever is smaller).
- `CELLD_MAX_CELL_REQUESTS` — concurrent fetch events for one Durable
  Object or Queue broker (default 64).
- `CELLD_MAX_REQUEST_BODY_BYTES` — the body limit for public Worker
  requests and direct Durable Object requests (default 1 GiB; the value
  cannot exceed the default) (crates/celld/actor.rs#L1128-L1130,
  crates/celld/main.rs#L3206-L3212).
- `CELLD_V8_HEAP_LIMIT_MB` — the per-isolate V8 heap limit (default
  128 MB), which decides how many hibernatable WebSocket clients a cell
  can carry.
- `CELLD_WORKER_LOADER` — bind a Worker Loader (Code Mode) at this `env`
  name; off unless set (experimental).
- `CELLD_MAX_LOADED_WORKERS` — the limit for concurrent loaded workers
  (default 256).
- `CELLD_VAR_*` / `CELLD_VARS_FILE` — Worker variable overrides.

## Replication and log tuning

- `CELLD_OUTPUT_GATE` — `1` (default) proves each write durable before
  acknowledging it; `0` removes the replication wait
  (docs/README.md#L690).
- `CELLD_LTX_COMPACTION` — `1` (default) creates additive L1 objects; `0`
  is required on every node of a mixed fleet until all nodes can read
  block objects (docs/README.md#L696).
- `CELLD_LTX_COMPACTION_MIN_TXIDS`, `CELLD_LTX_COMPACTIONS` — the durable
  TXID distance that queues a background L1 attempt (default 256) and the
  node-wide concurrency limit (default 2).
- `CELLD_LTX_TRUNCATE_PAGES` — the WAL size at which an ordinary cell's
  WAL file is truncated at the next checkpoint (default 128 pages).
- `CELLD_LTX_DURABILITY_TIMEOUT_SECS` — the deadline for a durability
  proof and the final snapshot retry window (default 10 s).
- `CELLD_LOG_CAPTURE_WORKERS`, `CELLD_LOG_PIPELINE`, `CELLD_LOG_HEDGE_MS`
  — the fleet log tier's concurrency and hedging settings.
- `CELLD_LOG_TRANSPORT` — the log tier transport, `http` or `stream`
  (crates/celld/env_vars.rs#L88-L92).

## Shutdown and fleet pacing

- `CELLD_SHUTDOWN_DRAIN_MS` (default 25000) — the maximum interval without
  a completed handoff during shutdown; each successor acknowledgement
  starts the interval again.
- `CELLD_SHUTDOWN_TOTAL_MS` (default 40000) — the bound for the complete
  process stop.
- `CELLD_DRAIN_TOKEN_WAIT_MS` (default 30000) — how long a donor waits to
  claim the fleet drain token; `0` disables the token.
- `CELLD_READY_FLEET_GATE_MS` (default 120000) — the bound on the
  first-readiness fleet gate; `0` disables it.

## Logging

`RUST_LOG` is the runtime log filter (docs/README.md#L701). A node's
stdout *is* its log — Docker and journald read it — while every operator
subcommand writes its data to stdout and its messages to stderr
(crates/celld/main/cli.rs#L30-L38).

## Source of truth for the complete list

The authoritative, current list of variables and their defaults is printed
by `celld --help`; the primary settings are tabulated in
docs/README.md#L660-L708. Because the surface grows with each release,
prefer `celld --help` over any fixed table when planning an operator
change.
