---
type: concept
title: "Gadgets: Lifecycle, Code, and Chat"
description: The lifecycle of a gadget/workspace — provisional status and promotion, the git object store for committed code, the Code Mode agent loop, operational-transform code-change streams, chat compaction, and actions approval.
tags: [gadget, lifecycle, code, chat, agent, git]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-e2cfd053e31709282d01298d
    resource: repo://packages/workshop-backend/src/agent-compaction.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Gadgets: Lifecycle, Code, and Chat

A **gadget** is a "process" in the OS analogy: each runs in its own sandbox, has its own code,
storage, and data, and lives inside a workspace — itself a single `OverseerDurableObject`. This page
covers how a workspace is born, how its code is stored and committed, how the chat/agent loop
edits it, and how side-effecting actions are gated.

## Workspace / gadget lifecycle

- **Creation.** `AuthenticatedApi.newGadget()` creates a new workspace; `openGadget` opens an
  existing one, atomically redeeming a share key if provided
  (`packages/workshop-shared/src/api.ts`, and `server.ts`'s `#openGadgetInternal`).
- **Provisional status.** A gadget is **provisional** until it has "some sort of activity, such as a
  chat message or code edit." Provisional gadgets do not appear on the home page and are
  automatically deleted after some time. Notably, calling `new*Gatekeeper()` does **not** clear the
  provisional bit (as long as the gatekeeper isn't bound into a gadget), so calling
  `newGatekeeper` is a normal way to let the user write an initial chat message without explicitly
  creating a gadget (`packages/workshop-shared/src/api.ts`, `newGadget` doc). Under the covers the
  user's `GadgetRecord.lastActive` is absent for provisional gadgets — `isFullyCreated` treats its
  presence as the promotion marker (`src/user.ts:101`), and they're hidden from `listGadgets`.
  Blueprint-created gadgets are provisional to the chat like any agent-created gadget.
- **Deletion** is owner-only; the source gadget's blueprints may survive it (orphaned blueprints).

## Code storage: the git object store

Committed gadget code is stored as **real git loose objects** — SHA-1, zlib-deflated, byte-identical
to what `git` itself would write — in the workspace's `gitObjects` typed-storage collection. Each
gadget record's `commitId` points at the head commit (`src/git-store.ts:1`).

There is deliberately **no ref layer**: no branches, tags, or HEAD. The "refs" are the gadget
records, blueprint records, and the chats' pinned commits, all managed by the Overseer's own
workflow. Because the store is content-addressed and refless, unrelated histories coexist and
related histories deduplicate at the blob/tree level (`git-store.ts:8`).

Real git formats are used (via isomorphic-git's plumbing only — writeBlob/writeTree/writeCommit/
read*/log, never the porcelain, which requires HEAD/index/config) so gadget code can later be
exported/imported from real git repositories and agents can "mount" arbitrary repos. Loose objects
only, no GC (`git-store.ts:15`). A `threeWayMerge` implements the merge the Overseer wants; the
Overseer holds the `GitStore` instance (`src/overseer.ts:1704`).

## The code-change model

A chat's uncommitted state is a sequence of `CodeChange`s applied on top of committed code —
produced by human keystrokes, agent tool edits, and update-from-mainline merges
(`packages/workshop-shared/src/code-change.ts:1`). Each chat keeps a revisioned stream (`chatChanges`
in the Overseer storage), where the base is always some commit's tree plus earlier changes.

The uncommitted model carries no base content, only "a change relative to revision N," which is what
lets it compose with git-backed storage. Sequencing and composition follow the operational-transform
priority convention fixed in `code-change.ts` (the change the server ordered earlier composes
first) (`code-change.ts:37`).

**Budgets** keep the change stream storable: `CHAT_CHANGE_MESSAGE_BUDGET` (1 MiB, one message's
composed change on the user-edit path) and `STEP_CHANGE_BUDGET` (an agent step's buffered changes)
live in `src/agent.ts`; the barrier writes a step's buffer as *one* composed "changes" message that
must fit in a 2 MB storage record (`agent.ts:31`).

## The agent loop (Code Mode)

The Cloudflare OS coding agent is a fully multi-purpose Code Mode agent — it performs tasks by
writing and immediately executing code snippets (`README.md`). The loop lives in `src/agent.ts`,
built on `@earendil-works/pi-agent-core`, with the harness injected as a WorkerEntrypoint module
(`CODE_MODE_HARNESS` in `overseer.ts:69`).

Agent tool edits do not accumulate as live per-row changes; they buffer in the step and land at the
**barrier** in one bounded "changes" message. Agent steps are recorded as chat messages, and opaque
model-facing payloads (`chatModelData`) are stored separately so reasoning and provenance survive
turn boundaries and restarts without ever being sent to clients. In-progress agent turns are tracked
(`activeAgents`) so they can be resumed after a server restart.

The agent's session exposes the gateway types via `describeGatekeeper`, tool tables via
`getAgentCatalog`, and binding env vars the agent reads in `executeCode` (`getSession` /
`getAgentCatalog`), each read recorded as an observation.

## Chat compaction

Context compaction keeps long chats within the model's limit by summarizing the messages before a
boundary and storing their replay state in a checkpoint; canonical history keeps every message so
the UI can page back, but agent replay starts at the boundary
(`src/agent-compaction.ts:8`).

- **Trigger**: compact when the prompt reaches ~85% (`COMPACTION_TRIGGER_RATIO`) of the input
  budget (`shouldCompactChat`).
- **Target**: retain ~30% (`COMPACTION_TARGET_RATIO`) of the input budget for the summary and later
  turns (`agent-compaction.ts:13`).
- **Assumed window**: `DEFAULT_CONTEXT_WINDOW` (128k) for a model that `SUGGESTED_MODELS` doesn't
  list (`agent-compaction.ts:21`).
- Checkpoints are stored per `(chatId, compactedTo)` so a chat can be rolled back across a boundary
  (revert needs the checkpoint *before* the one you're rolling back to)
  (`src/overseer.ts:1144`).
- `/compact` is also a slash command (`isCompactionTurn`): such a turn compacts and then ends instead
  of prompting the model (`agent-compaction.ts:62`).

## Actions and approval

Side-effecting actions (gatekeeper writes, agent `submitAction`) are queued for approval rather than
executed immediately; the agent may simulate and proceed, and the human approves or rejects in bulk
or one-by-one later. `autoApproveTags` are per-(gatekeeper, actionKind) user rules that auto-apply
actions carrying a given kind; the `getAutoApprovableActions` listing + the per-action
`autoApprovable` verdict are the binding gates. The Overseer's `actions` collection keeps pending /
applied / rejected records with resume-replay indexes so a reconnect replays only record changes
during the gap (`src/overseer.ts:1094`).

## Sharing and observers interplay

The gadget's lifecycle is tied to sharing: `use` collaborators can only render/use the UI (see
[Sharing and Observers](/openwiki/concepts/sharing-and-observers.md)), and non-owner users must pass
observer checks before interacting to prevent data leaks.
