---
type: operations
title: Configuration surface
description: The complete operator configuration surface — CLI actions and options, the strict environment-variable parsing and validation, listener and fleet resolution rules, and where each setting is consumed.
tags: [configuration, environment, cli, listeners]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-5582430152973ab16bc08716
    resource: repo://crates/celld/cli_options.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-7a56878b2d100d5d56e77549
    resource: repo://crates/celld/generation.rs
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-5398d3ff6030f6aca32a1143
    resource: repo://crates/logic/isolate.rs
  - id: openwiki-source-814e671dfc43c32bdd3bdd48
    resource: repo://crates/logic/types.rs
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Configuration surface

celld is configured from the command line and the environment. The rules that
make the surface safe are: an unset variable selects its caller's documented
default; a supplied variable must contain a valid value, so a typo cannot
silently change the configuration of a running node (`crates/celld/env_vars.rs:3-7`);
and Boolean variables accept only `0` or `1`. celld exits during startup when
a supplied value is invalid.

## CLI actions

The command line resolves to exactly one `Action`
(`crates/celld/main/cli.rs:31-54`): `Run` (the node), `Diagnose`, `Deploy`,
`Dev`, `Cell`, `D1`, `Kv`, `Queue`, `Connect`, `Credentials`, `Token`,
`Disconnect`, `Help`, and `Version`. Parsing refuses anything ambiguous rather
than guessing (`crates/celld/main/cli.rs:3-8`).

A central distinction is which invocation's stdout carries data: a node's
stdout **is** its log (Docker and journald read it), while a CLI subcommand's
stdout is its answer — `celld kv get KEY > value` must write the value and
nothing else. `stdout_is_data` (`crates/celld/main/cli.rs:56-71`) is false only
for `Run`, `Dev`, `Help`, and `Version`, and the logging sink is chosen
accordingly (`async_main`, `crates/celld/main.rs:3027-3038`).

### Node options

`Settings` (`crates/celld/main/cli.rs:9-29`) carries the node options:
`--bucket`, `--endpoint`, `--region`, `--listen`, `--internal-listen`,
`--advertise`, `--unsafe-public-advertise`, `--trust-forwarded-headers`, the
storage probe switch, and the internal dev-store path. The environment
equivalents are `CELLD_BUCKET`, `S3_ENDPOINT`, `AWS_REGION`/`AWS_DEFAULT_REGION`,
`CELLD_ADDR`, `CELLD_INTERNAL_ADDR`, `CELLD_ADVERTISE`,
`CELLD_UNSAFE_PUBLIC_ADVERTISE`, and `CELLD_TRUST_FORWARDED_HEADERS`.

Listener resolution has two refusal rules (`crates/celld/main/cli.rs:230-247`):

- An explicit non-loopback public `--listen` (or `CELLD_ADDR`) requires an
  explicit `--internal-listen` (or `CELLD_INTERNAL_ADDR`), because that shape
  identifies an obsolete one-listener configuration.
- `--advertise` (or `CELLD_ADVERTISE`) requires an explicit
  `--internal-listen`, because the default internal listener uses a random
  loopback port.

`celld::startup` owns the binding and the advertise-address policy:
`bind_internal_listener` rejects a literal public advertised IP unless
`--unsafe-public-advertise` is set, accepts `IP:PORT` or `HOST:PORT`, and
requires `--advertise` when `--internal-listen` uses an unspecified address
(`crates/celld/startup.rs:221-255`).

## Shared fleet flags

Every operator command reads the same fleet flags through `FleetFlags`
(`crates/celld/cli_options.rs:30-121`), so `--bucket gs://name` is handled in
one place and not four. `--bucket`, `--endpoint`, and `--region` map onto the
environment (`CELLD_BUCKET`, `S3_ENDPOINT`, `AWS_REGION` then
`AWS_DEFAULT_REGION`); `resolve` requires a bucket and defaults the region to
`us-east-1`. The `s3://` scheme is stripped because a bare name means S3; the
`gs://` and `az://` schemes survive into `Bucket::open`, which parses them to
pick a backend.

