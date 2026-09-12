---
type: operations
title: Observability and telemetry
description: Node logging conventions (a node's stdout is its log), the optional CELLD_OTEL telemetry pipeline (Parquet in the bucket or OTLP to a collector), and its sampling, shedding, and schema behavior.
tags: [observability, telemetry, otlp, logging, traces]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:33:19.973Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-ace6a460c1c9475047de036e
    resource: repo://crates/celld/env_vars.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-34a19fae1e1a1a0ff05a1838
    resource: repo://crates/celld/main/cli.rs
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-196170e31ff8ec60a116165b
    resource: repo://docs/README.md
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-11T15:33:19.973Z" }
---

# Observability and telemetry

## Node logging

A running node's stdout **is** its log; Docker and journald consume it as
such, while CLI subcommand stdout carries data — the
`Action::stdout_is_data` split exists so "an allocator warning [cannot
land] in front of a value"
[crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L57-L70).

`RUST_LOG` filters the runtime log (default `info` per the help text).
The runtime uses standard structured `tracing` events
[crates/celld/main/cli.rs](repo://crates/celld/main/cli.rs#L352-L383), e.g.
`http_connection_failures` aggregates connection-error telemetry once per
second rather than per-failure
[crates/celld/main.rs](repo://crates/celld/main.rs#L80-L115).

## Telemetry is off by default

`docs/telemetry.md`: "The feature is off by default, and the off state
costs nothing. Set `CELLD_OTEL=1` to turn it on"
[docs/telemetry.md](repo://docs/telemetry.md#L3-L7). The code makes "off"
structural, not a boolean branch: `init` never runs, `start_trace` finds
no globals and answers `None`, "no event is ever built", and sampling is
decided at trace creation for the same reason
[crates/celld/telemetry.rs](repo://crates/celld/telemetry.rs#L10-L17).

## Configuration surface

[docs/telemetry.md](repo://docs/telemetry.md#L17-L36) documents the knobs:

| Variable | Default | Effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | Enable telemetry |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` = Parquet to fleet bucket; `otlp` = OTLP/HTTP protobuf to a collector |
| `CELLD_OTEL_BUCKET` | fleet bucket | A different bucket for telemetry files (same endpoint/credentials) |
| `CELLD_OTEL_RETENTION` | `30d` | Delete older files; `none` disables deletion (own lifecycle rules) |
| `CELLD_OTEL_FLUSH_MS` | `300000` | Flush buffered events after this many ms |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | Flush buffered events at this size (whichever limit hits first) |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Standard sampler; `traceidratio` + `OTEL_TRACES_SAMPLER_ARG` samples a fraction |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | Collector base URL for the `otlp` sink |
| `OTEL_SERVICE_NAME` | `celld` | Exported resource name |

The `bucket` sink requires a fleet bucket; the `otlp` sink works on a
node without one [docs/telemetry.md](repo://docs/telemetry.md#L38-L39).

## Sinks in the code

- **Bucket**: telemetry objects live under `telemetry/traces` and
  `telemetry/logs` (`TRACES_PREFIX`, `LOGS_PREFIX`,
  [crates/celld/telemetry.rs](repo://crates/celld/telemetry.rs#L32-L38)).
  The format is Parquet under the `telemetry/` prefix — "a fleet with a
  bucket has observability with no other service. DuckDB can query these
  files directly". The Parquet workspace dependency deliberately avoids
  the `arrow` feature so the arrow stack stays out of the binary
  [docs/telemetry.md](repo://docs/telemetry.md#L9-L15)
  [Cargo.toml](repo://Cargo.toml#L80-L83).
- **OTLP**: `crates/celld/otlp.rs` hand-encodes OTLP/HTTP protobuf, "by
  hand" — the export messages are "a small, stable corner of the OTLP
  proto" (flat spans and log records with scalar attributes), so hand
  encoding keeps prost, tonic, and the generated proto crates out of the
  binary; field numbers follow opentelemetry-proto v1
  [crates/celld/otlp.rs](repo://crates/celld/otlp.rs#L3-L15).
- `CELLD_LOG_TRANSPORT` must be `http` or `stream` (validated at startup)
  [crates/celld/env_vars.rs](repo://crates/celld/env_vars.rs#L90-L94).

## What gets recorded

[docs/telemetry.md](repo://docs/telemetry.md#L41-L55): a span for each
stateless Worker request, each cell event (fetch, alarm, RPC, WebSocket
message), each outbound `fetch()`, and each cell start — carrying request
id, cell, isolate, queue wait, outbound URL/status, and the durability
facts. Every `console.log` line becomes a log record joined by trace id
and span id of the writing handler ("the correlation survives `await`").
W3C `traceparent` is read inbound and sent outbound, so a Worker call to
a Durable Object stays in one trace.

Log bodies are capped: "a `console.log` body larger than this is
truncated: log records are telemetry, not blob storage, and one runaway
line must not dominate a batch" (`LOG_BODY_CAP` = 8 KiB)
[crates/celld/telemetry.rs](repo://crates/celld/telemetry.rs#L40-L44).

## Behavior under load and failure

- The hot path never blocks: `record` is a `try_send`; a full channel
  increments a drop counter. "Under saturation celld sheds telemetry,
  counted, never requests."
- The pipeline runs ordinary tasks on the shared runtime — "no dedicated
  thread (the Deno pattern needs one because its main loop is a
  current-thread runtime; celld's is not)" — and encoding runs on
  `spawn_blocking`.
- Telemetry is observational and does **not** affect Actor decisions —
  the file opens with
  `#![allow(clippy::disallowed_methods)] // Telemetry is observational
  and does not affect Actor decisions`
  [crates/celld/telemetry.rs](repo://crates/celld/telemetry.rs#L10-L26).
- "An unsampled request records nothing and costs almost nothing";
  sampling is decided at the start of a request
  [docs/telemetry.md](repo://docs/telemetry.md#L57-L60).

## Schema stability

"The schema is version `v0-unstable`. The column names can change before
a stable release, and each file carries the schema version in its object
metadata" [docs/telemetry.md](repo://docs/telemetry.md#L21-L25). "celld
records no metrics yet" — durations and queue waits live in spans, and a
metrics signal can come later without a trace-schema change
[docs/telemetry.md](repo://docs/telemetry.md#L61-L64).

## `/state` and diagnostic reporting

Beyond telemetry, live introspection is on by default (alpha surface):

- `/state` reports the served/draining deployments, per-object
  deployments, deployment move counters, pressure inputs (all four
  measurements), and handoff/restore counters
  [docs/README.md](repo://docs/README.md#L272-L275)
  [docs/README.md](repo://docs/README.md#L504-L506).
- `celld diagnose` prints each node's coarse resident-cell, WebSocket,
  RSS, CPU, file-descriptor, pressure, and shedding sample, plus a
  `restoring` count for rolling-update pacing
  ([README.md](repo://README.md#L204-L215)
  [docs/README.md](repo://docs/README.md#L570-L577)).

## Related pages

- [Node command surface](/openwiki/operations/node-cli.md) — the operator
  API context.
- [Resident capacity and pressure](/openwiki/runtime/admission-pressure.md) —
  what the pressure signals mean.
