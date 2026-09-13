---
type: concept
title: Architecture Overview
description: The three-process Electron architecture of Pi Agent Desktop — Electron Main, Agent Host utilityProcess, and sandboxed React Renderer — plus the shared/contract layers and cross-process control flow.
tags: [architecture, electron, main, agent-host, renderer]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-ab729f0aba4796e9191fbadd
    resource: repo://src/agent-host/parent-rpc.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-07e08ac8a9b42c5bb7d70cd6
    resource: repo://src/contract/desktop.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-650ce447b08aa5092ed0ec70
    resource: repo://src/main/protocol.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Architecture Overview

Pi Agent Desktop is a pure Electron desktop application (`package.json` productName "Pi Agent Desktop", version 0.1.14) that embeds the Pi coding agent (`@earendil-works/pi-coding-agent` 0.84.0) as a desktop workbench. There is no internal HTTP server or bundled Node sidecar; the renderer is served over a custom `app://` protocol and all Host traffic travels over MessagePort RPC.

## Process model and ownership boundaries

```
Electron Main (out/main/main.js)
  window lifecycle, menus, tray, deep links, updates
  Host supervision, toolchain manager, browser service, managed-process reaper
      │  spawns + supervises
      ▼
Agent Host utilityProcess (out/main/agent-host.mjs)
  Pi Coding Agent in-process: sessions, files, config, models, auth
  channels (WeChat/Telegram/Feishu), managed processes, skills/plugins
      ▲  MessagePort RPC (typed contract)
      │
Renderer (React 19 + Vite, sandboxed)
      ▲  preload bridge (piBridge) → Electron IPC
      │
Electron Main (again)
```

- **Main process** (`src/main/main.ts`): owns window lifecycle, menus, tray/badge, deep links, the update manager, the toolchain manager, the browser service, the managed-process reaper, and Host supervision. Its own comment states it has "no business logic" (`src/main/main.ts:1`).
- **Agent Host** (`src/agent-host/index.ts`): an Electron `utilityProcess` running `pi-coding-agent` in-process. It serves the `Api`/`Streams` RPC contract over MessagePort and hosts sessions, file access, models/auth, channels, skills/plugins, and managed processes. It must be a `utilityProcess` (not pure Node) because it needs `process.parentPort` (`src/main/host-manager.ts:224`).
- **Renderer** (`src/renderer/main.tsx`): the React 19 UI, served over `app://bundle/index.html`, sandboxed with `sandbox: true`, `contextIsolation: true`, and a strict CSP (`src/main/window.ts:48`, `src/main/protocol.ts:11`). It talks to Main only through the preload `piBridge` surface and to the Host through a MessagePort it receives via `window.postMessage` transfer.
- **Preload** (`src/preload/preload.ts`): exposes `window.piBridge` — the typed `PiBridge` desktop surface (`src/contract/desktop.ts:131`) — but never passes MessagePorts through `contextBridge`. Ports cross via `window.postMessage` transfer (`src/preload/preload.ts:18`).
- **Shared** (`src/shared/`): framework-free pure functions and shared types (session message types, channel types, toolchain types, worktree/git helpers, managed-process policy, patch/markdown/normalize helpers) that run in multiple processes.
- **Contract** (`src/contract/`): the typed IPC surface — `api.ts` (methods/streams), `rpc.ts` (wire protocol), `browser.ts`, `desktop.ts`, `processes.ts`, `types.ts`.

## Primary data and control flows

### Renderer ↔ Agent Host (sessions, files, models, channels, processes)

The renderer obtains a `MessagePort` by calling `piBridge.requestHostPort()`; Main creates a `MessageChannelMain` and hands one end to the Host (`attachRendererPort`) and returns the other to the renderer (`src/main/host-manager.ts:140`). The renderer builds an RPC client on it and starts issuing typed calls (`host.ping`, `sessions.list`, `agent.new`, ...) and subscribing to streams (`agent.events`, `sessions.changed`, `processes.output`, ...). All of this is defined in `src/contract/api.ts` and implemented in `src/agent-host/handlers.ts`.

