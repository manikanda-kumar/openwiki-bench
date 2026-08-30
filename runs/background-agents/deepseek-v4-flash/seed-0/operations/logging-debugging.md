---
type: operations-guide
title: Logging, Correlation, and Debugging
description: How Open-Inspect services emit flat JSON logs with a common envelope (level, service, component, msg, ts), how canonical correlation IDs (trace_id, request_id, session_id, message_id, sandbox_id) are generated and propagated across slack-bot → control-plane → modal-infra → sandbox via x-* headers, the event catalog for querying, redaction rules, and the cf-logs worker-log query tool.
tags: [logging, correlation, debugging, observability, structured-logs, cloudflare-workers, trace-id, event-catalog]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-d4172c6666b1ca56f4a28bb0
    resource: repo://docs/DEBUGGING_PLAYBOOK.md
  - id: openwiki-source-6742148b866ee5c7b9533092
    resource: repo://packages/control-plane/src/db/instrumented-d1.ts
  - id: openwiki-source-bb4971132a91d2f43607be8b
    resource: repo://packages/control-plane/src/image-builds/finalization-consumer.ts
  - id: openwiki-source-c17bbe00abbcf37cbd7991f3
    resource: repo://packages/control-plane/src/image-builds/scheduler.ts
  - id: openwiki-source-d67978cdb180862cca3ffb24
    resource: repo://packages/control-plane/src/image-builds/workflow.ts
  - id: openwiki-source-d16c987124fdfadaa298d4c3
    resource: repo://packages/control-plane/src/logger.ts
  - id: openwiki-source-9175ccc37c339f0a3dfd984e
    resource: repo://packages/control-plane/src/router.ts
  - id: openwiki-source-0339083ae2c7a7f44eacd1b4
    resource: repo://packages/control-plane/src/sandbox/client.ts
  - id: openwiki-source-02d8401c91a4f2936e65eb0b
    resource: repo://packages/control-plane/src/sandbox/daytona-rest-client.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-b65fcbada0565b3a9eeca4db
    resource: repo://packages/control-plane/src/sandbox/providers/vercel/client.ts
  - id: openwiki-source-fba1dc72858ac1184df12fe6
    resource: repo://packages/control-plane/src/session/callback-notification-service.ts
  - id: openwiki-source-e3a0ae08e1f115f1cd7e107f
    resource: repo://packages/control-plane/src/session/connection-authenticator.ts
  - id: openwiki-source-931813438ca2f322802ec305
    resource: repo://packages/control-plane/src/session/http/dispatcher.ts
  - id: openwiki-source-2b1bf4f8f99c4524f76af605
    resource: repo://packages/control-plane/src/session/linear-start-callback.ts
  - id: openwiki-source-1d490fe5af2ebc3cd9c8300b
    resource: repo://packages/control-plane/src/session/message-queue.ts
  - id: openwiki-source-ceac3551ab349e518118540c
    resource: repo://packages/control-plane/src/session/runtime-client.ts
  - id: openwiki-source-9dfd7604326bc3d611e2b027
    resource: repo://packages/control-plane/src/session/sandbox-events/execution.handler.ts
  - id: openwiki-source-f5e4e8bcb5be7ab46f3ee66f
    resource: repo://packages/control-plane/src/session/session-logger.ts
  - id: openwiki-source-b80d9164d7c56eae749ac94b
    resource: repo://packages/control-plane/src/session/websocket-manager.ts
  - id: openwiki-source-258b56de085088c4e2e10662
    resource: repo://packages/modal-infra/src/sandbox/manager.py
  - id: openwiki-source-4f606005c64e373cdd655a89
    resource: repo://packages/modal-infra/src/web_api.py
  - id: openwiki-source-cbd064f0f85a511828117a62
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/bridge.py
  - id: openwiki-source-b5f0c29f69ff64079cdc20a4
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/entrypoint.py
  - id: openwiki-source-196d7b38651e428e98fef8cd
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/log_config.py
  - id: openwiki-source-cac68f5ceb0de1d13a1a4cf1
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repository_sync.py
  - id: openwiki-source-ba7b9750316811e45cbd444c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/supervisor.py
  - id: openwiki-source-1669ed9d0aafe9214762e96c
    resource: repo://packages/shared/src/logger.ts
  - id: openwiki-source-5856d6dafe718ec27f678566
    resource: repo://packages/shared/src/service-auth.ts
  - id: openwiki-source-569acecef185837a6fd89803
    resource: repo://packages/slack-bot/src/events/message-handler.ts
  - id: openwiki-source-4a6099fefd192bb6aaf8b8e8
    resource: repo://packages/slack-bot/src/logger.ts
  - id: openwiki-source-5859dda156579909472ad28d
    resource: repo://packages/slack-bot/src/routes/events.ts
  - id: openwiki-source-afa17564be8e22fec0fc9e87
    resource: repo://packages/slack-bot/src/sessions/control-plane-client.ts
  - id: openwiki-source-f92a272da85b38851895803e
    resource: repo://packages/web/src/lib/control-plane-service.ts
  - id: openwiki-source-824b9306fe61937fbc6a11b0
    resource: repo://packages/web/src/lib/logger.ts
  - id: openwiki-source-ca23976a896df219124c8d52
    resource: repo://packages/web/src/lib/request-context.ts
  - id: openwiki-source-703e3680e2354a3d849dfd79
    resource: repo://packages/web/src/lib/request-correlation.ts
  - id: openwiki-source-6a2c91e451aa61a9e471755d
    resource: repo://packages/web/src/middleware.test.ts
  - id: openwiki-source-d7e6a478e9486ede6520f81b
    resource: repo://packages/web/src/middleware.ts
  - id: openwiki-source-d891859c5e5b394a5a032cb6
    resource: repo://scripts/cf-logs.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Logging, Correlation, and Debugging

