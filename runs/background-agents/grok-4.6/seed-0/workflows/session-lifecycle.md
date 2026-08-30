---
type: workflow
title: Session Lifecycle and Prompt Flow
description: Session create, Durable Object prompt queue, sandbox event processing and broadcast, archive/unarchive, and why dropping a client WebSocket does not stop the sandbox.
tags: [sessions, prompts, queue, archive, websocket]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-5fd49082b7e464556f638e18
    resource: repo://packages/control-plane/src/routes/session-prompt.ts
  - id: openwiki-source-2ec333a28df9f76e36b65db7
    resource: repo://packages/control-plane/src/routes/session-runtime-proxy.ts
  - id: openwiki-source-b79e53115bc683bdc83c24f9
    resource: repo://packages/control-plane/src/session/contracts.ts
  - id: openwiki-source-f0f30ae9e3294e4573d06df6
    resource: repo://packages/control-plane/src/session/http/handlers/session-lifecycle.handler.ts
  - id: openwiki-source-5c3aae3f8b776193c21c4216
    resource: repo://packages/control-plane/src/session/initialize.ts
  - id: openwiki-source-1d490fe5af2ebc3cd9c8300b
    resource: repo://packages/control-plane/src/session/message-queue.ts
  - id: openwiki-source-17365289bdeda8f152a866f7
    resource: repo://packages/control-plane/src/session/sandbox-events/processor.ts
  - id: openwiki-source-53baf5b30ac8c2cc7a323980
    resource: repo://packages/shared/src/types/prompts.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Session Lifecycle and Prompt Flow

A **session** is the unit of background work. Clients (web, Slack, GitHub, Linear, automations) create one, enqueue prompts, and observe the same ordered timeline even if they disconnect. The Worker authenticates and indexes in D1; live messages, events, and sandbox state live in the session Durable Object. Spawn/restore details are in [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md). Protocol shapes are in [Realtime Protocol](/openwiki/architecture/realtime-protocol.md). The object itself is in [Session Durable Object](/openwiki/architecture/session-durable-object.md). Child spawn is in [Child Sessions](/openwiki/workflows/child-sessions.md).

```
Created → Active → Archived
            ↑
            └── unarchive restores to active
```

Warm-only sessions that never receive a prompt can also be archived by the abandoned-draft sweep (8 hours). Cancelled sessions cannot be archived.

## Create

`POST /sessions` (`session-create.ts`) parses `createSessionInputSchema` (at most one of scalar repo, `repositories` 1–10, `environmentId`, or none). Identity comes from the verified principal (`applyIdentityEnforcement`); caller-asserted identity/SCM fields are rejected. Repositories are resolved (App access for every member). Skills, sandbox settings, and provider auth are snapshotted at create.

`initializeSession` is the shared path for web create, bot create, automation, and child spawn:

1. **D1 index first** (`SessionIndexStore.create`, status `created`). A D1 failure happens before any sandbox warming.
2. **Durable Object init** `POST /internal/init` on `env.SESSION.idFromName(sessionId)`.

`repositories[0]` must match the scalar primary mirror. Repo-less sessions must not carry a branch.

Losing the browser WebSocket after create does **not** abort init. The object and (once prompted) the sandbox keep running.

## Prompt enqueue

Clients enqueue through:

- WebSocket `prompt` messages (web UI)
- `POST /sessions/:id/prompt` (`session-prompt.ts`) — bots, automations, HTTP clients

The Worker authenticates, may attach `callbackContext` only if `mayAttachCallbackContext`, then `sessionRuntime.fetch(..., SessionInternalPaths.prompt)`.

Inside the Durable Object, `SessionMessageQueue.enqueuePromptFromApi` / the WS path:

1. `assertPromptableSession` — archived/cancelled/etc. throw `SessionNotPromptableError`.
2. `assertQueueCapacity` — pending+processing must be `< MAX_UNFINISHED_PROMPTS` (10).
3. Idempotent insert when `clientRequestId` matches the same author and fingerprint; mismatch is a conflict.
4. Persist the message, claim attachments, then `processMessageQueue()`.

`processMessageQueue` promotes the next pending message to `processing`, ensures a sandbox (warm/spawn/restore — see [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md)), and pushes the prompt over the sandbox WebSocket to OpenCode. Further prompts wait in SQLite. Disconnecting the **client** socket does not dequeue or cancel; only an explicit stop/cancel or execution completion does.

## Sandbox events → broadcast

The sandbox runtime streams `SandboxEvent`s on its WebSocket. `SessionSandboxEventProcessor` logs, builds a per-event context (one clock, one message attribution), and dispatches:

| Family | Types |
| --- | --- |
| Runtime | heartbeat, ready, git_sync, session_title |
| Streaming | token, steps, tool_call, timeline observers |
| Artifacts | artifact |
| Execution | execution_complete |
| Push | push_complete / push_error |

Critical types (`execution_complete`, `error`, `snapshot_ready`, `push_complete`, `push_error`) send a delivery **ack** after the handler finishes. Tokens and heartbeats are high-volume; they still persist/broadcast as required by their handlers.

Handlers write SQLite then broadcast `ServerMessage`s to subscribed client sockets. A client that reconnects gets a snapshot + catch-up; it does not need to have been connected during the turn. See [Realtime Protocol](/openwiki/architecture/realtime-protocol.md).

`execution_complete` finalizes the processing message, may snapshot, notifies `CallbackNotificationService` (Slack/Linear/automation `runComplete`), and lets the queue start the next prompt.

## Archive, unarchive, drafts

Public `POST /sessions/:id/archive` and `/unarchive` proxy to `/internal/archive` and `/internal/unarchive`.

Archive requires a participant `userId`, rejects cancelled sessions (409), and rejects queued/processing work (409). Success `transition("archived")`. Unarchive returns the session to a promptable active status so later prompts restore/resume the sandbox.

The web composer **warms** a session on first keystroke (`created` with no prompt). Navigating away leaves that D1 row. The abandoned-draft cron asks the object `/internal/expire-draft` and archives if it is still an unprompted draft. That is Worker hygiene, not user archive.

## Client presence vs sandbox lifetime

The control-plane `fetch` upgrades `/sessions/:id/ws` only after D1 `exists`. Socket auth and hibernation are Durable Object concerns. Closing every client WebSocket:

- Does **not** stop OpenCode
- Does **not** cancel the processing prompt
- Leaves inactivity/heartbeat alarms in charge of snapshot+stop (see [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md))

That is the background-agent contract: send a prompt, close the laptop, reopen the URL later.

## Invariants

- D1 index before DO init.
- Ordered prompt queue in session SQLite; capacity 10 unfinished.
- Event processor acks critical sandbox events only after handlers return.
- Archive cannot hide in-flight work.
- Client WS is observation, not liveness of the agent.

## Focused tests

- Create/init ordering: `packages/control-plane/src/session/initialize.ts` + `router.create-session.test.ts`
- Prompt enqueue/idempotency/capacity: `packages/control-plane/src/session/message-queue.ts` tests
- Event dispatch: `packages/control-plane/src/session/sandbox-events/` tests
- Archive/unarchive: `packages/control-plane/src/session/http/handlers/session-lifecycle.handler.ts` tests
- Draft sweep: `abandoned-draft-sweep.test.ts` and `test/integration/abandoned-draft-sweep.test.ts`
