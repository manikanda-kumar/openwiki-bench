---
type: reference
title: Agent Sessions and Project Workflows
description: How the Pi Agent Desktop Agent Host creates, runs, persists, lists, and indexes Pi agent sessions, plus project/worktree resolution and file-access policy.
tags: [agent-host, sessions, project, worktree, indexing, rpc]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-5512bd60069393bf8eac652d
    resource: repo://src/agent-host/rpc-manager.ts
  - id: openwiki-source-b756a250bef1687434bf56f4
    resource: repo://src/agent-host/session-index.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-48e838c80623e1f67b0704ac
    resource: repo://src/shared/allowed-roots.ts
  - id: openwiki-source-d69e5bf5592a0b6abf2871db
    resource: repo://src/shared/worktree.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Agent Sessions and Project Workflows

This page describes how the Agent Host (the `utilityProcess` that runs Pi
Coding Agent in-process) owns agent sessions scrub, how sessions are created,
run, persisted, listed, indexed, and auto-titled, and how project/worktree
resolution and the file-access policy work.

## Responsibility and ownership

Session management lives entirely in the Agent Host process under
`src/agent-host/`. The Renderer never touches `pi-coding-agent` directly; it
sends session commands over the typed `MessagePort` RPC contract
(`src/contract/api.ts`) and receives streamed events back. The Main process
supervises the Host process but does not manage sessions.

Two layers own session state:

- The **RPC session registry** (`src/agent-host/rpc-manager.ts`) keeps in-memory
  `AgentSessionWrapper` objects for live sessions, deduplicates starts with
  per-session locks, broadcasts running-session-id changes, and disposes every
  live wrapper on process `exit`/`SIGINT`/`SIGTERM` (`rpc-manager.ts:1324-1333`).
- The **disk index** (`src/agent-host/session-index.ts`) builds a fingerprint
  cache of session files under the Pi agent directory so listing is cheap and
  watcher-driven.

## Where sessions persist

Session files live under the Pi agent directory (`~/.pi/agent/sessions` unless
overridden by `PI_CODING_AGENT_SESSION_DIR`), which is the same location the Pi
CLI uses. `session-watcher.ts:28` resolves the root from
`process.env.PI_CODING_AGENT_SESSION_DIR || getAgentDir() + "sessions"`.
Because the desktop app reuses Pi's session/config directory, users who already
run Pi CLI can reuse existing sessions without migration.

The on-disk format is owned by `@earendil-works/pi-coding-agent`'s
`SessionManager`. Pi Desktop appends custom entries to sessions for its own
markers — for example a `pi-desktop-channel-source` entry recording a messaging
channel turn and a `pi-desktop-session-tools` entry persisting the enabled tool
set (`rpc-manager.ts:467`, `rpc-manager.ts:94-110`).

## Session lifecycle

### Creation

`agent.new` in `handlers.ts` validates a project `cwd`, starts a session through
`startRpcSession` (`rpc-manager.ts`), allows that root for file access, binds
streaming events once via `ensureSessionEvents`, optionally sets a model and
thinking level, and either sends an initial command or (for
`type: "ensure_session"`) returns with no turn.

`startRpcSession` keyed by session id; for brand-new sessions Pi generates its
own id. It loads persisted tool names from the last `pi-desktop-session-tools`
custom entry when re-opening an existing session.

### Running a turn

The `AgentSessionWrapper` (`rpc-manager.ts:170`) wraps Pi's `AgentSessionLike`.
Its `send(command)` handler drives the agent. Prompts that are *not* given an
explicit `streamingBehavior` run through `enqueueTurn`, which serializes turns on
a `turnTail` promise chain and increments a queued-turn counter so the app can
report pending work (`rpc-manager.ts:425-447`). Steer and follow-up commands call
`inner.steer` / `inner.followUp` directly and run outside the serialized queue.

Event streaming flows through `inner.subscribe`; each event is re-broadcast to
RPC listeners and `notifyRunningChange()` pushes the running-session-id set.

### Command surface

The wrapper implements a broker for typed commands used by the renderer,
including `prompt`, `abort`, `get_state`, `set_model`, `fork`, `navigate_tree`,
`set_thinking_level`, `compact`, `set_session_name`, `get_session_stats`,
`get_tools`, `get_commands`, `set_tools`, `reload`, `steer`, `follow_up`, and
`extension_ui_response` (`send`), while serializing and reporting status for
`prompt`/`steer`/`follow_up`/`get_commands` via `shouldWaitForExtensions`
(`rpc-manager.ts:386-388`).

### Forking

