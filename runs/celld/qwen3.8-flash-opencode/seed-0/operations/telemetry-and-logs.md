---
type: workflow
title: Telemetry and logging
description: celld's observability is optional OTel traces and logs written as Parquet into the fleet bucket (or hand-encoded OTLP), shed before requests; process diagnostics ride a lossy non-blocking tracing pipeline, and the name "node log" belongs to the durability tier, not to logging.
tags: [telemetry, otel, parquet, duckdb, logging, otlp]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T15:57:20.671Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-9150fea3a9cc6cab2f4e834e
    resource: repo://crates/celld/ltx_repl.rs
  - id: openwiki-source-dd008b3e76483e56f5abb247
    resource: repo://crates/celld/main.rs
  - id: openwiki-source-c9d5a7d2423120e1ad1cc2dd
    resource: repo://crates/celld/node_log.rs
  - id: openwiki-source-92f66465a6aff8c7ed82a310
    resource: repo://crates/celld/otlp.rs
  - id: openwiki-source-7134014d54b351dd0584a22d
    resource: repo://crates/celld/telemetry.rs
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-11T15:57:20.671Z" }
---

# Telemetry and logging

> **Terminology warning first.** In celld, "node log" (`crates/celld/node_log.rs`)
> is the fleet durability tier — the replicated write-ahead append that proves
> writes with followers — not an observability stream. See
> [durability and fencing](../concepts/durability-and-fencing.md). This page
> covers the two things that *are* logging: process diagnostics and OTel
> telemetry.

## Process diagnostics

