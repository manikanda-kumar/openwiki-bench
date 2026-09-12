---
type: architecture
title: Sessions, Files, Projects & Skills
description: The agent session / file / project surface — session storage watching and indexing, allowed file roots, file watching and suggestions, worktree and git-status APIs, plus the skills and plugins services.
tags: [architecture, sessions, files, skills, plugins]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-0e308b018c67d162e7d04a50
    resource: repo://src/agent-host/file-access-core.ts
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-a1389707d8f24ddcc2cd3222
    resource: repo://src/agent-host/plugin-worker-client.ts
  - id: openwiki-source-7582ce298391905df5981168
    resource: repo://src/agent-host/plugin-worker.ts
  - id: openwiki-source-bfb43ec6e8519bc6aaeeca26
    resource: repo://src/agent-host/plugins-service.ts
  - id: openwiki-source-b756a250bef1687434bf56f4
    resource: repo://src/agent-host/session-index.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-69e2c03db6b510a7705cd6b9
    resource: repo://src/agent-host/session-title.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-a5c3af185114022c93a8494c
    resource: repo://src/agent-host/skills-service.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-48e838c80623e1f67b0704ac
    resource: repo://src/shared/allowed-roots.ts
  - id: openwiki-source-5b6ecf1803d1fe457295d439
    resource: repo://src/shared/git-status.ts
  - id: openwiki-source-d69e5bf5592a0b6abf2871db
    resource: repo://src/shared/worktree.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Sessions, Files, Projects & Skills

This page covers the Agent Host-side functionality that the renderer drives
through `sessions.*`, `files.*`, `worktrees.*`, `git.*`, `skills.*`, and
`plugins.*` RPC methods, plus the local watching and indexing that keeps that
surface current.

## Session storage, watching and indexing

Sessions are stored under the Pi agent directory
(`getAgentDir()`, default `~/.pi/agent`, with the session dir overridable via
`PI_CODING_AGENT_SESSION_DIR`). `src/agent-host/session-watcher.ts` watches that
tree and emits `sessions.changed` events (debounced), invalidating the allowed
roots cache on change.

`src/agent-host/session-index.ts` builds a fingerprint-based index of session
files (`size`, `mtimeMs`, `ctimeMs`, `ino`) so re-parsing is avoided when a file
is unchanged; `session-reader.ts` wraps `SessionManager` to produce `SessionInfo`
and session context, using `resolveProject` to map each session's `cwd` to the
shared project root (a worktree's git common-dir points at the main repo, so all
worktrees share one project root). `listAllSessions` prefers the fingerprinted
index and falls back to `SessionManager.listAll()` if the index is unavailable.

## File access and allowed roots

`src/agent-host/file-access.ts` derives the set of browsable file roots from
every session's `cwd` and its `projectRoot`, plus `~/pi-cwd-*` directories
created by the default-cwd endpoint and any `allowFileRoot`-style roots. The
roots are cached with a watcher-aware TTL and a generation counter so a stale
async scan cannot restore old roots after the watcher invalidated the cache
(`getAllowedRootsCache`/`setAllowedRootsCacheIfCurrent` in
`src/shared/allowed-roots.ts`). Low-level path checks
(`isFilePathAllowed`, canonical path resolution, Windows absolute path detection)
live in `src/agent-host/file-access-core.ts` and are enforced by every `files.*`
handler.

`src/agent-host/file-watch.ts` provides `files.watchStart`/`files.watchStop`
so the renderer can watch a specific directory and receive `files.changed`
events; TTL is governed by the accumulated change stats. `file-suggestions.ts`
provides `@`-mention file indexing and build entries for the composer.

## Project resolution, worktrees and git status

`src/shared/worktree.ts` resolves a `cwd` to a `ProjectInfo`
(`projectRoot`, current `branch`, `isWorktree`, `isTopLevel`) using the shared
Git runner, with a 60s process-local cache that is invalidated eagerly on
worktree add/remove (`invalidateProjectCache`). The `worktrees.list/create/remove`
and `git.status` API methods implement the worktree switcher and the porcelain
status display (`src/shared/git-status.ts` parses `git status --porcelain`).
`resolveProject` re-applies the same logic used by `session-reader` and
`session-index` so the project dropdown, file panel, and session titles agree.

## Auto session titles

`src/agent-host/session-title.ts` (`auto-session-title`) generates concise
titles from the first user message (a silent LLM request that never touches
session history; the `agent.generateTitle` API). Titles are sanitized and
capped at `AUTO_TITLE_MAX_LENGTH`; manually named sessions always win.

## Skills service

`src/agent-host/skills-service.ts` searches `skills.sh` (`SKILLS_API_URL`,
default `https://skills.sh`) and falls back to the `skills.sh` CLI via `runNpx`
when the API fails. `skills.install` invokes `skills add … —agent pi`
(global by default; `project` scope when requested). `skills.set` and
`skills.list` back the renderer's skill editor, and `skill-frontmatter.ts`
validates skill frontmatter and content.

## Plugins service

`src/agent-host/plugins-service.ts` manages Pi extensions/packages. It exposes
`plugins.list` (with resource counts and diagnostics) and `plugins.set`
(install/remove/update/disable/enable) scoped globally or per-project. Package
actions run in a bounded child worker (`plugin-worker.ts` / `plugin-worker-client.ts`,
marker-framed base64 line protocol, max request 64 KB, validated `cwd`/`action`)
rather than in the Host process, so a malformed package install cannot corrupt
the Host. Per-source enabled state and a disabled-plugin backup file
(`pi-desktop-plugin-filters.json`) are persisted; `extension-diagnostics.ts`
projects a diagnostic report used by the Plugins panel.

## Persistence and failure behavior

Session watching degrades gracefully: if the agent dir cannot be created or the
watcher cannot start, `startSessionWatcher` returns a no-op and the app relies on
the fallback `SessionManager` path and watcher-invalidated roots TTL. File root
cache collisions are retried once. Plugin worker failures are surfaced as RPC
errors so the Host remains healthy.
