---
type: operations
title: Telemetry and observability
description: The opt-in tracing and logging pipeline — spans and log records, the bucket Parquet sink and the OTLP sink, sampling, the v0-unstable schema, and the DuckDB query and compaction workflow.
tags: [telemetry, otel, tracing, parquet, observability]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:40:45.922Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-11T14:40:45.922Z" }
---

# Telemetry and observability

celld can record traces and logs for the requests it serves. The feature is
off by default, and the off state costs nothing: `init` never runs,
`start_trace` finds no globals and answers `None`, and no event is ever built
(`crates/celld/telemetry.rs:6-12`). Set `CELLD_OTEL=1` to turn it on.

## Sinks

There are two sinks (`SinkChoice`, `crates/celld/telemetry.rs:66-73`):

- **`bucket`** (the default) writes Parquet files under the `telemetry/`
  prefix of the fleet bucket, so a fleet with a bucket has observability with
  no other service. DuckDB can query the files directly. This sink requires a
  fleet bucket (`CELLD_BUCKET`); `CELLD_OTEL_BUCKET` selects a different
  bucket on the same endpoint and credentials.
- **`otlp`** sends the same data to an OpenTelemetry collector over
  OTLP/HTTP-protobuf. The protobuf encoding is written by hand
  (`crates/celld/otlp.rs:3-11`) so prost, tonic, and the generated proto
  crates stay out of the binary — the same trade the Parquet sink made by
  skipping arrow. This sink works on a node without a fleet bucket.

The schema is version `v0-unstable` (`crates/celld/telemetry.rs:41-43`): the
column names can change before a stable release, and each file carries the
schema version in its object metadata.

## What celld records

celld records a span for each request a stateless Worker serves, for each
event a cell serves (a fetch, an alarm, an RPC, a WebSocket message), for each
outbound `fetch()`, and for each cell start. A span carries the request id,
the cell, the isolate, the queue wait, the outbound URL and status, and the
durability facts the runtime already knows (`docs/telemetry.md:33-40`).

Each `console.log` line is recorded as a log record carrying the trace id and
span id of the handler that wrote it, so a query can join the logs to the
traces across `await`. celld reads the W3C `traceparent` header on incoming
requests so its spans join the trace of the system in front of it, and sends a
`traceparent` header on outbound `fetch()` so downstream systems can join too.
celld records no metrics yet; the spans carry the durations and queue waits,
and a metrics signal can come later without a change to the trace schema
(`docs/telemetry.md:56-59`).

## Sampling and shedding

The sampler (`OTEL_TRACES_SAMPLER`, with `parentbased_always_on` as default)
decides at the start of a request; an unsampled request records nothing and
costs almost nothing. The hot path never blocks: `record` is a `try_send`, and
a full channel increments a drop counter — under saturation celld sheds
telemetry, counted, never requests (`crates/celld/telemetry.rs:14-19`). The
pipeline is ordinary tasks on the shared runtime with encoding on
`spawn_blocking`.

## Configuration

| variable | default | effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | Enable telemetry (`1`). |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` (Parquet) or `otlp` (OTLP/HTTP). |
| `CELLD_OTEL_BUCKET` | the fleet bucket | A different bucket for the Parquet files. |
| `CELLD_OTEL_RETENTION` | `30d` | Delete telemetry files older than this; `none` disables deletion. |
| `CELLD_OTEL_FLUSH_MS` | `300000` | Write a Parquet file after this many milliseconds of buffered events. |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | Write a Parquet file after the buffered events reach this many bytes. |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | Standard sampler name; `traceidratio` samples a fraction. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | The collector base URL for the `otlp` sink. |
| `OTEL_SERVICE_NAME` | `celld` | The service name in the exported resource. |

The `Config` is parsed once from the environment in `telemetry::Config::from_env`,
before any command or runtime work.

## Querying the bucket with DuckDB

The files are partitioned by node and by hour:
`telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet`, so a query that
reads one day touches only that day's files. DuckDB reads them with the
`httpfs` extension (an S3-compatible endpoint needs `URL_STYLE 'path'`, and a
plain-HTTP endpoint needs `USE_SSL false`). The documented joins correlate the
slowest requests with their log lines (`docs/telemetry.md:62-89`).

## File size and compaction

celld writes one Parquet file per flush, on a time or size limit, whichever it
reaches first (defaults 5 minutes and 5 MB). The defaults suit an
investigation after the fact; a near-live view needs a short
`CELLD_OTEL_FLUSH_MS` (for example 10000) and a compaction job, because
DuckDB opens every file a query reads and short flushes make many small files.

celld does not compact its own files — the serving path must not do storage
maintenance, and each node writes only the files it produced. Run the
compaction job on a maintenance node, once an hour for the hour that just
ended: COPY one past hour of small files into one large zstd-compressed file,
then delete the sources (`docs/telemetry.md:112-134`). Retention
(`CELLD_OTEL_RETENTION`) is celld's own sweep that deletes old files.

## Related pages

- [Operating a node and a fleet](fleet-operations.md) — the `/state` route and operator-facing observability.
- [The fleet bucket and object storage](fleet-bucket.md) — the `telemetry/` prefix and the store requirements.
