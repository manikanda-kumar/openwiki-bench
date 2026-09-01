---
type: "Reference"
title: "Agent and chat subsystem"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-1544c1a3e8233e50ede0f06a
    resource: repo://packages/workshop-backend/src/ai-invoke.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---


# Agent and chat subsystem

Every workspace's chat runs an agent loop that is genuinely a *coding* agent: it performs tasks by
writing and immediately executing snippets of code in a sandboxed Dynamic Worker. This page describes
how that loop is structured, how the model is reached, how the agent's view of the workspace
("bindings") is built, how its edits flow into committed code, and how long chats stay within the
model's context window.

## Ownership and decoupling: `AgentHooks`

The agent loop lives in `packages/workshop-backend/src/agent.ts` and is a self-contained function,
`runAgent()`, that knows nothing about Durable Object storage. Everything it needs from the workspace
is passed through the `AgentHooks` interface (`agent.ts:339`): resolving chat contexts, reading and
writing code (`getGadgetHead`, `readCommitFiles`, `changedPaths`, `commitAgentStep`), enumerating
gadgets, describing bindings, preparing chat bindings, running code (`executeCodeMode`), resolving
agent callbacks, listing connectable vendors/resources, requesting connections, listing blueprints,
and emitting stream events.

The Overseer (`OverseerImpl` in `overseer.ts:1397`) implements `AgentHooks`. The two files are the
two halves of the agent subsystem: `agent.ts` is the prompt/replay/tool-call engine, `overseer.ts` is
the durable workspace state, storage, and RPC plumbing. This split keeps the model-facing logic
testable without a Durable Object.

## The Code Mode agent and the executeCode sandbox

A turn runs by reconstructing the model context from the chat log and streaming against the model.
The model expresses work as **tool calls**; the primary tool is `executeCode`. When the model invokes
it, the overseer's `executeCodeMode()` (`overseer.ts:7242`) loads a **one-off Dynamic Worker** through
the `LOADER` binding:

```ts
let workerDef: WorkerLoaderWorkerCode = {
  compatibilityDate: "2026-02-01",
  compatibilityFlags: [
    "disallow_importable_env",   // also disallows importable ctx.exports (no self-recursion)
    "allow_irrevocable_stub_storage",  // makes ctx.restore() available
  ],
  mainModule: "harness.js",
  modules: { "harness.js": CODE_MODE_HARNESS, "agent.js": code },
  env: this.getEnvForAgent(chatId, bindings),
  tails: [...],
  globalOutbound: null,          // no internet access whatsoever
};
```