### Host crash/restart supervision

`HostManager` (`src/main/host-manager.ts:35`) is the supervisor:

- Spawns the Host with `PI_AGENT_HOST=1`, `PI_DESKTOP_USER_DATA`, and `PI_DESKTOP_VERSION` injected, and forwards `MessagePort`s to it on attach (`src/main/host-manager.ts:209`).
- Sends `ping` every 15 s and kills the Host if it has not `pong`ed within 10 s (`src/main/host-manager.ts:386`).
- On unexpected exit, runs the `beforeRestartHandler` (which reaps managed processes via the reaper) and schedules a restart subject to a budget of 2 restarts within 30 s (`src/main/host-manager.ts:17`); exhausting the budget transitions to `crashed`.
- On `ready`, re-sends the toolchain and browser capability snapshots (`toolchain:init`, `browser:init`) and the managed-process owner identity; a replacement Host must re-acknowledge these itself (`src/main/host-manager.ts:212`).

### Main → Host one-shot requests

When the Host needs a Main-owned capability it posts `host-rpc` on `parentPort` and awaits `host-rpc-result` (`src/agent-host/parent-rpc.ts:55`). Main's request handler resolves `channelSecrets.*`, `toolchain.getSnapshot`/`toolchain.resolve`, `managedProcesses.*`, and `browser.*` (`src/main/main.ts:591`).

### Main → Renderer desktop events

Main pushes updates to the renderer over Electron IPC events: `host:status`, `host:restarted`, `host:crashed`, `update:state`, `toolchains:state`, `browser:event`, `deep-link:session`, and `menu:*`. The preload replays a bounded set of these (`EarlyEventReplay`) so navigation commands are not lost while React mounts (`src/preload/preload.ts:29`).

## Security posture

- The main window is created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true` (`src/main/window.ts:48`).
- The `app://` protocol serves the bundle with a strict CSP: `script-src 'self' app:`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` (`src/main/protocol.ts:11`). A separate, more permissive CSP is applied only to in-memory HTML previews, which can load http(s) resources but have `form-action 'none'` (`src/main/protocol.ts:27`).
- IPC is trust-enforced: every `desktop:*` handler requires the sender to be exactly the main window's main frame (`src/main/ipc-trust.ts:13`).
- File access is restricted to allowed roots derived from sessions (plus explicit grants), enforced in the Host (`src/agent-host/file-access.ts:24`).
- The app declares `sandbox: true` and "typed IPC contract" in its README security section, and the renderer is not given Node or a local UI server.
- Agent browser tools and managed background processes are opt-in, fail-closed, and separately authorized (see the Browser and Managed Processes pages).

## No internal local server

The UI is served by the `app://` protocol and `protocol.handle` (`src/main/protocol.ts:169`); there is no TCP port carrying the UI or control plane. In dev, Vite runs on `localhost:5173` and the main window loads `http://localhost:5173` only while `VITE_DEV_SERVER_URL` is set (`src/main/host-manager.ts:475`). User-initiated managed project services may bind loopback, but that is a separate, explicitly-started subsystem.

## Persistence home

Sessions and Pi config live in `~/.pi/agent/` (Pi's `getAgentDir`), which is shared with the Pi CLI so data is reused across both (`src/agent-host/session-reader.ts:20`, README). Electron `userData` holds desktop-owned state (window state, toolchains, browser profiles/grants, channel secrets vault). See the Data & Persistence page for the full inventory.

## Tests

- `src/main/main-bootstrap.test.mjs` exercises the main bootstrap wiring.
- `src/main/host-restart-core.test.mjs` and `src/smoke/host-checks.ts` cover Host supervision and the smoke harness.
- `src/contract/rpc.test.mjs` covers the RPC wire protocol.
- `src/main/desktop-workflow.test.mjs` validates the CI packaging workflow against declared invariants.
