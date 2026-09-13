---
type: "Reference"
title: "Agent Sessions, Files, and History"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-5512bd60069393bf8eac652d
    resource: repo://src/agent-host/rpc-manager.ts
  - id: openwiki-source-6ec9338f115883dc2a0b2fe7
    resource: repo://src/agent-host/session-history.ts
  - id: openwiki-source-b756a250bef1687434bf56f4
    resource: repo://src/agent-host/session-index.ts
  - id: openwiki-source-69e2c03db6b510a7705cd6b9
    resource: repo://src/agent-host/session-title.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---


# Agent Sessions, Files, and History

All Agent work happens in the Agent Host process (`src/agent-host/`). The Host wraps Pi's `AgentSession` in an `AgentSessionWrapper` (`rpc-manager.ts`), maintains a session index and watcher over `~/.pi/agent/sessions`, serves history through paged RPC handlers, and enforces file access through allowed roots.

## Session lifecycle and command dispatch

`AgentSessionWrapper` (`src/agent-host/rpc-manager.ts:170`) wraps a Pi `AgentSession` with desktop-specific concerns:

- **Turn serialization**: agent commands (`prompt`, `steer`, `follow_up`, `compact`) are queued through `enqueueTurn`, which chains each turn behind `turnTail` so turns never interleave (`src/agent-host/rpc-manager.ts:425`). `queuedTurnCount` and `promptRunning` feed the running-state broadcast.
- **Idle eviction**: an idle timer disposes the session after 10 minutes of no agent events, but never while the agent is still running (`src/agent-host/rpc-manager.ts:542`).
- **Dispose**: `dispose` is idempotent and shared across concurrent owners; it aborts the agent, waits for idle, and releases the agent with a bounded timeout. `destroy()` clears listeners, pending UI, and notifies running-state subscribers (`src/agent-host/rpc-manager.ts:831`).
- **Command surface**: `send()` handles `prompt`, `abort`, `get_state`, `set_model`, `fork`, `navigate_tree`, `set_thinking_level`, `compact`, `set_session_name`, `steer`, `follow_up`, `get_tools`, `get_commands`, `set_tools`, `reload`, and extension UI responses (`src/agent-host/rpc-manager.ts:575`).

Session creation goes through `startRpcSession` (`src/agent-host/rpc-manager.ts:1405`): it opens (or creates) a `SessionManager`, builds a toolchain execution context with intent `agent-shell`, registers desktop tools (bash via `createToolchainBashOptions`, desktop search tools, browser tools, managed-process tools), and activates the requested tool set. Desktop-owned session choices (tool names) are persisted outside Pi's shared JSONL and read for one-way migration from legacy custom entries (`src/agent-host/rpc-manager.ts:1428`).

The `agent.command` handler lazily restores a session from its file path when it is not already live, and `agent.new` creates one for a cwd (`src/agent-host/handlers.ts:1155`).

## Session index and watcher

- `SessionIndex` (`src/agent-host/session-index.ts:68`) scans `~/.pi/agent/sessions` for `*.jsonl` files, fingerprinting each by size/mtime/ctime/ino so unchanged files are reused without re-parsing. It derives `SessionInfo` (cwd, project root, worktree branch, message count, first message) and parent-session links.
- `startSessionWatcher` (`src/agent-host/session-watcher.ts:12`) uses a recursive `fs.watch` on the agent dir, classifies changes via `classifySessionWatchChange`, debounces by 300 ms, and emits `sessions.changed` events (per-path or full refresh). It also marks the allowed-roots cache as watcher-healthy or unhealthy.
- History reads flow through `getSessionContentSnapshot` and `buildSessionHistoryPage` (`src/agent-host/session-history.ts:286`) which builds the active-branch entry path and projects entries into UI messages (including compaction and branch summaries as inline messages).

## History paging, cursors, and deferred content

`buildSessionHistoryPage` pages history from the leaf:

- It groups projected messages into turns and selects the newest `maxTurns` (default 20) within `maxBytes` (default 1 MiB) using a cursor anchored to a `historyRevision` and `beforeEntryId` (`src/agent-host/session-history.ts:314`). Each page returns a `previousCursor` for older pages.
- A cursor is invalidated (`StaleHistoryCursorError`) if the file identity (dev/ino/birthtime) changes or the anchored entries leave the path, so the renderer is told to reload rather than shown inconsistent pages (`src/agent-host/session-history.ts:53`).
- Oversized content blocks (text/thinking/toolCall/image over 128 KiB) are deferred: the page carries a bounded preview plus a `DeferredContentRef`, and `sessions.entryContent` fetches the full block later (`src/agent-host/session-history.ts:171`).

## Auto session titles

`agent.generateTitle` (`src/agent-host/handlers.ts:1225`) produces a title from the first user message:

- A **silent LLM request** through the configured model with `cacheRetention: "none"`, 60-token cap, and a 15 s timeout (`src/agent-host/handlers.ts:447`). It never touches session history and is sanitized by `sanitizeGeneratedTitle` (collapse whitespace, strip quotes, cap at 40 chars).
- On failure it falls back to `makeFallbackTitle` (first characters of the message) so a session never appears untitled (`src/agent-host/session-title.ts:38`).
- The title is written only when the session has no manual name yet (`applySessionNameIfEmpty`), so a manual rename always wins (`src/agent-host/handlers.ts:528`).

## File access, roots, and worktrees

- **Allowed roots**: `getAllowedFileRoots` (`src/agent-host/file-access.ts:24`) caches the set of browsable directories derived from every session's `cwd` and `projectRoot`, plus `~/pi-cwd-*` default-cwd directories. The cache TTL is watcher-aware: long when the session watcher delivers event-driven invalidation, short otherwise. `files.*` and `worktrees.*` handlers call `assertPathAllowed` before touching any path, and a path referenced by a session is also allowed (`src/agent-host/handlers.ts:203`).
- **Worktrees**: `shared/worktree.ts` resolves a cwd to its project root (a linked worktree's `--git-common-dir` points at the main repo), and `worktrees.list/create/remove` plus `git.status` handlers enforce allowed-root checks. Removing a worktree that still contains active managed processes is refused (`src/agent-host/handlers.ts:1119`).
- **File watching**: `file-watch.ts` implements per-path `fs.watch` reference-counted watchers that emit `files.changed` (`connected`/`change`/`error`) with a 100 ms debounce; recursive directory watching falls back to non-recursive where unsupported (`src/agent-host/file-watch.ts:71`).

## Channels integration surface

The session wrapper exposes the messaging-channel turn surface:

- `runExternalTurn` runs a channel message through the session with `expandPromptTemplates: false`, marks the browser session source as `channel`, and emits `channel_turn_start/end/error` progress that adapters use for streaming (`src/agent-host/rpc-manager.ts:449`).
- `runExternalCommand` handles `/compact` and `/reload` from IM (via `PiSessionBridge` in `channels/pi-session-bridge.ts`), where `reload` re-dispatches `session_start` to extensions and restores the requested tool set (`src/agent-host/rpc-manager.ts:512`).

## Tests

- `src/agent-host/session-history.test.mjs` covers paging, cursors, and deferred content.
- `src/agent-host/session-index.test.mjs` and `src/agent-host/session-watcher.test.mjs` cover indexing and change classification.
- `src/agent-host/session-title.test.mjs` covers sanitization/fallback title logic.
- `src/agent-host/handlers.test.mjs` and `src/agent-host/file-access.test.mjs` cover handler paths and root enforcement.
