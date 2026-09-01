---
type: "Reference"
title: "The AI agent: tools, code mode, and chat flow"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-7272ce5de435f7a3954bd25d
    resource: repo://packages/workshop-backend/src/agent-spawner-binding.d.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-d55d17145eabaf345158dbb3
    resource: repo://packages/workshop-backend/src/chat-attachment-validation.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-a60768dbbe37cf4dc037121e
    resource: repo://packages/workshop-backend/src/slash-commands.ts
  - id: openwiki-source-1e6c5cdca0629df744b896d4
    resource: repo://packages/workshop-backend/src/web-fetch.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-5e1c85223120db7658229b83
    resource: repo://plans/step-transactionality.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# The AI agent: tools, code mode, and chat flow

The workshop agent is a **Code Mode** agent: it performs tasks by writing and immediately running
code against its `env` bindings rather than calling narrow tools per operation
(`README.md:126-143`). The loop itself is pi-agent-core's low-level `runAgentLoopContinue`, driven
by `runAgent` in `packages/workshop-backend/src/agent.ts`.

## The turn pipeline

A user message enters via `OverseerImpl.sendChatMessage` (`overseer.ts:5343-5406`): the message is
prepared (slash command or prompt, attachments canonicalized per provider support), the chat's
uncommitted change rows are materialized into a durable `"changes"` message, and the whole prompt
commit happens in one synchronous storage transaction with `activeAgent` set — the lock that makes
`assertChatNotActive` reject concurrent turns. A built-in slash command (`/compact`) runs a turn
with no prompt; a spawned or external message follows the same path via `newChat`/
`receiveExternalMessage`.

`startAgent` then (`overseer.ts:5740-5858`):

1. Reconciles pending gadget creations and materializes turn-start change rows.
2. **Checks usage before user-initiated turns** — `checkUsageAndBalance` enforces the optional
   free-tier limit and resolves BYOK routing (callback-initiated continuations are exempt so
   outstanding callbacks are never stranded mid-flow). A block posts an agent error message with
   outcome `usage_limit` (`overseer.ts:5748-5773`).
3. Resolves the model handle (with session affinity and the BYOK routing when the free tier is
   exhausted — see [AI models](/openwiki/operations/ai-models.md)).
4. Loops `runAgent` until done. After each run: a compaction checkpoint is committed and the turn
   reruns with shorter history (bounded, because the boundary only moves forward); a `/compact`
   turn ends; callback-initiated runs keep looping while callbacks are outstanding — **nudging once**
   with the outstanding `env.PARAMS_<n>` names, then bailing out and rejecting the rest if no
   progress followed the nudge (`overseer.ts:5788-5854`).

The Overseer's `alarm()` holds the DO open and resumes agents when the browser closed, retrying on
DO death (`overseer.ts:8212-8226`).

## The runAgent loop

`runAgent` (`agent.ts:1004+`) replays the chat log first: it rebuilds the session's code content
(pins from the checkpoint, epoch changes, accepted rows), the `chatBindings` name map (also from
the checkpoint), per-gadget observed heads (fixed at first observation so one turn sees a
consistent tree), and the proposed-changes state. Replay is what makes a turn resumable after a
restart — tool outputs recorded in the log are rehydrated rather than re-run
(`agent.ts:1024-1123`; see [compaction](/openwiki/kernel/agent-context-compaction.md) for the
checkpoint contents).

The system prompt is built in two slots (static + dynamic) for provider prompt caching, folding in
instance instructions, the workspace's gadget registry and binding names, ambient capsule catalogs,
connectable vendors, and the standard output formats (`agent.ts:2192-2203`). Tools are passed as
the flat `toolList`; execution is `toolExecution: "sequential"`, `convertToLlm` is identity
(replay already produces LLM-shaped messages), and `shouldStopAfterTurn` ends the loop after the
turn in which the abort signal fired or the turn cap was hit (`agent.ts:3086-3110`).

Every event flows through one awaited `emit` sink: `message_update` events fan out provisional
`AiChatStreamEvent`s to connected clients (text deltas, reasoning, executeCode streaming,
writeFile/editFile live edit previews), and `turn_end` is the **persistence barrier** — one
transaction per completed model step that persists the step's tool-call message together with its
buffered code changes, created gadgets, and added bindings, so chat-content side effects are
durable **iff** the transcript record that explains them is (`agent.ts:2960-3070`;
`plans/step-transactionality.md:1-24`). Nothing from a failed or cancelled model request is
persisted; tool calls an abort pre-empted are recorded with the honest error `"Operation aborted"`
(`agent.ts:2964-2977`, `3004-3010`).

## Code Mode: the executeCode harness

The `executeCode` tool compiles the model's code into a **dynamic worker** and runs it
(`executeCodeMode`, `overseer.ts:7242-7360`):

