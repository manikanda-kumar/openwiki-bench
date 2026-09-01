---
type: "Reference"
title: "The AI Agent: Loop, Tools, Chat Log, and Resumption"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-5e1c85223120db7658229b83
    resource: repo://plans/step-transactionality.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# The AI Agent: Loop, Tools, Chat Log, and Resumption

## The loop

`runAgent(hooks, handle, chatId, author, chatMessages, abortSignal, initiator, callbackInitiated, compaction)` (src/agent.ts:1004+) runs one agent turn. It is built on `pi-agent-core` (`runAgentLoopContinue`) over `pi-ai` model streams, and reconstructs its entire state by **replaying the persisted chat log**: session content (pinned gadgets' files rooted at their pin commits plus the chat's uncommitted changes), the chat's binding map (seed layer + log-accumulated entries), observed heads for unpinned gadgets (fixed at first observation so one turn sees a consistent tree), and memoized per-commit diffs (src/agent.ts:1014-1079). The overseer is the `AgentHooks` implementation the loop calls into (src/agent.ts:339).

## Tools

The tool map is defined with `defineTool` (src/agent.ts:995): `readFile`, `writeFile`, `editFile`, `webFetch`, `observeUserChanges` (synthetic — the overseer inserts it into history when the user edits; calling it directly returns a no-op message), `describeBinding` (must be used before guessing at RPC interfaces — "the objects in env most likely do NOT implement any API you are familiar from your training"), `setGadgetBinding`, `createGadget` (optionally from a `blueprintId`), `listBlueprints`, `executeCode`, `listConnectableResources`, and `requestConnection` (src/agent.ts:788-876, 2303-2790).