Every Open-Inspect service emits flat JSON lines with a common envelope. Use the `msg` field — a **stable event identifier**, not free-form text — for querying, and the correlation fields (`trace_id`, `session_id`, `message_id`, `sandbox_id`, `request_id`) for joining events across service boundaries. This page is the operational reference for reading those logs, tracing a prompt run end-to-end, and querying Cloudflare Worker logs with `cf-logs`.

A prompt run crosses **slack-bot → control-plane → modal-infra → sandbox** (Modal example); the trace path for web-driven sessions is **web → control-plane → SessionDO → sandbox**. Join on `trace_id` from the entry edge, or narrow to a specific run with `session_id` + `message_id`.

## Common log envelope

The shared TypeScript logger (`@open-inspect/shared/logger`) defines the envelope for the Cloudflare Worker services — `web`, `control-plane`, `slack-bot`, and the other bot workers. The Python sandbox runtime (`sandbox_runtime/log_config.py`) emits the same shape for `modal-infra` and the in-sandbox supervisor/bridge.

| Field       | Type   | Description                                                              |
| ----------- | ------ | ------------------------------------------------------------------------ |
| `level`     | string | `debug` \| `info` \| `warn` \| `error`                                   |
| `service`   | string | `web` \| `control-plane` \| `modal-infra` \| `slack-bot` (and bot workers) |
| `component` | string | Sub-area (e.g. `router`, `session-do`, `bridge`, `supervisor`, `handler`) |
| `msg`       | string | Stable event identifier for querying (e.g. `prompt.enqueue`)            |
| `ts`        | number | Epoch milliseconds                                                        |

Logger-owned keys (`level`, `component`, `msg`, `ts`, `service`) are reserved: context and per-call data can never overwrite them (`packages/shared/src/logger.ts` strips them with `stripReserved` before merging). Other fields merge in the order base context → child context → per-call data, later values winning. `error` values are normalized into `error_message` / `error_stack` / `error_type` (and `error_code` when the error carries a string `code`) at emit time. `JSON.stringify` is wrapped in try/catch; an unserializable line degrades to a guaranteed `LOG_SERIALIZE_FAILURE` event so the log is never lost.