The worker is fully sandboxed: `globalOutbound: null` disables network access, and the harness
(`overseer.ts:69`) wraps the agent's code in a `WorkerEntrypoint` whose `run(self, callbackResolvers,
restoreForger)` grafts a `restore` symbol onto each binding so executed code can forge persistent
stubs, then invokes the agent's default export. `verify()` is called first so startup errors surface
as total failures. Output flows back through a tail loopback (`CodeModeTailLoopback`) rather than any
shared channel, and the call resolves with the captured logs (plus the stack of any uncaught
exception).

Only `executeCode` receives the *restore forger* capability (`RestoreForgerImpl`, `overseer.ts:192`),
a transient stub scoped to the single `run()` call. It lets executed code create persistent hook
callbacks targeting a gadget's `[restore]()` method; the binding name is resolved on the overseer
side, so the capability carries no authority beyond the `env` it accompanies.

Other tools the loop replays and dispatches include `readFile`, `writeFile`, `editFile`,
`describeBinding`, `setBindingHook`, `saveCapsuleAsBinding`, `setGadgetBinding`, `createGadget`,
`webFetch`, `observeUserChanges`, `listBlueprints`, `listConnectableResources`, `requestConnection`,
and `giveUp` (`agent.ts:1522-1700`).

## Chat bindings: the agent's `env`

The agent's sandboxed worker gets an `env` object built by `getEnvForAgent()` (`overseer.ts:2748`)
from the chat's **binding map** — a set of named entries, each resolving to a workpiece (a gadget or a
gatekeeper facet) or to a stored callback argument. These are the names the agent reads as
`env.NAME`. Every name is validated by the shared `validateBindingName()` chokepoint in
`workshop-shared/src/api.ts`, which rejects names that are not safe JS identifiers or that collide
with `Object.prototype` members; invalid names are skipped rather than poisoning the env object
(`overseer.ts:2757-2764`).

The map is seeded and maintained by `prepareChatBindings()` (`overseer.ts:6397`):

- The **seed layer** comes from the workspace's default binding list plus the **ambient capsules** —
  auto-provisioned gatekeeper singletons (e.g. the Context Library) whose sessions the chat gets
  automatically. The ambient set is *frozen on first use* (`alwaysAvailableCapsuleIds`), so
  singletons gained later only appear in chats started afterwards. Each ambient resource is named by
  its gatekeeper's `suggestedBindingName`.
- Binding names are also **stamped onto persisted chat messages** that lack them (capsules and
  connection requests), reusing an existing in-scope name when there is one, else asking the "quick"
  model, else falling back to a uniquified `suggestedBindingName`. Names are never rebound, so
  resolution is replay-deterministic.
- The seed map is persisted on the chat's `ChatAgentContext` and replayed consistently from the
  checkpoint after compaction.

A **spawned chat** (one started by an agent spawner) sees only the bindings its spawner configured
(`overseer.ts:6416-6435`).

## Proposed changes: from tool calls to commits

The agent never writes to mainline directly. Its `writeFile`/`editFile`/`createGadget` results are
recorded as **"changes" chat messages** describing *proposed* code changes against the chat's
session content. Each step is persisted through `commitAgentStep()` (via the `AgentHooks` contract,
`agent.ts:370`); a step that dies before its persistence barrier leaves only an unstamped gadget
record, which `reconcilePendingGadgets()` reaps on the next turn.

A human (or the agent's own flow) later:

- **merges** the proposed changes into mainline (`mergeChanges`, `overseer.ts:3491`) — a three-way
  merge against the chat's last merged commit, producing `conflictPaths` with inline diff3 markers
  (see the git-store page); or
- **reverts** them (`revertChanges`, `overseer.ts:3772`), discarding from `revertFrom` onward.

The single rule for which batches are still proposed (and which sequences are merged/reverted) is
`foldProposedChanges()` / `chatChangeStatuses()` in `agent-compaction.ts:102-158`, shared by agent
replay, chat-doc construction, and the merge/revert guards.

## Context compaction

Long chats stay inside the model window through **compaction** (`agent-compaction.ts`):

- Compaction triggers when the prompt reaches 85% of the input budget (`COMPACTION_TRIGGER_RATIO`)
  and targets 30% for retained messages; the budget is derived from the model's context window minus
  the reserved response capacity (`getModelTokenLimits`).
- The **boundary** is chosen by walking the projected messages backward and then snapping to a record
  boundary (`findCompactionBoundary`), never splitting a tool result from its call. It is lowered
  past nothing that holds live state: a pending connection request protects its whole turn
  (`findProtectedFromSequence`), and retained reverts are kept with the change IDs they report
  (`protectRetainedReverts`).
- A summarization call (with `COMPACTION_SYSTEM_PROMPT`, which tells the model to ignore instructions
  in the transcript) produces a **handoff**, and `buildCompactionState()` folds everything before the
  boundary into a `CompactionCheckpoint`: the chat bindings, pins, epoch, next change id, and the
  composed `proposedChange`. Canonical history keeps every message, so the UI can still page back.
- A user can force it with the `/compact` slash command; such a turn compacts and then ends.

The overseer stores checkpoints per chat (`getActiveChatCompaction`, `#commitChatCompaction`,
`rollbackChatCompaction`), and the turn loop reruns after an automatic compaction because the shorter
history changes the prompt.

## Auto-approval of gatekeeper actions

