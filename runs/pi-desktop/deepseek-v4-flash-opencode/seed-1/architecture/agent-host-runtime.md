---
type: concept
title: Agent Host Runtime
description: How the Agent Host utilityProcess runs the pi-coding-agent in-process, manages sessions and custom desktop tools, and serves the typed RPC surface to the renderer.
tags: [agent-host, sessions, rpc, pi-coding-agent, architecture]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-0e308b018c67d162e7d04a50
    resource: repo://src/agent-host/file-access-core.ts
  - id: openwiki-source-ce20b494f5f822ed5576a6a6
    resource: repo://src/agent-host/file-access.ts
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-e754dbf111c65da11a25634e
    resource: repo://src/agent-host/model-runtime.ts
  - id: openwiki-source-5298dc7f2807e154f7134bd1
    resource: repo://src/agent-host/npx.ts
  - id: openwiki-source-bfb43ec6e8519bc6aaeeca26
    resource: repo://src/agent-host/plugins-service.ts
  - id: openwiki-source-5512bd60069393bf8eac652d
    resource: repo://src/agent-host/rpc-manager.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-a5c3af185114022c93a8494c
    resource: repo://src/agent-host/skills-service.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Agent Host Runtime

The **Agent Host** is the Electron `utilityProcess` that owns the coding agent workload. It runs the `@earendil-works/pi-coding-agent` SDK in-process, creates and drives agent sessions, and serves the typed `Api`/`Streams` RPC surface to the renderer over a transferred `MessagePort`. It is a separate process from Electron Main and from the sandboxed renderer.

## Entrypoint and process model

- The Host entry is `src/agent-host/index.ts`, bundled to `out/main/agent-host.mjs` by tsup (`scripts/build-main.mjs`, `tsup.config.ts`). Electron Main resolves it with `resolveHostEntry()` and forks it with `utilityProcess.fork` (`src/main/host-manager.ts:466-469`, `host-manager.ts:209-236`).
- On startup the Host creates the RPC server (`createRpcServer`), registers the full handler map (`registerHandlers`), installs the toolchain-backed Git runner (`installToolchainGitRunner`), and starts the session watcher (`startSessionWatcher`) (`src/agent-host/index.ts:19-22`).
- The Host speaks to Main over `process.parentPort`. It answers `ping`/`pong`, attaches renderer ports (`attach-port`), accepts toolchain and browser capability snapshots (`toolchain:init`/`changed`, `browser:init`/`changed`), applies the managed-process owner identity (`managed-process-owner:init`), and honors a `shutdown` message (`src/agent-host/index.ts:35-107`).
- A `ready` message carrying the Pi runtime version is posted as soon as the Host starts (`src/agent-host/index.ts:106`). Main treats this as the Host becoming ready and then forwards the pending policy snapshots.

## Fail-fast behavior and supervision

- The Host deliberately fails fast on uncaught exceptions or rejections: it logs and calls `process.exit(1)` on the next tick rather than serving requests from a possibly corrupted process (`src/agent-host/index.ts:113-122`).
- Electron Main supervises the Host. A crash is detected by the exit handler plus a ping/pong heartbeat (15 s interval, 10 s timeout), and the Host is restarted with a bounded budget of 2 restarts within a 30 s window before the status flips to `crashed` (`src/main/host-manager.ts:17-20`, `host-manager.ts:368-384`, `host-manager.ts:386-416`).
- Before a Host restart, Main reaps managed processes through the `beforeRestartHandler`; a failed or unconfirmed reap blocks the restart (`src/main/main.ts:579-587`, `host-manager.ts:345-359`).

## Session lifecycle

Sessions are created and driven by `src/agent-host/rpc-manager.ts`.

- `startRpcSession` opens an existing session file with `SessionManager.open(sessionFile)` or creates a new one with `SessionManager.create(cwd)`, then builds the Pi services (`createAgentSessionServices`) **before** constructing the agent so extension-registered providers exist before the SDK restores a saved model (`src/agent-host/rpc-manager.ts:1420-1438`).
- The session is constructed with `createAgentSessionFromServices`, and the resulting Pi `AgentSession` is wrapped in `AgentSessionWrapper` (`src/agent-host/rpc-manager.ts:1462-1486`). The wrapper re-broadcasts agent events to RPC subscribers, queues turns serially, and exposes the same interface expected by the rest of the app.
- Every session is bound to a cwd and to a toolchain execution context resolved with `intent: "agent-shell"` and `trusted = services.settingsManager.isProjectTrusted()`. The resolved context's revision and summary are injected into the system prompt as a `<pi-desktop-toolchain>` block (`src/agent-host/rpc-manager.ts:1439-1448`, `rpc-manager.ts:285-292`, `rpc-manager.ts:412-419`).
- Desktop-owned session tool choices are persisted outside Pi's shared JSONL in a `pi-desktop-session-tools` custom entry (`src/agent-host/rpc-manager.ts:90`, `rpc-manager.ts:112-121`, `src/agent-host/session-tool-store.ts`). `requestedToolNames` selects which tools are active; an empty list forces an empty system prompt (all tools disabled).

