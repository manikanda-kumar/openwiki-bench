---
type: operations
title: "Operational CLI and configuration"
description: "The celld command surface, its environment variables, listener addresses, output discipline, and telemetry sinks — as parsed from the source."
tags: [cli, configuration, environment, telemetry, operations]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:23:20.669Z
sources:
  - id: openwiki-source-c2f1f9ad6afd51e0d878f2e5
    resource: repo://crates/celld/actor.rs
  - id: openwiki-source-d67853ffafaf731eb8cddf50
    resource: repo://crates/celld/cell_cli.rs
  - id: openwiki-source-74510bca427f93999e1bbdd0
    resource: repo://crates/celld/cli_output.rs
  - id: openwiki-source-55e133f02ad99db05fcca8ad
    resource: repo://crates/celld/d1_cli.rs
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-6d3d805980c86df360693637
    resource: repo://crates/celld/kv_cli.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-cb45cb88385401a2b1df7330
    resource: repo://crates/celld/queue_cli.rs
  - id: openwiki-source-12d7dc2c6f562e2c078e90ee
    resource: repo://crates/celld/startup.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
generated: { by: "opencode", at: "2026-09-11T15:23:20.669Z" }
---

# Operational CLI and configuration

`celld`'s command line is parsed by hand, not derived from clap: the doc
comment says parsing "answers one question — which `Action` to take — and
refuses anything ambiguous rather than guessing" (`crates/celld/main/cli.rs:5-7`).

## Actions

`Action` (`crates/celld/main/cli.rs:34-59`) covers the whole surface:

- `Run(Settings)` — the daemon. Started implicitly (no subcommand) with
  bucket/addr configuration, or as `celld` with environment-derived settings.
- `Diagnose` — operator health checks against the node and optional peers,
  with `--json` output and a read-only mode that skips the write probe
  (`crates/celld/main/cli.rs:42-52`).
- `Deploy`, `Dev`, `Cell`, `D1`, `Kv`, `Queue`, `Connect`, `Credentials`,
  `Token`, `Disconnect` — each subcommand gets its own arg vector.
- `Help` and `Version`.

Configuration comes from flags (`--bucket`, `--endpoint`, `--region`,
`--listen`, `--internal-listen`, `--advertise`,
`--unsafe-public-advertise`, `--trust-forwarded-headers`) overlaid on
environment values (`CELLD_BUCKET`, `CELLD_TEST_BUCKET`,
`S3_ENDPOINT`, `AWS_REGION`/`AWS_DEFAULT_REGION`, `CELLD_ADDR`,
`CELLD_INTERNAL_ADDR`, `CELLD_ADVERTISE`,
`CELLD_UNSAFE_PUBLIC_ADVERTISE`, `CELLD_TRUST_FORWARDED_HEADERS`,
`CELLD_STORAGE_PROBE`, `CELLD_CLOUD`; `crates/celld/main/cli.rs:117-174`).
Defaults: the worker listen is `AutoLoopback`, the internal listener
`LoopbackEphemeral` (`crates/celld/main/cli.rs:152-159`), and `CELLD_STORAGE_PROBE`
defaults **true**, because "a store that accepts the precondition and ignores
it makes the node self-fence in a loop" (`crates/celld/main/cli.rs:166-168`).

Only the node-mode actions (`Run`, `Dev`, `Help`, `Version`) log to stdout;
`stdout_is_data()` returns true for every operator subcommand
(`crates/celld/main/cli.rs:69-107`).

## Subcommands of note

- **`celld kv`** — "read and write a deployed KV namespace… This command is
  the operator surface for KV… The CLI implements no storage. It transports a
  request" through the operator-cell machinery: bucket leases find the fleet,
  the fleet secret signs the request, `/runtime/<scope>` forwards to the
  owner (`crates/celld/kv_cli.rs:9-24`).
- **`celld d1`** — run SQL/migrations against a deployed D1 database, which
  is a cell "reachable through the node that owns" it
  (`crates/celld/d1_cli.rs:8-10`).
