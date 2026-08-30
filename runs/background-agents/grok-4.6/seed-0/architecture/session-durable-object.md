---
type: architecture
title: Session Durable Object
description: Per-session Cloudflare Durable Object that owns SQLite session state, composes the session runtime, and exposes HTTP, WebSocket, and alarm entrypoints.
tags: [durable-objects, session, sqlite, alarms, control-plane]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-17525a70b871e2e83636b91f
    resource: repo://packages/control-plane/src/session/alarm/handler.ts
  - id: openwiki-source-c3bb3f3184b643da3b68df23
    resource: repo://packages/control-plane/src/session/alarm/scheduler.ts
  - id: openwiki-source-f69048d2562235a60f688786
    resource: repo://packages/control-plane/src/session/components.ts
  - id: openwiki-source-0f7dc7a19c00389ea0e86e0f
    resource: repo://packages/control-plane/src/session/durable-object.ts
  - id: openwiki-source-931813438ca2f322802ec305
    resource: repo://packages/control-plane/src/session/http/dispatcher.ts
  - id: openwiki-source-b5e52d398550648420138d80
    resource: repo://packages/control-plane/src/session/schema.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Session Durable Object

Each coding session is one Cloudflare Durable Object (`SessionDO`). That object is the isolation boundary: its embedded SQLite is the canonical store for the session timeline, participants, sandbox row, and WebSocket mappings. The Worker router authenticates callers and indexes sessions in D1; it does not keep this live state. See [Control Plane](/openwiki/architecture/control-plane.md).

## Thin adapter over a session runtime

`SessionDO` is a Cloudflare adapter, not the application graph. Construction captures two databases:

- `this.sql` — Durable Object `SqlStorage` (per-session SQLite)
- `this.db` — the Worker's D1 binding, nullable, read once in the constructor

On first touch after construction or eviction, `ensureInitialized` applies `initSchema`, then `createSessionRuntime`. The runtime is published only after the collaborator graph is fully built: a throw leaves `_runtime` null so the next event retries instead of using a half-built graph.

Platform callbacks then forward to `SessionServer`:

| Cloudflare hook | SessionServer |
| --- | --- |
| `fetch` | `onRequest` → HTTP dispatcher / WebSocket upgrade |
| `webSocketMessage` | `onMessage` |
| `webSocketClose` / `webSocketError` | disconnect handler |
| `alarm` | `onScheduledDeadline` (initialize **without** re-arming, then handle the delivery) |

Hibernation-restored instances reconstruct the runtime on first touch the same way.

## Composition root

`createSessionRuntime` (`packages/control-plane/src/session/components.ts`) builds repositories, services, sandbox lifecycle, source-control, WebSocket manager, snapshot reader, alarm scheduler, and internal HTTP handlers **eagerly**, in topological order, with one session-scoped logger created first.

Provider factories run at this point on purpose. `createSandboxProviderFromEnv` and `createSourceControlProviderFromEnv` throw on missing credentials or an invalid `SCM_PROVIDER`. A misconfigured deployment fails every session request at initialization, before session state is written, instead of running degraded until the first spawn or PR.

Encryption keys are required the same way (`requireTokenEncryptionKey`, `requireRepoSecretsEncryptionKey`). See [Security Model and Authentication](/openwiki/concepts/security-and-auth.md).

`SessionRuntime.internals` exists for integration-test introspection only. Production `SessionDO` uses the narrow surface: server entry points, logger, alarm rehydrate.

## SQLite schema (this session only)

`SCHEMA_SQL` in `packages/control-plane/src/session/schema.ts` is the per-session database. It is not D1.

| Table | Owns |
| --- | --- |
| `session` | Identity, status, model, parent/spawn fields, sandbox settings JSON, environment provenance, scalar primary-repo mirror |
| `session_repositories` | Ordered multi-repo members; position 0 is primary |
| `participants` | Members, encrypted SCM tokens, WebSocket token hash |
| `messages` | Prompt queue and history (`pending` / `processing` / `completed` / `failed`) |
| `events` | Agent event log with unique `timeline_sequence` |
| `artifacts` | PRs, screenshots, video, previews, branches |
| `attachments` | Prompt attachment metadata (bytes live in R2) |
| `sandbox` | Provider ids, snapshot ids, auth token hash, status, heartbeats, tunnel URLs, access secrets |
| `session_diff` | Singleton latest checkout-diff bundle |
| `session_alarm_state` | Singleton pending/in-flight/cancelled alarm deadlines |
| `ws_client_mapping` | Hibernation recovery from `wsId` to participant |

Invariants baked into SQL:

- `repo_owner` and `repo_name` are both null or both set; no-repo sessions cannot carry `repo_id` or `base_branch`.
- At most one message with `status = 'processing'`.
- `client_request_id` is unique when present (web idempotency).
- `events.timeline_sequence` is unique.

D1 still holds the **session index** (list/inbox, parent links, automation ids) plus users, secrets, environments, and other cross-session config. `initializeSession` writes D1 first, then this Durable Object. Git SHAs, message bodies, and sandbox heartbeats do not live in D1.

## Internal HTTP surface

The Worker talks to the object through `SessionInternalPaths` (`/internal/init`, `/internal/prompt`, `/internal/snapshot`, `/internal/verify-sandbox-token`, and the rest of the contract). `SessionHttpDispatcher` matches method + exact path. WebSocket upgrades bypass the route table. Unmatched paths return `404`. Request loggers copy `x-trace-id` / `x-request-id` onto a child logger without mutating the session logger.

This path contract is shared with the router so internal URLs cannot drift.

## Alarms

Cloudflare gives a Durable Object a single alarm slot. `PersistedAlarmDeadlineStore` plus `createEarliestAlarmScheduler` multiplex deadlines in `session_alarm_state` (pending vs in-flight, cancellation). On activation, `alarms.rehydrate()` restores that slot. The `alarm()` hook initializes **without** rehydrate so the delivery itself is not rewritten out from under the handler.

`createAlarmHandler` runs on each delivery:

1. Recover a stop-confirmation that timed out.
2. If a message has been `processing` longer than `EXECUTION_TIMEOUT_MS`, fail it (`evaluateExecutionTimeout`). If it is not yet timed out, reassert that deadline so a lifecycle alarm cannot starve stuck-message recovery.
3. Delegate to `SandboxLifecycleManager.handleAlarm` (inactivity, heartbeat, connecting timeout — see [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md)).
4. If lifecycle reports a termination, fail a stuck processing message and `resumeAfterSandboxTermination` so queued prompts can continue on a new sandbox.

Alarms have no request correlation; they use the session-scoped logger.

## Upstream and downstream

**In:** Worker `createSessionRuntimeClient` (user/service/sandbox HTTP), client and sandbox WebSockets, Durable Object alarms.

**Out:** selected `SandboxProvider`, SCM provider, D1 stores (index, PR summaries, MCP, integration settings), R2 via attachment/media handlers, optional Slack/Linear completion callbacks, automation `Scheduler` on execution complete.

Losing a client WebSocket does not stop the sandbox. Losing the sandbox WebSocket does not by itself mark the sandbox stopped: the bridge may reconnect, and the alarm path confirms heartbeat/inactivity. Explicit stopped/stale persistence is what blocks reconnect. Details in [Realtime Protocol](/openwiki/architecture/realtime-protocol.md) and [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md).

## Focused tests

Co-located unit tests cover schema, alarm handler/scheduler, websocket manager, snapshot reader, and message queue. Workerd integration tests under `packages/control-plane/test/integration` exercise a real Durable Object with helpers such as `initSession` and `queryDO`.
