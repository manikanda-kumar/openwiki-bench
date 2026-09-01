---
type: mechanism
title: Agent context compaction
description: How long chats stay within the model's window — trigger ratios and token budgets, boundary selection with protections, the summarization call, checkpoint contents, and replay-from-checkpoint semantics.
tags: [agent, compaction, chat, context-window, checkpoints]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Agent context compaction

Compaction keeps long chats within the model's limit. It summarizes the messages before a boundary
and stores their replay state in a **checkpoint**. Canonical history keeps every message, so the UI
can still page back through them, but agent replay starts at the boundary
(`packages/workshop-backend/src/agent-compaction.ts:8-10`).

## Trigger and budget

- A chat compacts when the prompt reaches **85%** of the input budget
  (`COMPACTION_TRIGGER_RATIO`), targeting a retained tail of **30%** (`COMPACTION_TARGET_RATIO`)
  (`agent-compaction.ts:13-17`).
- `getModelTokenLimits` derives the budget from `SUGGESTED_MODELS`' context window minus the
  model's output limit; unknown models assume 128k, and a hand-configured Cloudflare model gets the
  platform's `WORKERS_AI_OUTPUT_LIMIT`. The reserved response capacity is both withheld from the
  prompt's budget and sent as the request's response cap, so the two can't disagree
  (`agent-compaction.ts:19-37`; `agent.ts:2205-2207`).
