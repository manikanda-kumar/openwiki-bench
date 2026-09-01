---
type: architecture
title: Agent Runtime and Chat
description: How the overseer drives AI chat turns, the agent tool loop in agent.ts, executeCode's throwaway workerd isolate, the chat binding map, compaction, budgets, and gatekeeper slash commands.
tags: [agent, chat, overseer, execute-code, compaction, sandbox]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-a60768dbbe37cf4dc037121e
    resource: repo://packages/workshop-backend/src/slash-commands.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Agent Runtime and Chat

The agent runtime spans two files with a strict dependency direction: `overseer.ts` (a Durable
Object per workspace) owns all chat state and implements the `AgentHooks` interface, while
`agent.ts` is a plain module that runs one conversational turn. `agent.ts` deliberately never
imports `overseer.ts` — shared constants like `CHAT_CHANGE_MESSAGE_BUDGET` are declared in
`agent.ts` for that reason (packages/workshop-backend/src/agent.ts#L36-L49, `AgentHooks` at L339).

## Turn loop and the persistence barrier

`runAgent()` (packages/workshop-backend/src/agent.ts#L1004-L1013) drives the model conversation
using `runAgentLoopContinue` from the `@earendil-works/pi-agent-core` loop package
(packages/workshop-backend/src/agent.ts#L11-L15, invoked at L3101). Everything the client sees and
everything that gets durably logged flows through one awaited event sink, `emit`, which maps agent
events to `AiChatStreamEvent`s for live fan-out (text/reasoning deltas, tool-call lifecycle,
streamed `writeFile`/`editFile` previews and `executeCode` output) (packages/workshop-backend/src/agent.ts#L2896-L2945).

The core invariant is the **persistence barrier** at `turn_end`: one durable chat-log step is
written per completed model turn, and the loop awaits it before starting the next request, so the
chat log can never fall behind what the model has seen (packages/workshop-backend/src/agent.ts#L2962-L2965).
Turns that end with `stopReason` `error`/`aborted` persist nothing and are rethrown after the loop
as an `AgentTurnError` carrying the provider HTTP status (packages/workshop-backend/src/agent.ts#L2887-L2892, L3135-L3140;
packages/workshop-backend/src/ai-invoke.ts#L21). A turn the model *completed* is persisted even if
the user cancelled during tool execution — completed calls' buffered edits and captured actions
land together with their record ("effects iff record"), while aborted tool calls are recorded as
errors (packages/workshop-backend/src/agent.ts#L2970-L2978).

Failed tool calls are detected at one chokepoint, `tool_execution_end`, which sees schema
failures, blocked calls, and aborts that never reach a tool's own `execute()`; failed edits'
code previews are withdrawn there (packages/workshop-backend/src/agent.ts#L2946-L2958).

## Tool surface

Tools are declared with `defineTool` (packages/workshop-backend/src/agent.ts#L995) and include:
`readFile`, `writeFile`, `editFile`, `webFetch`, `observeUserChanges`, `describeBinding`,
`setGadgetBinding`, `createGadget`, `listBlueprints`, `executeCode`, `listConnectableResources`,
and `requestConnection` (packages/workshop-backend/src/agent.ts#L2303-L2870). `giveUp` is added
only for callback-initiated turns (packages/workshop-backend/src/agent.ts#L2881). The
system prompt (packages/workshop-backend/src/agent.ts#L570+) teaches the model that `env` bindings
are RPC interfaces that must be inspected with `describeBinding` rather than guessed, and that
`requestConnection` does not block: the agent's turn ends and it is resumed when the user accepts
the connection card (packages/workshop-backend/src/agent.ts#L840-L876).

## executeCode: a throwaway workerd isolate

`executeCode` does not run in the overseer's isolate and not in the browser.
`OverseerImpl.executeCodeMode()` (packages/workshop-backend/src/overseer.ts#L7242-L7345)
generates a random execution id and calls `this.env.LOADER.load(workerDef)` — the Worker Loader
binding — with a module graph of the harness (`CODE_MODE_HARNESS`, overseer.ts#L69-L80) plus the
agent's code as `agent.js`. Security-relevant properties of this definition:

- `disallow_importable_env` also disallows importable `ctx.exports`, preventing the code from
  calling itself in a loop; `allow_irrevocable_stub_storage` enables `ctx.restore()`
  (packages/workshop-backend/src/overseer.ts#L7266-L7272).
- `globalOutbound: null` severs all outbound network from the executed code
  (packages/workshop-backend/src/overseer.ts#L7284).
- `env` is the chat's named bindings, built by `getEnvForAgent` from the chat's binding map
  (packages/workshop-backend/src/overseer.ts#L2744-L2748, L7280-L7281).
- A tail worker (`CodeModeTailLoopback`) streams console traces and output text back to the
  overseer, which resolves them via `deliverCodeModeTrace`/`deliverCodeModeText`
  (packages/workshop-backend/src/overseer.ts#L7261-L7265, L7735-L7750, L9004-L9032).

The harness receives a `self` magic object — an `AgentSelfLoopback` worker entrypoint carrying the
chat id and the turn initiator's identity, so callbacks into the chat thread resolve models as the
initiator (packages/workshop-backend/src/overseer.ts#L7294-L7300; the `self` target is documented
at overseer.ts#L8831). Executed code can also invoke gadget `restore` methods via a
`RestoreForgerImpl` passed as a *transient stub argument* to `run()`, so the forging capability
lives exactly as long as the execution and conveys no authority beyond the accompanying env
(packages/workshop-backend/src/overseer.ts#L186-L192, L7327-L7332). Startup failures (`verify()`)
are treated as total failures (packages/workshop-backend/src/overseer.ts#L7286-L7289).

## The chat binding map

Each name in the agent's executeCode `env` resolves through a chat-scoped binding map that starts
from a seed layer produced by `prepareChatBindings` (packages/workshop-backend/src/agent.ts#L1066-L1070;
packages/workshop-backend/src/overseer.ts#L6397) and accumulates chat-local entries during history
replay (pasted resources, accepted connections, created gadgets, agent callbacks) and live tool
calls. Names are never rebound, which keeps resolution replay-deterministic
(packages/workshop-backend/src/agent.ts#L1066-L1070). Ambient gatekeeper singletons enter the chat
as named bindings under the vendor's `suggestedBindingName`
(packages/workshop-backend/src/overseer.ts#L6175-L6176).

Chat state itself lives in typed-storage collections keyed `{chatId}.{sequence}` per message row
(packages/workshop-backend/src/overseer.ts#L1183, L2434).

## Compaction and size budgets

Context compaction keeps long chats inside the model window: when prompt tokens reach 85% of the
model's input budget the runtime summarizes the messages before a boundary and stores a
checkpoint; canonical history keeps every message for the UI, but agent replay starts at the
boundary, targeting 30% of the budget for retained messages (packages/workshop-backend/src/agent-compaction.ts#L6-L20).
Token limits come from `SUGGESTED_MODELS` when known, with a 128k default and a provider-side
output cap for hand-configured Cloudflare models (packages/workshop-backend/src/agent-compaction.ts#L17-L35);
the summarization prompt explicitly instructs the model to ignore instructions embedded in the
transcript it is summarizing (packages/workshop-backend/src/agent-compaction.ts#L38-L55).

Code-change sizes are bounded twice: `CHAT_CHANGE_MESSAGE_BUDGET` (1 MiB) caps composed user-edit
changes, and `STEP_CHANGE_BUDGET` (1.5 MiB) caps one agent step's buffered edits, enforced at the
write call so the offending tool call fails visibly while earlier edits still persist at the
barrier (packages/workshop-backend/src/agent.ts#L36-L64, L1976).

## Hooks and slash commands

Gatekeepers can advertise a `SlashCommandProvider`; the overseer collects the catalog across all
attached gatekeepers that implement `getSlashCommandProvider` — a failing gatekeeper degrades to
contributing nothing — and invokes a chosen command on its gatekeeper, passing an
`ObservationAuthorizer` so command effects go through the approval machinery
(packages/workshop-backend/src/slash-commands.ts#L18-L53).

## Model access

Models are resolved per user via `getModel(env, config, ...)` in
packages/workshop-backend/src/ai-models.ts#L356 (including the `LanguageModelGatekeeper`
entrypoint at L657), and non-agent completions go through `completeText` in
packages/workshop-backend/src/ai-invoke.ts#L52.