`fork` in `send` either creates an empty linked session before the first message
or calls `createBranchedSession` to copy history up to (excluding) the fork
point, then disposes the current wrapper and returns the new session id
(`rpc-manager.ts:647-678`).

### Idle eviction and disposal

Every active wrapper has a 10-minute idle timer. When a session is not running
and idle, `dispose({ abort: true, reason: "idle-eviction" })` is called
(`rpc-manager.ts:542-555`). `dispose` is idempotent (all callers share one
teardown) and races teardown against a 5s default timeout. Deletion
(`sessions.delete`) aborts and disposes the live session before unlinking the
session file (`handlers.ts:1033-1046`).

## Session listing, reading, and indexing

`listAllSessions` (`session-reader.ts`) prefers the `sessionIndex` and falls
back to Pi's `SessionManager.listAll()` when the index is unavailable.

The session index (`session-index.ts`) fingerprints each session file by
`size/mtimeMs/ctimeMs/ino` and reuses the cached `SessionInfo` when the file is
unchanged (`session-index.ts:33-45`). `sessions.get` builds a `SessionDetail`
from the indexed snapshot plus a live `get_state` call when `includeState` is
set, and supports cursored history pages.

A session watcher (`session-watcher.ts`) `fs.watch`es the sessions root,
debounces changes 300ms, invalidates the allowed-roots cache, refreshes the
index, and emits `sessions.changed` events. It distinguishes a full refresh
from path-level refreshes and emits `deleted` when an indexed path disappears
(`session-watcher.ts:50-64`).

Session history reads use `session-history.ts` builders with an opaque,
version-stamped cursor; stale cursors surface as a `STALE_CURSOR` RPC error
(`handlers.ts:958-967`).

## Auto title generation

The Host can silently ask the configured model to title the session from the
first user message. `generateSessionTitle` in `handlers.ts` uses a short
system prompt, a 15s abort timeout, and `cacheRetention: "none"` so the request
never touches session history or writes prompt-cache entries
(`handlers.ts:416-480`). The result is sanitized via `sanitizeGeneratedTitle`
in `session-title.ts`; on any failure `makeFallbackTitle` reuses the first
characters of the first user message so the sidebar never shows an untitled
session.

A write is applied only if the session still has no name, using the same
synchronous-turn check so a manual rename that runs first is never overwritten
(`handlers.ts:499-551`).

## Project and worktree resolution

`src/shared/worktree.ts` resolves a `cwd` to a `ProjectInfo`:
`projectRoot`, current `branch`, whether the directory is a linked worktree, and
whether it is a checkout top level. For a linked worktree the project root is the
parent of the git *common dir* (the main repo), so all worktrees collapse onto
the shared project. Non-git directories resolve to themselves. Results are
cached 60s and invalidated eagerly on worktree add/remove.

`addWorktree` places new worktrees in `<repoRoot>-worktrees/<sanitized-branch>`
and `allowFileRoot`s the created path; `removeWorktree` refuses the main
worktree and propagates a dirty-tree error unless `force` is set
(`worktree.ts:274-325`). The wrapper checks that a worktree still contains no
active managed processes before removal via `handlers.ts`.

## File-access policy

All file reads in the Host are guarded by the allowed-roots policy
(`src/agent-host/file-access.ts`). Allowed roots are derived from every
session's `cwd` and `projectRoot`, plus `~` directories matching `pi-cwd-<date>`
and any roots added programmatically (`allowFileRoot`). The set is cached with a
TTL that is long (10 min) when the session watcher is healthy and short (5s)
otherwise (`allowed-roots.ts:60-70`). `files.*` handlers call `assertPathAllowed`
before acting (`handlers.ts:203-208`).

## Interaction with managed processes

Deleting a session refuses (with `CONFLICT`) while it still owns active managed
background processes unless `force` is set, in which case those processes are
stopped first. Removing a worktree likewise refuses while it contains active
managed processes (`handlers.ts:1017-1032`, `handlers.ts:1124-1132`).

## Failure behavior

- If the session index fails, `listAllSessions` falls back to Pi's own listing.
- If a live prompt rejects, the wrapper emits `prompt_error` and re-emits
  `prompt_done` so the renderer unblocks.
- If an external-channel turn rejects, a `channel_turn_error` event is emitted
  and the error propagates; the browser session source is reset to `local` in
  `finally`.
- Unhandled session wrapper disposal is isolated per owner via destroy
  callbacks.

## Tests

Focused unit tests exercise the pure helpers and policies (for example
`session-title`, `session-history`, `session-file-references`,
`project-tree`, `worktree`, `file-access`, `tool-environment`) under
`src/**/*.test.mjs`. They run in Node without a GPU.