- The worker definition embeds the fixed `CODE_MODE_HARNESS` (`overseer.ts:69-106`) plus the
  model-authored code as `agent.js`, with `disallow_importable_env` (no importable env or
  `ctx.exports`, so executed code cannot re-enter exports in a loop) and `globalOutbound: null`
  (no internet). The agent's `env` holds the chat's named bindings (`getEnvForAgent`,
  `overseer.ts:2748-2792`), each a loopback that resolves sessions with a `caller` of
  `{from: "agent", chatId}` — which is how observations and actions get attributed to the chat.
- A `self` stub (`AgentSelfLoopback`) lets executed code call back into the chat thread
  (`self.chat(...)`); one `resolve`/`reject` pair per agent-callback binding (`env.PARAMS_<n>`)
  is passed in as `callbackResolvers`.
- A transient `RestoreForgerImpl` capability (argument-scoped to this `run()` call, so it lives
  exactly as long as the execution) grafts the runtime `restore` symbol onto each gadget's service
  binding in `env`, letting executed code forge persistent gadget stubs for hooks
  (`overseer.ts:69-106`, `187-215`, `7320-7325`).
- A tail loopback captures the trace; logs are joined and returned to the model, raced against a
  5 s timeout, with uncaught exceptions appended (`overseer.ts:7335-7354`).

## The tool set

Defined via `defineTool` in the `tools` record (`agent.ts:2302-2856`), typed as `AiToolCall`
variants in `api.ts:2925-3103`:

| Tool | Purpose |
| --- | --- |
| `readFile` / `writeFile` / `editFile` | file tools over workpieces; reads record `observedCommit` for staleness detection |
| `executeCode` | Code Mode execution (above) |
| `describeBinding` | returns a binding's types (mandatory before first use — the prompt forbids guessing RPC APIs or enumerating `env`) |
| `createGadget` | create a workpiece, empty or from a blueprint; files copied into the chat's proposed changes |
| `setGadgetBinding` | wire one of the chat's bindings into a gadget's own `env` (provisional to the chat) |
| `listBlueprints` | formats first, then the owner's/library/featured blueprints |
| `listConnectableResources` / `requestConnection` | discover a vendor's URL patterns; ask the user to connect (turn ends; resumed on accept) |
| `webFetch` | public-HTTPS GET with Markdown conversion — a tool for the *agent*, not callable from gadget code (`web-fetch.ts:1-19`) |
| `observeUserChanges` | never called by the model; the system inserts synthetic calls when the user edits (`agent.ts:826-837`) |
| `giveUp` | added only for callback-initiated runs: reject all outstanding callbacks (`agent.ts:2857-2872`) |

Sub-agents (spawner chats) get a narrowed set: `describeBinding`, `executeCode`, and `giveUp` for
callback-initiated runs (`agent.ts:2875-2883`).

## Chat message model

The durable log (`AiChatMessageBody`, `api.ts:2559-2810`) distinguishes: `message` (user/agent/
gadget, with `toolCalls`, `capsules`, `attachments`), `slashCommand`, `changes` (an agent step's
code changes + `createdGadgets` + `addedBindings`, sequence-stamped), `merge` (accepts through
`mergeThrough`; may be an `epochBoundary`), `revert` (discards from `revertFrom`), `action` (a
captured approval-queue action id), `useGadget`, `error`, `agentCallback` (a pending `self.<method>`
call from gadget code, with storable args persisted separately), `agentNudge`, and
`connectionRequest` (accept/deny cards whose acceptance both binds the resource and resumes the
agent). Names claimed across the log are reconstructed by `prepareChatBindings` and
`chatScopeNames`, which simulate the replay loop's allocation (including `PARAMS_<n>`) so a new
resource can never collide with an existing name (`overseer.ts:6397-6556`, `6262-6273`).

## Agent callbacks and spawners

A gadget (or the agent) can call `self.someMethod(args)` inside a turn; the overseer queues it as
an `agentCallback` message and, on the *next* agent turn, exposes the stored args as
`env.PARAMS_<n>` with resolvers wired back to the pending queue (`overseer.ts:1228-1232`,
`7300-7318`, `8159-8181`). The **agent spawner** binding exposes `spawn(title, prompt)` and
`spawnCallable(title, prompt)` — the latter returns a storable stub whose calls deliver into a new
agent thread that starts waiting (`packages/workshop-backend/src/agent-spawner-binding.d.ts:1-26`).
Spawned chats see only the spawner's configured `env` bindings and the narrowed tool set.

## Attachments and slash commands

Chat attachments are uploaded to the Overseer (`chatAttachmentContent` collection), validated
against per-provider support (`assertChatAttachmentSupportedByProvider`) and image MIME rules, and
delivered either inline (images) or on demand via `getChatAttachmentContent`
(`overseer.ts:4496-4564`; `chat-attachment-validation.ts`). A PDF bridge rewrites Anthropic
document payloads (`chat-attachment-pdf.ts`).

Slash commands are collected from every attached gatekeeper advertising a provider, plus builtins
(`/compact`) (`slash-commands.ts:19-53`). Invoking a gatekeeper command passes an
`ObservationAuthorizer` so expansion text derived from protected data is authorized and audited;
the result is stored as an ordinary generated user message (`gatekeeper.ts:902-926`).
