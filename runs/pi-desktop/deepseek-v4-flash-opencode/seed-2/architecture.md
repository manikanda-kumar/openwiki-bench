---
type: concept
title: Architecture and process model
description: The Pi Agent Desktop is a three-process Electron application that separates the Electron main process (windows, menus, supervision), the Agent Host utilityProcess (pi-coding-agent and all business logic), and the sandboxed React renderer, connected by MessagePort RPC.
tags: [architecture, electron, processes, message-port, rpc, supervision]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T15:27:00.466Z
---

# Architecture and process model

Pi Agent Desktop is a pure Electron desktop application (no sidecar server, no bundled Node). It separates high-privilege desktop capabilities, the Agent runtime, and the UI into three processes, communicating over Electron MessagePorts and typed IPC.

```
Main (Electron main)  <->  Agent Host (utilityProcess)
  ^                          ^  MessagePort RPC (renderer <-> Host)
  |  ipcMain / preload       |
Renderer (React 19 / Vite)   |  Browser (Main-owned WebContentsView)
                             |  Managed project processes (POSIX group / Windows Job)
```

## Process roles

- **Main process** — `src/main/main.ts`. Owns window lifecycle, menus, tray/badge, deep links, the `app://` protocol, the built-in browser, toolchains, updates, and supervision of the Agent Host. The file's header states it carries "no business logic" (`src/main/main.ts:1-5`); business logic lives in the Host.
- **Agent Host** — `src/agent-host/index.ts`, a `utilityProcess` (`serviceName: "pi-agent-host"`) that embeds `pi-coding-agent` in-process. It owns sessions, files, models, credentials, skills, plugins, messaging channels, and managed background processes. It is forked by `HostManager.spawn()` (`src/main/host-manager.ts:209-236`).
- **Renderer** — `src/renderer/main.tsx` + `App.tsx`. React 19 + Vite UI. Runs with Electron `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, and a strict CSP served by the `app://` protocol (`src/main/window.ts:48-54`, `src/main/protocol.ts:11-25`). It talks to the Host only through a preload-transferred MessagePort.
- **Browser** — Main-owned `WebContentsView` for remote and localhost pages. Remote sites never receive the app preload, Node, or the renderer bridge.
- **Managed project processes** — user-triggered dev servers/watchers owned by the Host, supervised by a main-process crash reaper.

## Host supervision and crash recovery

`HostManager` (`src/main/host-manager.ts`) is the main-process supervisor:

- Spawns the Host with `utilityProcess.fork` and injects `PI_AGENT_HOST=1`, `PI_DESKTOP_USER_DATA`, `PI_DESKTOP_VERSION`; it deletes `ELECTRON_RUN_AS_NODE` so the Host keeps `process.parentPort` (`src/main/host-manager.ts:219-228`).
- Liveness is maintained by a ping interval: every 15s main posts `ping` and the Host replies `pong`; if a reply is missing for 10s the Host is killed (`src/main/host-manager.ts:386-416`, `src/shared/heartbeat-liveness.ts`).
- On Host exit, main runs the pre-restart cleanup handler, then schedules a restart within a bounded budget: `MAX_RESTARTS = 2` within a `CRASH_WINDOW_MS = 30_000` window (`src/main/host-manager.ts:17-18, 368-384`; `src/main/host-restart-core.ts:37-48`). Exhausting the budget transitions to `crashed`.
- Before a Host restart, the main process must confirm managed-process cleanup (`reapAll` returns zero records), or the restart is blocked (`src/main/main.ts:579-587`).
- Renderer reconnects after a crash via `resetRpc()` + `ensureRpc()` in `src/renderer/lib/api-client.ts:11-20` and the `onHostRestarted`/`onHostCrashed` events in `App.tsx:64-77`.

## Policy snapshot handshake

Desktop-owned capability policies are pushed from main to the Host and acknowledged by revision:

- `toolchain:init` / `toolchain:changed` — the `ToolchainSnapshot` from `ToolchainManager` is posted and acknowledged with `toolchain:ack { revision }` (`src/main/host-manager.ts:418-425`, `src/agent-host/index.ts:76-86`).
- `browser:init` / `browser:changed` — the `BrowserCapabilitySnapshot` is posted and acknowledged with `browser:ack { revision }` (`src/main/host-manager.ts:427-434`, `src/agent-host/index.ts:87-98`).
- `managed-process-owner:init` — main announces its PID, start fingerprint, real image path, and `hostInstanceId`; the Host stores this owner identity and acknowledges (`src/main/host-manager.ts:436-456`, `src/agent-host/index.ts:63-75`).

Acknowledgements are not transferable across Host instances: a replacement Host must re-acknowledge both snapshots itself (`src/main/host-manager.ts:211-216`).

## Renderer ↔ Host bridging

The renderer never uses IPC for Host traffic; it uses a MessagePort RPC channel:

1. Renderer calls `window.piBridge.requestHostPort()` (preload `src/preload/preload.ts:68-70`).
2. Main creates a `MessageChannelMain`, hands one port to the Host via `attachRendererPort`, and sends the other to the renderer through `desktop:host-port` (`src/main/host-manager.ts:140-166`, `src/preload/preload.ts:18-26`).
3. Preload forwards the port to the page via `window.postMessage` with transfer, because ports cannot cross `contextBridge` via promise resolution (`src/preload/preload.ts:4-6, 22-25`).
4. The renderer's `api-client.ts` receives it, creates a typed `createRpcClient(port)`, and gates on host readiness first (`waitForHostReady` then `requestHostPort`, with `host.ping` validation) (`src/renderer/lib/api-client.ts:42-141`).

The `preload.ts` also validates the preload location and only exposes `piBridge` in trusted locations (`src/preload/preload-location-policy.ts`). `piBridge` additionally exposes desktop-only surfaces (updates, menus, toolchains, browser controls, file save/context menus, theme, diagnostics) via `ipcRenderer.invoke`/`send`.

## Main-mediated Host requests

Not all Host needs are reachable over the renderer port. The Host issues one-shot RPCs to main via `callMain` (`src/agent-host/parent-rpc.ts`), posting `host-rpc` on `process.parentPort`; main dispatches them in its `setRequestHandler` (`src/main/main.ts:591-685`): channel credential secrets (`channelSecrets.*` → `CredentialVault`), toolchain snapshot/resolution, managed-process settings/registration/LAN-bind confirmations/export dialogs, and `browser.*` host methods routed to `BrowserService`. Browser errors carry a structured `BrowserError` with recovery hints.

## No local server, data persistence

- The app intentionally runs **no internal TCP/HTTP server** for UI or control-plane traffic; renderer↔Host traffic is MessagePort-only. User-initiated managed project services may listen on loopback, and the built-in browser can reach them under separate authorization (`README.md` architecture section).
- User data — Pi sessions, models, config — persists under the Pi agent directory (`~/.pi/agent/`), shared with the Pi CLI. The Host resolves it via `getAgentDir()` from pi-coding-agent (e.g. `src/agent-host/session-watcher.ts:14-28`). Desktop-owned UI state is stored separately via `window-state.ts`.
- Channel credentials are kept in an OS-encrypted `CredentialVault` (`safeStorage`) at `<userData>/channels.secrets.json` (`src/main/credential-vault.ts`).

## Compatibility shim

For migrated components that still call `/api/...`, the renderer installs a `fetch` and `EventSource` shim that translates legacy HTTP-shaped calls into the typed RPC surface (`src/renderer/lib/api-fetch.ts`, `installApiShims()` in `src/renderer/main.tsx:10`). This keeps the UI decoupled from the old server-style routes without opening any local port.