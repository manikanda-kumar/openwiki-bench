---
type: architecture
title: Agent Host
description: The Agent Host is the Electron utilityProcess that runs the Pi Coding Agent in-process and serves the desktop Api/Streams contract over MessagePort; it owns sessions, the session index/watcher, model runtime, auth, skills/plugins, and file-access policy.
tags: [architecture, agent-host, sessions, rpc, utility-process]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T10:56:41.032Z
---

# Agent Host

The **Agent Host** is the Electron `utilityProcess` that runs the Pi Coding Agent
(`@earendil-works/pi-coding-agent` 0.84.0) in-process and serves the desktop
request/response API plus server-push streams over a `MessagePort`. It is the
only process that talks to the coding-agent SDK and it owns the desktop's
session, model, file, skill, plugin, and worktree behavior.

## Entrypoint and role

The Host entry is `src/agent-host/index.ts`. It is bundled by tsup as ESM
(`out/main/agent-host.mjs`) and spawned by the Electron main process with
`utilityProcess.fork` (see `src/main/host-manager.ts`). Because the pi packages
are import-only ESM, the Host bundle is ESM while the main process bundle is CJS
(`tsup.config.ts`).

At startup the Host:

1. Creates the RPC server with `createRpcServer()` (`src/contract/rpc.ts`).
2. Installs the toolchain git runner and registers every API handler
   (`registerHandlers` in `src/agent-host/handlers.ts`).
3. Starts the session watcher (`startSessionWatcher` in
   `src/agent-host/session-watcher.ts`).
4. Reads the Pi runtime version and posts `{ type: "ready" }` to its parent port.

It also initializes the `ChannelManager` for messaging channels and the
`ManagedProcessService` for managed background processes; those subsystems are
covered by their own wiki pages.

## Parent-channel protocol

The Host receives control messages on `process.parentPort`:

- `ping` → replies `pong` (heartbeat supervised by the main process).
- `attach-port` → transfers the renderer's `MessagePort` into the RPC server so
  the renderer can call handlers directly.
- `toolchain:init` / `toolchain:changed` → applies a `ToolchainSnapshot` to the
  toolchain runtime and acks with `toolchain:ack` including the revision.
- `browser:init` / `browser:changed` → applies a `BrowserCapabilitySnapshot` and
  syncs browser tools across sessions, acking with `browser:ack`.
- `managed-process-owner:init` → binds the Host to the main process owner
  identity used to gate Windows managed-process registration.
- `shutdown` → stops the watcher, restores the git runner, disposes all sessions
  and exits with code 0.

The Host also initiates calls in the other direction: `src/agent-host/parent-rpc.ts`
wraps `host-rpc` / `host-rpc-result` messages so the Host can request
main-process services (browser operations, channel secrets, toolchain
resolution, managed-process dialogs) with a default 10s timeout.

## Crash and liveness behavior

`src/agent-host/index.ts` registers `uncaughtException` and `unhandledRejection`
handlers that log the error and then `process.exit(1)`. The comment is explicit
that a possibly-corrupted Host must not keep serving requests; the main process
supervisor detects the exit and restarts it within its restart budget
(`src/main/host-manager.ts`). The Host keeps a `setInterval` alive and does not
serve further requests after an uncaught exception.

## Session lifecycle

Sessions are created and wrapped by `src/agent-host/rpc-manager.ts`:

- `startRpcSession` creates an `AgentSessionWrapper` around the pi
  `AgentSession` (or reuses a live one from the registry), optionally
  pre-configuring active tool names.
- `AgentSessionWrapper.send` dispatches agent commands (`prompt`, `steer`,
  `follow_up`, `compact`, `fork`, `set_model`, `set_thinking_level`,
  `set_session_name`, `reload`, extension UI responses, and more). Turns are
  serialized through a promise `turnTail` queue, and running state is broadcast
  through `notifyRunningChange()` to the `agent.running` stream and to the main
  process (`running-sessions` message) for tray/badge counts.
- Idle sessions are evicted after 10 minutes of no activity
  (`resetIdleTimer`), but never while the agent is still running.
- `dispose` is idempotent and shared across concurrent owners; `destroy` runs
  teardown callbacks, cancels pending extension UI responses, and clears the
  browser agent runtime for the session.
- The registry installs `exit`/`SIGINT`/`SIGTERM` cleanup so all sessions are
  disposed on Host shutdown.

Session files are JSONL under the pi agent directory (default
`~/.pi/agent/sessions`, overridable with `PI_CODING_AGENT_SESSION_DIR`), and
both the pi `SessionManager` and the desktop's own `SessionIndex` read them.

## Session index, watcher, and path cache

