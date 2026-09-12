---
type: operations
title: Telemetry and Observability
description: How celld records traces and logs (off by default), the bucket Parquet sink vs the OTLP sink, the v0-unstable schema, retention, and correlation with W3C traceparent.
tags: [operations, telemetry, observability, otel, parquet, tracing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:37:50.122Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-12T21:37:50.122Z" }
---

# Telemetry and Observability

celld can record traces and logs for the requests it serves. The feature is off
by default, and the off state costs nothing — `init` never runs, `start_trace`
finds no globals and answers `None`, and no event is ever built
(`crates/celld/telemetry.rs:6-12`). Set `CELLD_OTEL=1` to turn it on
(`docs/telemetry.md:5`).

## The two sinks

The default sink is the fleet bucket: celld writes Parquet files under the
`telemetry/` prefix, so a fleet with a bucket has observability with no other
service, and DuckDB can query these files directly. An alternative sink
(`CELLD_OTEL_SINK=otlp`) sends the same data to an OpenTelemetry collector as
OTLP/HTTP protobuf (`docs/telemetry.md:7-10`, `crates/celld/telemetry.rs:66-73`).

The `bucket` sink requires the node to have a fleet bucket (`CELLD_BUCKET`);
the `otlp` sink works on a node without one (`docs/telemetry.md:30-31`). The
bucket sink is identified by the prefix constants `telemetry/traces` and
`telemetry/logs` (which sit under the fleet bucket's `telemetry/` reserved
prefix) (`crates/celld/telemetry.rs:31-33`).

The OTLP export messages are hand-encoded in `crates/celld/otlp.rs`, keeping
`prost`, `tonic`, and generated proto crates out of the binary; field numbers
follow opentelemetry-proto v1 (`crates/celld/otlp.rs:3-11`).

## Configuration

| variable | default | effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | Set `1` to enable telemetry |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` Parquet to the fleet bucket, `otlp` OTLP/HTTP to a collector |
| `CELLD_OTEL_BUCKET` | the fleet bucket | A different bucket for the Parquet files, same endpoint and credentials |
| `CELLD_OTEL_RETENTION` | `30d` | Delete telemetry files older than this; `none` disables deletion |
| `CELLD_OTEL_FLUSH_MS` | `300000` | Write a Parquet file after this many ms of buffered events |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | Write a Parquet file after the buffered events reach this many bytes (whichever is reached first) |
| `OTEL_TRACES_SAMPLER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_SERVICE_NAME` | standard | Standard sampler/exporter settings, `parentbased_always_on` sampler default for the `otlp` sink |

(`docs/telemetry.md:14-31`). The schema is version `v0-unstable`: the column
names can change before a stable release, and each file carries the schema
version in its object metadata (`docs/telemetry.md:12-13`, `crates/celld/telemetry.rs:41-43`).

## How the hot path behaves

Telemetry is observational and does not affect Actor decisions
(`crates/celld/telemetry.rs:3`). The hot path never blocks: `record` is a
`try_send`, a full channel increments a drop counter, and under saturation
celld sheds telemetry — counted, never requests (`crates/celld/telemetry.rs:14-19`).
The pipeline runs on the shared runtime, and encoding runs on `spawn_blocking`

The sample decision is made at trace creation, so an unsampled request builds
nothing (`crates/celld/telemetry.rs:10-12`).

## What celld records

celld records a span for each request a stateless Worker serves, for each event
a cell serves (a fetch, an alarm, an RPC, a WebSocket message), for each
outbound `fetch()`, and for each cell start. A span carries the request id, the
cell, the isolate, the queue wait, the outbound URL and status, and the
durability facts the runtime already knows.

celld also records each `console.log` line as a log record. The log record
carries the trace id and span id of the handler that wrote it, so a query can
join the logs to the traces, and the correlation survives `await`
(`docs/telemetry.md:33-45`).

celld reads the W3C `traceparent` header on incoming requests, so its spans join
the trace of the system in front of it, and it sends a `traceparent` header on
outbound `fetch()`, so downstream systems join too. A Worker call to a Durable
Object stays in one trace (`docs/telemetry.md:46-50`).

## Log body capping

A `console.log` body larger than `LOG_BODY_CAP` (8 KiB) is truncated, because
log records are telemetry, not blob storage, and one runaway line must not
dominate a batch (`crates/celld/telemetry.rs:35-39`).

## Retention

`CELLD_OTEL_RETENTION` (default `30d`) is the age past which celld deletes
telemetry files; `none` leaves them to the operator's own lifecycle rules
(`docs/telemetry.md:23`).