The TypeScript logger routes severity to console methods so Cloudflare Workers Logs and external tooling see the right severity: `debug`/`info` → `console.log`, `warn` → `console.warn`, `error` → `console.error`. `parseLogLevel(process.env.LOG_LEVEL)` turns the `LOG_LEVEL` env var into the minimum emitted level, defaulting to `info`.

The Python side (`JSONFormatter`) writes `event` in the same slot the TypeScript logger names `msg` — the runtime uses `event` as its call-site kwarg and `msg` as the standard-logging attrs name, so the resulting `event`/`msg` field is the stable identifier both ways. `configure_logging()` replaces the root handler with a single JSON `StreamHandler(sys.stdout)`; third-party library logs (httpx, websockets) flow through the same pipeline. Python exceptions are normalized into the same `error_type` / `error_message` / `error_stack` fields used by the TS services.

## Correlation fields and canonical naming

| Field                 | Scope               | Generated by                                      |
| --------------------- | ------------------- | ------------------------------------------------- |
| `trace_id`            | Cross-service       | Router / slack-bot edge (entry edge)              |
| `request_id`          | Single HTTP hop     | Each boundary independently                       |
| `session_id`          | Session lifetime    | Control plane on session create                   |
| `message_id`          | Single prompt run   | Control plane on enqueue (`message-queue.ts`)     |
| `sandbox_id`          | Sandbox lifetime    | Sandbox backend on create/restore                 |
| `opencode_session_id` | OpenCode process    | Sandbox supervisor on ensure                      |

**Canonical naming rule:** correlation keys are snake_case everywhere outside local in-memory variables — in logs (`trace_id`), in HTTP headers (`x-trace-id`, `x-request-id`, `x-session-id`, `x-sandbox-id`), and in provider/client correlation objects (`correlation.trace_id`). If a module uses camelCase internally, convert once at the boundary and keep the rest of the path canonical; never mix `traceId`/`requestId` with `trace_id`/`request_id` within the same boundary.

### Header propagation and boundary conversion

The web service (`packages/web`) is the reference for the boundary conversion:

- `middleware.ts` runs on `/api/:path*`: it resolves the inbound `x-trace-id` (validating `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/`, else generating a fresh UUID), generates a fresh hop-local 8-character `x-request-id` (discarding any inbound `x-request-id`), sets `x-open-inspect-request-id` for downstream internal use, and stamps both `x-trace-id` and `x-request-id` on the response.
- Route code reads correlation via `request-context.ts`, which resolves `traceId` from `x-trace-id` and `requestId` from `x-open-inspect-request-id` (the internal hop id the middleware minted). `getCorrelationLogFields` converts the camelCase pair to `trace_id` / `request_id` for log lines; `applyCorrelationHeaders` writes the wire headers.
- Web → control-plane calls (`control-plane-service.ts` via `buildServiceAuthHeaders` in `@open-inspect/shared/service-auth`) forward only `x-trace-id` alongside the sig1 auth headers; the control plane still generates its own per-hop `request_id`.
- The control-plane router (`router.ts`) accepts `x-trace-id` (fresh UUID fallback) and mints an 8-char `request_id` per request, storing both in `RequestContext`; every response carries `x-request-id` and `x-trace-id` plus CORS (also on CORS preflights and errors).
- The router → SessionDO hop (`session/runtime-client.ts`) copies `x-trace-id` and `x-request-id` onto every internal DO request. Inside the DO, `session/http/dispatcher.ts` builds a per-request child logger from those headers (`session_log.child({ trace_id, request_id })`) without mutating the session-level logger, so later callbacks keep their own hop ids.
- Control-plane → provider calls: the Modal client (`sandbox/client.ts`) writes `x-trace-id` / `x-request-id` / `x-session-id` / `x-sandbox-id` on every sandbox API call; the Vercel provider client forwards `x-trace-id`.
- Modal's FastAPI endpoints (`modal-infra/src/web_api.py`) accept `x_trace_id`, `x_request_id`, `x_session_id`, `x_sandbox_id` headers and stamp them onto the `modal.http_request` wide event — joining control-plane and sandbox-side logs for the same sandbox.