## Desktop tools attached to sessions

Each session is constructed with custom tools on top of the Pi defaults (`src/agent-host/rpc-manager.ts:1450-1461`):

- a desktop Bash tool definition (`createBashToolDefinition`) that runs through the toolchain-resolved shell and is guarded by the browser runtime for channel turns (`rpc-manager.ts:1444-1449`);
- desktop search tool definitions backed by `rg`/`fd` (`createDesktopSearchToolDefinitions`);
- browser tools that the browser capability runtime gates (`createBrowserToolDefinitions`);
- managed-process tools (`createManagedProcessToolDefinitions`) when the managed-process service is active.

Tool **registration** is never narrowed — only the active set is filtered, so a session initialized with no tools can enable them later (`src/agent-host/rpc-manager.ts:1469-1474`).

## Channel and external turns

- Channel turns run through `runExternalTurn`, which appends a `pi-desktop-channel-source` marker to the session, optionally delivers attachment context as a custom message, invokes `inner.prompt`, and returns the final assistant text (`src/agent-host/rpc-manager.ts:449-510`).
- External commands (`compact`, `reload`) run through `runExternalCommand`; `reload` re-binds extensions and re-applies tool selection (`rpc-manager.ts:512-540`).
- Sessions are idle-evicted after 10 minutes of inactivity unless the agent is running (`src/agent-host/rpc-manager.ts:542-555`).

## Extension binding

- The wrapper binds Pi extensions in `"rpc"` mode, passing a desktop UI context, command-context actions, and a shutdown handler that reports "shutdown is not supported in Pi Desktop" (`src/agent-host/rpc-manager.ts:309-371`). Extension `session_start` is dispatched once per session (`rpc-manager.ts:354-356`); prompts wait for the bind to succeed (`shouldWaitForExtensions`, `rpc-manager.ts:386-388`).

## Model runtime and OAuth

- `src/agent-host/model-runtime.ts` provides a shared `ModelRuntime` for host-level model and credential management; agent sessions keep their own cwd-bound runtimes so project extensions cannot leak provider registrations across sessions (`model-runtime.ts:173-189`).
- `ModelCatalogRefreshCoordinator` orchestrates catalog refreshes per request id and per cwd, aborting replaced or timed-out refreshes; refresh aborts at 12 s and keeps cached models available. In `PI_OFFLINE` mode it returns an offline catalog status without network access (`model-runtime.ts:5`, `model-runtime.ts:49-149`).
- OAuth login progress is a stream service (`createAuthLoginService`) that uses the shared model runtime and resolves interactive prompts through per-provider callbacks; cancellation is driven by `AbortController` (`src/agent-host/auth-login.ts:51-229`).

## Skills and plugins

- Skills search queries the `skills.sh` API first and falls back to the Pi skills CLI via `runNpx`; installation runs the skills CLI (`skills add`) (`src/agent-host/skills-service.ts:13-68`).
- `runNpx` always uses the Main-resolved Node + npx pair from the toolchain execution context — the Host never scans PATH itself. On network, lock, or concurrency failures it retries once with an isolated `npm_config_cache` and `--maxsockets=1` (`src/agent-host/npx.ts:77-116`).
- Plugins are managed through Pi's `DefaultPackageManager`. Install/remove/update that need npm or git run in a plugin worker with the toolchain-resolved npm command; disable/enable rewrite package resource arrays to empty and back up the previous configuration in `pi-desktop-plugin-filters.json` (`src/agent-host/plugins-service.ts:296-315`, `plugins-service.ts:40-75`, `plugins-service.ts:124-159`).

## Session watching and indexing

- `startSessionWatcher` watches the Pi agent directory (from `getAgentDir()`), classifies file changes, debounces by 300 ms, and emits `sessions.changed` events — per-session when a path refresh is enough, or a `fullRefresh` for structural changes (`src/agent-host/session-watcher.ts:12-99`).
- `SessionIndex` fingerprints session JSONL files (size, mtimes, inode) so unchanged files are reused across refreshes (`src/agent-host/session-index.ts:33-66`).
- File access is rooted: allowed roots are derived from session cwds and project roots (plus `~/pi-cwd-*`), cached with a watcher-aware TTL, and enforced by `isFilePathAllowed` (`src/agent-host/file-access.ts:24-60`, `src/agent-host/file-access-core.ts`).

## Related pages

- [Three-Process Architecture](./three-process-architecture.md)
- [RPC and Contract Layer](./rpc-and-contracts.md)
- [Sessions and Project Files](../systems/sessions-and-project-files.md)
- [Toolchain Management](../systems/toolchain-management.md)
- [Messaging Channels](../systems/messaging-channels.md)
