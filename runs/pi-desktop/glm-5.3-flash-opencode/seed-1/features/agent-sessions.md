---
type: feature
title: Agent Sessions
description: How the Agent Host manages Pi coding-agent sessions — the session index and file watcher, live session wrappers, queued turns and agent commands, automatic titles, and tool environment sanitation.
tags: [agent, sessions, pi-coding-agent, session-index, watcher]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T19:27:00.576Z
---

# Agent Sessions

Sessions are the heart of the Agent Host. The Host embeds `@earendil-works/pi-coding-agent` and keeps its sessions and configuration in the shared `~/.pi/agent/` directory, so the desktop app and the Pi CLI operate on the same data. On top of the SDK, the Host adds an in-memory session index, a file watcher that pushes `sessions.changed` events, live session wrappers with queued turns, automatic title generation, and desktop-only tool sets.

## Session index and watcher

`SessionIndex` scans the Pi agent directory for `.jsonl` session files and caches per-file records keyed by a stat fingerprint (size, mtime, ctime, ino), so unchanged files are reused instead of re-parsed; it also maintains project views with a 60 s TTL (`PROJECT_VIEW_TTL_MS`) and exposes parse metrics (`repo://src/agent-host/session-index.ts#L13-L36`, `repo://src/agent-host/session-index.ts#L38-L48`). `listAllSessions` prefers the index and falls back to Pi's own `SessionManager.listAll()` if the index fails (`repo://src/agent-host/session-reader.ts#L19-L29`).

`startSessionWatcher` watches the agent directory recursively (respecting `PI_CODING_AGENT_SESSION_DIR` for the sessions root) and debounces changes by 300 ms (`repo://src/agent-host/session-watcher.ts#L18-L27`, `repo://src/agent-host/session-watcher.ts#L64-L66`):

- A changed session file triggers `sessionIndex.refreshPath` and emits `sessions.changed` for that session id; a deleted file emits a `deleted` event; when the watcher cannot classify the change, it emits a wildcard `fullRefresh` event (`repo://src/agent-host/session-watcher.ts#L68-L92`).
- Watcher failures degrade gracefully: the healthy flag is cleared (which shortens the allowed-roots cache TTL) and the allowed-roots cache is invalidated (`repo://src/agent-host/session-watcher.ts#L95-L107`).
- Every debounced flush also invalidates the file-access roots cache, because new sessions imply new browsable cwds (`repo://src/agent-host/session-watcher.ts#L71`).

## Creating and addressing sessions

The `agent.new` RPC method validates the `cwd` (which must exist), starts a session under a temporary lock key, allows that cwd as a file root, binds events once (ISSUE-003), optionally applies provider/model/thinking-level choices, and can immediately run an initial command (`prompt` by default) before returning the real session id (`repo://src/agent-host/handlers.ts#L1155-L1198`).

`agent.command` sends a command to a live session; if the session is not in memory, it resolves the session file path and rehydrates it via `startRpcSession` before delivering the command (`repo://src/agent-host/handlers.ts#L1200-L1217`). `agent.state` reports only live in-memory sessions (`repo://src/agent-host/handlers.ts#L1219-L1224`).

## Live session wrappers

`startRpcSession` (`src/agent-host/rpc-manager.ts`) is the single creation path for live sessions (`repo://src/agent-host/rpc-manager.ts#L1405-L1495`):

- It deduplicates concurrent creation with a registry (by id) and an in-flight lock map (`repo://src/agent-host/rpc-manager.ts#L1408-L1418`).
- Desktop-owned per-session choices (active tool names) are persisted outside Pi's shared JSONL so the CLI remains unaffected; legacy custom-entries are migrated one-way (`repo://src/agent-host/rpc-manager.ts#L1424-L1435`).
- It builds the custom tool set — toolchain-aware bash, desktop search tools, browser tools, and managed-process tools when the service exists — and narrows only the *active* tool set while keeping every tool registered so a session can enable tools later (`repo://src/agent-host/rpc-manager.ts#L1449-L1490`).
- The wrapper exposes runtime diagnostics, a toolchain summary, browser tool activation sync, and destruction callbacks that clean the registry (`repo://src/agent-host/rpc-manager.ts#L1480-L1493`).

