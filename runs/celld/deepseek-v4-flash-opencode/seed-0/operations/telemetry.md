---
type: operations
title: Telemetry and Node Logging
description: How celld reports what it is doing — the tracing stdout process log, the off-by-default OpenTelemetry telemetry with its Parquet bucket sink and OTLP collector sink, retention and compaction, and the span/log schema.
tags: [telemetry, tracing, otel, parquet, otlp, logging]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T14:20:08.241Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-11T14:20:08.241Z" }
---

# Telemetry and Node Logging

celld has two distinct reporting surfaces. The **process log** is the
node's tracing output on stdout — Docker and journald read it, and a node
fences itself with a `SELF-FENCE:` line that names the cause
(docs/guarantees.md#L220-L223). The **telemetry** feature records traces
and logs for the requests it serves and is off by default.

## Telemetry is off unless enabled

`CELLD_OTEL=1` turns telemetry on. The off state is structural: `init`
never runs, `start_trace` finds no globals and answers `None`, and no
event is ever built. Sampling is decided at trace creation for the same
reason — an unsampled request builds nothing (crates/celld/telemetry.rs#L6-L12).

The hot path never blocks: `record` is a `try_send`, and a full channel
increments a drop counter. Under saturation celld sheds telemetry,
counted, never requests (crates/celld/telemetry.rs#L14-L19). Under load,
telemetry sheds before requests do (docs/telemetry.md#L54-L55).

## Sinks

- **Bucket sink** (default): writes Parquet files under the
  `telemetry/traces` and `telemetry/logs` prefixes of the fleet bucket —
  `telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet` — so a
  fleet with a bucket has observability with no other service, and DuckDB
  can query the files directly (docs/telemetry.md#L6-L10,
  crates/celld/telemetry.rs#L31-L33).
- **OTLP sink** (`CELLD_OTEL_SINK=otlp`): sends the same data as
  OTLP/HTTP protobuf to a collector. The encoding is written by hand —
  the exported messages are flat spans and log records with scalar
  attributes — which keeps prost, tonic, and the generated proto crates
  out of the binary, the same trade the Parquet sink made by skipping
  arrow (crates/celld/otlp.rs#L3-L11).

The schema is version `v0-unstable`: the column names can change before a
stable release, and each file carries the schema version in its object
metadata (crates/celld/telemetry.rs#L41-L43, docs/telemetry.md#L12-L14).

## What celld records

celld records a span for each request a stateless Worker serves, for each
event a cell serves (a fetch, an alarm, an RPC, a WebSocket message), for
each outbound `fetch()`, and for each cell start. A span carries the
request id, the cell, the isolate, the queue wait, the outbound URL and
status, and the durability facts the runtime already knows
(docs/telemetry.md#L34-L40).

Each `console.log` line is recorded as a log record carrying the trace id
and span id of the handler that wrote it, so a query can join the logs to
the traces; the correlation survives `await`. celld reads the W3C
`traceparent` header on incoming requests so its spans join the trace of
the system in front of it, sends a `traceparent` header on outbound
`fetch()`, and keeps a Worker call to a Durable Object in one trace
(docs/telemetry.md#L42-L50). A `console.log` body larger than 8 KiB is
truncated, because log records are telemetry, not blob storage
(crates/celld/telemetry.rs#L35-L39).

celld records no metrics yet; the spans carry the durations and the queue
waits, and a metrics signal can come later without a change to the trace
schema (docs/telemetry.md#L56-L59).

## Configuration

| variable | default | effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | `1` enables telemetry |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` writes Parquet to the fleet bucket; `otlp` sends OTLP/HTTP protobuf to a collector |
| `CELLD_OTEL_BUCKET` | the fleet bucket | a different bucket for the Parquet files, on the same endpoint and credentials |
| `CELLD_OTEL_RETENTION` | `30d` | celld deletes telemetry files older than this; `none` disables the deletion |
| `CELLD_OTEL_FLUSH_MS` | `300000` | celld writes a Parquet file after this many milliseconds of buffered events |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | celld writes a Parquet file after the buffered events reach this many bytes |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | a standard sampler name; `traceidratio` records a fraction of traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | the collector base URL for the `otlp` sink |

The `bucket` sink requires the node to have a fleet bucket; the `otlp`
sink works without one (docs/telemetry.md#L18-L31).

## File size and compaction

celld writes one Parquet file per flush, on whichever of the time limit
and the size limit is reached first. The defaults (5 minutes, 5 MB) make
files large enough for a fast query with no other moving part, and a
query sees an event up to 5 minutes after the request. A near-live view
uses `CELLD_OTEL_FLUSH_MS=10000`, which makes many small files, so you
must also run the compaction job described in
docs/telemetry.md#L112-L134: a maintenance node rewrites one past hour of
small files into one large, zstd-compressed file with DuckDB, and celld
never compacts its own files because the serving path must not do storage
maintenance (docs/telemetry.md#L91-L111).

## The fleet log tier

The **node log** is also the name of the fleet durability tier's
write-ahead log (`log/<node>.json`, the CAS-guarded root of truth for the
follower ensemble); it is a replication mechanism, not telemetry, and is
covered on the durability page. Its structured events flow through the
same tracing logger as the rest of the process, and `RUST_LOG` filters the
process log (docs/README.md#L701).
