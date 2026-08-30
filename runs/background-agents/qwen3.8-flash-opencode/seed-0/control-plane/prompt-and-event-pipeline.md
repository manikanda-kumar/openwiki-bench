---
type: pipeline
title: Prompt Queue and Event Stream
description: The session Durable Object's durable prompt queue (FIFO, one in-flight prompt, idempotent client request ids) and its append-mostly event timeline (unique sequence, token/tool-call upserts, cursor replay), plus the WebSocket admission and routing around them.
tags: [messages, events, websocket, invariants, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-e3a0ae08e1f115f1cd7e107f
    resource: repo://packages/control-plane/src/session/connection-authenticator.ts
  - id: openwiki-source-067f2a7a626a8649cc7b66d5
    resource: repo://packages/control-plane/src/session/event-cursor.ts
  - id: openwiki-source-a99106adb9372823259dd483
    resource: repo://packages/control-plane/src/session/event-repository.ts
  - id: openwiki-source-64934be7798cc34349b99d75
    resource: repo://packages/control-plane/src/session/event-stream.ts
  - id: openwiki-source-1d490fe5af2ebc3cd9c8300b
    resource: repo://packages/control-plane/src/session/message-queue.ts
  - id: openwiki-source-893ac0a294bbda5cd7dd3bc7
    resource: repo://packages/control-plane/src/session/message-repository.ts
  - id: openwiki-source-4b89134f3f6974b1017cbfb4
    resource: repo://packages/control-plane/src/session/message-router.ts
  - id: openwiki-source-85f16310824bd9d0bfe42c60
    resource: repo://packages/control-plane/src/session/presence-service.ts
  - id: openwiki-source-b5e52d398550648420138d80
    resource: repo://packages/control-plane/src/session/schema.ts
  - id: openwiki-source-b80d9164d7c56eae749ac94b
    resource: repo://packages/control-plane/src/session/websocket-manager.ts
  - id: openwiki-source-53baf5b30ac8c2cc7a323980
    resource: repo://packages/shared/src/types/prompts.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Everything a session does funnels through two durable structures in the SessionDO: the **message queue** (prompts waiting to run) and the **event stream** (the timeline clients replay). Both live in the DO's SQLite, so ordering survives reconnects, evictions, and crashes.

## Prompt admission and ordering

Admission has two doors — `handlePromptMessage` (WebSocket `prompt` frame) and `enqueuePromptFromApi` (bot/automation HTTP via `/internal/prompt`) — and both land in `messages` rows before anything runs. Four invariants, each DB-backed:

1. **FIFO**: the next prompt is always `status='pending' ORDER BY created_at ASC, rowid ASC` (`session/message-repository.ts:140–145`); the unfinished-queue view orders processing-first.
2. **One in-flight prompt**: claiming a message runs a conditional `UPDATE … WHERE status='pending' AND NOT EXISTS (SELECT 1 FROM messages WHERE status='processing')` inside a transaction (`message-repository.ts:316–331`), backed by the partial unique index `idx_messages_one_processing` (`session/schema.ts:218–219`). A lost claim returns silently — redrive elsewhere will pick it up.
3. **Capacity**: at most `MAX_UNFINISHED_PROMPTS = 10` unfinished prompts per session (`packages/shared/src/types/prompts.ts:5`); the check, the idempotency lookup, and the insert happen in one synchronous DO turn so concurrent enqueues can't both pass the cap (`message-queue.ts:761–763`).
4. **Client idempotency**: `clientRequestId` is deduped per participant (fingerprint-scoped): a resend of the same payload returns the existing message; reuse with a different payload raises `PromptRequestConflictError` (`message-queue.ts:114–126, 764–791`; `idx_messages_client_request_id`, `schema.ts:216–217`).

The `user_message` timeline event is created *inside* the processing claim (`message-repository.ts:333–338`) and deleted again if the message falls back to pending (L343–355) — queued prompts are visible in the queue projection but **never** in the event timeline. This is pinned by `test/integration/prompt-enqueue.test.ts` and `message-queue.test.ts`.

## Dispatch and stop semantics

Dispatch happens only when the sandbox WebSocket is up; otherwise the DO broadcasts `sandbox_spawning` and spawns **in the background** (blocking the HTTP prompt response would exceed bot timeouts, `message-queue.ts:400–427`). On send failure the message returns to pending *and* the unresponsive sandbox is terminated (`terminateUnresponsiveSandbox("prompt_dispatch_send_failed")`, L478–481). Authorship travels with the command: the prompt carries the participant's resolved git identity (`attributed-user` vs `agent-only`) so commits credit whoever sent it.

`stop` does not delete the running message: it marks it failed and sets a `stop_confirmation_deadline` of `STOP_CONFIRMATION_TIMEOUT_MS = 15s` (`message-repository.ts:12`); the queue refuses to dispatch while awaiting confirmation, and an alarm (`recoverStopConfirmationTimeout`) terminates the sandbox if the agent never confirms (`message-queue.ts:360–369, 556–565`). `cancel_prompt` (by `clientRequestId`) fails synchronously. Completion is compare-and-set on status (`recordMessageCompletion`) so a late duplicate `execution_complete` can't double-project; failure paths emit the synthetic terminal event + completion callbacks in the background.

## The event timeline

Every persisted event gets `timeline_sequence = MAX+1` (`event-repository.ts:16`), a UNIQUE column giving a gap-free monotonic replay order independent of wall-clock ties. Three event families are **upserts**, not appends:

- `token:<messageId>` — the running assistant text for a message updates in place;
- `tool_call:<identityKey>` — insert-or-update on `toolCallIdentityKey`, updating `data` **without advancing the sequence** so the tool snapshot holds its original timeline position (`event-repository.ts:109–123`);
- `execution_complete:<messageId>`.

Context compaction rewrites the running token id to `token:<mid>:<eventId>` inside a transaction so pre-compaction tokens remain replayable (`event-repository.ts:72–81`). `SessionEventStream` serves replay (default 500 events), history paging (limit clamped 1–500, heartbeats excluded), and **skips malformed persisted events rather than failing the page** (`event-stream.ts:92–107`). Cursors are composite `createdAt:sequence:id` with legacy formats still parsed (`event-cursor.ts:21–87`); paging orders `created_at DESC` with sequence/id tie-breakers and reverses for chronological delivery.

## WebSocket admission and routing

`SessionConnectionAuthenticator` (`connection-authenticator.ts`) splits the two socket kinds:

- **Sandbox connect** (`?type=sandbox`): validate sandbox id → bearer token against `auth_token_hash` → session promptable → live sandbox status, with **fresh synchronous re-reads after the async token hash** so a cancel or credential rotation landing mid-hash cannot admit (L110–151, pinned by `test/integration/websocket-sandbox.test.ts`). Accept flips status to `ready`, broadcasts gated on provider-startup-pending, schedules heartbeat + inactivity alarms *before* responding, then drains the queue in the background.
- **Client subscribe**: hashed token → participant row (24 h TTL), then the snapshot handoff — history + queue + state — is deliberately **synchronous** (`completeClientSubscription`, L310–350) because awaiting would let another activation interleave; identity survives hibernation evictions via `ws_client_mapping` rows, and unauthenticated sockets are closed 4008 after `WS_AUTH_TIMEOUT_MS = 30s` (`websocket-manager.ts:346–362`).

`websocket-manager.ts` is a registry, not a factory: tag-based `classify` (`wsid:` vs `sandbox`+`sid:`), and `getSandboxSocket` (L157–203) refuses to re-adopt zombie sockets for terminal `stopped|stale|failed` statuses and validates the `sid:` tag against the persisted provider sandbox id during hibernation recovery. `disconnect-handler.ts` schedules a reconnect check on sandbox close only if the closing socket is still the active one.

`message-router.ts` is the schema gate: JSON only, sandbox frames against `sandboxEventSchema`, client frames against `clientMessageSchema` from shared; only `ping`/`subscribe` are accepted pre-auth (`message-router.ts:92–100`); `fetch_history` is rate-limited to one request per 200 ms per client (`message-router.ts:8,159`); exhaustive `satisfies never` guards make adding a message variant without a handler a compile error.

## Multiplayer

Presence is participant-scoped: multiple tabs of one user collapse to one presence entry, per-participant socket counting in `presence-service.ts:20–41`, so a disconnect re-projects presence rather than removing the user. A `typing` frame marks activity and triggers sandbox warming — `presence-service.ts:101–112` requests a warm spawn so the first prompt often lands on an already-restoring sandbox. Everyone sees the same persisted stream; prompts carry their author (`active-prompt-author.ts` also feeds the `spawn-child` attribution chain).

## Where the tests are

Unit: `message-queue.test.ts` (admission, dedup-before-mutation, queue-cap-before-mutation, spawn-defer), `alarm/scheduler.test.ts` (persisted-before-runtime alarm ordering), `event-repository.test.ts` / `event-stream.test.ts` / `event-cursor.test.ts` (sequence and cursor semantics), `websocket-sandbox.test.ts` + `durable-object-eviction.test.ts` (admission fences, hibernation recovery). Integration (workerd + real SQLite): `test/integration/prompt-enqueue.test.ts`, `test/integration/websocket-client.test.ts`.
