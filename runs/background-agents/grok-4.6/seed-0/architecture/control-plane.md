---
type: architecture
title: Control Plane
description: Cloudflare Worker composition root that authenticates requests, indexes shared D1 state, and forwards session work to Durable Objects without executing agent code.
tags: [control-plane, cloudflare-workers, durable-objects, d1, queues, cron]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-c6bb3d9059aee3f5eada2df9
    resource: repo://packages/control-plane/src/auth/authenticate.ts
  - id: openwiki-source-d2de27bfae64ae9ec188830b
    resource: repo://packages/control-plane/src/db/sql-database.ts
  - id: openwiki-source-557254ea34d55b02eef467a0
    resource: repo://packages/control-plane/src/env-validation.ts
  - id: openwiki-source-c17bbe00abbcf37cbd7991f3
    resource: repo://packages/control-plane/src/image-builds/scheduler.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-820b9ad986724854db571bee
    resource: repo://packages/control-plane/src/queue-routing.ts
  - id: openwiki-source-9175ccc37c339f0a3dfd984e
    resource: repo://packages/control-plane/src/router.ts
  - id: openwiki-source-f49c3ab49317a2ad215805d3
    resource: repo://packages/control-plane/src/routes/shared.ts
  - id: openwiki-source-93cf7d35cafae73be72279c1
    resource: repo://packages/control-plane/src/session/abandoned-draft-sweep.ts
  - id: openwiki-source-5c3aae3f8b776193c21c4216
    resource: repo://packages/control-plane/src/session/initialize.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Control Plane

The control plane is the coordinator for Open-Inspect. It lives in `packages/control-plane` as a Cloudflare Worker that authenticates callers, stores shared configuration in D1, and routes session work into one Durable Object per session. It does not run the coding agent. Agent execution happens in a sandbox on the selected data-plane provider; the session Durable Object is the runtime that talks to that sandbox.

See [Session Durable Object](/openwiki/architecture/session-durable-object.md) for per-session SQLite, alarms, and sandbox orchestration, and [Realtime Protocol](/openwiki/architecture/realtime-protocol.md) for the WebSocket contracts that clients and sandboxes use after the Worker upgrades the socket.

## Responsibility and ownership

The Worker owns three platform entrypoints and one Durable Object class:

| Entrypoint | Owner | What it does |
| --- | --- | --- |
| `fetch` | `packages/control-plane/src/index.ts` | HTTP API plus WebSocket upgrade to a session Durable Object |
| `scheduled` | same | Image-build maintenance, abandoned-draft retirement, automation tick, autofix queue health |
| `queue` | same | GitHub autofix envelopes or image-build finalization jobs |
| `SessionDO` | `packages/control-plane/src/session/durable-object.ts` | Re-exported so Cloudflare can bind the session namespace |

HTTP handlers live in the router (`packages/control-plane/src/router.ts`) and route modules under `packages/control-plane/src/routes`. Session mutation after create is not implemented in those handlers: they authenticate, authorize, then call `createSessionRuntimeClient`, which stubs `env.SESSION` and `fetch`es an internal path on the Durable Object.

Shared state that is not a session's private timeline lives in D1 through `SqlDatabase` stores under `packages/control-plane/src/db`. Media blobs live in R2 (`MEDIA_BUCKET`). Repository listing uses KV (`REPOS_CACHE`). Optional service bindings (`SLACK_BOT`, `LINEAR_BOT`) and queues (`AUTOFIX_QUEUE`, `IMAGE_BUILD_FINALIZATION_QUEUE`) are declared on `Env`.

## Fetch: HTTP versus WebSocket

`fetch` splits traffic before the router:

1. An `Upgrade: websocket` request must match `/sessions/:id/ws`. The Worker checks `SessionIndexStore.exists(sessionId)` in D1. Unknown sessions return `404`; any other path returns `400`. A known session is forwarded to `env.SESSION.idFromName(sessionId)` and the Durable Object's `fetch`. A successful upgrade is returned as HTTP 101 with `Access-Control-Allow-Origin: *`.
2. Every other request goes to `handleRequest` in the router, with `createCloudflareBackgroundTasks(ctx)` so handlers can schedule `waitUntil` work.

