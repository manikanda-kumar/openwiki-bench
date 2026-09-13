---
type: workflow
title: Agent Sessions and the Pi Runtime
description: How the Agent Host creates, runs, and streams Pi coding-agent sessions, how session files under ~/.pi/agent are indexed and watched, and how history paging, auto titles, and file access roots work.
tags: [sessions, pi-coding-agent, agent-host, event-stream, history-pagination, file-access]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-2f0c558288a8a32519e88ca2
    resource: repo://src/agent-host/file-watch.ts
  - id: openwiki-source-c29682f0b8276774bdd82c52
    resource: repo://src/agent-host/handlers.test.mjs
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-5512bd60069393bf8eac652d
    resource: repo://src/agent-host/rpc-manager.ts
  - id: openwiki-source-6ec9338f115883dc2a0b2fe7
    resource: repo://src/agent-host/session-history.ts
  - id: openwiki-source-b756a250bef1687434bf56f4
    resource: repo://src/agent-host/session-index.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-69e2c03db6b510a7705cd6b9
    resource: repo://src/agent-host/session-title.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-54339e3b89e9458685bcd031
    resource: repo://src/renderer/hooks/useAgentSession.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
  - id: openwiki-source-d85be6977458cf4338fdd0ac
    resource: repo://src/renderer/lib/session-pagination.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Agent Sessions and the Pi Runtime

All agent behavior runs inside the Agent Host utilityProcess, which embeds `@earendil-works/pi-coding-agent` 0.84.0 in-process. Sessions, files, and configuration are read from and written to the standard Pi directory `~/.pi/agent/`, so the desktop app and the Pi CLI share the same data.

## Session storage and indexing

Session files live under the agent directory (overridable with `PI_CODING_AGENT_SESSION_DIR`; sessions default to `<agentDir>/sessions`). `sessionIndex` recursively discovers session files, fingerprints each file by `size/mtimeMs/ctimeMs/ino`, and reuses parsed `SessionInfo` records when the fingerprint is unchanged, with a 60-second project-view TTL (src/agent-host/session-index.ts:8-60). `listAllSessions()` refreshes the index and falls back to Pi's `SessionManager.listAll()` when the index is unavailable, resolving each session's `cwd` to its project root so worktrees group under the main repository (src/agent-host/session-reader.ts:22-66). A session-id → path cache bounded by the Host's lifetime makes `resolveSessionPath` cheap after first contact (src/agent-host/session-reader.ts:68-70).

## Watching for external changes

`startSessionWatcher` watches the sessions root and debounces filesystem events. Per-file changes emit targeted `sessions.changed` events for the affected session id; directory-level or unclassifiable changes emit a `fullRefresh: true` event for topic key `*`, which triggers `sessionIndex.refreshAll()` (src/agent-host/session-watcher.ts:12-67). The watcher also invalidates the allowed-roots cache on every batch (src/agent-host/session-watcher.ts:40). IM channels that run turns through shared sessions emit the same `sessions.changed` events so the desktop UI stays live (src/agent-host/channels/channel-manager.ts:981-987).

## Session lifecycle over RPC

`agent.new` is the creation entry point:

1. It requires an existing `cwd`, creates the session through `startRpcSession` using a unique temporary lock key so concurrent new-session requests never collide (src/agent-host/handlers.ts:1155-1175; src/agent-host/handlers.test.mjs:82).
2. It calls `allowFileRoot(cwd)` so the new project becomes browsable (src/agent-host/handlers.ts:1176).
3. It binds session events exactly once via the single `ensureSessionEvents` entry point (ISSUE-003) (src/agent-host/handlers.ts:1178-1179).
4. It applies `set_model` / `set_thinking_level` when provided, then sends the initial command (default `prompt`), and emits an indexed `sessions.changed` event (src/agent-host/handlers.ts:1181-1195).

`agent.command` reuses an alive in-memory session, or reopens the session from disk through `SessionManager.open(filePath)` when the wrapper was destroyed (for example after idle eviction), then forwards the command (src/agent-host/handlers.ts:1198-1215). `agent.state` reports `{ running: false }` for sessions that are not alive (src/agent-host/handlers.ts:1217-1223).

## Event streaming

`AgentSessionWrapper` wraps each Pi session. It subscribes to the inner session's event stream, tags message events from channel-driven turns with `channelSource`, and re-broadcasts the running-status snapshot on every event so the sidebar updates live (src/agent-host/rpc-manager.ts:243-259). Running state combines `promptRunning`, queued turn count, `isStreaming`, and `isCompacting` (src/agent-host/rpc-manager.ts:236-241). `subscribeRunningSessions` fans the set of running session ids out as `agent.running` events (src/agent-host/handlers.ts:722-724).