The sandbox runtime's bridge connects to `wss://{control_plane}/sessions/{session_id}/ws?type=sandbox` with `Authorization: Bearer {sandbox_token}` and `X-Sandbox-ID`; the `sandbox_id` is the join key on sandbox-side events, while `session_id` is baked into the supervisor logger context at boot (`entrypoint.py` binds `service=sandbox`, `sandbox_id`, `session_id`).

### Joining across services

The canonical prompt-run trace, for Slack + Modal:

1. **slack-bot** generates `trace_id` and sends it as `x-trace-id` on `control_plane.create_session` / `control_plane.send_prompt`.
2. **control-plane** router propagates `trace_id` into the SessionDO and provider calls; the DO's `prompt.enqueue` mints `message_id`.
3. **modal-infra** binds the same trace to sandbox startup where supported (`x-trace-id` headers → `modal.http_request`), and the sandbox runtime logs join on `sandbox_id` / `session_id`.

Filter by `trace_id` across all services, or narrow by `session_id` + `message_id` for one specific prompt run.

## Error shape and outcome convention

All services use the same error fields: `error_type` (error class name, e.g. `TimeoutError`), `error_message`, `error_stack` (error level only, truncated), `error_code` (when applicable). Python normalizes `exc=` into the same field names.

Wide events classify results with `outcome`:

- `success` — completed normally
- `error` — failed with an error
- `rejected` — denied before processing (auth, validation)
- `timeout` — timed out
- `cancelled` — cancelled by caller

## Event catalog

The authoritative catalog lives in `docs/DEBUGGING_PLAYBOOK.md`; the important events are summarized below. All events carry `trace_id` / `request_id` where the correlation context exists at the call site.

### Control plane (`service: "control-plane"`)

**Router (`component: "router"`)** — `http.request` (info/error): one per incoming HTTP request with `http_method`, `http_path`, `http_status`, `duration_ms`, `outcome`, plus the D1 metrics summary (`d1_query_count`, `d1_total_ms`, `d1_server_total_ms`, `d1_rows_read`, `d1_rows_written`) spread from `RequestMetrics.summarize()`. `auth.principal` records who acted (never token material). Handler errors outside `HttpError` are the only 500 path that logs inside the router.

**Session DO (`component: "session-do"`)** — `do.request` (one per internal DO route call), `ws.connect` (info/warn: sandbox/client WebSocket lifecycle with `reject_reason` — `sandbox_id_mismatch`, `token_mismatch`, `session_terminal`, `sandbox_stopped`; success emits `replaced_existing`), and the prompt-run trio:

- `prompt.enqueue` (info, warn) — `message_id`, `source`, `author_id`, `user_id`, `model`, `content_length`, `has_attachments`, `queue_position`; `outcome` is `enqueued` | `deduplicated` | `conflict` (clientRequestId fingerprint mismatch) | `rejected` (`queue_full`).
- `prompt.dispatch` (info) — `message_id`, `outcome` (`sent` | `deferred` | `send_failed`), `reason` (`no_sandbox`), `has_sandbox_ws`, `queue_wait_ms`, `sandbox_ready_state`.
- `prompt.complete` (info, warn) — emitted from the `execution_complete` sandbox event handler with `message_id`, `outcome` (`success` | `failure` | `already_stopped`), `total_duration_ms`, `processing_duration_ms`, `queue_duration_ms`.

