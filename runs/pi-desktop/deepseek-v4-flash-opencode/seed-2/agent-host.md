---
type: concept
title: Agent Host runtime
description: The Electron utilityProcess that embeds pi-coding-agent, serving the renderer over a MessagePort RPC server, wrapping sessions, registering desktop tools, coordinating model catalog refresh, and forwarding privileged requests to the main process.
tags: [agent-host, utility-process, rpc, sessions, model-runtime, toolchain]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T15:27:00.466Z
---

# Agent Host runtime

The Agent Host is a dedicated Electron `utilityProcess` that embeds the Pi Coding Agent (`@earendil-works/pi-coding-agent`) in-process and exposes it to the renderer over a typed MessagePort RPC server. It is the privileged-but-isolated "server side" of the desktop app: session execution, file access, model/credential management, channel adapters, skills, plugins, and managed background processes all live here. The main process supervises it, and the renderer talks to it directly through the preload-transferred MessagePort.

## Ownership and boundaries

- **Entrypoint**: `src/agent-host/index.ts`. It is bundled by tsup to `out/main/agent-host.mjs` (ESM, because Pi packages are import-only) and forked by the main process (`src/main/host-manager.ts` `spawn()` via `utilityProcess.fork`).
- The Host must **not** run as pure Node (`ELECTRON_RUN_AS_NODE` is deleted from its environment) because it relies on `process.parentPort` from `utilityProcess` (`src/main/host-manager.ts:224-225`).
- It reads desktop-owned environment: `PI_AGENT_HOST=1`, `PI_DESKTOP_USER_DATA`, `PI_DESKTOP_VERSION` are injected by the main process (`src/main/host-manager.ts:226-228`).
- Business logic lives in the Host; the main process explicitly carries "no business logic" (`src/main/main.ts:1-5`).

## Lifecycle messages

The Host and main process exchange a small set of control messages over `process.parentPort` (`src/agent-host/index.ts:33-104`):

- `ping` → `pong` — liveness heartbeat used by the main-process supervisor.
- `attach-port` — main hands over a renderer MessagePort; the RPC server attaches it.
- `toolchain:init` / `toolchain:changed` — main pushes the toolchain snapshot; the Host applies it via `toolchainRuntime.apply()` and acknowledges with `toolchain:ack` carrying the revision.
- `browser:init` / `browser:changed` — main pushes the browser capability snapshot; the Host applies it via `browserCapabilityRuntime.apply()`, re-syncs browser tools for all sessions, and acknowledges with `browser:ack`.
- `managed-process-owner:init` — main announces the owner identity (main PID, start fingerprint, image path, host instance id); the Host stores it and replies `managed-process-owner:ack`.
- `shutdown` — stops the session watcher, restores the git runner, disposes all handlers, then `process.exit(0)`.

On startup the Host posts `ready` with its Pi runtime version, resolved by `readPiRuntimeVersion()` from `src/agent-host/runtime-version.ts`. Uncaught exceptions and unhandled rejections log and force-exit so the main supervisor can restart the Host within its crash budget rather than continue serving from a corrupted process (`src/agent-host/index.ts:113-122`).

## RPC server and handlers

The Host builds an `RpcServer` (`createRpcServer` from `src/contract/rpc.ts`) and registers every Api method via `registerHandlers(server)` from `src/agent-host/handlers.ts`. The renderer's typed request/response contract is defined in `src/contract/api.ts`. Key structural points:

- The server multiplexes request/response/subscribe/unsubscribe/event messages over any attached MessagePort and tracks per-port leases so long-running resources (for example `files.watchStart` leases) are released when the port closes (`src/contract/rpc.ts` `forgetPort`, `requestContext`).
- `registerHandlers` also wires the server-push streams: running-session ids are emitted to `agent.running` and forwarded to main for the tray badge (`src/agent-host/handlers.ts:722-734`).
- Handler shutdown (returned function) cancels model refresh, stops all managed processes as `host`, shuts down channels, stops file watches, and disposes all sessions (`src/agent-host/handlers.ts:1950-1956`).

### Forwarding privileged requests to main

The Host cannot touch desktop-owned capabilities directly. It calls `callMain(method, params, timeoutMs)` (`src/agent-host/parent-rpc.ts`) which posts a `host-rpc` message to `process.parentPort` and resolves the `host-rpc-result` reply. The main process dispatches those in its `setRequestHandler` (`src/main/main.ts:591-685`):

- `channelSecrets.*` → credential vault (`CredentialVault` backed by Electron `safeStorage`), `src/main/credential-vault.ts`.
- `toolchain.getSnapshot` / `toolchain.resolve` → the `ToolchainManager`; resolution validates cwd, intent, and `trusted` flags.
- `managedProcesses.getSettings/register/unregister/confirmLanBind/selectExportTarget` → managed process reaper and dialog confirmations.
- `browser.*` → the `BrowserService` host-request surface.

### Toolchain and browser snapshot handling

