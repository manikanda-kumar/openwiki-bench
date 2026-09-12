---
type: "Reference"
title: "Telemetry: traces and logs"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:05:17.667Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-11T15:05:17.667Z" }
---


# Telemetry: traces and logs

celld can record traces and logs for the requests it serves. The feature is
off by default, and the off state costs nothing: with `CELLD_OTEL` unset,
`init` never runs, `start_trace` finds no globals and answers `None`, and no
event is ever built (crates/celld/telemetry.rs#L6-L12;
docs/telemetry.md#L3-L5).

The default sink is the fleet bucket: celld writes Parquet files under the
`telemetry/` prefix, so a fleet with a bucket has observability with no other
service, and DuckDB can query the files directly. An alternative sink sends
the same data to an OpenTelemetry collector (docs/telemetry.md#L7-L10). The
schema is version `v0-unstable`, and each file carries the schema version in
its object metadata (docs/telemetry.md#L12-L15;
crates/celld/telemetry.rs#L41-L43).

## Configuration

The `Config` is built once from the environment by `Config::from_env`, which
returns `None` unless `CELLD_OTEL` is set to `1`
(crates/celld/telemetry.rs#L102-L108). The settings (all grounded in
`Config::from_lookup`, crates/celld/telemetry.rs#L110-L209):

- **`CELLD_OTEL_SINK`** — `bucket` (default) writes Parquet to the fleet
  bucket; `otlp` sends OTLP/HTTP protobuf to a collector.
- **`CELLD_OTEL_BUCKET`** — a different bucket for the Parquet files, on the
  same endpoint and credentials.
- **`CELLD_OTEL_RETENTION`** — default `30d`; `none` disables the deletion so
  your own lifecycle rules control the data.
- **`CELLD_OTEL_FLUSH_MS`** — default 300000; celld writes a Parquet file
  after this many milliseconds of buffered events.
- **`CELLD_OTEL_FLUSH_BYTES`** — default 5242880; celld writes a file after
  the buffered events reach this many bytes, using the limit it reaches
  first (Firehose semantics — time or size, whichever first)
  (crates/celld/telemetry.rs#L92-L97).
- **`OTEL_TRACES_SAMPLER`** — default `parentbased_always_on`; the sampler is
  parsed from the standard names, with `traceidratio`/`parentbased_traceidratio`
  requiring `OTEL_TRACES_SAMPLER_ARG` in `[0, 1]`
  (crates/celld/telemetry.rs#L140-L162). A `parentbased_*` sampler defers to
  the caller's sampled flag and decides only for roots, which is an explicit
  statement of upstream trust — appropriate because celld's ingress sits
  behind the operator's own edge (crates/celld/telemetry.rs#L140-L146).
- **`OTEL_EXPORTER_OTLP_ENDPOINT`** — default `http://localhost:4318`; the
  collector base URL for the `otlp` sink, with `/v1/traces` and `/v1/logs`
  appended per the spec's default-port convention
  (crates/celld/telemetry.rs#L80-L83).
- **`OTEL_SERVICE_NAME`** — default `celld`, the service name in the exported
  resource.

The `bucket` sink requires the node to have a fleet bucket (`CELLD_BUCKET`).
The `otlp` sink works on a node without one (docs/telemetry.md#L30-L31).

## What celld records

celld records a span for each request a stateless Worker serves, for each
event a cell serves (a fetch, an alarm, an RPC, a WebSocket message), for
each outbound `fetch()`, and for each cell start. A span carries the request
id, the cell, the isolate, the queue wait, the outbound URL and status, and
the durability facts the runtime already knows (docs/telemetry.md#L35-L42).

celld also records each `console.log` line as a log record. The log record
carries the trace id and the span id of the handler that wrote it, so a query
can join the logs to the traces, and the correlation survives `await`
(docs/telemetry.md#L44-L46). A `console.log` body larger than 8 KiB is
truncated: "log records are telemetry, not blob storage, and one runaway line
must not dominate a batch" (crates/celld/telemetry.rs#L35-L39).

celld reads the W3C `traceparent` header on incoming requests so its spans
join the trace of the system in front of it, and it sends a `traceparent`
header on outbound `fetch()` so downstream systems can join too; a Worker
call to a Durable Object stays in one trace (docs/telemetry.md#L47-L50).

The sampler decides at the start of a request. An unsampled request records
nothing and costs almost nothing. Under load, telemetry sheds before requests
do, and celld counts what it sheds: the hot path never blocks — `record` is a
`try_send`, and a full channel increments a drop counter
(crates/celld/telemetry.rs#L14-L19). The channel capacity is 8192, and
encoding runs on `spawn_blocking` (crates/celld/telemetry.rs#L45-L48).

celld records no metrics yet; the spans carry the durations and the queue
waits, so many questions a metric answers have an answer in the traces, and a
metrics signal can come later without a change to the trace schema
(docs/telemetry.md#L56-L59).

## The bucket sink and DuckDB

The files are partitioned by node and by hour:
`telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet`, and likewise
`telemetry/logs/...`, so a query that reads one day touches only that day's
files (docs/telemetry.md#L87-L89; crates/celld/telemetry.rs#L31-L33).

DuckDB can query the bucket sink directly. An S3-compatible endpoint such as
minio needs `URL_STYLE 'path'` in the secret and `USE_SSL false` for a
plain-HTTP endpoint; AWS itself needs neither. The traces and logs views join
on `trace_id` and `span_id`, so the slowest requests and each log line inside
its writing span are one query each (docs/telemetry.md#L62-L86).

## File size and compaction

celld writes one Parquet file per flush, on the time limit or the size limit,
whichever it reaches first (docs/telemetry.md#L92-L96). Keep the defaults if
you run no compaction job: they make files large enough for a fast query, and
a query sees an event up to 5 minutes after the request. For a near-live
view, set `CELLD_OTEL_FLUSH_MS=10000`, but turn on the compaction job first
or queries grow slow within hours, because DuckDB opens every file a query
reads (docs/telemetry.md#L98-L107).

Run the compaction job on a maintenance node, not on a celld node — "celld
does not compact its own files, because the serving path must not do storage
maintenance and each node writes only the files it produced." The job rewrites
one past hour of small files into one large file with a DuckDB `COPY ... TO
'...' (FORMAT parquet, COMPRESSION zstd)`, run once an hour for the hour that
just ended, and never for the current hour (docs/telemetry.md#L112-L134).

## The OTLP sink

The `otlp` sink sends OTLP/HTTP protobuf to a collector. The encoding is done
by hand in `crates/celld/otlp.rs` because the export messages are a small,
stable corner of the OTLP proto — flat spans and log records with scalar
attributes — and protobuf's wire format is varints and length-delimited
fields; hand encoding keeps prost, tonic, and the generated proto crates out
of the binary, the same trade the Parquet sink made by skipping arrow
(crates/celld/otlp.rs#L3-L11). The `otlp` sink is the other route to a
near-live view: it sends each batch to a collector, so set the same short
`CELLD_OTEL_FLUSH_MS` (docs/telemetry.md#L109-L110).