`callback.complete_delivery` / `callback.started_delivery` (info/error, per-attempt `*_attempt_failed` warn) cover the completion and linear start-callback deliveries with `session_id`, `message_id`, `source`, `outcome`, `attempts`, `retries`, `http_status`, `reject_reason`.

**Lifecycle manager (`component: "lifecycle-manager"`)** — terminal wide events (dashboards must use these; the legacy `sandbox.spawned` / `spawn_failed` / `restored` names are retired):

- `sandbox.spawn` (info/error) — `outcome`, `duration_ms`, `sandbox_id`, `expected_sandbox_id`, `provider_object_id`, `repo_owner`, `repo_name`, `error`.
- `sandbox.restore` (info/error) — `outcome`, `duration_ms`, `snapshot_image_id`, `sandbox_id`, `provider_object_id`, `error`.
- `sandbox.snapshot` / `sandbox.snapshot_saved` (info), `sandbox.heartbeat_stale` (warn), `sandbox.timeout` (info). A `sandbox.spawn_superseded` warn means the attempt was abandoned because a newer spawn won.

**Provider clients** — `modal.request` (info, per control-plane → Modal call: `endpoint`, `session_id`, `sandbox_id`, `http_status`, `duration_ms`, `outcome`), `vercel_sandbox.request`, `daytona.create_sandbox` (info: `sandbox_id`/`sandbox_name`, `target`, `duration_ms`, `outcome`).

**Image builds** — one `image_build.*` vocabulary across `component: "image-builds:*"` and `"router:image-builds"`, with `scope_kind` (`repo` | `environment`) and `scope_id`: `image_build.build_triggered`, `build_complete_received`, `build_failed`, `callback_auth_failed` (warn), `finalization_job_invalid` (error), `finalization_error` (error, retries exhaust to the DLQ), `scheduler_tick` (info) plus the scheduler phase warnings, `trigger_error` / `trigger_mark_failed_error`, `late_artifact_recorded`, `save_hook_trigger(_failed)`, `secrets_change_superseded`, `toggle`, `cleanup` / `stale_marked`.

### Modal infra (`service: "modal-infra"`) and sandbox runtime (`service: "sandbox"`)

**API (`component: "api"` / `web_api`)** — `modal.http_request` (info) per endpoint call with `http_method`, `http_path`, `http_status`, `duration_ms`, `outcome`, `endpoint_name`, `trace_id`, `request_id` (emitted by the `_execute_endpoint` context manager, which also records client-cancelled requests as status 499 and auth failures as `api.error`).

**Sandbox manager (`component: "manager"`)** — `sandbox.create`, `sandbox.snapshot`, `sandbox.restore` (info: `sandbox_id`, `modal_object_id`, `snapshot_image_id`, `repo_owner`, `repo_name`, `duration_ms`, `outcome`), `sandbox.create_build` for image builds.

**Supervisor (`component: "supervisor"`)** — `sandbox.startup` (info: `repo_owner`, `repo_name`, `boot_mode`, `restored_from_snapshot`, `from_repo_image`, `git_sync_success`, `setup_success`, `start_success`, `opencode_ready`, `duration_ms`, `outcome`), `supervisor.start`, `supervisor.error` (error: `exc`), `supervisor.fatal` (error: `error_message` — the sandbox will exit; reported to the control plane via `/sessions/:id/sandbox-error`).

**Bridge (`component: "bridge"`)** — `bridge.connect` (info: `outcome`, `connection_count`, `reconnect_count`, `reconnect_attempt_count`), `bridge.disconnect` (info/warn: `reason`, `ws_close_code`, `connection_duration_seconds`, `total_connected_duration_seconds`, `connection_count`, `reconnect_count`, `reconnect_attempt_count`), `bridge.reconnect`, `bridge.run_complete`. Fatal reconnect errors (HTTP 401/403/404/410) are not retried — the bridge exits gracefully (`SessionTerminatedError`).