## Environment parsing and validation

`crates/celld/env_vars.rs` is the single home for the typed parsers:
`flag` (Booleans: only `0` or `1`), `positive` (a value above zero),
`positive_or` (a default when unset), `with_default`, `optional`, and `value`.
`validate()` (`crates/celld/env_vars.rs:16-100`) runs before any command or
runtime work and covers every typed production variable, including the
cross-checks for ranged values (for example
`CELLD_PRESENCE_HEARTBEAT_MS` must be between 50 and 30000 and
`CELLD_V8_HEAP_LIMIT_MB` must not overflow). Consumers that cache a value or
read it from a synchronous callback cannot return a configuration error at the
point of use, so this pass makes those reads infallible without giving
malformed values a default (`crates/celld/env_vars.rs:11-15`).

The `--help` text (`crates/celld/main/cli.rs:269-391`) is the public
description of the configuration surface and remains stable across builds; the
environment table in `docs/README.md` documents the primary settings.

## Where each group of settings is consumed

- **Listeners and advertise** — `crates/celld/startup.rs`; the node binds both
  sockets before storage or V8 work starts.
- **Leases, pressure, ownership on evict** — `crates/celld/machine.rs`
  (`CELLD_TTL_MS`, `CELLD_PRESSURE_OWNERSHIP`,
  `CELLD_MAX_OUTBOUND_WEBSOCKETS`, `PEER_CONNECT_TIMEOUT`), feeding the core
  `Config`.
- **Deployment adoption** — `crates/celld/generation.rs` (`CELLD_DEPLOY_POLL_S`,
  `CELLD_DEPLOY_MAX_AGE_S`) and `crates/celld/main.rs` (the pointer watcher and
  cron arm).
- **Durability and replication** — `crates/celld/ltx_repl.rs`
  (`CELLD_LTX_COMPACTION`, `CELLD_LTX_COMPACTION_MIN_TXIDS`,
  `CELLD_LTX_COMPACTIONS`, `CELLD_LTX_TRUNCATE_PAGES`,
  `CELLD_LTX_DURABILITY_TIMEOUT_SECS`), `crates/celld/machine.rs`
  (`CELLD_DURABILITY`, `CELLD_OUTPUT_GATE`), and the peer log tier
  (`CELLD_LOG_CAPTURE_WORKERS`, `CELLD_LOG_PIPELINE`, `CELLD_LOG_HEDGE_MS`).
- **Pressure and memory** — `crates/celld/memory.rs` and `crates/logic/pressure.rs`
  (`CELLD_MAX_RSS_MB`, the cgroup cap, `CELLD_V8_HEAP_LIMIT_MB`).
- **Shutdown and rollout** — `crates/celld/machine.rs` and `crates/logic/drain.rs`
  (`CELLD_SHUTDOWN_DRAIN_MS`, `CELLD_SHUTDOWN_TOTAL_MS`,
  `CELLD_DRAIN_TOKEN_WAIT_MS`, `CELLD_READY_FLEET_GATE_MS`, `CELLD_RELEASES`,
  `CELLD_ACTIVATIONS`).
- **Telemetry** — `crates/celld/telemetry.rs` (`Config::from_env`).
- **Worker runtime** — `crates/celld/runtime.rs` (`CELLD_MAX_CELL_REQUESTS`,
  `CELLD_WORKER_LOADER`, `CELLD_MAX_LOADED_WORKERS`,
  `CELLD_MAX_REQUEST_BODY_BYTES`, pool limits) and `crates/celld/pool.rs`.

A setting that feeds a behavioral decision enters the core through the `Config`
struct (`crates/logic/types.rs:63`); the core never reads the environment
itself. Each node also publishes what it sees: the `/state` operator route
reports the deployment the node serves, the memory measurements, and the
phase census.

## Related pages

- [Quickstart](../quickstart.md) — the minimal settings to run a node and deploy an application.
- [Operating a node and a fleet](fleet-operations.md) — how the shutdown, pressure, and rollout settings behave.
- [Telemetry and observability](telemetry.md) — the telemetry configuration group.
