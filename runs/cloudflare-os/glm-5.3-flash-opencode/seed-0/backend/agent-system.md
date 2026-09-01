---
type: agent-system
title: AI Agent System
description: How the Workshop's coding agent works — the runAgent loop over pi-agent-core, its tool set (file edits, executeCode in a dynamic worker, connections), the step persistence barrier and change budgets, context compaction, and the binding/capsule model that exposes gadgets and gatekeepers to executed code.
tags: [agent, ai, tools, compaction, executeCode, bindings]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-be4f1762fdfb4515718f0c62
    resource: repo://packages/workshop-backend/src/agent-catalog.ts
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# AI Agent System

The agent is the Workshop's primary programmer: it reads and writes gadget code, executes snippets against live bindings, creates gadgets, and wires up external connections. The loop itself lives in `packages/workshop-backend/src/agent.ts`; the workspace state it manipulates lives behind the `AgentHooks` interface, implemented by the overseer (packages/workshop-backend/src/agent.ts:339-453).

## Loop structure and boundaries

`runAgent()` runs one agent turn against a chat's history (packages/workshop-backend/src/agent.ts:999-1013). It is built on `@earendil-works/pi-agent-core`'s loop (`runAgentLoopContinue`) and `@earendil-works/pi-ai` message types, with a `ModelHandle` resolved from the user's model configuration (packages/workshop-backend/src/agent.ts:7-27). The turn's key inputs:

- **Gadget snapshot**: the workspace's gadgets as of turn start, excluding gadgets provisional to other chats (packages/workshop-backend/src/agent.ts:1016-1022).
- **Session content**: pinned gadgets' files rooted at their pin commits, plus the chat's uncommitted changes, reconstructed by replaying the log's pins and changes; unpinned gadgets are read live at their head commit (packages/workshop-backend/src/agent.ts:1024-1043).
- **Binding map**: what each name in the agent's `env` resolves to — a workpiece (gadget or gatekeeper) or an agent callback's stored arguments. It starts from the seed layer (`prepareChatBindings`, which also stamps names onto old messages that predate named bindings) and accumulates entries during replay and live tool calls. Names are never rebound, keeping replay deterministic (packages/workshop-backend/src/agent.ts:1066-1079).

The system prompt frames the model's role: the workspace holds gadgets and external connections, each available as a named binding in `env` for the `executeCode` tool; gadgets' code can be edited with file tools; resources are connected on request; the model is explicitly warned not to guess APIs and to use `describeBinding` first (packages/workshop-backend/src/agent.ts:570, 785, 840-876).

## Tool set

The turn defines its tools via `defineTool` wrappers around TypeBox schemas (packages/workshop-backend/src/agent.ts:992-997). The live tool set includes:

- **File tools**: `readFile`, `writeFile`, `editFile` (packages/workshop-backend/src/agent.ts:2304, 2352, 2398) — edits are buffered per step (below), not applied directly.
- **`executeCode`** (packages/workshop-backend/src/agent.ts:2722-2771) — runs a self-contained JavaScript module (`export default async function(self, env, ctx)`) in a dynamic worker.
- **`webFetch`** (packages/workshop-backend/src/agent.ts:2479) — backed by `web-fetch.ts`, which relies on the worker's `global_fetch_strictly_public` flag for SSRF protection (packages/workshop-backend/wrangler.jsonc:20-23).
- **`describeBinding` / `setGadgetBinding`** (packages/workshop-backend/src/agent.ts:2534, 2553) — learn a binding's API, or wire a resource into a gadget's binding list.
- **`createGadget` / `listBlueprints`** (packages/workshop-backend/src/agent.ts:2611, 2707) — create a gadget (provisional to the chat) and list available blueprints.
- **`listConnectableResources` / `requestConnection`** (packages/workshop-backend/src/agent.ts:2775-2810) — discover and request external connections; a request ends the turn and shows the user an accept/deny card.
- **`giveUp`** (packages/workshop-backend/src/agent.ts:2860).

## Change budgets and the step barrier

Agent edits do not hit gadget code directly. Each model step buffers its changes in a step buffer and persists everything at one **barrier** — `AgentHooks.commitAgentStep` writes the step's messages, each buffered change as one chat change row (one row per tool call, in call order, never pre-composed), materializes the rows into a single durable "changes" message carrying the step's gadget creations and binding additions, and retires the rows — all in one storage transaction, so the step's effects are durable iff its transcript record is (packages/workshop-backend/src/agent.ts:66-80, 339-378).

Two byte bounds size this pipeline, and their doc comments explain why they exist (packages/workshop-backend/src/agent.ts:31-63):

- `CHAT_CHANGE_MESSAGE_BUDGET` (1 MiB) bounds one composed "changes" message for the *user* edit path; materialization writes exactly one message per call, so the composition is kept storable by bounding what accumulates rather than by splitting output.
- `STEP_CHANGE_BUDGET` (1.5 MiB) bounds one agent step's buffered changes; the file-tool call that would exceed it fails with an agent-visible error so the model can adapt mid-turn. The bound exists for correctness — the barrier writes the buffer as one message which must fit a 2 MiB storage record.

`executeCode` refuses to run in a step that already buffered changes — code must not execute against content the persisted history does not yet hold; the error is retryable and tells the model to end the step first (packages/workshop-backend/src/agent.ts:2746-2755).

