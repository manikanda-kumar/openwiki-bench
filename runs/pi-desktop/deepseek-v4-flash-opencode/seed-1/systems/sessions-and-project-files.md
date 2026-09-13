---
type: concept
title: Sessions and Project Files
description: How sessions are stored, indexed, watched, and titled under ~/.pi/agent, and how the desktop reads project files, watches directories, searches, and manages Git status and worktrees.
tags: [sessions, files, session-index, file-watch, search, git, worktrees]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-06d2230d008cc2a344c4d386
    resource: repo://src/agent-host/file-suggestions.ts
  - id: openwiki-source-2f0c558288a8a32519e88ca2
    resource: repo://src/agent-host/file-watch.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-b756a250bef1687434bf56f4
    resource: repo://src/agent-host/session-index.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-69e2c03db6b510a7705cd6b9
    resource: repo://src/agent-host/session-title.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-e989b9d0d6b08a1c61d9c4ea
    resource: repo://src/agent-host/toolchain-git.ts
  - id: openwiki-source-d69e5bf5592a0b6abf2871db
    resource: repo://src/shared/worktree.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Sessions and Project Files

Sessions and project files are owned by the Agent Host. Sessions are persisted on disk as Pi JSONL files under `~/.pi/agent/` (shared with Pi CLI), and the desktop layer adds an index, a watcher, path caches, and access control on top of the Pi `SessionManager`.

## Session storage and reading

- Pi sessions are stored in the agent directory resolved by `getAgentDir()` (`src/agent-host/session-reader.ts:1-20`), which defaults to `~/.pi/agent/`. Existing Pi CLI data is reused without migration (`README.md:124`).
- `listAllSessions` first refreshes the `SessionIndex` and reads from it; if indexing fails it falls back to `SessionManager.listAll()` (`src/agent-host/session-reader.ts:22-66`).
- `resolveSessionPath` uses a process-local `sessionId → filePath` cache and falls back to the index (`session-reader.ts:76-96`).
- `buildSessionInfoFromManager` derives `messageCount`, `firstMessage`, activity-based `modified`, `projectRoot`, and `worktreeBranch` from the session header and entries (`session-reader.ts:133-174`).
- `buildSessionContext` walks the branch path from the target leaf to the root and renders every displayable entry — compaction entries become inline summary messages and channel turns are tagged from `pi-desktop-channel-source` markers — so compacted history stays visible in the UI (`session-reader.ts:181-246`). `entryToUiMessage` maps message/compaction/branch-summary/custom entries to UI messages (`session-reader.ts:345-381`).

## Indexing and watching

- `SessionIndex` (`src/agent-host/session-index.ts:68-286`) fingerprints each `.jsonl` session file (size, mtimes, inode) so unchanged files are reused; `refreshAll` and `refreshPath` keep the index current, and metrics report discovered/parsed/reused/invalid counts.
- `startSessionWatcher` (`src/agent-host/session-watcher.ts:12-99`) `fs.watch`es the agent directory, classifies each change (`classifySessionWatchChange` in `session-watch-policy.ts`), debounces by 300 ms, and emits `sessions.changed` — per-session path refreshes or a `fullRefresh`. It also invalidates the allowed-roots cache and, on watcher failure, falls back to a short TTL (see `shared/allowed-roots.ts`).

## Session titles

- `agent.generateTitle` performs a silent LLM request that never touches session history and returns a sanitized title; `sanitizeGeneratedTitle` collapses whitespace, strips wrapping quotes and trailing punctuation, and caps at 40 characters (`src/agent-host/session-title.ts:23-32`, `contract/api.ts:186-195`).
- When the model call is unavailable, `makeFallbackTitle` reuses the first 40 characters of the first user message so the sidebar never shows an untitled conversation (`session-title.ts:38-42`). Manual names always win and auto-titles can be disabled in settings.

## File access control

- Allowed file roots are derived from every session's `cwd` and `projectRoot`, plus `~/pi-cwd-*` directories, cached with a watcher-aware TTL (long when the session watcher invalidates on changes, short otherwise) (`src/agent-host/file-access.ts:24-60`, `src/shared/allowed-roots.ts`).
- `isFilePathAllowed`/`canonicalPath` enforce these roots for `files.list`, `files.read`, `files.download`, `files.meta`, `files.preview`, and `files.watchStart`; a path referenced by the calling session is allowed even outside the roots (`src/agent-host/handlers.ts` `assertPathAllowed`, `src/agent-host/session-file-references.ts`).

## File listing, reading, and preview

- `files.list` returns directory entries; `files.read` returns file content with encoding (`utf8`/`base64`/`too_large`); `files.download` returns base64 content; `files.preview` returns a rendering kind (`src/contract/api.ts:253-282`).
- The renderer renders Markdown with code highlighting, Mermaid, and KaTeX, and previews Word (`.docx`) via `mammoth`; the Agent Host supports HTML previews served over `app://preview` (see [Security Model](../architecture/security-model.md)).

## File watching

`createFileWatchService` (`src/agent-host/file-watch.ts:18-116`) provides `files.watchStart`/`files.watchStop`:

- per-path `fs.watch` with reference counting, a 100 ms debounce, and `files.changed` events (`connected`/`change`/`error`) carrying mtime/size (`file-watch.ts:47-109`);
- recursive directory watching with a non-recursive fallback when the platform/Node pair does not support it (`file-watch.ts:71-92`).

## Search and suggestions

`files.index` (`src/agent-host/handlers.ts:1497-1508`) uses `FileSuggestionService.suggest` (`src/agent-host/file-suggestions.ts`):

- direct directory browsing up to 300 entries; for queries, a toolchain-backed `rg`/`fd` search capped at 300 matches with a 2-second timeout and a 2 MiB buffer, returning at most 50 items and a `degradedReason` (`search-unavailable`/`search-timeout`/`search-failed`) when the search backend fails (`file-suggestions.ts:10-14`);
- common toolchain/dependency directories (`node_modules`, `.git`, `dist`, `build`, `target`, `vendor`, caches) are ignored (`file-suggestions.ts:16-32`).

## Git status and worktrees

- `shared/worktree.ts` resolves a cwd to `{ projectRoot, branch, isWorktree, isTopLevel }` using `git rev-parse` (`git-common-dir` links worktrees to the main repo's project root), with a 60 s process-local cache that is eagerly invalidated on worktree add/remove (`worktree.ts:46-80`).
- `worktrees.list/create/remove` and `git.status` run through a Git command runner; the Agent Host installs a toolchain-backed Git runner so Git always executes through the resolved toolchain (`src/agent-host/toolchain-git.ts`, `src/agent-host/index.ts:20`). `git.status` parses `--porcelain` output (`shared/git-status.ts`).
- Session info carries `projectRoot` and `worktreeBranch` so the sidebar can group sessions by project and show the active branch (`session-reader.ts:158-172`).

## Related pages

- [Agent Host Runtime](../architecture/agent-host-runtime.md)
- [Toolchain Management](./toolchain-management.md)
- [Messaging Channels](./messaging-channels.md)
