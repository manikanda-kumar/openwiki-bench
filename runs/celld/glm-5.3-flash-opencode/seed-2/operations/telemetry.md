---
type: operations
title: Telemetry and observability
description: Request traces and console logs — the Parquet bucket sink, the OTLP collector sink, retention and sampling configuration, and the v0-unstable schema caveat.
tags: [telemetry, tracing, logs, otel, parquet]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:47:04.277Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-11T15:47:04.277Z" }
---

# Telemetry and observability

Telemetry is **off by default** — `CELLD_OTEL=1` turns it on, and the off
state costs nothing (repo://docs/telemetry.md#L5-L8). When on, celld
records request traces and `console.log` lines and ships them to one of
two sinks.

## The two sinks

`SinkChoice` enumerates them (repo://crates/celld/telemetry.rs#L67-L76):

- **`Bucket`** — Parquet into the operator's fleet bucket. Zero
  configuration beyond the flag; `telemetry/traces` and `telemetry/logs`
  prefixes (repo://crates/celld/telemetry.rs#L32-L33). Requires
  `CELLD_BUCKET` to be set on the node.
- **`otlp`** — OTLP/HTTP protobuf to an OpenTelemetry collector via
  `crates/celld/otlp.rs` (`traces_request` / `logs_request` builders);
  works on a node without a fleet bucket (repo://crates/celld/otlp.rs#L166-L210).

## Configuration

| variable | default | effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | 1 enables telemetry |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` or `otlp` |
| `CELLD_OTEL_BUCKET` | fleet bucket | Separate bucket for Parquet, same endpoint/credentials |
| `CELLD_OTEL_RETENTION` | `30d` | Older files deleted; `none` disables deletion |
| `CELLD_OTEL_FLUSH_MS` | `300000` | Buffer flush trigger (ms) |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | Buffer flush trigger (bytes; whichever triggers first) |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Standard sampler names; `traceidratio` + `OTEL_TRACES_SAMPLER_ARG` for fractions |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP sink base URL |

(repo://docs/telemetry.md#L43-L66)

Retention is `Retention::Days(u32)` or `Retention::None` — the latter is
documented as "Never delete, my lifecycle rules own this." Files are
partitioned per node per hour: `telemetry/traces/<node>/<yyyy>/<mm>/<dd>/
<hh>/<id>.parquet` (repo://docs/telemetry.md#L96-L101).

## What is recorded

Per docs (repo://docs/telemetry.md#L36-L52):

- A **span** for each request a stateless Worker serves, for each event a
  cell serves (fetch, alarm, RPC, WebSocket message), for each outbound
  `fetch()`, and for each cell start. A span carries the request id, cell,
  isolate, queue wait, outbound URL/status, and durability facts.
- A **log record** per `console.log` line, carrying trace id and span id so
  queries can join logs to traces, correlation surviving `await`.
  A `console.log` body larger than 8 KiB is truncated — log records are
  telemetry, not blob storage (repo://crates/celld/telemetry.rs#L38-L45).
- **W3C `traceparent`** interop: celld reads it on incoming requests so its
  spans join the upstream trace, and sends it on outbound `fetch()`, so a
  Worker call to a Durable Object stays in one trace
  (repo://docs/telemetry.md#L49-L51).
- **No metrics yet**; the spans carry durations and queue waits
  (repo://docs/telemetry.md#L53-L54).

## Sampling, shedding, and buffering

The sampler decides at request start; an unsampled request records nothing
at near-zero cost. Telemetry sheds *before* requests do under load, and
celld counts what it sheds. Inside the process a channel of capacity 8,192
records sits between the hot path and the pump — a full queue sheds
(counted), and the pump drains continuously with size-triggered batching,
so the channel only needs to cover a scheduling hiccup, not a flush
interval (repo://crates/celld/telemetry.rs#L47-L49).

## Schema instability

The schema is explicitly not frozen:

> The schema is version `v0-unstable`. The column names can change before
> a stable release, and each file carries the schema version in its object
> metadata.

(repo://docs/telemetry.md#L11-L14, grounded in
repo://crates/celld/telemetry.rs#L38-L40)

## Querying with DuckDB

The docs page gives a complete DuckDB recipe: `INSTALL httpfs`, an S3
`SECRET` (path-style URLs for MinIO, `USE_SSL false` for plain-HTTP
endpoints), then views over `s3://BUCKET/telemetry/{traces,logs}/.../
*.parquet` — e.g. the slowest requests and every log line joined to the
span that wrote it, keying on `(trace_id, span_id)`
(repo://docs/telemetry.md#L57-L99).