**Prompt processing** — `prompt.start` (info: `message_id`, `model`, `reasoning_effort`), `prompt.run` (info: `message_id`, `model`, `outcome`, `duration_ms`), `prompt.error` (error: `message_id`, `exc`), plus `prompt.invalid_attachments` and `prompt.no_output` (OpenCode returned nothing) diagnostics.

**Git operations (`component: "bridge"` / `"supervisor"`)** — `git.clone_start`, `git.clone_complete`, `git.clone_error`, `git.sync_complete`, `git.push_start`, `git.push_complete`, `git.push_error`.

**OpenCode (`component: "bridge"`)** — `opencode.session.ensure` (info: `opencode_session_id`, `action`), `opencode.start`, `opencode.ready`, `opencode.crash` (error: `exit_code`, `restart_count`); `opencode.restart` (info: `delay_s`, `restart_count`) and `opencode.max_restarts` (error) cover the restart policy.

### Slack bot (`service: "slack-bot"`)

**Handler (`component: "handler"`)** — `http.request` (info/warn per `/events` or `/interactions`; a fresh `trace_id` is minted at the edge), `slack.dm.received`, `slack.event.duplicate` (debug, KV dedupe hit), `slack.event.dedupe_unavailable` (error, degraded mode), `thread_session.stale`, `control_plane.create_session` / `control_plane.send_prompt` (info/error with `trace_id`, `session_id`, `message_id`, `http_status`, `duration_ms`, `outcome`), `slack.app_home`, `kv.*`. The `callback` component logs `http.request` for the `/complete` / `/start` endpoints (validated/enqueued), `slack.completion.enqueue`, `slack.completion.job_invalid`, `slack.completion.unhandled`, and `callback.complete` (info/error: `trace_id`, `session_id`, `message_id`, `channel`, `agent_success`, `tool_call_count`, `artifact_count`, `media_artifact_count`, `duration_ms`).

**Attachments / media** — `slack.attachment.*` (warn family: `untrusted_url`, `download_failed`, `download_error`, `size_rejected`, `too_large`, `upload_failed`, `upload_error`, `notify_failed`; `file_lookup_failed` is emitted by `handler` or `target-selection` depending on where lookup failed) and `slack.media.*` (warn family for protected-media fetch/upload/delivery). Size events enforce a 10 MiB per-image cap; the bot forwards at most six images per message; a text-plus-image request losing images still runs the text and the bot attempts an in-thread warning.

**Extractor / repos / classifier** — `control_plane.fetch_events`, `control_plane.fetch_repos`, `classifier.classify` (error when LLM classification fails).

## Querying worker logs: cf-logs

`scripts/cf-logs.ts` queries the Cloudflare Workers Observability Telemetry Query API for historical control-plane (and bot) logs:

```
CLOUDFLARE_API_TOKEN=<token with Workers:Read> CLOUDFLARE_ACCOUNT_ID=<account> \
  bun scripts/cf-logs.ts --session <session-id> [--level error] [--mins 30] \
  [--trace <trace-id>] [--request-id <id>] [--search "prompt.run"] [--script <worker>] \
  [--limit 1000] [--json]
```

- Filters: `--session` (application `session_id` field), `--request-id` (`$metadata.requestId`: app-level request_id on fetch events, CF platform request id on DO events), `--trace` (`$metadata.traceId`; fetch events only), `--search` (free text matched on `$metadata.message`, which is populated from `msg` or `message`), `--script` (worker script name), `--all`.
- Options: `--level` (debug|info|warn|error), `--mins` (default 30, max 10080/7 days), `--limit` (default 1000), `--json` (raw events — pipe to `pbcopy` for LLM debugging), `--help`.
- Events are returned sorted by timestamp; the tool prints a summary of scripts, levels, components, sessions, execution models, and outcomes on stderr. Application fields live under `source` (not top level): `source.level`, `source.service`, `source.component`, `source.msg`/`source.message`, `source.ts`, and context fields like `source.session_id`. Platform-level `cf-worker-event` entries carry the request URL in `source.message`.

