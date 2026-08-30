---
type: architecture
title: Realtime Protocol and Snapshot Handoff
description: Client, server, and sandbox WebSocket contracts, the subscribed snapshot handoff, bounded event replay, and why sandbox credentials stay off the snapshot.
tags: [websocket, protocol, snapshot, realtime, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-476b68a463256112b96dc86e
    resource: repo://docs/adr/0003-session-snapshot-handoff.md
  - id: openwiki-source-e3a0ae08e1f115f1cd7e107f
    resource: repo://packages/control-plane/src/session/connection-authenticator.ts
  - id: openwiki-source-64934be7798cc34349b99d75
    resource: repo://packages/control-plane/src/session/event-stream.ts
  - id: openwiki-source-66d53f6ba5396ccf9e579ef4
    resource: repo://packages/control-plane/src/session/sandbox-access-reader.ts
  - id: openwiki-source-17365289bdeda8f152a866f7
    resource: repo://packages/control-plane/src/session/sandbox-events/processor.ts
  - id: openwiki-source-794f44a5bb0e749fe6c8abb7
    resource: repo://packages/control-plane/src/session/snapshot-reader.ts
  - id: openwiki-source-a53cb4aa1c5a2d2ed8b0d99b
    resource: repo://packages/shared/src/types/server-messages.ts
  - id: openwiki-source-0dfefeca89a6d1280d92409c
    resource: repo://packages/shared/src/types/websocket.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Realtime Protocol and Snapshot Handoff

Live session views are a WebSocket to the session Durable Object plus a secret-free HTTP snapshot. Protocol types live in `@open-inspect/shared`. The Durable Object is the hub: it accepts client and sandbox sockets, persists events, and fans `ServerMessage`s out. See [Shared Contracts](/openwiki/architecture/shared-contracts.md) for why those types are not redefined in control-plane or web.

## Two sockets, one Durable Object

`GET /sessions/:id/ws` is upgraded on the Worker after a D1 existence check (see [Control Plane](/openwiki/architecture/control-plane.md)). The Durable Object then classifies the connection:

- **Client** — browser or other UI. Accepted immediately, then must `subscribe` with a WebSocket token before the auth timeout fires.
- **Sandbox** — query `type=sandbox` plus `Authorization: Bearer` and `X-Sandbox-ID`. Token hash is checked against the stored sandbox row. A reconnect is refused when lifecycle state is `stopped` or `stale` so a dead sandbox cannot come back as live.

`SessionWebSocketManager` is the only module that talks to the Cloudflare WebSocket API. It tags client sockets with a `wsId` so hibernation can recover identity from `ws_client_mapping`. There is at most one active sandbox socket; a new sandbox connection replaces the previous one.

## Client messages

`ClientMessage` is a discriminated union on `type` (`packages/shared/src/types/websocket.ts`):

| Type | Role |
| --- | --- |
| `subscribe` | Token + `clientId`; starts the snapshot handoff |
| `prompt` | Enqueue work with a `clientRequestId` |
| `cancel_prompt` | Cancel a queued or running prompt |
| `stop` | Stop execution |
| `typing` / `presence` | Multiplayer signals |
| `fetch_history` | Paginate timeline older than the subscribed replay |
| `ping` | Keepalive (`pong` in reply) |

WebSocket tokens are minted by `POST /sessions/:id/ws-token` from the verified principal (not from caller-supplied identity). Tokens older than 24 hours close the socket with code `4001`, forcing a fresh mint on reconnect. A second `subscribe` on an already subscribed or synchronizing socket closes with `4003`.

## Server messages

`ServerMessage` (`packages/shared/src/types/server-messages.ts`) is the live view:

- `subscribed` — canonical snapshot plus `participantId`
- Prompt queue: `prompt_queued`, `prompt_cancelled`, `prompt_queue_updated`
- `sandbox_event` wrapping a `SandboxEvent`
- Presence: `presence_sync`, `presence_update`, `presence_leave`
- Sandbox lifecycle: `sandbox_warming`, `sandbox_spawning`, `sandbox_status`, `sandbox_ready`, `sandbox_error`, `sandbox_restored`, `sandbox_warning`, `snapshot_saved`
- Artifacts: `artifact_created`, `artifact_updated`
- Session: `session_status`, `session_title`, `session_branch`, `processing_status`, `child_session_update`
- `diff_state_changed`, `tunnel_urls`, `sandbox_dashboard_url`
- `sandbox_access_changed` — invalidation only; no secrets on the wire
- `history_page` for `fetch_history`
- `error` with optional `clientRequestId`

`SessionState` on the live protocol may include interactive URLs. The **snapshot** variant (`SessionSnapshotState`) omits `codeServerPassword`, `vncPassword`, and `ttydToken`. Those credentials are not part of the canonical snapshot contract.

## Snapshot handoff (ADR 0003)

The canonical Durable Object SQLite database is the synchronization source of truth. There is no retained session-view delta log and no per-socket applied revision.

Hydration has two readers of the same snapshot:

1. **HTTP** `GET /sessions/:id` → Durable Object `/internal/snapshot` → `SessionSnapshotReader.handleSnapshot()`. Secret-free JSON for SSR. Cache-Control is `private, no-store`.
2. **WebSocket subscribe / reconnect** — after token checks, one `subscribed` message carrying the same snapshot shape (session, artifacts, timeline, prompt queue, spawn error).

The handoff invariant is structural, not a comment:

1. Authenticate the token and finish asynchronous enrichment (`resolveSessionSnapshotEnrichment` for environment name) **first**.
2. `completeClientSubscription` is a **non-async** method: it reads the snapshot inside a Durable Object storage transaction, sends `subscribed`, then registers/persists the socket (`setClient` + `persistClientMapping`).
3. There is no `await` between that final read, the send, and registration. A mutation is therefore either in the snapshot or delivered afterward on the ordered stream.

If the send fails, the socket is closed with `4009` (`Session synchronization failed`) rather than left half-subscribed. SSR state can be briefly older than the socket snapshot; the live `subscribed` message is authoritative.

Timeline identity is independent of synchronization: each stored event has a stable `eventId` and `timelineSequence`. Replay on subscribe is bounded (`DEFAULT_REPLAY_LIMIT = 500`) and excludes heartbeats. Older events come from `fetch_history` / `history_page`. Unknown event payloads in stored envelopes are dropped at parse time so a single bad row cannot fail the whole snapshot.

## Sandbox credentials stay off the snapshot

Interactive sandbox secrets (code-server password, VNC password, ttyd token) are **not** on `GET /sessions/:id`, **not** on `subscribed`, and **not** on other semantic WebSocket messages.

Clients fetch them from authenticated `GET /sessions/:id/sandbox-access` (`SessionAccessReader`). The sandbox must be `ready`; otherwise the handler returns `409`. Decrypts are re-checked against the current row so a mid-flight sandbox replacement cannot leak mismatched credentials. `sandbox_access_changed` tells the client to refetch that query. Integration credentials (SCM, model providers) stay on their own endpoints.

`SessionState` may still carry **URLs** (`codeServerUrl`, `vncUrl`, `ttydUrl`, `tunnelUrls`) and a provider dashboard URL. URLs are not the access secrets.

## Sandbox events and acknowledgements

`SandboxEvent` (`packages/shared/src/types/sandbox-events.ts`) is the bridge-to-Durable-Object contract: `heartbeat`, `ready`, tokens, tool calls, steps, git sync, artifacts, execution complete, snapshot ready, push results, errors, and related runtime signals. Events carry `sandboxId`, `timestamp`, and optional `ackId`.

`SessionSandboxEventProcessor` routes events to family handlers (streaming, artifacts, execution, runtime, push). It owns the delivery-ack contract: `execution_complete`, `error`, `snapshot_ready`, `push_complete`, and `push_error` are acked **after** the handler finishes. Family handlers never see `ackId`. Clients observe these as `sandbox_event` (and sibling semantic messages) after persistence.

## Correlation

At transport boundaries the canonical keys are `trace_id`, `request_id`, `session_id`, `sandbox_id`, with headers `x-trace-id`, `x-request-id`, `x-session-id`, `x-sandbox-id` (ADR 0002). The Worker copies `x-trace-id` / `x-request-id` onto HTTP responses; `createSessionRuntimeClient` forwards those headers on internal Durable Object fetches.

## Failure behavior

| Condition | Result |
| --- | --- |
| Missing/invalid/expired WS token | Close `4001` |
| Duplicate subscribe | Close `4003` |
| Snapshot send failed | Close `4009` |
| Sandbox upgrade with blocked lifecycle | Connection refused (stopped/stale) |
| Sandbox access while not `ready`, or row changed during decrypt | HTTP `409` |
| Client auth timeout after upgrade | Socket closed by `enforceAuthTimeout` |

The web client must normalize shared payloads at the WebSocket boundary before UI state (ADR 0002). See [Web Client](/openwiki/architecture/web-client.md).