`ensureSessionEvents` binds each wrapper's events once per wrapper instance (tracked in a `WeakSet`, with stale bindings replaced when a session id is re-opened after idle destroy), emitting every event on the `agent.events` topic keyed by session id (src/agent-host/handlers.ts:1979-2014). Only real `agent_end` events (not synthetic `prompt_done`) are forwarded to Main via `parentPort` as `agent-end`, which drives system notifications (src/agent-host/handlers.ts:1997-2008).

On the Renderer side, all Host communication goes through the `api-client.ts` transport facade; components never touch the MessagePort directly, and `resetRpc()` drops the client so the next call reconnects after a Host crash (src/renderer/lib/api-client.ts:1-20). `useAgentSession` consumes `agent.events` through `connectTimedEventStream`/`EventStreamConnectionManager`, merges streamed history with `mergeHistoryTail`, and keeps a module-level scroll magnet that survives session-switch remounts (src/renderer/hooks/useAgentSession.ts:31-73).

## History pagination

Large sessions are paged instead of shipped whole. `sessions.get` accepts a `historyWindow` of `maxTurns`/`maxBytes`; `buildSessionHistoryPage` projects complete turns into the byte budget (minimum 32 KiB), never splitting a turn, and returns a base64url `previousCursor` that encodes the position plus the `historyRevision` (src/agent-host/session-history.ts:289-359). A cursor whose revision no longer matches the file raises `StaleHistoryCursorError`, and `sessions.contextPage` walks older pages with the same guards (src/agent-host/session-history.ts:297; src/agent-host/handlers.test.mjs:589-604). The Renderer merges pages by entry id, resetting whenever the revision changes, and prepends older pages only when the revision still matches (src/renderer/lib/session-pagination.ts:20-53).

## Automatic session titles

`agent.generateTitle` produces a ChatGPT-style short title for a new session. It never overwrites a name the user already set, sanitizes the model output (collapse whitespace, strip wrapping quotes/brackets and trailing punctuation, cap at 40 code points), and falls back to the first characters of the user's message when the model call fails, so the sidebar never shows an untitled conversation (src/agent-host/handlers.ts:1225-1261; src/agent-host/session-title.ts:11-42). The write is atomic at the live-session or `SessionManager` edge: a concurrent manual rename either blocks the automatic write or replaces it afterwards (src/agent-host/handlers.ts:1254-1257).

## Tool selection and extension UI bridging

Sessions accept a `toolNames` preset; an empty preset forces an empty system prompt, and the wrapper strips legacy channel prompts from restored state (src/agent-host/rpc-manager.ts:202-217). Browser tools are kept in sync per session by `syncBrowserToolActivation`, which removes browser tool names and re-adds the set allowed by the current capability snapshot (src/agent-host/rpc-manager.ts:261-269).

Pi extensions render UI through the wrapper rather than a terminal: `ExtensionUiRequest` events (select/confirm/editor and custom components) are queued in `pendingUiResponses`/`pendingUiRequests`, custom UI components render to text lines at a negotiated width via `render(width)` with optional `handleInput`, and status items, working indicators, and widgets are mirrored into the session state the Renderer displays (src/agent-host/rpc-manager.ts:54-68, 174-183, 926-1067). Extension features that cannot be represented in the desktop Renderer (TUI-only interfaces) are tracked as `unsupportedExtensionFeatures` so the app can surface an explicit compatibility notice instead of silently dropping them (src/agent-host/rpc-manager.ts:183).

## File access and watching

File browsing is rooted in the sessions themselves: allowed roots are the set of session `cwd`s, their project roots (so a main repo is browsable even when only worktrees have sessions), and `~/pi-cwd-*` default-cwd directories (src/agent-host/file-access.ts:43-60). The roots cache is watcher-aware — long-lived while the session watcher delivers event-driven invalidation, short as a fallback — and a generation counter prevents a scan that raced an invalidation from caching stale roots (src/agent-host/file-access.ts:21-41).

`files.watchStart`/`files.watchStop` provide per-path `fs.watch` streams with reference counting, shared watchers per path, and debounced `files.changed` events carrying `mtime`/`size` (src/agent-host/file-watch.ts:16-60). Access checks first consult the allowed roots; a file outside them is still readable for a session that references it by path (`isFilePathReferencedBySession`), otherwise the request is rejected with `FORBIDDEN` (src/agent-host/file-watch.ts:19-24).

## Representative tests

- src/agent-host/handlers.test.mjs — `agent.new` lock-key uniqueness, manual rename races, history paging and stale cursors, file access limits
- src/agent-host/session-history.test.mjs — complete-turn page fitting, byte budgets, cursor staleness across revisions
- src/agent-host/session-watcher.test.mjs and src/agent-host/session-index.test.mjs — watcher classification and fingerprint reuse
- src/renderer/lib/session-pagination.test.mjs — renderer-side page merge and revision resets