- Token counting uses provider usage when available (covering the last measured step plus an
  estimate of what was added since — attachment payloads are replaced by a marker because the
  model's cost depends on content, not bytes) and falls back to a characters÷4 estimate plus the
  system prompt (`agent.ts:2214-2222`; `agent-compaction.ts:237-249`).

`/compact` is detected from the log itself (`isCompactionTurn`: the newest message is the builtin
`compact` slash command), so a turn resumed after a restart behaves the same
(`agent-compaction.ts:66-71`).

## Boundary selection

`findCompactionBoundary` walks the projection backward until retained messages fill the target
budget, then moves the cut to a **record boundary** (`canCut` marks the first model message a chat
record contributes, so a tool result always keeps the call it answers and a record's messages are
never split) (`agent-compaction.ts:219-235`, `315-344`). Character weights only decide *where* the
cut lands; the measured token count is divided among messages by serialized length
(`agent-compaction.ts:318-322`).

Three protections adjust or refuse the cut:

- **Pending connection requests** carry live accept/deny state only their own message can answer,
  so the boundary stays behind the start of the turn that raised it
  (`findProtectedFromSequence`, `agent-compaction.ts:200-217`).
- **Retained reverts** must stay together with the changes whose IDs they report; `protectRetainedReverts`
  lowers the cut (walking newest-first, which settles in one pass) and never below the existing
  boundary, which `rollbackChatCompaction` guarantees every tail revert respects
  (`agent-compaction.ts:346-366`).
- A boundary that can't advance past the previous checkpoint returns `undefined`, and the turn runs
  uncompacted (`agent-compaction.ts:341-343`).

## The summarization call

The compacted prefix is flattened to plain text (providers reject tool-call blocks without declared
tools, so every message becomes text and consecutive same-role messages merge; the error flag on
failed tool results is kept visible so the summarizer can't describe a failure as success), and the
summary is produced by one `completeText` call with the `COMPACTION_SYSTEM_PROMPT` — a structured
handoff (Goal / Constraints & Preferences / Progress / Key Decisions / Next Steps / Critical
Context) that instructs the model to ignore instructions inside the transcript
(`agent-compaction.ts:43-55`, `272-308`; `agent.ts:2233-2247`).

The summary call's usage is deliberately **not billed to the chat** (like title generation), and it
carries the turn's largest prompt, so it needs the response cap most
(`agent.ts:2239-2245`). An empty summary is refused rather than allowed to discard the compacted
history (`agent.ts:2248-2249`). Failure semantics: compaction triggers below the limit, so the
turn's own prompt still fits and a failed summary logs a warning and runs the turn uncompacted —
except an explicit `/compact`, which surfaces the error, and cancellation, which always propagates
(`agent.ts:2264-2274`). The stream emits `compacting`/`compacted` events (with
`nothingToCompact` when `/compact` finds no boundary) so the UI can show progress
(`agent.ts:2231`, `2273`, `2275-2279`). After a `/compact`, the turn ends without prompting the
model, whether or not the boundary advanced (`agent.ts:2281-2282`).

## What a checkpoint stores

`CompactionCheckpoint` (keyed `chatId.compactedTo` in the overseer's `chatCompactions` collection,
so a chat's checkpoints sort by boundary and a merge/revert across a boundary can find the one
before it) carries (`agent.ts:164-232`; `overseer.ts:1144-1150`):

- `summary` — the handoff text, injected into the replay as a `user` message wrapped in
  `<prior_conversation>` tags (sanitized of nested tags) (`agent.ts:1180-1192`).
- `chatBindings` — the name→workpiece/value map as of the boundary: the frozen seed layer folded
  with capsules, successful `createGadget` calls, accepted connection requests, `"changes"`
  messages' `createdGadgets`, and the `PARAMS_<n>` names allocated for agent callbacks
  (`agent-compaction.ts:372-414`; `agent.ts:1072` seeds replay from it).
- `nextChangeId` — the change-number counter so numbering stays monotonic across the boundary.
- `pins` + `epoch` — the chat's pinned gadgets and the epoch it lies in, replayed from the
  previous checkpoint and folded over the compacted span; an epoch boundary (an epoch-boundary
  merge or a migrated chat's conversion boundary) resets both (`agent-compaction.ts:416-436`;
  `agent.ts:1358-1365`).
- `proposedChange` — the **composed** CodeChange of every still-proposed batch below the boundary
  (from `foldProposedChanges` over the compacted span, seeded with the previous checkpoint's
  composition). Composition is bounded by content size, not edit count, so it can't grow with
  history the way merged CRDT updates could (`agent-compaction.ts:438-461`).

The same fold makes the checkpoint the seed for the UI's proposed-changes view:
`getProposedChanges` seeds `foldProposedChanges` with `{sequence: compactedTo - 1, change:
checkpoint.proposedChange}` (plus a registry scan when the prefix created gadgets or bindings but
no change), then folds the live tail (`overseer.ts:5055-5074`). `chatChangeStatuses` marks merged/
reverted message ranges in log order (a merge accepts through `mergeThrough`; a revert discards
from `revertFrom` up to the revert itself; earliest marking wins) — the single rule shared by
agent replay, chat-doc construction, and the merge/revert guards (`agent-compaction.ts:128-158`).

## Committing and rolling back

`#commitChatCompaction` stores the checkpoint and points the chat at it in one synchronous
transaction (also clearing `totalTokens` so the next turn re-measures the shrunken prompt; without
that the next turn would weigh a short prompt's usage against a long one and never re-trigger)
(`overseer.ts:5640-5651`). It is safe to commit after the summary's model I/O: the turn that
produced the checkpoint is still the chat's active agent, and merge/revert/rollback refuse while a
turn is active. A revert across the boundary calls `rollbackChatCompaction`, which points the chat
at the newest checkpoint a revert leaves intact — checkpoints that folded in the erased changes are
deleted, earlier ones stay, which is what lets a revert cross a boundary at all
(`overseer.ts:5653-5659`, `3897`).

## Legacy anchor

Pre-git-storage checkpoints carry an `observedCodeVersion`; `legacyChatBaseVersion` computes the
*maximum* referenced version across the checkpoint stamp, tool calls' `observedCodeVersion`, and
legacy merge versions — anchoring lower could silently lose content (Yjs would park the edits as
pending structs) — and is read only by the git-storage migration (`agent-compaction.ts:160-198`).