The tracing pipeline is tuned for a serving process: Docker and journald can
stop consuming the pipe during a log burst, so logging uses a lossy
non-blocking writer with an 8,192-line buffer — "Logging must lose diagnostics
under that backpressure rather than block the Tokio workers that route
requests and renew authority"
([crates/celld/main.rs#L3009-L3016](repo://crates/celld/main.rs#L3009-L3016),
[crates/celld/main.rs#L3039-L3044](repo://crates/celld/main.rs#L3039-L3044)).
Where it writes depends on the invocation: a node logs to stdout; a CLI
subcommand sends prose to stderr because stdout carries its data answer
([crates/celld/main.rs#L3012-L3038](repo://crates/celld/main.rs#L3012-L3038),
[crates/celld/cli_output.rs#L9-L12](repo://crates/celld/cli_output.rs#L9-L12)).
The filter is `RUST_LOG` (env-filter), defaulting to `info` — and `celld dev`
without `--logs` forces `error` so the supervisor view stays concise even
under an inherited broad filter ([crates/celld/main.rs#L3017-L3027](repo://crates/celld/main.rs#L3017-L3027)).
ANSI colors follow terminal detection (journald must not receive escapes), and
every exit path runs `exit_flushed`, which drops the non-blocking guard first
so the fence-forensics lines survive the hard
`std::process::exit` ([crates/celld/main.rs#L3046-L3049](repo://crates/celld/main.rs#L3046-L3049),
[crates/celld/main.rs#L59-L61](repo://crates/celld/main.rs#L59-L61)).
Startup also reports whether the allocator agreed to return freed pages on a
timer — the condition behind memory-retention issue #36
([crates/celld/main.rs#L3051-L3056](repo://crates/celld/main.rs#L3051-L3056)).

## OTel telemetry: off by default, off for free

`CELLD_OTEL=1` turns telemetry on; the off state is structural — `init` never
runs, `start_trace` finds no globals and answers `None`, and no event is ever
built; sampling is decided at trace creation for the same reason, so an
unsampled request builds nothing
([crates/celld/telemetry.rs#L5-L19](repo://crates/celld/telemetry.rs#L5-L19),
[docs/telemetry.md#L3-L5](repo://docs/telemetry.md#L3-L5)). The hot path never
blocks: `record` is a `try_send` onto an 8,192-deep channel and a full channel
increments a drop counter — "under saturation celld sheds telemetry,
counted, never requests" ([crates/celld/telemetry.rs#L13-L19](repo://crates/celld/telemetry.rs#L13-L19)).
Encoding runs on `spawn_blocking` on the shared runtime
([crates/celld/telemetry.rs#L16-L19](repo://crates/celld/telemetry.rs#L16-L19)).

### What is recorded

Per [docs/telemetry.md#L33-L59](repo://docs/telemetry.md#L33-L59): a span per
stateless-Worker request, per cell event (fetch, alarm, RPC, WebSocket
message), per outbound `fetch()`, and per cell start — spans carry the request
id, cell, isolate, queue wait, outbound URL/status, and the durability facts
the runtime already knows. Each `console.log` line becomes a log record with
the trace/span id of the handler that wrote it, and the correlation survives
`await`; large bodies are truncated at 8 KiB because "log records are
telemetry, not blob storage" ([crates/celld/telemetry.rs#L35-L39](repo://crates/celld/telemetry.rs#L35-L39)).
W3C `traceparent` is read on ingress and sent on outbound fetch, so celld
joins surrounding traces; a Worker-to-DO call stays one trace. No metrics
signal yet — spans carry the durations, by design
([docs/telemetry.md#L47-L59](repo://docs/telemetry.md#L47-L59)).
Sampling uses the standard `OTEL_TRACES_SAMPLER` (default
`parentbased_always_on`) with `traceidratio` + `OTEL_TRACES_SAMPLER_ARG` for
fractional sampling, and the bucket sink requires a fleet bucket while the
`otlp` sink works without one
([docs/telemetry.md#L26-L31](repo://docs/telemetry.md#L26-L31)).

### Sinks

- **`bucket` (default)** — Parquet objects under `telemetry/traces/…` and
  `telemetry/logs/…` ([crates/celld/telemetry.rs#L30-L33](repo://crates/celld/telemetry.rs#L30-L33)),
  partitioned `telemetry/traces/<node>/<yyyy>/<mm>/<dd>/<hh>/<id>.parquet`
  ([docs/telemetry.md#L87-L90](repo://docs/telemetry.md#L87-L90)). It uses the
  native parquet column-writer only — no `arrow` in the binary
  ([Cargo.toml#L96-L99](repo://Cargo.toml#L96-L99)). The schema is version
  `v0-unstable`, stamped in each object's metadata
  ([crates/celld/telemetry.rs#L41-L44](repo://crates/celld/telemetry.rs#L41-L44),
  [docs/telemetry.md#L12-L14](repo://docs/telemetry.md#L12-L14)). A
  `CELLD_OTEL_BUCKET` may redirect files to another bucket on the same
  endpoint and credentials ([crates/celld/telemetry.rs#L76-L80](repo://crates/celld/telemetry.rs#L76-L80)).
- **`otlp`** — OTLP/HTTP protobuf to `OTEL_EXPORTER_OTLP_ENDPOINT` (default
  `http://localhost:4318`), **hand-encoded**: the emitted messages are a
  small, stable corner of OTLP, and hand coding keeps prost, tonic, and
  generated proto crates out of the binary — "the same trade the Parquet sink
  made by skipping arrow" ([crates/celld/otlp.rs#L3-L11](repo://crates/celld/otlp.rs#L3-L11),
  [docs/telemetry.md#L27](repo://docs/telemetry.md#L27)).

Flushing is a race: one file per flush, on `CELLD_OTEL_FLUSH_MS` (300,000) or
`CELLD_OTEL_FLUSH_BYTES` (5,242,880), whichever arrives first
([crates/celld/telemetry.rs#L91-L97](repo://crates/celld/telemetry.rs#L91-L97),
[crates/celld/telemetry.rs#L185-L195](repo://crates/celld/telemetry.rs#L185-L195),
[docs/telemetry.md#L24-L25](repo://docs/telemetry.md#L24-L25)).
`CELLD_OTEL_RETENTION` (default `30d`; `none` disables deletion) drives a
periodic sweep that deletes the node's old files
([crates/celld/telemetry.rs#L46-L56](repo://crates/celld/telemetry.rs#L46-L56),
[crates/celld/telemetry.rs#L163-L178](repo://crates/celld/telemetry.rs#L163-L178)).

### Querying the bucket with DuckDB

Files are queried directly with DuckDB over httpfs (`read_parquet` over the
partition glob), which is why the time partition exists: a one-day query
touches only that day's files
([docs/telemetry.md#L61-L90](repo://docs/telemetry.md#L61-L90)). Defaults
(5 minutes, 5 MB) suit after-the-fact investigation; a 10 s flush gives a
near-live view but produces many small files that DuckDB must open, so the
documented procedure is to **run the hourly compaction job first, then
shorten the flush** — celld never compacts its own telemetry files, because
the serving path must not do storage maintenance and each node writes only
what it produced ([docs/telemetry.md#L92-L117](repo://docs/telemetry.md#L92-L117)).
Compaction is an external DuckDB `COPY ... FORMAT parquet, COMPRESSION zstd`
over the hour that just ended (never the current hour), with source files
deleted afterward ([docs/telemetry.md#L112-L133](repo://docs/telemetry.md#L112-L133)).

## The `CELLD_LOG_*` knobs are not telemetry

The operator table's `CELLD_LOG_CAPTURE_WORKERS` (default 8) and
`CELLD_LOG_PIPELINE` (default 4) tune the **durability** path, not logging:
pipeline counts in-flight fleet log rounds in the node-log manager
([crates/celld/node_log.rs#L4181](repo://crates/celld/node_log.rs#L4181),
[crates/celld/env_vars.rs#L36-L37](repo://crates/celld/env_vars.rs#L36-L37)),
and capture workers belong to the replication ship loop in the LTX backend
([crates/celld/ltx_repl.rs#L2874-L2876](repo://crates/celld/ltx_repl.rs#L2874-L2876)).
The OTel knobs are the `CELLD_OTEL_*` family above
([docs/telemetry.md#L16-L28](repo://docs/telemetry.md#L16-L28)).

Related: [node operations](node-operations.md) ·
[durability and fencing](../concepts/durability-and-fencing.md) ·
[actor and execution boundary](../architecture/actor-execution.md)
