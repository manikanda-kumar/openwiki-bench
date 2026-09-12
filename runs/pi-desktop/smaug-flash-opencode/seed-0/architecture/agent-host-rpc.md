---
type: architecture
title: Agent Host & MessagePort RPC
description: How the Agent Host utilityProcess is supervised and restarted by the main process, and the request/response plus stream MessagePort RPC protocol that carries the desktop API surface.
tags: [architecture, agent-host, rpc, process-supervision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-2e66fb4f566860c1e33d2bc9
    resource: repo://src/main/host-restart-core.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Agent Host & MessagePort RPC

The Agent Host is an Electron `utilityProcess` that runs the `pi-coding-agent`
in-process and serves the desktop's request/response and stream API over
assembled `MessagePort`s. The main process supervises it, and the renderer talks
to it directly once a port is handed over.

## Role and entrypoint

`src/agent-host/index.ts` is the Host process entry. At startup it builds a
single RPC server (`createRpcServer` from `src/contract/rpc`), installs Git
toolchain routing and session tool definitions, registers all API handlers, and
starts a session watcher. It then messages its parent over
`process.parentPort`:

- `ready` (with the resolved Pi runtime version) shortly after boot;
- `pong` replies to each main-process `ping`;
- `toolchain:ack` / `browser:ack` once a pushed policy snapshot is applied;
- `managed-process-owner:ack` after the owner identity is accepted.

The entrypoint subscribes to parent messages for `ping`, `attach-port` (each
carries a transferred `MessagePort`), `toolchain:init` / `toolchain:changed`
and `browser:init` / `browser:changed` (both carry a policy snapshot), a
`managed-process-owner:init` identity message, and `shutdown`. When a port is
attached, the Host calls `server.attachPort(port)` and from then on the caller
(Renderer or main) talks to the same RPC server over that port.

Because `pi-coding-agent` is import-only ESM, the Host is launched from the
bundled `agent-host.mjs` entry (`resolveHostEntry` in `src/main/host-manager.ts`).

## Main-process supervision (HostManager)

`src/main/host-manager.ts` owns the Host lifecycle. Its status machine is
`stopped → starting → ready → crashed ↘ stopped` and it pushes every change to
renderer listeners.

- **Spawn** (`HostManager.spawn`): forks `utilityProcess.fork(this.hostEntry)`.
  A new `hostInstanceId` (UUID) is minted and both policy-snapshot ack
  revisions are reset to `-1` because a replacement process must acknowledge
  the snapshots itself. The child env always sets `PI_AGENT_HOST=1` and
  removes `ELECTRON_RUN_AS_NODE`.
- **Ready handshake**: on `ready`, the manager re-delivers the current
  toolchain and browser capability snapshots (`toolchain:init`, `browser:init`),
  pushes the managed-process owner identity, starts the ping loop, and marks
  the Host `ready`. If the Host had been ready before a crash, it emits a
  `host-restarted` event to the renderer.
- **Ping/pong heartbeat** (`startPing`): every `PING_INTERVAL_MS` (15 s) it
  sends `ping` and, via `evaluateHeartbeatTick` from
  `src/shared/heartbeat-liveness.ts`, kills the child if a pong has not arrived
  within `PING_TIMEOUT_MS` (10 s).
- **Restart budget** (`scheduleRestart` → `reserveHostRestart` in
  `src/main/host-restart-core.ts`): at most `MAX_RESTARTS` (2) restarts are
  allowed within a rolling `CRASH_WINDOW_MS` (30 s). A `rescan` within the
  window is used; exceeding the budget flips the Host to `crashed` instead of
  restarting.
- **Exit handling**: on child exit the manager first runs the
  `beforeRestartHandler` (managed-process cleanup) and only schedules a restart
  if that cleanup can be safely confirmed; otherwise the Host is marked
  `crashed`. A `host-rpc` outbound message lets the Host make one-shot RPC
  calls to the main process, answered through `host-rpc-result`.

## Port hand-off patterns

Three ways a MessagePort reaches the Host:

1. **Renderer channel** — `HostManager.createRendererChannel` builds a
   `MessageChannelMain` and hands the Host-side port to
   `attachRendererPort`. Pending ports are queued until the child emits
   `spawn`, then flushed.
2. **Host→renderer transfer** — the renderer calls `requestHostPort()`
   (`src/renderer/lib/api-client.ts`), which invokes `window.piBridge.requestHostPort()`;
   the preload receives `desktop:host-port`, selects the transferred port, and
   re-posts it to the page via `window.postMessage(..., [port])`
   (`src/preload/preload.ts`). The page must not transport a port through
   `contextBridge` as a Promise value because that silently breaks the port.
3. **Main→Host one-shot RPC** — `HostManager.call` opens a temporary channel,
   issues a single `request`, and resolves/rejects on the matching `response`.

## RPC wire protocol

`src/contract/rpc.ts` implements a dependency-free `MessagePort` RPC layer with
five message kinds:

- `request` / `response` — method calls with a unique `id`, an `ok` flag, and
  a typed result or `RpcErrorShape`;
- `subscribe` / `unsubscribe` — register or drop a `(topic, key)` subscription;
- `event` — a server-pushed `(topic, key, data)` broadcast.

The client (`createRpcClient`) correlates responses by idhols page pages,
enforces a default 120 s call timeout, and fans events out to matching
subscribers where the key equals the topic's key or the sentinel `*` matches
either side. On port close or timeout it rejects all pending calls with
`CLOSED` / `TIMEOUT`. The server (`createRpcServer`) tracks per-port
subscriptions and per-port leases (`setLease` / `releaseLease`) that are
finalized if the port closes, and it maps unknown handlers, `RpcError`,
`ToolchainError`, and arbitrary exceptions to structured error shapes
(`METHOD_NOT_FOUND`, `INTERNAL`, and the toolchain codes).

## API and stream surfaces

`src/contract/api.ts` defines the full `Api` (request/response) and `Streams`
(server-push) surface. Handlers are registered in `src/agent-host/handlers.ts`
via `createRpcServer().handle(...)`.

Request groups include: `host.*`, `processes.*` (managed background
processes), `sessions.*` / `agent.*` (session lifecycle and commands),
`channels.*` (Feishu/Telegram/WeChat), `files.*` / `worktrees.*` / `git.status`
(project surface), `models.*` / `modelsConfig.*` / `auth.*` (providers),
`skills.*` / `plugins.*`, and `system.*`.

Streams include `agent.events`, `agent.running`, `auth.login`,
`sessions.changed`, `files.changed`, `channels.status`,
`channels.login`, `channels.pairing`, `channels.binding`,
`channels.activity`, `processes.changed`, and `processes.output`. Handlers
broadcast these by calling `server.emit(topic, key, data)`.

Typical flows, all over the same port:

- `agent.new` / `agent.command` / `agent.state` — create or drive a Pi agent
  session; session events arrive on `agent.events`.
- `sessions.list` / `sessions.get` — enumerate and detail sessions; updates
  arrive on `sessions.changed`.
- `auth.*` — manage provider credentials and OAuth, with progress pushed on
  `auth.login`.
- `skills.*` / `plugins.*` — list, install, and configure skills and plugins.

## Renderer connection and crash recovery

`src/renderer/lib/api-client.ts` exposes a single facade (`ensureRpc` / `call`
/ `subscribe`) that all components use and never lets them touch `MessagePort`
directly. It waits for the Host to be `ready` (via `piBridge.getHostStatus` and
`onHostStatus`, with a 30 s cap), requests the transferred port, verifies liveness
with `host.ping`, and builds a client. On Host crash the renderer reseeds the
RPC by dropping the client (`resetRpc`) and re-running `ensureRpc`, which
re-requests a fresh port after the main process restarts the Host.

## Failure behavior

The Host installs `uncaughtException` and `unhandledRejection` handlers that
log and then `process.exit(1)` on the next tick, so a potentially corrupted Host
does not keep serving requests; the main-process supervisor restarts it within
its restart budget. `shutdown` is the graceful path (stops watcher, restores Git
runner, closes handlers, exits), triggered by `HostManager.stop`.

Global page-relevant notes: the Host is intentionally small and owns agent
runtime, session, file, skills/plugin, channel, and managed-process concerns,
while the main process handles window, menu, tray, update, and browser-surface
lifecycle. Cross-system pages are linked below.