### Commands and queued turns

`AgentSessionWrapper.send` dispatches command types including `prompt`, `abort`, `get_state`, `set_model`, `fork`, `navigate_tree`, `set_thinking_level`, `compact`, `set_session_name`, `steer`, `follow_up`, `get_tools`/`set_tools`, `reload`, `clear_queue`, extension UI responses, and auto-retry settings (`repo://src/agent-host/rpc-manager.ts#L578-L819`). Prompts without a streaming behavior are funneled through an internal turn queue (`enqueueTurn` tracks a queued-turn count and serializes execution); `steer`/`followUp` prompts bypass the queue and are passed to the SDK with an explicit `streamingBehavior` (`repo://src/agent-host/rpc-manager.ts#L425-L444`, `repo://src/agent-host/rpc-manager.ts#L581-L605`). Prompt failures emit `prompt_error` followed by `prompt_done` (`repo://src/agent-host/rpc-manager.ts#L597-L604`).

## Automatic session titles

New sessions can get a ChatGPT-style short title generated from the first user message. The pure helpers in `session-title.ts` cap titles at 40 code points (`AUTO_TITLE_MAX_LENGTH`), sanitize model output (collapse whitespace, strip wrapping quotes/brackets, remove trailing punctuation), and guarantee a non-empty fallback title from the message text (`repo://src/agent-host/session-title.ts#L1-L34`).

The `agent.generateTitle` RPC is deliberately conservative (`repo://src/agent-host/handlers.ts#L1226-L1273`):

- It never overwrites a user-set name or an earlier title (`hasSessionName`).
- It writes the generated title atomically at the live-session or `SessionManager` edge (`applySessionNameIfEmpty`), so a concurrent manual rename either blocks the automatic title or replaces it afterwards.
- On success it emits an indexed `sessions.changed` event.

## Session content, context, and history

Reading historical sessions goes through `session-reader` (wrapping Pi's `SessionManager`) and the index; the RPC surface offers `sessions.get` with optional history windows, `sessions.context` / `sessions.contextPage` for paged context (cursor, maxTurns, maxBytes), `sessions.entryContent` for individual entries, and `sessions.export` (`repo://src/contract/api.ts#L18-L25`).

## Tool environment sanitation

Environment variables inherited by project-controlled tools and processes are filtered by `sanitizeToolEnvironment`: exact sensitive keys (`API_KEY`, `TOKEN`, `AWS_SECRET_ACCESS_KEY`, …) and key *suffixes* (`_API_KEY`, `_ACCESS_TOKEN`, `_PRIVATE_KEY`, …) are dropped, as are values containing URL credentials. The stated rationale is trust-domain separation: the Host needs provider credentials, but arbitrary project commands must not be able to disclose them via `env` dumps or compromised package scripts (`repo://src/agent-host/tool-environment.ts#L1-L65`).

## Invariants and failure behavior

- Sessions live in Pi's own storage (`~/.pi/agent/`); the desktop app adds only side-channel state (desktop tool names) so the CLI is unaffected (`repo://src/agent-host/rpc-manager.ts#L1424-L1429`).
- `agent.new` rejects missing/nonexistent cwds with `BAD_REQUEST` (`repo://src/agent-host/handlers.ts#L1164-L1171`).
- The watcher and index are best-effort: any refresh error degrades to a wildcard `fullRefresh` event rather than stale data (`repo://src/agent-host/session-watcher.ts#L93`).
- Host death destroys all live wrappers; sessions persist as files and are rehydrated on demand (`repo://src/agent-host/handlers.ts#L1200-L1217`).