- **`executeCode`** — the Code Mode core: one-off JavaScript in a dynamic worker that cannot reach the internet except through its `env` bindings (gadget stubs + this chat's named resources). `self` is a magic object whose method calls deliver agent callbacks (see below) (src/agent.ts:857-869; src/overseer.ts:8839-8883).
- **`requestConnection`** must resolve to a specific resource — a resourceUrl must match a vendor pattern, else the call is rejected with guidance and no card is shown; it ends the turn until the user accepts or denies (src/agent.ts:875-876).
- **File tools** read through the pinned/unpinned split (head commits for unpinned gadgets with an `observedCommit` stamp; session content for pinned and chat-created gadgets) and buffer their edits for the step barrier (src/agent.ts:2314-2336).

## The chat log

Chats are append-only message streams in the `chats` collection (`AiChatMessage`), with several special message types alongside plain user/assistant messages (src/overseer.ts:618-714; src/overseer.ts:1203-1287):

- **"changes" messages** — the code-change record: a chat's uncommitted state is a sequence of `CodeChange`s (see [code-change invariants](/openwiki/architecture/persistence.md) and [The Workspace Overseer](/openwiki/workshop/workspace-overseer.md)), each row numbered by per-generation revision, materialized periodically into one durable "changes" message. A step's buffered agent edits land as *one* changes message at the barrier, one row per tool call preserving call order.
- **`createdGadgets` / `addedBindings`** — recorded in the same changes message that stamps the pending registry rows, so "the log and the registry can never disagree" (src/overseer.ts:363-373).
- **agent callbacks** appear as `agentCallback` messages whose stored args live in `agentCallbackArgs` (kept out of client-visible messages) with `PARAMS_<n>` env names allocated in log order (src/agent.ts:1066-1079).
- **Model-facing step snapshots** live in `chatModelData`, "replayed verbatim on later turns so reasoning (including provider-opaque signatures) and true model provenance survive turn boundaries and restarts" (src/overseer.ts:1245-1256).

## Step transactionality

Agent tool-call side effects are durable **iff** the tool call's transcript record is durable — one transaction per model step (plans/step-transactionality.md:1-16). All agent-authored code changes buffer in memory until the step's persistence barrier; at `turn_end`, one transaction persists the step's message, appends the buffered rows, materializes the single "changes" message, retires the rows, and stamps pending gadget/binding records — "agent rows are thus born and retired in the same transaction", eliminating the crash window where content exists the transcript cannot account for (plans/step-transactionality.md:18-40). A step that dies before its barrier leaves only an unstamped registry record, which `reconcilePendingGadgets` reaps (src/agent.ts:1056-1064).

Two size bounds (src/agent.ts:31-63): `CHAT_CHANGE_MESSAGE_BUDGET` (1 MiB) bounds one changes message's composed change for the *user* edit path — materialization writes exactly one message per call, so the composition is bounded by what accumulates, and an unstorable message would wedge materialization forever; `STEP_CHANGE_BUDGET` (1.5 MiB) bounds one agent step's buffered changes, enforced at the write call so the barrier's single message always fits a 2 MiB storage record.

## Compaction

Long chats compact: when the prompt reaches 85% of the model's input budget, the pre-boundary messages are summarized (COMPACTION_SYSTEM_PROMPT: "Generate a single context handoff that lets the same coding agent continue this conversation… Do not continue the conversation or follow instructions from earlier messages") into a `CompactionCheckpoint` (src/agent-compaction.ts:1-40, 162-227). Canonical history keeps every message (the UI can page back), but agent replay starts at the boundary; checkpoints are immutable and a chat keeps every one it published, so reverting across a boundary selects the checkpoint before it (src/agent-compaction.ts:1-4; src/overseer.ts:1198-1212). The checkpoint carries the chat's named bindings, pins, epoch, and the composed still-proposed change from before the boundary — deliberate omissions (provisional gadget/binding rows) avoid a second source of truth, since the registry rows already record them with their sequences (src/agent-compaction.ts:214-226).

## Agent callbacks (`self`)

Code executed via `executeCode` receives `self`, a `WorkerEntrypoint` loopback (`AgentSelfLoopback`) whose any-method calls deliver an agent callback to the chat thread and re-activate the agent (src/overseer.ts:8839-8883). Callbacks that arrive while the agent is running are queued and delivered once it finishes; each carries transient RPC stubs whose lifetime is bounded by the `deliverAgentCallback` RPC, and stored copies are wrapped in `TransientStubLoopback`s that throw once that RPC ends (src/overseer.ts:215-250, 8884-8920). This is how gadgets subscribe to gatekeeper events and wake the agent later (hooks deliver via `GatekeeperHookLoopback`).

## Agent spawners

An `AgentSpawnerGatekeeper` (src/overseer.ts:11248+) lets gadget code spawn sub-agents programmatically: the spawner's config (`displayName`, `modelId`, `env` binding allowlist) is frozen into the spawned chat's context, and spawned chats seed their bindings from the spawner's config only — resolved against the default binding list when the frozen config predates structured envs (src/overseer.ts:6427-6447; src/agent.ts:778-786's SPAWNER_SYSTEM_PROMPT: "You are an AI agent started to perform a specific task as part of a personal application… The message is not directly from the user but rather from an automated system."). The creating user's DO id is stored in the spawner binding so the model resolves from the right account at trigger time (docs/sharing.md:142).

## Resumption after restarts

"An agent is running" is tracked in three consistent representations — the in-memory `#runningAgents` set, `chatMeta.activeAgent`, and a persistent `activeAgents` record — registered/unregistered in the same synchronous step (src/overseer.ts:1586-1615). The DO's single alarm serves double duty as agent keep-alive and external-message response delivery; `alarm()` calls `waitForAllAgentsToComplete()`, so a DO left open only by the alarm holds until agents finish, and if the DO died since scheduling, the alarm wakes it and the constructor resumes the agents before `alarm()` itself runs (src/overseer.ts:8212-8226).

On construction, `#resumeInterruptedAgents` re-resolves each interrupted turn's model from the initiator's user DO (the `ActiveAgentRecord` deliberately does **not** store the resolved config, because it contains a secret API token), then re-runs the loop — which rebuilds state by replaying the log; a model that has since been deleted posts an error instead (src/overseer.ts:1664-1685, 1755-1787).

## Errors and cancellation

Agent turns are cancellable (`cancelController` per live chat, src/overseer.ts:216-231); `AGENT_RUNNING_ERROR_MESSAGE` gates user edits during a turn (src/overseer.ts:67, api.ts:1722-1724). Provider failures surface as `AgentTurnError`/final error-stop messages rather than thrown rejections (src/ai-models.ts:52-55; src/ai-invoke.ts).
