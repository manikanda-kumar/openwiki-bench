---
type: architecture
title: Session Durable Object
description: The per-session Cloudflare Durable Object — activation-time composition of a 9-tier collaborator graph, embedded SQLite schema and migrations, the sql-storage port that makes repositories Node-testable, the internal HTTP path contract, and persisted-deadline alarm scheduling that survives evictions.
tags: [durable-objects, composition, sqlite, alarms, control-plane]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-c3bb3f3184b643da3b68df23
    resource: repo://packages/control-plane/src/session/alarm/scheduler.ts
  - id: openwiki-source-f69048d2562235a60f688786
    resource: repo://packages/control-plane/src/session/components.ts
  - id: openwiki-source-b79e53115bc683bdc83c24f9
    resource: repo://packages/control-plane/src/session/contracts.ts
  - id: openwiki-source-0f7dc7a19c00389ea0e86e0f
    resource: repo://packages/control-plane/src/session/durable-object.ts
  - id: openwiki-source-ac9bdc17cacce6343a52f06e
    resource: repo://packages/control-plane/src/session/sandbox-lifecycle-adapters.ts
  - id: openwiki-source-b5e52d398550648420138d80
    resource: repo://packages/control-plane/src/session/schema.ts
  - id: openwiki-source-b91d1e3d9acc6b2a85763842
    resource: repo://packages/control-plane/src/session/sql-storage.ts
  - id: openwiki-source-b80d9164d7c56eae749ac94b
    resource: repo://packages/control-plane/src/session/websocket-manager.ts
  - id: openwiki-source-80a56aa35a04e03081f1fd9a
    resource: repo://packages/control-plane/src/session/ws-client-mapping-repository.ts
  - id: openwiki-source-a52547c46f00cc6fd2ac822e
    resource: repo://packages/control-plane/test/integration/session-components.test.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Every Open-Inspect session is exactly one Cloudflare **Durable Object** (`SessionDO`, `packages/control-plane/src/session/durable-object.ts`) — the only DO class in the worker, bound as `SESSION` (Terraform `workers-control-plane.tf:215–216`). The class is deliberately thin: it forwards `fetch`, `webSocketMessage/Close/Error`, and `alarm` to a per-activation **session runtime** built once in `ensureInitialized()` (L44–60).

## Activation and fail-at-construction

`ensureInitialized` applies the SQLite schema (`initSchema(this.sql)`) and then builds the *entire* collaborator graph eagerly through `createSessionRuntime` (`session/components.ts:210–834`). Two operational consequences:

1. **Publish only after full construction** (comment L49–52): if the graph throws, the activation stays uninitialized and the next event retries — no half-built runtime is ever dereferenced.
2. **Fail-at-construction posture** (`components.ts:14–21`): missing provider factory config, missing source-control provider, or absent encryption keys *throw* during composition (`requireRepoSecretsEncryptionKey`/`requireTokenEncryptionKey`, `env-validation.ts`), so every request to a misconfigured deployment fails loudly instead of degrading silently — pinned by `test/integration/session-components.test.ts:44–62`.

The `alarm()` callback initializes with `rehydrateAlarm=false` — this delivery *is* the scheduled wake-up, re-arming would loop (durable-object.ts L96–102).

## The 9-tier composition graph

`createSessionRuntime` assembles the subsystems in dependency order (tier comments in `components.ts` L215–653):

| Tier | Contents |
| --- | --- |
| 1 | SQLite repositories (session core, messages, events, artifacts, participants, sandbox, repositories, diff, ws-mapping) |
| 2 | WebSocket manager, hibernation ping→pong auto-response (`ctx.setWebSocketAutoResponse`, L265–270), alarm scheduler |
| 3 | `SessionMessengerImpl` (broadcast / sendToSandbox) |
| 4 | Domain services: title, status, participants, presence, callbacks, user-env resolver, diff service, event stream |
| 5 | `SandboxLifecycleManager` via `createLifecycleManager` (L852–955): provider factory, MCP lookup, Slack gate, inactivity timeout, image-build lookup |
| 6 | `SessionMessageQueue` (prompt admission/dispatch) |
| 7 | Queue-facing services + sandbox-event handlers/processor |
| 8 | Internal HTTP handlers (route table L692–742) |
| 9 | Read models + `SessionServer` (the platform-neutral entry surface, `server.ts`: five delegating methods) |

