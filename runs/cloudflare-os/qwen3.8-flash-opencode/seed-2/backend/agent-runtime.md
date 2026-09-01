---
type: runtime-subsystem
title: Agent Runtime and Tools
description: How the Workshop's coding agent runs — the pi-agent-core loop, its tool surface, the executeCode dynamic-worker sandbox, step-transactional persistence with size budgets, context compaction, and model/billing routing.
tags: [agent, tools, code-mode, compaction, ai-gateway]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-9b6f6a87a13c3accb0afc329
    resource: repo://docs/ai-gateway-billing.md
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-64b029899e771aec2fb6dfef
    resource: repo://packages/workshop-backend/src/external-message-gateway.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Agent Runtime and Tools

The agent is a Code-Mode loop: instead of one tool per operation, it mostly writes JavaScript snippets and executes them against capability bindings. `runAgent()` in `packages/workshop-backend/src/agent.ts` drives one turn, taking an `AgentHooks` facade (implemented by the workspace Overseer), a `ModelHandle`, the chat id, message history, an abort signal, and a `CompactionContext` (packages/workshop-backend/src/agent.ts#L1004-L1013). The loop engine is `@earendil-works/pi-agent-core`'s `runAgentLoopContinue`, with tools typed via TypeBox schemas; `defineTool` keeps `execute`'s params typed by the schema while pi validates call arguments at runtime (packages/workshop-backend/src/agent.ts#L992-L996, #L3101). Provider failures never throw out of pi: they surface as a final assistant message with `stopReason "error"/"aborted"`, the turn is rethrown to the Overseer's triage only after the loop settles, and *nothing from a failed turn is persisted* (packages/workshop-backend/src/agent.ts#L2885-L2893).

At turn start the agent snapshots the workspace's gadget registry and reconstructs the chat's *session content* — pinned gadgets replayed from the chat's commit pins plus uncommitted changes, with unpinned gadgets read live at a head fixed on first observation, so one turn sees a consistent tree even if mainline advances mid-turn (packages/workshop-backend/src/agent.ts#L1017-L1048).

## The tool surface

The main tool map declares: `readFile`, `writeFile`, `editFile`, `webFetch`, `observeUserChanges`, `describeBinding`, `setGadgetBinding`, `createGadget`, `listBlueprints`, `executeCode`, `listConnectableResources`, `requestConnection` (packages/workshop-backend/src/agent.ts#L2302-L2856). Two contextual adjustments:

- A **callback-initiated** run (resumed by a registered hook firing) additionally gets `giveUp`, which rejects all pending callbacks with an explanation (packages/workshop-backend/src/agent.ts#L2859-L2873).
- **Spawned sub-agent** chats (from an `AgentSpawnerGatekeeper`) are restricted to `describeBinding` + `executeCode` (+`giveUp`) — sub-agents may inspect and call bindings in code, not use the editing/connection surface (packages/workshop-backend/src/agent.ts#L2877-L2883).

The prompt encodes deliberate API-discovery discipline: bindings in `env` implement no familiar API, so the agent must call `describeBinding` (which returns the gatekeeper/gadget's TypeScript types) before `executeCode`, and `editFile`/`writeFile` calls for one message should be issued in parallel (packages/workshop-backend/src/agent.ts#L570-L870). `requestConnection` shows the user an accept/deny card without blocking — the turn ends and resumes on the user's decision (packages/workshop-backend/src/agent.ts#L876, #L2794). `webFetch` is a tool for the *agent*, not gadget code — gadget runtime code cannot network at all (packages/workshop-backend/src/agent.ts#L815).

## executeCode: the code-mode sandbox

`executeCode` requires a complete self-contained ES module exporting `async function(self, env, ctx)`; `env` holds the chat's bindings and `self` is a magic object that calls back into the chat (packages/workshop-backend/src/agent.ts#L2722-L2748). Execution happens in the Overseer: a `CODE_MODE_HARNESS` dynamic worker wraps the user code, injecting callback resolvers and the `restore`-forging machinery into `env` before invoking the exported function (packages/workshop-backend/src/overseer.ts#L69-L106). The chat's env bindings come from `prepareChatBindings`, which freezes the ambient singleton set (gatekeeper capsules of type `ambient`, ordered by immutable gatekeeper id for determinism) on first use of the chat (packages/workshop-backend/src/overseer.ts#L6397-L6412).

A **step-transactionality guard** rejects `executeCode` in any step that already buffered code edits: buffered edits only become durable at the step's persistence barrier, so executing against un-persisted content could lose edits a crash would orphan — the model is told to split the step (packages/workshop-backend/src/agent.ts#L2739-L2749).

## Step barrier and size budgets

File-tool edits don't write rows directly; they accumulate in a per-step buffer, and at the end of each step the loop calls `hooks.commitAgentStep` as a single persistence barrier that appends one chat change row per tool call, in call order (preserving per-call correspondence for client-side streaming edit previews) (packages/workshop-backend/src/agent.ts#L3060-L3072; AgentHooks contract at #L339-L370; row semantics at #L62-L80).

Two byte budgets exist for correctness, not tuning (packages/workshop-backend/src/agent.ts#L34-L65):

- `STEP_CHANGE_BUDGET = 1536 KiB` bounds one step's buffered changes, because the barrier writes them as *one* message that must fit the 2 MB Durable Object storage record (envelope included); an over-budget file write fails with an agent-visible error while everything buffered before it persists normally, letting the model adapt mid-turn.
- `CHAT_CHANGE_MESSAGE_BUDGET = 1024 KiB` bounds what *accumulates* on the user-edit path: `submitCodeChange` materializes pending rows before appending one that would push their summed size past the budget, because an unstorable composition would wedge materialization forever.

## Compaction

Before each turn the agent estimates the projected context tokens (measured checkpoint tokens plus an estimate of the retained projection, system prompt included); when the estimate crosses the model's input budget (`shouldCompactChat`), it computes a compaction boundary (`findCompactionBoundary`), protects recent revert-relevant sequences (`protectRetainedReverts`, `findProtectedFromSequence`), and runs a summarizing turn whose `CompactionCheckpoint` replaces the elided prefix; a `compacting` stream event notifies the UI (packages/workshop-backend/src/agent.ts#L2218-L2232; packages/workshop-backend/src/agent-compaction.ts#L58-L65, #L315, #L354). Chat history elision is replay-safe: change IDs stay sequential across boundaries and replayed tool results are re-derived from stored commits (see [The Overseer Workspace Object](overseer-workspace.md)).

## Models and billing

`getModel()` resolves a `ModelHandle` with a three-way routing policy: if the user connected their own Cloudflare account (BYOK), everything — every provider, including Workers AI — routes through *their* AI Gateway with unified billing; else if a platform AI Gateway is configured it routes there (platform-funded); otherwise it calls the provider directly with the configured token (packages/workshop-backend/src/ai-models.ts#L356-L379). The platform gateway config comes from `getAiGatewayConfig(env)`, and per-request cost/audit trails are looked up via `getAiGatewayLogCost` with the log id the handle records (packages/workshop-backend/src/ai-gateway.ts#L152-L176; lastResponse.aiGatewayLogId consumed at the barrier, packages/workshop-backend/src/agent.ts#L3068-L3071). The daily-allowance-then-user-credits flow is optional and env-gated (`ENABLE_CLOUDFLARE_LIMITS`), enforced before each non-callback agent run by `checkUsageAndBalance` — which can block the turn or hand back BYOK routing that bills the user's own gateway (packages/workshop-backend/src/overseer.ts#L5750-L5772; docs/ai-gateway-billing.md#L1-L5). Model providers offered to users, and the admin's instance instructions injected into prompts, are configuration — see [Admin Settings and Configuration](../operations/admin-and-configuration.md) and [How to Change Agent Behavior](../guides/agent-behavior.md).

## Outside-the-chat entry point

The `ExternalMessageGateway` WorkerEntrypoint lets an external channel service deliver a prompt into a gadget: it namespaces `gadgetKey`/`chatKey`/`messageKey` by the binding-owned `source` prop (preventing cross-gateway id collisions) and forwards to `OverseerDurableObject.receiveExternalMessage` with an idempotency key (packages/workshop-backend/src/external-message-gateway.ts#L10-L34).

## Gadget authoring knowledge

`agent.ts` also embeds the system prompt that teaches the agent how Gadgets are written — server.js as a `DurableObject` class with no network access, client.js building the whole DOM in a sandboxed iframe (no `index.html`, no modal `alert()`/`confirm()`), `.dup()` + `onRpcBroken` subscription patterns, the `[restore]`/`ctx.restore` hook recipe, print-CSS export conventions, and `gadgetExportFormatId` (packages/workshop-backend/src/agent.ts#L570-L780). Changing prompt text changes agent behavior repo-wide; treat it like kernel surface (see [How to Change Agent Behavior](../guides/agent-behavior.md)).