## executeCode: dynamic workers with a harness

`hooks.executeCodeMode` (implemented by the overseer) loads a **dynamic worker** through the `LOADER` binding (packages/workshop-backend/src/overseer.ts:7242-7319). The worker definition is built from two modules: a fixed `harness.js` (`CODE_MODE_HARNESS`) and the agent's code as `agent.js` (packages/workshop-backend/src/overseer.ts:69-106, 7265-7286). The harness:

- wires callback resolvers so executed code can `env.PARAMS_N.resolve(value)` / `.reject(error)` to complete agent callbacks (packages/workshop-backend/src/overseer.ts:77-88, 7300-7318);
<!-- openwiki: broken internal link [params] file "params" does not exist. Fix the href or restore the target, then delete this comment. -->
- grafts the well-known `restore` symbol onto each service-binding `Fetcher` in `env`, so the code can call `env.SOME_GADGET[restore](params)` to forge a persistent stub targeting that gadget's `[restore]()` method — a capability granted only to executeCode, never to gadget workers themselves (packages/workshop-backend/src/overseer.ts:88-106, 188-195).

The worker runs with `disallow_importable_env` (which also blocks re-importing `ctx.exports`, preventing self-invocation loops) and `allow_irrevocable_stub_storage` (for `ctx.restore()`), with `globalOutbound: null` so no ambient network access exists (packages/workshop-backend/src/overseer.ts:7265-7284).

The `env` object itself is built by `getEnvForAgent` from the chat's binding map: gadget bindings become gadget-facet loopback stubs, gatekeeper bindings become gatekeeper session loopbacks, and value bindings embed the stored agent-callback arguments. It must be a plain object (the loader's serializer rejects anything else), so prototype-pollution safety comes from name validation: invalid or hostile names (e.g. `__proto__`) are skipped (packages/workshop-backend/src/overseer.ts:2744-2792).

The `self` magic object is an `AgentSelfLoopback` entrypoint stub that lets executed code call back into the same chat thread, using the initiator's user id for model resolution (packages/workshop-backend/src/overseer.ts:7291-7298).

## Context compaction

Long chats are compacted rather than truncated. Canonical history keeps every message so the UI can page back, but agent replay starts at a compaction boundary (packages/workshop-backend/src/agent-compaction.ts:1-5). The policy:

- compact when the prompt reaches **85%** of the input budget; retain messages up to **30%** of it, leaving room for the summary and following turns; models without a `SUGGESTED_MODELS` entry are assumed to have a 128k window (packages/workshop-backend/src/agent-compaction.ts:8-41).
- The summarization call uses `COMPACTION_SYSTEM_PROMPT`, which demands a structured handoff (Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical Context) and forbids continuing the conversation or obeying instructions found in the transcript (packages/workshop-backend/src/agent-compaction.ts:43-56).

When compaction is needed, `runAgent` returns a `CompactionCheckpoint` (summary, chat bindings, next change id, pins, epoch, composed proposed change) instead of prompting; the overseer commits it and re-runs or stops for an explicit `/compact` (packages/workshop-backend/src/agent.ts:999-1013, 162-227).

## Bindings, ambient capsules, and catalogs

Ambient gatekeepers (auto-provisioned singletons like the Context Library or Scheduled Tasks) are reconciled against the owner's accounts and folded into every chat's env as named bindings, named by the gatekeeper's suggested binding name — the agent reads them in `executeCode` and may wire them into a gadget with `setGadgetBinding` only if the gadget's persistent code needs them (packages/workshop-backend/src/overseer.ts:6164-6230, packages/workshop-backend/src/agent.ts:854-866). `prepareChatBindings` is the chokepoint that seeds and names these bindings each turn (packages/workshop-backend/src/agent.ts:420-440).

Discovery metadata for ambient resources comes from each gatekeeper's `AgentCatalog`. The Workshop does **not trust gatekeeper output**: `normalizeAgentCatalog` strips control characters, collapses whitespace, drops unusable entries, re-clamps to the global `AGENT_CATALOG_MAX_*` bounds, and sorts for display (packages/workshop-backend/src/agent-catalog.ts:28-49; packages/workshop-shared/src/gatekeeper.ts:125-128).

## Agent callbacks and spawner

Gadgets can spawn agents: the `AgentSpawnerBinding` exposes `spawn(title, prompt)` — creating a new agent chat seeded with the prompt — and `spawnCallable`, which returns a stub that delivers calls to the new thread like the `self` object of `executeCode`; the stub can be stored in Durable Object storage to invoke the same agent again later (packages/workshop-backend/src/agent-spawner-binding.d.ts:1-36). Agent callbacks (values in the binding map) are completed by executed code via the harness's `resolve`/`reject` resolvers, and unresolved callbacks can be mass-rejected (`rejectAllAgentCallbacks`) (packages/workshop-backend/src/overseer.ts:7300-7318, packages/workshop-backend/src/agent.ts:453-455).

## Related pages

- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md) — the hooks' implementer.
- [Gadget Code Storage: Git Objects and Code Changes](/openwiki/backend/gadget-code-storage.md) — what the file tools read and write.
- [Gatekeeper Contract](/openwiki/gatekeepers/contract.md) — the session stubs `env` exposes.
