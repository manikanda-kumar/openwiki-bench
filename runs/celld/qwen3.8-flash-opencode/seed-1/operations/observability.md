---
type: "Reference"
title: "Observability and Control Plane"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-11T16:58:20.256Z
sources:
  - id: openwiki-source-651d1fb6c9e49916a916ab51
    resource: repo://Cargo.toml
  - id: openwiki-source-7091fbd5baa39fe548c0e34d
    resource: repo://crates/celld/control_plane.rs
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
  - id: openwiki-source-7501e61db97f4591cd581692
    resource: repo://docs/security.md
  - id: openwiki-source-a7c5b70a8439157c87a9ddec
    resource: repo://docs/telemetry.md
generated: { by: "opencode", at: "2026-09-11T16:58:20.256Z" }
---


# Observability and Control Plane

## Node logs and structured events

Node logging is `tracing` with an `EnvFilter` from `RUST_LOG` (default level `info`); celld's own operator-facing command output is separated from node logging by the lint-enforced `Output`/`note!` boundary (crates/celld/main.rs#L3021-L3044, clippy.toml#L84-L86 — see [Operator CLIs](/openwiki/operations/operator-clis.md)). Key events are structured fields rather than prose: for example the overload counter-event `cell_overload_refused` (cell scope, node, region, in-flight count, limit) when a saturated target refuses a request (docs/README.md#L653-L656), `ready_gate_expired` at the readiness deadline (crates/celld/main.rs#L3939), and the `SELF-FENCE:` prefixed exit line (docs/guarantees.md#L220-L224). `celld dev` by default hides node warn/info logs behind its status display and `--logs` reveals them, with errors always visible (docs/README.md#L106-L110).

## Health and state

The public listener's single reserved path `/.well-known/celld/health` answers 503 while the node drains (docs/security.md#L35-L40, docs/README.md#L429-L436). The internal `/state` route answers with `app.snapshot()` during normal serving *and* throughout a drain, reporting handoff and restore counters, the served and draining deployments, moving objects, per-cell generation, and the four memory-pressure inputs (crates/celld/main.rs#L2635, docs/README.md#L504-L505, #L275-L276). `celld diagnose` consumes the peer `/peer/probe` equivalent for fleet-wide reporting (see [Fleet Operations](/openwiki/operations/fleet-operations.md)).

## Telemetry: off, and off-cheap

Wide-event telemetry is "off by default, and off is structural: `init` never runs, `start_trace` finds no globals and answers `None`, and no event is ever built" (crates/celld/telemetry.rs#L8-L12). When `CELLD_OTEL=1` is set, celld records a span per stateless request, per cell event (fetch, alarm, RPC, WebSocket message), per outbound `fetch()`, and per cell start, carrying request id, cell, isolate, queue wait, outbound URL/status, and the durability facts the runtime already knows; the schema is stamped `v0-unstable` on every object (docs/telemetry.md#L28-L40, crates/celld/telemetry.rs#L40-L43).

The hot path never blocks: `record` is a `try_send` into an 8,192-slot channel and "a full channel increments a drop counter. Under saturation celld sheds telemetry, counted, never requests" (crates/celld/telemetry.rs#L14-L16, #L44-L48, #L443-L451). Captured `console.log` lines ride the same pipeline correlated to their trace, truncated at an 8 KiB per-line cap because "log records are telemetry, not blob storage" (crates/celld/telemetry.rs#L31-L39). Capture-worker and pipeline-depth budgets are `CELLD_LOG_CAPTURE_WORKERS` (8) and `CELLD_LOG_PIPELINE` (4) (docs/README.md#L692-L693).

Two sinks, chosen by `CELLD_OTEL_SINK` (docs/telemetry.md#L15-L26):

- **`bucket`** (default; requires a fleet bucket): buffered events become Parquet files under `telemetry/traces` and `telemetry/logs` once either the `CELLD_OTEL_FLUSH_MS` (300 s) or `CELLD_OTEL_FLUSH_BYTES` (5 MiB) trigger fires first, with `CELLD_OTEL_RETENTION` (default 30 days, `none` delegates to bucket lifecycle rules) driving a periodic sweep; DuckDB can query the files directly (crates/celld/telemetry.rs#L29-L70, #L91-L98, #L163-L191, docs/telemetry.md#L7-L26). The writer uses the parquet crate's native column API without arrow, "so the arrow crate stack stays out of the binary" (Cargo.toml#L80-L83).
- **`otlp`** (works bucket-less): OTLP/HTTP protobuf to a collector (`OTEL_EXPORTER_OTLP_ENDPOINT`, default `http://localhost:4318`) encoded **by hand** — "varints and length-delimited fields" for a small stable corner of the proto — keeping prost, tonic, and generated crates out of the binary, with field numbers following opentelemetry-proto v1 (crates/celld/otlp.rs#L3-L14, docs/telemetry.md#L23-L26).

Sampling is decided at trace creation so an unsampled request builds nothing, honoring the standard `OTEL_TRACES_SAMPLER` (`parentbased_always_on` default; `traceidratio` + `OTEL_TRACES_SAMPLER_ARG`) (crates/celld/telemetry.rs#L11-L12, docs/telemetry.md#L22).

## The managed control plane (alpha)

`celld connect` / `token` / `credentials` / `disconnect` (CLI actions in crates/celld/main/cli.rs#L78-L87) attach the fleet to the celld.dev managed service (default URL `https://celld.dev`): a stored installation credential, a short-lived deploy token rendered as ready-to-run commands, credential staging/refresh with rotation validated before it is accepted, and revocation on disconnect (crates/celld/control_plane.rs#L25, #L392-L511, #L527-L642, #L701). While connected, a presence agent keeps a WebSocket session that streams presence snapshots (bounded at 50 cells, 200-byte ids) and serves `explorer_request` messages — bounded read-only peeks at resident cells' tables (≤100 tables × 32 columns × 25 rows, 2 KiB values, 96 KiB responses) — so a dashboard can inspect a fleet without extra exposure (crates/celld/control_plane.rs#L26-L36, #L793-L1180). Managed deployment adoption reuses the same generation pipeline; the legacy "replace the process image" cut is behind `CELLD_CLOUD_RESTART_ON_DEPLOY` and off by default because it "would exec-restart and cold-restore every resident cell" (crates/celld/control_plane.rs#L38-L49). Runtime state transitions are reported with structured `managed_runtime_state` events, and losing control-plane connectivity never stops bucket-backed serving (crates/celld/control_plane.rs#L145-L182). Treat the alpha boundary as alpha: celld's docs warn operator APIs "can change on a release" (docs/README.md#L546-L551), and the limitations page notes the managed path's current scope (docs/limitations.md).

Related: [Node Runtime and Actor Loop](/openwiki/architecture/node-runtime.md), [Listeners and Peer Networking](/openwiki/concepts/networking-peers.md), [Fleet Operations](/openwiki/operations/fleet-operations.md), [Operator CLIs](/openwiki/operations/operator-clis.md).
