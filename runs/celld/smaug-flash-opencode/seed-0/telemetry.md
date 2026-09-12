---
type: telemetry
title: Telemetry and Observability
description: The optional telemetry system — Parquet-to-bucket and OTLP sinks, the span/log schema, trace correlation, file partitioning, compaction, DuckDB querying, and configuration.
tags: [telemetry, observability, otlp, parquet, tracing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:30:17.310Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-12T21:30:17.310Z" }
---

# Telemetry and Observability

celld can record traces and logs for the requests it serves. The feature is **off
by default, and the off state costs nothing** — `init` never runs, `start_trace`
finds no globals and answers `None`, and no event is ever built
(`crates/celld/telemetry.rs`). Set `CELLD_OTEL=1` to turn it on.

There are two sinks:

- **`bucket`** (default) — writes Parquet files under the `telemetry/` prefix
  of a bucket, queryable directly by DuckDB. Requires the node to have a fleet
  bucket (`CELLD_BUCKET`).
- **`otlp`** — sends OTLP/HTTP protobuf to a collector. Works on a node without
  a fleet bucket.

The schema is version `v0-unstable`, and each file carries the schema version in
its object metadata; column names can change before a stable release.

## Configuration

| variable | default | effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | `1` enables telemetry. |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` writes Parquet to the fleet bucket; `otlp` sends OTLP/HTTP to a collector. |
| `CELLD_OTEL_BUCKET` | the fleet bucket | A different bucket for Parquet, on the same endpoint and credentials. |
| `CELLD_OTEL_RETENTION` | `30d` | deletes telemetry files older than this; `none` disables. |
| `CELLD_OTEL_FLUSH_MS` | `300000` | writes a Parquet file after this many ms of buffered events. |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | writes a Parquet file after this many bytes; the limit reached first wins. |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | standard sampler name; `traceidratio` + `OTEL_TRACES_SAMPLER_ARG` samples a fraction. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | collector base URL for the `otlp` sink. |
| `OTEL_SERVICE_NAME` | `celld` | service name in the exported resource. |

(`docs/telemetry.md` lines 16-34.)

## What celld records

celld records a span for (`docs/telemetry.md` lines 35-58):

- each fetch event a stateless Worker serves;
- each event a cell serves (fetch, alarm, RPC, WebSocket message);
- each outbound `fetch()`;
- each cell start.

A span carries the request id, the cell, the isolate, the queue wait, the
outbound URL and status, and "the durability facts the runtime already knows".

Each `console.log` line is recorded as a log record carrying the trace id and
span id of the handler that wrote it, so "a query can join the logs to the
traces. The correlation survives `await`."

celld reads the W3C `traceparent` header on incoming requests so its spans join
the trace of the system in front of it, and it sends `traceparent` on outbound
`fetch()` so downstream systems join too. A Worker call to a Durable Object
stays in one trace. An unsampled request records nothing and "costs almost
nothing"; under load telemetry sheds before requests do, and celld counts what
it sheds.

celld records no metrics yet: "the spans carry the durations and the queue
waits, so many questions a metric answers have an answer in the traces, and a
metrics signal can come later without a change to the trace schema" (lines
56-59).

## The hot path never blocks

The telemetry pipeline is deliberately non-blocking: `record` is a `try_send`;
a full channel increments a drop counter. "Under saturation celld sheds
telemetry, counted, never requests" (`crates/celld/telemetry.rs`). Encoding runs
on `spawn_blocking`.

## Parquet layout, partitioning, and compaction

Files are partitioned by node and hour
(`docs/telemetry.md` lines 87-89):

```
telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet
telemetry/logs/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet
```

A query that reads one day touches only that day's files.

celld writes one Parquet file per flush, on the time or size limit "whichever
it reaches first". The defaults (5 minutes, 5 MB) keep files large enough for a
fast query with no other moving part, and a query sees an event up to 5
minutes after the request (lines 93-107). For a near-live view either shorten
`CELLD_OTEL_FLUSH_MS=10000` (and run the compaction job) or use the `otlp` sink
with the same short flush.

celld does not compact its own files "because the serving path must not do
storage maintenance and each node writes only the files it produced"
(lines 112-120). Run the compaction job on a maintenance node: rewrite one past
hour of small files into one large sorted zstd file per node/hour, then delete
the sources. Never compact the current hour, because a node still writes to
it. "It is also smaller, because zstd compresses one sorted batch better than
many separate files" (lines 128-134).

## Query the bucket with DuckDB

The example in `docs/telemetry.md` (lines 65-84) uses the `httpfs` extension
with a secret for the S3-compatible endpoint:

```sql
INSTALL httpfs; LOAD httpfs;
CREATE SECRET celld_telemetry (
  TYPE s3, KEY_ID '...', SECRET '...',
  ENDPOINT 's3.example.com', URL_STYLE 'path'
);
SELECT name, duration_us, trace_id FROM traces
  ORDER BY duration_us DESC LIMIT 20;
-- join logs to traces:
SELECT l.body, t.name, t.duration_us FROM logs l
  JOIN traces t ON l.trace_id = t.trace_id AND l.span_id = t.span_id;
```

An S3-compatible endpoint such as minio needs `URL_STYLE 'path'` in the secret;
a plain-HTTP endpoint also needs `USE_SSL false`; AWS itself needs neither
(lines 82-85). `CREATE VIEW traces AS SELECT * FROM
read_parquet('s3://.../telemetry/traces/*/*/*/*/*/*.parquet')`.

## The OTLP sink

`crates/celld/otlp.rs` implements OTLP/HTTP protobuf encoding by hand. "The
export messages celld emits are a small, stable corner of the OTLP proto —
flat spans and log records with scalar attributes — and protobuf's wire format
is varints and length-delimited fields. Hand encoding keeps prost, tonic, and
the generated proto crates out of the binary" (`crates/celld/otlp.rs` lines
8-16). Field numbers follow opentelemetry-proto v1.
