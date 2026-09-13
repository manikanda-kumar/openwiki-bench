---
type: data-and-access-concept
title: Session Storage and File Access
description: Where Pi Desktop keeps its data (~/.pi/agent), how the session index and watcher surface session state, and the allowlist machinery that decides which filesystem paths the Host may serve.
tags: [sessions, storage, file-access, allowlist, worktree, watcher]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

Pi Desktop is a consumer of the Pi CLI's on-disk layout. It does not own a private session store; everything lives under `~/.pi/agent/` (overridable via `PI_CODING_AGENT_SESSION_DIR` / `PI_CODING_AGENT_DIR`), so desktop and CLI share one dataset (repo://src/agent-host/session-index.ts#L71-L73, repo://src/agent-host/session-reader.ts#L1-L10).

## Where data lives

- **Sessions**: `<agentDir>/sessions/**.jsonl`, discovered recursively by the `SessionIndex` (repo://src/agent-host/session-index.ts#L55-L68). The root resolves from `PI_CODING_AGENT_SESSION_DIR` or `<getAgentDir()>/sessions` (repo://src/agent-host/session-index.ts#L71-L73).
- **Channel runtime state**: under `~/.pi/desktop` (or `$PI_DESKTOP_USER_DATA` / `$PI_CODING_AGENT_DIR/desktop`), holding channel config, state, and media stores (repo://src/agent-host/channels/channel-manager.ts#L59-L63).
- **App-managed secrets** (channel credentials) live in the Main process's userData as an encrypted vault, not under `~/.pi` (repo://src/main/main.ts#L461-L472).

## Session index: fingerprints, not full re-parses

`SessionIndex` keeps a per-file `IndexRecord` with a stat fingerprint (`size`, `mtimeMs`, `ctimeMs`, `ino`); a refresh reuses cached parse results when the fingerprint is unchanged and only re-parses changed or new files (repo://src/agent-host/session-index.ts#L26-L53). Session discovery walks the sessions tree for `.jsonl` files (repo://src/agent-host/session-index.ts#L55-L68). The index also derives **project views**: each session's `cwd` is resolved to its shared project root via `resolveProject`, cached per project-view revision with a 60 s TTL (repo://src/agent-host/session-index.ts#L100-L127). Derived state links child sessions to parents (`parentSessionId`) and is rebuilt whenever records change (repo://src/agent-host/session-index.ts#L78-L97).

`listAllSessions` in `session-reader.ts` falls back to Pi's `SessionManager.listAll()` if the index fails, and resolves each session's project so `projectRoot`/`worktreeBranch` decorate the list (repo://src/agent-host/session-reader.ts#L17-L65). A bounded `sessionId → path` cache backs `resolveSessionPath` (repo://src/agent-host/session-reader.ts#L68-L83).

## Session watcher: event-driven invalidation → `sessions.changed`

`startSessionWatcher` watches the agent directory recursively and classifies each fs event via `classifySessionWatchChange` into per-path or full refreshes; changes are debounced (300 ms) (repo://src/agent-host/session-watcher.ts#L21-L83). On flush it:

1. invalidates the allowed-roots cache,
2. emits targeted `sessions.changed` events per changed path — including `deleted: true` when a previously-known session disappears — or a `fullRefresh` wildcard when unclassifiable (repo://src/agent-host/session-watcher.ts#L31-L60).

Watcher failures force the wildcard/full-refresh and are treated as unhealthy by the file-access cache (repo://src/agent-host/session-watcher.ts#L63-L83, repo://src/shared/allowed-roots.ts#L62-L69).

## Worktree/project resolution

`resolveProject` maps a cwd to `{ projectRoot, branch, isWorktree, isTopLevel }`. A worktree's `git rev-parse --git-common-dir` points at the main repo's `.git`, whose parent is the project root shared by all worktrees; non-git directories resolve to themselves. Results are cached per process with a 60 s TTL, and worktree add/remove bumps a revision that eagerly invalidates the cache (repo://src/shared/worktree.ts#L41-L96). Creating or registering a worktree also calls `allowFileRoot(worktreePath)`, which feeds straight into the file-access allowlist (repo://src/shared/worktree.ts#L305-L310).

## The file-access allowlist

Host file APIs (`files.list/read/download/preview`, etc.) only serve paths inside allowed roots. Roots come from four sources:

1. **Every indexed session's `cwd` and `projectRoot`** — the project root is browsable even when only worktrees have sessions (repo://src/agent-host/file-access.ts#L43-L66).
2. **Default-cwd scratch directories**: `~/pi-cwd-<digits>` created by the default-cwd endpoint (repo://src/agent-host/file-access.ts#L53-L62).
3. **Explicit grants** via `allowFileRoot`, called by worktree registration and by handlers when a directory/drop/preview is validated (repo://src/shared/allowed-roots.ts#L47-L52, repo://src/agent-host/handlers.ts#L1096-L1116, repo://src/agent-host/handlers.ts#L1922-L1941).
4. Process-local additional roots accumulated during the Host's lifetime (repo://src/shared/allowed-roots.ts#L1-L12).

Gate checks use `canonicalPath` — realpath of the nearest **existing ancestor** — so a symlink cannot hide behind not-yet-created path segments; matching is separator-aware and case-insensitive for Windows paths (repo://src/agent-host/file-access-core.ts#L13-L34).

### Cache invalidation semantics

The roots cache is generation-counted. An async scan snapshots `getAllowedRootsGeneration()` before listing sessions, and its result is published **only if no invalidation happened meanwhile** (`setAllowedRootsCacheIfCurrent`); the caller retries once, and a second collision stays uncached so stale roots can never ride the long TTL (repo://src/agent-host/file-access.ts#L21-L41, repo://src/shared/allowed-roots.ts#L31-L38). TTL is 10 minutes with a healthy watcher (every mutation invalidates explicitly) and drops to 5 seconds as a safety net when `fs.watch` failed — so sessions created by an external Pi CLI still appear (repo://src/shared/allowed-roots.ts#L61-L74).

## Failure behavior

- If the agent dir cannot be determined or created, the watcher degrades to a no-op rather than crashing the Host (repo://src/agent-host/session-watcher.ts#L11-L19).
- Index failure falls back to Pi's session manager; the app prefers availability over the optimized index (repo://src/agent-host/session-reader.ts#L17-L26).
- Watcher refresh errors emit `sessions.changed *` full refreshes so UI state self-heals (repo://src/agent-host/session-watcher.ts#L62-72).
- File access outside roots is refused by `isFilePathAllowed` — there is no per-request override except via explicit `allowFileRoot` grants (repo://src/agent-host/file-access-core.ts#L34-L47).

## Related pages

- [Agent Sessions](/openwiki/workflows/agent-sessions.md) — what runs against these session files.
- [Security Model](/openwiki/architecture/security-model.md) — where this allowlist sits in the security stack.
