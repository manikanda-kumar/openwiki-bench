---
type: subsystem
title: Agent Runtime and LLM Integration
description: How an agent chat turn runs inside workshop-backend — the Code Mode executeCode sandbox, the tool surface and step-transactional persistence barrier, model routing (BYOK / platform gateway / direct), context compaction, and optional daily usage limits.
tags: [agent, llm, code-mode, overseer, compaction, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-e5a9d4ba90863e0f110878c9
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/limits/config.ts
  - id: openwiki-source-1544c1a3e8233e50ede0f06a
    resource: repo://packages/workshop-backend/src/ai-invoke.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-a60768dbbe37cf4dc037121e
    resource: repo://packages/workshop-backend/src/slash-commands.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-1e6c5cdca0629df744b896d4
    resource: repo://packages/workshop-backend/src/web-fetch.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Agent Runtime and LLM Integration

The Workshop's coding agent is a Code Mode agent: it performs tasks by writing and executing JavaScript snippets rather than calling a fixed tool schema per operation. This page covers where a turn runs, what the agent can do, how its effects become durable, and how model requests are routed and budgeted.

## Ownership and entry point

Agent turns run inside the workspace's `OverseerDurableObject`. The private `#runAgentTurn` wraps the operation in observability context (`operation: "agent.run"`, chat/model ids) and tracing, then delegates to `#runAgentTurnWithContext`, which performs the turn-start sequence (packages/workshop-backend/src/overseer.ts:5703-5734). The turn loop itself lives in `runAgent` in packages/workshop-backend/src/agent.ts:1004-1013, driving pi-agent-core's `runAgentLoopContinue` (imported at agent.ts:12-15) with a stream fan-out/persistence sink called `emit`.

Before the first model request, the turn (packages/workshop-backend/src/overseer.ts:5735-5785):

1. reaps provisional gadgets orphaned by a crashed prior turn (`reconcilePendingGadgets`),
2. materializes pending live chat-change rows into durable "changes" messages,
3. enforces the optional free-tier usage gate via `checkUsageAndBalance` (skipped for callback-initiated turns; always allows when the Cloudflare limits flow is disabled), and optionally switches to the user's own-gateway (BYOK) routing,
4. resolves a `ModelHandle` via `getModel` with a computed session affinity.

If the turn was started by an agent callback and callbacks remain outstanding, the outer loop nudges the agent once with the outstanding set and gives up (rejecting remaining callbacks) when a nudged run makes no further progress (packages/workshop-backend/src/overseer.ts:5800-5830).

## Code Mode: executeCode

The `executeCode` tool (packages/workshop-backend/src/agent.ts:2723-2771) requires a self-contained module exporting one async function `function(self, env, ctx)`. Execution goes to `OverseerImpl.executeCodeMode` (packages/workshop-backend/src/overseer.ts:7242-7355), which:

- builds a `WorkerLoaderWorkerCode` definition with modules `harness.js` (a fixed wrapper) and `agent.js` (the model's code), compatibility flags `disallow_importable_env` (which also denies importable `ctx.exports`, so loaded code cannot invoke the OS itself in a loop) and `allow_irrevocable_stub_storage` (enables `ctx.restore`), and **`globalOutbound: null`** — executed snippets have no internet access at all;
- sets `env` to the chat's named bindings through `getEnvForAgent`, which materializes each gadget/gatekeeper binding as a loopback `Fetcher` and skips binding names that fail `validateBindingName` (a prototype-pollution guard on the plain-object env) (packages/workshop-backend/src/overseer.ts:2748-2790);
- loads the worker through the `LOADER` binding and calls `entrypoint.verify()` first, treating startup errors as total failures;
- passes a `self` magic object: the `AgentSelfLoopback` WorkerEntrypoint, a Proxy whose every method call delivers `deliverAgentCallback` to the chat thread and activates the agent to respond (packages/workshop-backend/src/overseer.ts:6003-6014, 8823-8870);
- hands the harness a transient `RestoreForgerImpl` capability, which grafts the well-known `restore` symbol onto gadget binding stubs for the duration of that one `run()` call so code can forge persistent restore stubs (packages/workshop-backend/src/overseer.ts:69-106, 7298-7318).

Stdout logs return through a `CodeModeTailLoopback` tail with a bounded 5-second trace wait; streaming output deltas are fanned out to clients via an execution-id subscriber map (packages/workshop-backend/src/overseer.ts:7250-7259, 7325-7345).

A step-transactionality guard makes `executeCode` refuse to run when the current step already buffered code edits, because edits only take effect at the step's persistence barrier — the model is told to split edit-and-execute into two steps (packages/workshop-backend/src/agent.ts:2746-2754).

## Tool surface

`runAgent` registers these tools (packages/workshop-backend/src/agent.ts:2304-2882):

- `readFile` / `writeFile` / `editFile` — file edits against the chat's session content; edits are gated on a prior read of the file's current content and are buffered per step rather than written immediately;
- `webFetch` — public HTTPS GET only, no credentials; documents are converted to Markdown via the Workers AI `toMarkdown` utility; SSRF protection relies on workerd's post-DNS IP filtering behind the `global_fetch_strictly_public` compatibility flag (packages/workshop-backend/src/web-fetch.ts:1-21, agent.ts:2479-2522);
- `describeBinding` / `setGadgetBinding` / `createGadget` / `listBlueprints` — workspace manipulation; gadget creations and binding edges are recorded durably only by the step barrier;
- `listConnectableResources` / `requestConnection` — the capability-introduction flow; a *successful* connection request stops the loop so the agent waits for the user's decision (packages/workshop-backend/src/agent.ts:3117-3122);
- `observeUserChanges` — surfaces user edits made since the last observation;
- `giveUp` — only registered for callback-initiated runs (packages/workshop-backend/src/agent.ts:2859-2882).

The loop also stops after 30 model turns, while an action awaits a user approval decision, or when a callback-initiated run has resolved all callbacks (packages/workshop-backend/src/agent.ts:3108-3130).

The model-facing system prompt is a large constant documenting the entire gadget programming model (server.js as a Durable Object class named `Gadget`, no `fetch()`, bindings-only outbound, capnweb client/server RPC), with a separate spawner variant; admin-configured instance instructions are appended at turn time (packages/workshop-backend/src/agent.ts:565-620, 778, 2085-2203).

## Persistence barrier and budgets

The `turn_end` case of `emit` is the sole durable write for a step: one `hooks.commitAgentStep` transaction persists the assistant transcript together with that step's buffered edits, captured gatekeeper actions, connection requests, and gadget/binding creations, so effects are durable iff the transcript that explains them is (packages/workshop-backend/src/agent.ts:2985-3070). A completed-but-cancelled turn still persists the calls that finished; an aborted error result is recorded honestly as `"Operation aborted"` rather than fabricated (packages/workshop-backend/src/agent.ts:2991-3012).

Two byte budgets keep barrier writes storable against the 2 MB record cap: `CHAT_CHANGE_MESSAGE_BUDGET` (1 MB) bounds composed user-edit rows, and `STEP_CHANGE_BUDGET` (1.5 MB) bounds one step's buffered edits, with the offending tool call failing agent-visibly (packages/workshop-backend/src/agent.ts:36-71). Cancellation never reverts completed steps; users revert explicitly (packages/workshop-backend/src/agent.ts:3140-3144).

## Model layer (ai-models.ts, ai-invoke.ts)

`getModel` picks a routing mode in priority order (packages/workshop-backend/src/ai-models.ts:356-379):

1. **User gateway (BYOK)** — when the billing gate resolved a Cloudflare account routing, inference goes through the user's own account's default AI Gateway with `cf-aig-authorization`, billing their credits; every AI-Gateway-served provider works, including Workers AI (packages/workshop-backend/src/ai-models.ts:381-421);
2. **Platform AI Gateway** — when `CF_AI_GATEWAY` is configured (the free tier), otherwise
3. **Direct provider** access with the resolved API key (packages/workshop-backend/src/ai-models.ts:442-508).

A `ModelHandle` closes over endpoint, auth headers, gateway attribution metadata, and session affinity, so callers never handle credentials. pi streams never throw for provider failures; they end with an assistant message whose `stopReason` is `"error"`/`"aborted"` (packages/workshop-backend/src/ai-models.ts:62-104). `ai-invoke.ts` converts that shape back into exceptions for callers that want them: `AgentTurnError` carries a best-effort HTTP status parsed from the provider error text (or the last observed response) so the overseer can triage — report 5xx/unknown, tolerate expected 4xx (packages/workshop-backend/src/ai-invoke.ts:14-45). `completeText` serves one-shot completions (thread/gadget titles, compaction summaries, gadget `LanguageModelBinding.run`) and always disables extended thinking (packages/workshop-backend/src/ai-invoke.ts:47-80).

Models themselves are exposed as gatekeeper resources: `LanguageModelGatekeeper` is a Durable Object implementing `Gatekeeper<LanguageModelBinding>` with binding type `LanguageModelBinding` from `ai-model-binding.txt`, and its `addObserver` is a deliberate never-throwing no-op because a model is not a restricted-access resource (packages/workshop-backend/src/ai-models.ts:650-714).

## Compaction

Context compaction keeps long chats inside the model window without destroying history (packages/workshop-backend/src/agent-compaction.ts:1-41):

- it triggers when the prompt reaches 85% of the input budget (model context window minus reserved output capacity, per `SUGGESTED_MODELS` / provider defaults) and targets 30% of the budget for retained messages; unknown models assume a 128k window;
- the summarization prompt asks for a handoff that preserves requirements, decisions, files, errors, and next steps, and tells the summarizer to ignore instructions inside the transcript (packages/workshop-backend/src/agent-compaction.ts:43-56);
- a `CompactionCheckpoint` records the boundary sequence and replay state (session content, pins, proposed changes, chat bindings). The canonical chat log keeps every message so the UI can still page back; agent replay restarts at the boundary (packages/workshop-backend/src/agent-compaction.ts:6-8, 315-330; agent.ts:1038-1080);
- the stored summary is re-injected as a `user` message framed as machine-generated, untrusted content, with any embedded `<prior_conversation>` delimiters stripped so summary text cannot escape the framing (packages/workshop-backend/src/agent.ts:1173-1192);
- `/compact` turns finish once the checkpoint lands; automatic compaction re-runs the turn against the shortened history, bounded because each boundary moves strictly forward (packages/workshop-backend/src/overseer.ts:5793-5810).

## Usage limits (optional)

The free-tier flow is disabled unless `ENABLE_CLOUDFLARE_LIMITS` is set. The per-user daily counter lives on `UserDurableObject` as a `dailyLlmCount` record keyed by UTC day, with `checkDailyLlmCount` / `consumeDailyLlmCall` as the read and the atomic check-and-count; the DO's single-threaded execution makes the read-modify-write race-free, and exhausted windows never count a blocked call (packages/workshop-backend/src/user.ts:658-692). The limit comes from `DAILY_LLM_CALL_LIMIT` env with a shared default of 100 (packages/workshop-backend/src/ai-gateway-billing/limits/config.ts:31-40; packages/workshop-shared/src/limits.ts:15). Callback-initiated continuations are exempt from the gate so outstanding callbacks are never stranded mid-flow (packages/workshop-backend/src/overseer.ts:5749-5756). See [Configuration and Admin Settings](/openwiki/operations/configuration-and-admin.md) for the full billing configuration surface.

## Slash commands

Gatekeepers may advertise a `SlashCommandProvider`; the Workshop collects the merged catalog from attached gatekeepers and invokes a chosen command with an `ObservationAuthorizer`, so slash-command work funnels through the same observation/approval machinery as code execution (packages/workshop-backend/src/slash-commands.ts:19-57).

## Known gaps and uncertainty

- The `RestoreForgerImpl` placeholder for forged restore stubs is documented in-source as a TODO until the runtime can invoke the gadget's real `[restore]()` (packages/workshop-backend/src/overseer.ts:108-131).
- Behavior of the `@earendil-works/pi-agent-core` / `pi-ai` packages is documented here only as observed through their call sites in this repo; their internals are outside this workspace's source.