If a `session_id`/`trace_id` query returns nothing, the field path may differ in the telemetry store — inspect the raw event shape with `--request-id <known-id> --json` first.

Web logs (Vercel-hosted Next.js) and the sandbox runtime (inside Modal/Daytona/etc. containers) are not reachable through cf-logs; the sandbox runtime emits the same JSON envelope to stdout and Modal surfaces container logs separately.

## Debugging scenarios

The playbook (`docs/DEBUGGING_PLAYBOOK.md`) contains the full scenario library; the high-frequency cases:

**"What happened to message X?"** — `service="control-plane" msg="prompt.enqueue" message_id=<MSG_ID>` → `prompt.dispatch` (check `outcome`, `reason`) → `service="modal-infra" msg="prompt.run" message_id=<MSG_ID>` (check `outcome`, `duration_ms`) → `service="control-plane" msg="prompt.complete" message_id=<MSG_ID>` (check `total_duration_ms`).

**"Why is the sandbox not connecting?"** — control-plane `sandbox.spawn` then `ws.connect` (check `reject_reason`: `sandbox_id_mismatch`, `token_mismatch`, `session_terminal`, `sandbox_stopped`); modal-infra `sandbox.create` → `sandbox.startup` → `bridge.connect`; then control-plane `ws.connect ws_type="sandbox" outcome="success"`.

**"Slack message isn't getting a response"** — slack-bot `http.request http_path="/events"` (use its `trace_id` downstream) → `slack.event.duplicate` → `classifier.classify` → `control_plane.create_session` → `control_plane.send_prompt` → slack-bot `callback.complete`.

**Attachments lost in transit** — trace `slack.attachment.file_lookup_failed`, `slack.attachment.untrusted_url`, `slack.attachment.*` (download/size), then `slack.attachment.upload*` and `control_plane.send_prompt`; an HTTP download failure often means the bot lacks `files:read` or was not reinstalled after scope changes.

**Aggregate queries** — errors by type across services (`level="error" | group by error_type, service, msg | count`), slow spawns (`msg="sandbox.spawn" | where duration_ms > 30000`), prompt failures by model (`msg="prompt.complete" outcome!="success" | group by model, outcome | count`), OpenCode crashes (`msg="opencode.crash" | group by exit_code, restart_count | count`), slack-bot → control-plane latency (`msg="control_plane.send_prompt" | stats avg/median/p95/max(duration_ms)`).

## Redaction rules

Never log: authorization headers; HMAC tokens derived from `MODAL_API_SECRET` or the sig1 service signatures derived from the per-service `SERVICE_AUTH_SECRET`s; GitHub App private keys or installation tokens; GitHub OAuth access/refresh tokens; sandbox auth tokens. Body content is omitted unless explicitly whitelisted and truncated.

## Log level guidelines

| Level   | Use for                                                        |
| ------- | -------------------------------------------------------------- |
| `debug` | High-frequency internals (heartbeats, per-token events, cache) |
| `info`  | Wide events for normal operations                              |
| `warn`  | Degraded but recoverable (stale sessions, fallbacks, retries)  |
| `error` | Failures requiring investigation                               |

Set `LOG_LEVEL` per service to control verbosity (default `info`); `debug` in staging, `info` or `warn` in production. The control-plane, web, and slack-bot loggers bind it through `parseLogLevel`.

## Relation to architecture

- The control-plane router's correlation context and per-request D1 instrumentation are described in [/openwiki/architecture/control-plane.md](/openwiki/architecture/control-plane.md); the `http.request` wide event is where the D1 metrics summary lands.
- The sandbox runtime supervisor/bridge lifecycle and boot events are described in [/openwiki/architecture/sandbox-runtime.md](/openwiki/architecture/sandbox-runtime.md).
- Deployment of the workers behind these logs (Terraform, worker names, observability settings) is in [/openwiki/operations/deployment.md](/openwiki/operations/deployment.md).