- **`celld cell`** — "the operator's view of the Durable Object instances a
  fleet holds"; listings are paginated because "one `LIST` request returns at
  most a thousand children" (`crates/celld/cell_cli.rs:8-13`).
- **`celld queue`** — inspect and operate the Queue broker, reaching it "over
  the authenticated fleet operator route" without touching SQLite
  (`crates/celld/queue_cli.rs:8-11`).

## Environment variables

`crates/celld/env_vars.rs` is the strict parser: "An unset variable selects
its caller's documented default. A supplied variable must contain a valid
value, so a typo cannot silently change the configuration of a running node"
(`crates/celld/env_vars.rs:5-7`). It exposes typed helpers (`flag`,
`positive`, `positive_or`) used by the actor's operation-deadline default
(`CELLD_OPERATION_DEADLINE_MS`, default 15s; `crates/celld/actor.rs:26-33`)
and by production stereo of configuration — `validate()` lists all flags and
positives it recognizes ahead of runtime startup
(`crates/celld/env_vars.rs:19-56`), so "some consumers [that] cannot return a
configuration error at the point of use" are made infallible without giving
malformed values defaults.

The numeric knobs cover activations, evictions, deploy polling, fetch and
handler budgets, idle-evict seconds, log-capture workers, the log pipeline,
LTX compaction, durability timeout (`crates/celld/env_vars.rs:27-56` list).
Flags (`CELLD_CLOUD`, `CELLD_OUTPUT_GATE`, `CELLD_PRESENCE_SHADOW`,
`CELLD_TRUST_FORWARDED_HEADERS`, `CELLD_UNSAFE_PUBLIC_ADVERTISE`,
`CELLD_LTX_COMPACTION`, `CELLD_CLOUD_RESTART_ON_DEPLOY`) parse through
`flag()` (`crates/celld/env_vars.rs:19-31`).

## Listener policy

`crates/celld/startup.rs` keeps listener policy out of the executor: "both
sockets are reserved before storage or V8 work starts, and the executor
receives an already-validated peer address for the internal socket"
(`crates/celld/startup.rs:5-9`). It auto-selects from port range 8080–8099
when the task is a demo, and enlarges the accept backlog past `TcpListener::bind`'s
inherited 128 after a real incident ("1,200 chat clients returning together
filled every node's accept queue", `crates/celld/startup.rs:20-27`).

## Telemetry and OTLP

Telemetry is off by default and off *is structural*: "`init` never runs,
`start_trace` finds no globals and answers `None`, and no event is ever
built"; tracing decisions are made at trace creation and the hot path never
blocks — "`record` is a `try_send`; a full channel increments a drop counter"
(`crates/celld/telemetry.rs:7-15`). Two sinks exist:
`crates/celld/telemetry.rs` writes **Parquet** into the bucket
(`telemetry/` prefix); `crates/celld/otlp.rs` hand-encodes **OTLP/HTTP
protobuf** ("a small, stable corner of the OTLP proto… Hand encoding keeps
prost, tonic, and the generated proto crates out of the binary",
`crates/celld/otlp.rs:5-13`). [docs/telemetry.md](../docs/telemetry.md)
documents the sink selection (`CELLD_OTEL_SINK=bucket|otlp`), flush
time/size triggers, and DuckDB querying for the Parquet sink.

## Output discipline

`crates/celld/cli_output.rs` enforces three rules "across every subcommand":

1. "stdout carries data, stderr carries everything a person reads."
2. listings are bounded by default and "say on stderr what they withheld and
   how to continue."
3. "a closed pipe ends the output; it is not a failure"
   (`crates/celld/cli_output.rs:9-16`).

Enforcement is the `Record` trait — a row cannot be printed as text without
declaring its JSON shape, so `--json` cannot be half-implemented
(`crates/celld/cli_output.rs:20-33`). The provenance comments name the actual
incident: "`celld kv get KEY > value` must write the value and nothing else,
and `celld d1 execute` prints JSON a script parses. Sharing one stream
between the two prefixes an operator's data with whatever the process
warned about at startup" (`crates/celld/main/cli.rs:75-83`).