The session index check is the Worker's only WebSocket gate. Socket authentication, the subscribed snapshot, and hibernation tags are Durable Object concerns (see [Realtime Protocol](/openwiki/architecture/realtime-protocol.md)).

## HTTP router

The router is an API gateway, not the session runtime.

### Composition root

`handleRequest` refuses to serve if `env.DB` is missing (`503 Database not configured`). Otherwise it builds a `RequestContext` with:

- `trace_id` from `x-trace-id` or a new UUID
- a short `request_id`
- an instrumented D1 handle (`ctx.db`) — route and webhook modules must not read `env.DB` directly
- lazy Better Auth runtimes keyed on the raw D1 binding
- the background-task port

Responses always carry `x-request-id`, `x-trace-id`, and `Access-Control-Allow-Origin: *`. CORS preflight is answered here without hitting a handler.

### Authentication before handlers

Non-public routes authenticate before the handler runs:

- **sandbox** — Bearer token verified by the Durable Object (`/internal/verify-sandbox-token`). Success sets `principal.kind = "sandbox"`.
- **user / web-service / user-or-service** — `authenticate()` in `packages/control-plane/src/auth/authenticate.ts`. A `sig1` service signature is verified against that service's secret; user traffic additionally requires a Better Auth session. Sandbox tokens are not assembled here because they need the session id from the path and a Durable Object round-trip.
- **user-or-service-with-sandbox-fallback** — if no recognized user/service credential is present, the router tries sandbox verification.
- **handler-authenticated** and **public** — skip the central authenticator (webhooks verify their own signatures).

After a principal is set, the router enforces `supportedScmProviders`. A deployment whose `SCM_PROVIDER` is not implemented for that route returns `501`. Invalid SCM configuration returns `500`. See [Security Model and Authentication](/openwiki/concepts/security-and-auth.md).

### What the HTTP surface covers

The route table concatenates health, browser auth, sessions, repos, secrets, environments, image builds, model preferences, provider accounts, integration settings, commit signing, SCM settings, automations, MCP servers, analytics, autofix, managed skills, keyboard shortcuts, and inbound webhooks.

Session routes are a mix of Worker-owned work and Durable Object proxies:

- **Create / spawn** (`session-create`, `session-child-spawn`) resolve identity, repositories, skills, and provider accounts in the Worker, then call `initializeSession`.
- **Index / inbox** read D1 (`SessionIndexStore`).
- **Runtime proxy** (`session-runtime-proxy.ts`) maps public session URLs onto `SessionInternalPaths` (`/internal/prompt`, `/internal/snapshot`, `/internal/scm-credentials`, and the rest of the contract in `packages/control-plane/src/session/contracts.ts`).

`initializeSession` writes the D1 index first, then initializes the Durable Object. That ordering is an invariant: a D1 failure must happen before any sandbox warming starts.

## Scheduled work

`scheduled` dispatches on the cron expression, not on a single catch-all tick:

| Cron | Constant | Work |
| --- | --- | --- |
| `7,37 * * * *` | `IMAGE_BUILD_SCHEDULER_CRON` | Image-build maintenance, stale-build cleanup, and rebuild triggers. See [Image Prebuild](/openwiki/workflows/image-prebuild.md). |
| `23 * * * *` | `ABANDONED_DRAFT_SWEEP_CRON` | Archive warm sessions that stayed in `created` with no prompt for `ABANDONED_DRAFT_TTL_MS` (8 hours). Offset from the image-build cron so the two never share an invocation. |
| `* * * * *` | hardcoded in `index.ts` | `Scheduler.tick()` plus `waitUntil(checkAutofixQueueHealth)`. |

Unknown cron strings are logged and ignored.

The minute tick is the automation scheduler's home: recovery of orphaned or timed-out runs, then overdue automations, with per-tick caps (`MAX_PER_TICK = 25`, `TICK_CHILD_LAUNCH_BUDGET = 50`). Details live in [Automations and Inbound Triggers](/openwiki/integrations/automations.md). Autofix queue health is best-effort observability on that same minute tick; it does not consume queue messages.