- `toolchainRuntime.apply()` keeps the latest snapshot (rejecting older revisions), and drops cached per-project resolutions when the revision changes (`src/agent-host/toolchain-runtime.ts:161-173`).
- `browserCapabilityRuntime` stores the capability snapshot and computes a session's effective `BrowserPermissionLevel` (`src/agent-host/browser-capability-runtime.ts`). Any change triggers `syncBrowserToolsForAllSessions()` so active sessions' tool sets track the current permission state.

## Session wrapper

`AgentSessionWrapper` (`src/agent-host/rpc-manager.ts:170-1313`) is the desktop-facing façade over the Pi `AgentSessionLike`. Sessions are registered in a process-wide registry and started via `startRpcSession()` (`src/agent-host/rpc-manager.ts:1405-1493`). Construction wires in the desktop toolchain:

- A toolchain execution context for `agent-shell` intent is created (`src/agent-host/rpc-manager.ts:1439-1443`).
- Custom tools registered per session: the toolchain-aware Bash tool, desktop search tools, browser tools, and — when the managed-process service exists — `process_*` tools (`src/agent-host/rpc-manager.ts:1450-1461`).
- Browser Bash guarding (`browserAgentRuntime.guardBash`) filters shell commands against browser authorization policy.

Key behaviors:

- **Turn queueing**: prompts and external turns are serialized through `enqueueTurn()`; only `steer`/`followUp` bypass the queue via Pi's streaming behavior (`src/agent-host/rpc-manager.ts:425-447, 580-605`).
- **Events**: subscriber events re-broadcast over `agent.events`; `agent_end` is additionally forwarded to main for desktop notifications (`src/agent-host/handlers.ts:1995-2009`).
- **Extension binding**: sessions bind Pi extensions in RPC mode, mapping extension UI requests (`confirm`, `select`, `input`, `editor`, `notify`, widgets, working indicator) onto renderer events. Terminal-only features (custom footer/header, TUI editor component, autocomplete providers, theme switching, extension-driven session switching) are reported as unsupported and never silently ignored (`src/agent-host/rpc-manager.ts:1142-1277, 1284-1312`).
- **External channel turns**: `runExternalTurn` runs a message-channel turn on the same session, tagging the user message with the channel source/attachments and emitting `channel_turn_*` events; interactive extension UI is blocked during such headless turns (`src/agent-host/rpc-manager.ts:449-510`).
- **Idle eviction**: an idle timer disposes sessions after 10 minutes unless the agent is running; dispose is idempotent and shared across owners (`src/agent-host/rpc-manager.ts:542-555, 831-882`).
- **Tool names**: the active tool set is persisted per session (`pi-desktop-session-tools`); empty tool lists force an empty system prompt (`src/agent-host/rpc-manager.ts:94-121, 398-410`).

## Model runtime and catalog refresh

- A shared host-level `ModelRuntime` (`getSharedModelRuntime`) handles provider/model and credential management outside sessions; each session keeps its own cwd-bound runtime so project extensions cannot leak provider registrations across sessions (`src/agent-host/model-runtime.ts:173-189`).
- `ModelCatalogRefreshCoordinator` coordinates refresh requests keyed by request id and cwd: a new request replaces an in-flight one for the same cwd/requestId, enforces a 12s timeout, and respects offline mode (`PI_OFFLINE`). Failures surface as provider warnings while cached models remain usable (`src/agent-host/model-runtime.ts:49-169`).
- The handlers use `resolveAvailableModels`/`projectModelsList` to merge provider availability checks with the cached snapshot, and `models.json` edits are version-gated with atomic tmp+rename writes plus a `.bak` (`src/agent-host/handlers.ts:210-279, 604-686`).
- Credential mutations verify readability after writing (`credentialStateMatches`) and recover committed-but-unsynced credentials on `CredentialSynchronizationError` (`src/agent-host/handlers.ts:382-399`).

## Session watcher

`startSessionWatcher` (`src/agent-host/session-watcher.ts`) watches the Pi agent directory (defaulting to `~/.pi/agent`) and pushes `sessions.changed` events:

- Recursive `fs.watch` over the agent dir; changes are classified by `classifySessionWatchChange` (`session-watch-policy.ts`) into per-path refresh or full refresh.
- A 300ms debounce batches changes; a full refresh re-indexes everything and emits `{ fullRefresh: true }`; per-path refresh emits session-specific events or `deleted`.
- Watcher health is wired to the allowed-roots cache (`setAllowedRootsWatcherHealthy`, `invalidateAllowedRootsCache`), so file-access policy degrades safely if watching fails.

## Extension point summary

- New Api methods: add types to `src/contract/api.ts` and a handler in `src/agent-host/handlers.ts`; the `check-contract-coverage` script validates handler coverage.
- New desktop tools per session: add them to the `customTools` array in `startRpcSession()`.
- New main-side capabilities for the Host: add a branch to the main `setRequestHandler` and call it via `callMain`.