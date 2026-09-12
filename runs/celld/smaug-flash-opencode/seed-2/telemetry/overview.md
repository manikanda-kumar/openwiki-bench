---
type: "Reference"
title: "Telemetry: traces and logs to the bucket or OTLP"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:45:00.837Z
sources:
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-12T21:45:00.837Z" }
---


# Telemetry: traces and logs to the bucket or OTLP

celld can record traces and logs for the requests it serves. The feature is off
by default)Skip and the off state costs nothing. Set `CELLD_OTEL=1` to turn it on
(`docs/telemetry.md:3-5`).

## Configuration

The telemetry settings (`docs/telemetry.md:18-28`):

| variable | default | effect |
| --- | --- | --- |
| `CELLD_OTEL` | `0` | `1` enables telemetry. |
| `CELLD_OTEL_SINK` | `bucket` | `bucket` writes Parquet to the fleet bucket; `otlp` sends OTLP/HTTP protobuf to a collector. |
| `CELLD_OTEL_BUCKET` | the fleet bucket | A different bucket for the Parquet files, same endpoint/credentials. |
| `CELLD_OTEL_RETENTION` | `30d` | Delete telemetry files older than this; `none` disables. |
| `CELLD_OTEL_FLUSH_MS` | `300000` | Write a Parquet file after this many ms of buffered events. |
| `CELLD_OTEL_FLUSH_BYTES` | `5242880` | Write a Parquet file after the buffered events reach this many bytes. |
| `OTEL_TRACES_SAMPLER` | `parentbased_always_on` | The sampler name. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | The collector base URL for the `otlp` sink. |

The `bucket` sink requires a fleet bucket; the `otlp` sink works on a node
without one (`docs/telemetry.md:30-31`).

## What celld records

celld records a span for each request a stateless Worker serves, for each event
a cell serves (a fetch, an alarm, an RPC, a WebSocket message), for each
outbound `fetch()`, and for each cell start. A span carries the request id, the
cell, the isolate, the queue wait, the outbound URL and status, and durability
facts (`docs/telemetry.md:35-40`). Each `console.log` line is recorded as a log
record carrying the trace id and span id of the handler that wrote it, so a
query can join logs to traces across `await` (`docs/telemetry.md:41-45`).

celld reads the W3C `traceparent` header on incoming requests so spans join the
fronting system's trace, and sends a `traceparent` header on outbound
`fetch()` (`docs/telemetry.md:47-50`).

## Sampling

The sampler decides at the start of a request. An unsampled request records
nothing and costs almost nothing; under load telemetry sheds before requests
do, and celld counts what it sheds (`docs/telemetry.md:52-54`). `init` never
runs when off, `start_trace` finds no globals and answers `None`, and no
event is ever built (`crates/celld/telemetry.rs:9-12`).

## Bucket sink: Parquet

The default sink writes Parquet files under the `telemetry/` prefix
(`TRACES_PREFIX`/`LOGS_PREFIX`, `crates/celld/telemetry.rs:31-33`), partitioned
by node and by hour: `telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet`
(`docs/telemetry.md:7-9`, `docs/telemetry.md:87-89`). The schema is version
`v0-unstable` and each file carries the schema version in its object metadata
(`docs/telemetry.md:12-13`).

The hot path never blocks: `record` is a `try_send`, and a full channel
increments a drop counter. Under saturation celld sheds telemetry, counted,
never requests (`crates/celld/telemetry.rs:14-19`). The queue capacity is 8192.

## OTLP sink

The `otlp` sink sends OTLP/HTTP protobuf to a collector. The OTLP export
messages are hand-encoded in `crates/celld/otlp.rs` to keep prost/tonic and the
generated proto crates out of the binary — the same trade the Parquet sink made
by skipping arrow (`crates/celld/otlp.rs:3-11`).

## The DuckDB query workflow

```sql
INSTALL httpfs; LOAD httpfs;
CREATE SECRET celld_telemetry (
  TYPE s3, KEY_ID '...', SECRET '...',
  ENDPOINT 's3.example.com', URL_STYLE 'path'
);
CREATE VIEW traces AS SELECT * FROM
  read_parquet('s3://YOUR-BUCKET/telemetry/traces/*/*/*/*/*/*.parquet');
CREATE VIEW logs AS SELECT * FROM
  read_parquet('s3://YOUR-BUCKET/telemetry/logs/*/*/*/*/*/*.parquet');
```

An S3-compatible endpoint typically needs `URL_STYLE 'path'`; AWS itself does
not (`docs/telemetry.md:83-85`). Because files are partitioned by node and
hour, a query that reads one day touches only that day's files
(`docs/telemetry.md:87-89`).

## Flush and compaction

celld writes one Parquet file per flush, on the time or size limit whichever it
reaches first (`CELLD_OTEL_FLUSH_MS` 5 min, `CELLD_OTEL_FLUSH_BYTES` 5 MB).
Keep the defaults if you run no compaction job. A short flush (e.g. 10000 ms)
gives a near-live view but makes many small files, and DuckDB opens every
file a query reads, so run the compaction job first
(`docs/telemetry.md:93-110`).

Run the compaction job on a maintenance node, not a celld node: celld does not
compact its own files. DuckDB rewrites one past hour of small files into one
large sorted zstd-compressed file (`docs/telemetry.md:112-134`). Do not compact
the current hour, because a node still writes to it.

---

## Related pages

- [Operating a fleet: CLI, diagnostics, and memory pressure](/openwiki/operations/operating-a-fleet.md)
- [Change guides: representative maintenance tasks](/openwiki/operations/change-guides.md)