Abandoned drafts are a Worker-level hygiene path. The web client warms a session on first keystroke; navigating away leaves a `created` D1 row. The sandbox inactivity timeout only writes sandbox state, so without this sweep the session would sit forever. The sweep asks each Durable Object `/internal/expire-draft` and repairs the index when the object is missing or already left `created`.

## Queue consumers

`queue` is a two-way split on queue name:

- Names starting with `open-inspect-github-autofix-` go to `handleAutofixQueue`, which builds GitHub provider + D1 stores and runs `AutofixQueueConsumer`.
- Every other queue is treated as image-build finalization (`consumeImageBuildFinalizations`). Invalid jobs are acked and dropped; `retry` results delay redelivery; later messages in the batch still run.

GitHub autofix ingress originates in the github-bot worker and is processed here asynchronously so webhook handling stays short. Image-build finalization is the durable handoff after a provider build sandbox reports success or failure.

## Shared state versus session state

Two SQL engines are in play and they are not interchangeable:

- **D1 (`SqlDatabase`)** — global data layer. Session index and inbox, environments, automations, image builds, encrypted secrets, users, provider accounts, managed skills, MCP servers, analytics. Stores take `ctx.db`. The type port is explicit that it is not the Durable Object's synchronous `SqlStorage`.
- **Durable Object SQLite** — one database per session: messages, events, artifacts, sandbox rows, WebSocket mappings, diffs. See [Session Durable Object](/openwiki/architecture/session-durable-object.md).

Object payloads (prompt attachments, media artifacts) go to R2 through `ObjectStorage`. The Worker also binds KV for repository listing cache and optional queues/service bindings declared on `Env`.

Encryption keys are fail-closed. `requireTokenEncryptionKey` and `requireRepoSecretsEncryptionKey` require present, strict-base64, 32-byte AES-256 material. Missing or malformed keys throw at first touch rather than writing plaintext.

## Upstream and downstream

Callers of the control plane:

- Web BFF (`packages/web`) using `sig1` as service `web`, often with a Better Auth user session
- Slack, GitHub, and Linear bot workers using their own service secrets
- Sandboxes using per-session Bearer tokens
- Public webhook routes (Sentry, inbound automation, GitHub/Slack automation events) that verify signatures inside the handler

Downstream of the Worker:

- Session Durable Objects for live session work
- Selected sandbox provider APIs (via the Durable Object lifecycle manager, not the router)
- GitHub/GitLab SCM APIs for repo listing and PR operations
- Optional Slack/Linear service bindings for completion fan-out
- Image-build and autofix queues

## Failure behavior

- Missing D1 binding: HTTP `503`.
- Unknown session WebSocket: `404` after D1 existence check; invalid WS path: `400`.
- Sandbox token missing/invalid: `401`; Durable Object unreachable during sandbox auth: `503`.
- Unimplemented SCM provider on a restricted route: `501`.
- Uncaught handler errors: `500` with request metrics logged; `HttpError` maps to the thrown status.
- Queue: malformed image-build jobs are acked away; processing failures retry without aborting the rest of the batch.
- Automation tick: backpressure caps leave leftover overdue work for the next minute.

## Extension seams

- Add HTTP surface as a `Route` in `packages/control-plane/src/routes` (or `src/webhooks`) and concatenate it in `router.ts`.
- Add session behavior behind `SessionInternalPaths` so the router and Durable Object cannot drift.
- Add a cron by exporting a cron constant and branching in `scheduled` before the `* * * * *` catch-all.
- Add a queue consumer by extending `queue()`'s name check; do not overload the autofix prefix.

## Focused tests

- Worker composition: `packages/control-plane/src/worker-build.test.ts`
- Router auth, session create, spawn, SCM, policy: `packages/control-plane/src/router.*.test.ts`
- Queue name split: `packages/control-plane/src/queue-routing.test.ts`
- Cron wiring: `packages/control-plane/test/integration/image-build-scheduler.test.ts`, `packages/control-plane/test/integration/abandoned-draft-sweep.test.ts`
- Env encryption fail-closed: `packages/control-plane/src/env-validation.test.ts`