Tier ordering is the wiring contract: nothing below can reach above it, which is why the file reads as a linear build-up rather than a DI container.

## Embedded SQLite: schema and migrations

`session/schema.ts` (677 lines) declares `SCHEMA_SQL` (L50–208) with tables `session`, `participants`, `messages`, `events`, `artifacts`, `attachments`, `sandbox`, `session_repositories`, `session_diff`, `session_alarm_state`, `ws_client_mapping`, and `INDEXES_SQL` (L213–229) carrying the invariant-enforcing **partial unique indexes** — one-processing (`idx_messages_one_processing`), client-request-id idempotency, and autofix feedback. The index *is* the enforcement; the repository code merely cooperates. `MIGRATIONS` (L273–622) is an ordered, transactionally-applied list (45 entries tracked in `_schema_migrations`, `applyMigrations` L645–668) — note this is a separate world from the D1 migration files; DO schemas evolve per-activation and are never re-downloaded from elsewhere. Migration 42 is the instructive one: it backfills data and then creates the one-processing index (L574–595), because the index cannot exist while legacy rows violate it.

## The sql-storage port

`session/sql-storage.ts` is only 13 lines: a **structural type** for Cloudflare's `ctx.storage.sql` (`exec`/`run`/`one`/`toArray`, `transactionSync`, `SqlResult.rowStats`) — nothing else in `src/session/` may reference the Cloudflare global. Every repository codes against that interface, so the whole persistence layer unit-tests in plain Node against a small SQL fake (`schema.test.ts`, `message-repository.test.ts`, `event-repository.test.ts`), and the integration pool exercises the real thing. The same port-driven style gives the DO a *narrow* lifecycle socket adapter (`session/sandbox-lifecycle-adapters.ts:49–52` exposes exactly four socket operations, so the lifecycle manager structurally cannot reach admission or teardown).

## Internal HTTP contract

The router calls the DO only through exact paths declared once in `session/contracts.ts` — `SessionInternalPaths` (39 entries: `/internal/init`, `/internal/prompt`, `/internal/sandbox-event`, `/internal/spawn-context`, `/internal/verify-sandbox-token`, `/internal/child-session-update`, the diff family…) — shared by the caller (`runtime-client.ts` builds DO-stub fetches with correlation headers) and the callee (`http/dispatcher.ts` matches path+method exactly, with a per-request child logger and `do.request` metrics). Both sides referencing one constant is what keeps worker↔DO drift impossible; new internal routes go through `SessionHttpDispatcher`'s handler table (tier 8), never string matching.

## Alarms and eviction recovery

The DO has one platform alarm slot for many deadlines. `session/alarm/scheduler.ts` implements **persisted-deadline-first** scheduling over the `session_alarm_state` row (`pending_deadline`, `in_flight_deadline`, `cancelled` tombstone, L30–45): the earliest deadline is written to SQLite *before* `ctx.storage.setAlarm`, delivery is wrapped in `beginDelivery/completeDelivery` bookkeeping, and a cancellation tombstone survives rehydration so a canceled alarm's late delivery is dropped rather than fired. On activation, `ensureInitialized` calls `runtime.alarms.rehydrate()` (durable-object.ts L55–58), re-arming whatever the row says — which is how watchdogs (inactivity, heartbeat, stop-confirmation, execution timeout, reconnect check) survive evictions and deploys. The handler composition order lives in `alarm/handler.ts`: stop-confirmation recovery → execution watchdog (re-arm if the lifecycle consumed it) → `lifecycleManager.handleAlarm()` → fail-stuck-and-resume.

WebSocket client identity likewise survives eviction: `ws_client_mapping` rows record authenticated participant/socket bindings, and the hibernation `sid:` tag check re-validates sandbox sockets against the persisted provider sandbox id (see [Prompt Queue and Event Stream](/openwiki/control-plane/prompt-and-event-pipeline.md)).

## Read the code in this order

`index.ts` (worker surface) → `session/durable-object.ts` (adapter) → `session/components.ts` (the graph) → `session/server.ts` + `http/dispatcher.ts` (entry) → `schema.ts` (state) → the subsystem pages.