Gatekeeper actions normally wait for a human to approve. Users can opt in to **auto-approving** a
specific action *kind* (tag) for a gatekeeper; the `AutoApprovalDrainer` (`auto-approval.ts`) then
applies eligible pending actions automatically:

- Eligibility requires **both** signals: the action's own `autoApprovable: true` verdict (set by the
  gatekeeper author) *and* a user-enabled `autoApproveTags` rule for the action's `actionKind.tag`.
- The drain applies eligible actions in ascending id order and **stops at the first manual gate or
  failure** — it never skips ahead past an action that needs human review.
- A per-gatekeeper single-flight guard folds concurrent drains together, and each action is re-checked
  immediately before applying. Auto-approvals are attributed to the user who enabled the rule.

The drain is triggered from the overseer whenever pending actions change (`drainAutoApprovals`).

## AI model routing and cost accounting

Inference is routed by `getModel()` (`ai-models.ts:356`), which returns a `ModelHandle` — a resolved
pi model descriptor plus a `stream()` closure that carries the routing and auth, so callers never
handle credentials. Three modes, in priority order:

1. **User BYOK gateway** — when the free tier is exhausted and the user has a connected Cloudflare
   account, requests route through the *user's own* AI Gateway (`getModelViaUserGateway`), billing
   their Cloudflare credits under unified billing. Honored whenever a `userGateway` routing is
   supplied, regardless of platform gateway configuration.
2. **Platform AI Gateway** — when the deployment configures one (`CF_AI_GATEWAY*`), all free-tier
   requests route through it via each provider's native API (never the /compat translation layer,
   which drops features pi relies on). The `WORKERS_AI` binding is the transport when present,
   otherwise a token over HTTPS.
3. **Direct provider access** — with the model config's own API token/URL.

Every provider including Workers AI rides the same gateway in gateway mode, and each handle carries
an `aiGatewayLogRoute` used for cost accounting (the overseer reads the gateway log cost per
request; see `#getCostFromAiGateway`).

One-shot completions (titles, binding names, compaction summaries, `LanguageModelBinding.run`) go
through `completeText()` (`ai-invoke.ts:52`), which always requests thinking off and converts pi's
error-shaped assistant messages back into an `AgentTurnError` (carrying the HTTP status when known)
so callers can triage.

## The turn lifecycle and failure handling

`#runAgentTurnWithContext` (`overseer.ts:5716`) is the per-turn driver:

1. Reaps orphaned provisional gadgets and materializes any live rows into a durable "changes"
   message.
2. For a user-initiated turn, enforces the optional free-tier usage limit via
   `checkUsageAndBalance`; if the flow says "use your own gateway", it resolves the BYOK routing and
   refreshes the cached balance when the turn completes (`refreshCachedBalance`, background).
3. Resolves the model (with session affinity), then loops `runAgent()` until the history is stable.
   Callback-initiated turns continue while callbacks remain outstanding, nudging the agent once and
   then rejecting leftover callbacks (`giveUp`-style) if no progress is made.
4. Errors are triaged: expected provider 4xx are ordinary control flow; 5xx and unknown failures are
   reported via `reportIssue` and a user-visible error message is posted.

An agent turn is registered while running (`#registerRunningAgent`) so a second `sendChatMessage`
fails with `AGENT_RUNNING_ERROR_MESSAGE`; on completion the active-agent state, registry entry, and
keep-alive alarm are torn down together, queued callbacks are delivered, and waiting external-message
responses are flushed.

## Agent spawners

An **agent spawner** is a gatekeeper-like workpiece (created by `newAgentSpawnerGatekeeper`,
`overseer.ts:9409`) that carries a spawner config — display name, the model to use, and an `env` that
maps binding names to other workpieces. A spawner's `startSession` starts a chat **spawned** by that
config: the chat's seed bindings come only from the spawner's configured env (entries whose targets
no longer exist are dropped), so a spawned chat is a scoped sub-agent. The creating user's DO id is
stored in the spawner props so the model can be resolved at trigger time from the correct account
(see the sharing page's resource-isolation notes).