`src/agent-host/session-index.ts` maintains an in-memory `SessionIndex` keyed by
file path. It fingerprints each `.jsonl` session file by size, mtime, ctime, and
inode so `refreshAll()` / `refreshPath()` only re-parse changed files. It also
refreshes project views (worktree/project-root resolution) with a 60s TTL and a
project-cache revision guard.

`src/agent-host/session-watcher.ts` uses `fs.watch` (recursive) on the agent
directory, classifies each change, and debounces refresh work by 300ms before
emitting `sessions.changed` events. The watcher also drives invalidation of the
allowed-roots cache and toggles a "watcher healthy" flag used to choose the
cache TTL.

`resolveSessionPath` (in `src/agent-host/session-reader.ts`) resolves a session
id to an absolute file path through an in-memory path cache that is bounded by
the Host process lifetime, falling back to the index, falling back to a full pi
`SessionManager.listAll()` scan.

## File-access policy

`src/agent-host/file-access.ts` computes the set of allowed file roots from:

- the `cwd` and `projectRoot` of every session,
- `~/pi-cwd-*` directories created by the default-cwd endpoint,
- additional explicitly allowed roots (e.g. worktrees).

The cache is watcher-aware: TTL is long when the session watcher can invalidate
on change, short when it cannot. `src/agent-host/file-access-core.ts` implements
containment: paths are canonicalized with `realpath` (resolving symlinks and
junctions, falling back to the nearest existing ancestor) and must be equal to
or inside an allowed root. `assertPathAllowed` additionally permits files that
are referenced by a session (`isFilePathReferencedBySession`) — the mechanism
behind `@` file references.

## Model runtime and models.json

`src/agent-host/model-runtime.ts` exposes a shared `ModelRuntime` and a
`ModelCatalogRefreshCoordinator` that:

- aborts/replaces any prior refresh for the same request id or cwd,
- enforces a 12s timeout and detects offline mode via `PI_OFFLINE`,
- on partial provider failure keeps the cached catalog and reports a
  `PROVIDER_REFRESH_FAILED` warning.

The provider/model configuration lives in `models.json` inside the pi agent
directory. `src/agent-host/handlers.ts` implements optimistic-concurrency-safe
writes: the caller must pass the `expectedVersion` (a SHA-256 of the current
file), the write is atomic via temp file + `rename`, a `.bak` of the previous
good file is kept, and a `CONFLICT` error is raised if the file changed
underneath the editor. A corrupt `models.json` fails with `PARSE_ERROR` instead
of being silently overwritten.

## Auth / OAuth login

`src/agent-host/auth-login.ts` runs browser-style OAuth logins against the
model runtime. Login progress is pushed over the `auth.login` stream, code
prompts are resolved through `resolveLoginCode`, and logins can be cancelled via
AbortController. `src/agent-host/credential-sync.ts` verifies credential
commits against the runtime and can recover a committed credential whose model
sync failed.

## Skills and plugins

- Skills search/install (`src/agent-host/skills-service.ts`): search hits the
  skills.sh API (`SKILLS_API_URL`, default `https://skills.sh`); on failure it
  falls back to the `skills` CLI via `runNpx`. Install runs `skills add -y
  --agent pi` through npx with a 180s timeout and npm's default concurrency,
  retrying once with an isolated cache when network/timeout/cache-lock faults
  occur.
- Plugins (`src/agent-host/plugins-service.ts`): managed through the pi
  `DefaultPackageManager`. Disabled plugin sources are recorded in
  `pi-desktop-plugin-filters.json` inside the agent directory, and plugin
  work is delegated to a dedicated `utilityProcess` worker
  (`src/agent-host/plugin-worker.ts`, invoked via `plugin-worker-client.ts`).

## Auto session titles

`src/agent-host/session-title.ts` provides pure helpers for automatic titles:
`sanitizeGeneratedTitle` normalizes a model-generated title (collapse
whitespace, strip wrapping quotes and trailing punctuation, cap at 40
characters), and `makeFallbackTitle` guarantees a non-empty local fallback from
the first user message. In `handlers.ts`, `agent.generateTitle` performs a
silent LLM request that never touches session history, and
`applySessionNameIfEmpty` writes the title only if the session has no name —
checking and writing in the same synchronous turn so a concurrent manual rename
always wins.

## Related pages

- `/openwiki/architecture/rpc-and-contract.md` — the MessagePort protocol the Host serves.
- `/openwiki/architecture/main-process.md` — Host supervision and restart budget.
- `/openwiki/operations/persistence-and-data.md` — where session/model/config data lives.
- `/openwiki/systems/managed-processes.md` — the managed-process service initialized by the Host.
- `/openwiki/systems/messaging-channels.md` — the `ChannelManager` and external turns.
- `/openwiki/systems/toolchains.md` — toolchain snapshots consumed by the Host.