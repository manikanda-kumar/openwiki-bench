---
type: concept
title: Three-Process Architecture
description: How Electron Main, the Agent Host utilityProcess, and the sandboxed React renderer are structured, connected via MessagePort and preload, supervised, and kept free of internal network servers.
tags: [architecture, electron, main, renderer, agent-host, processes]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-ab729f0aba4796e9191fbadd
    resource: repo://src/agent-host/parent-rpc.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-db94ac485981ee6d84773d1b
    resource: repo://src/main/window-navigation-policy.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
  - id: openwiki-source-39e18faf4fe62278d38ba627
    resource: repo://src/renderer/main.tsx
  - id: openwiki-source-74c6b0267a12bbfb67847a09
    resource: repo://tsup.config.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Three-Process Architecture

Pi Agent Desktop uses an Electron **three-process model** that separates high-privilege desktop capabilities (Main), the agent runtime (Agent Host), and the UI (Renderer). There is no internal HTTP service: the renderer and Host talk over a typed MessagePort RPC, and remote web content lives only in Main-owned `WebContentsView` instances.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    Main["Electron Main<br/>window · tray · protocol · Host supervision · BrowserService · toolchains"]
    Host["Agent Host / utilityProcess<br/>pi-coding-agent · sessions · files · config · channels · managed processes"]
    UI["Renderer<br/>React 19 · Vite · sandboxed"]
    Preload["preload (piBridge)"]
    Main -->|"utilityProcess.fork"| Host
    Main -->|"MessagePortMain"| Preload
    Preload -->|"window.postMessage transfer"| UI
    UI <-->|"MessagePort RPC"| Host
    Host -->|"parentPort host-rpc"| Main
```

## Electron Main

Entry: `src/main/main.ts`, bundled to `out/main/main.js`.

Before `app.ready` it registers the `app://` protocol and starts the local crash reporter (`main.ts:42-48`). On startup it:

- acquires the single-instance lock and wires deep links (`main.ts:283-297`);
- on Windows x64, verifies the Rust managed-process helper and initializes the managed-process reaper with a secured journal directory (`main.ts:391-419`);
- creates the `CredentialVault`, `BrowserService`, `UpdateManager`, and `ToolchainManager` (`main.ts:427-508`);
- installs the desktop IPC surface, app menu, and tray (`main.ts:550-571`);
- creates and supervises the `HostManager`, registering the status listener, message listener, and the Host request handler that Main uses to serve trusted capabilities (`main.ts:578-751`);
- creates the main window and kicks off the toolchain scan and update checks (`main.ts:751-755`).

Main owns all Electron-facing services: window lifecycle, menus, tray and badges, notifications, updater, deep links, the `app://` protocol, `BrowserService`, `ToolchainManager`, and the managed-process `ManagedProcessReaper`.

## Agent Host (utilityProcess)

Entry: `src/agent-host/index.ts`, bundled to `out/main/agent-host.mjs` (ESM, because the pi packages only export an `import` condition) (`tsup.config.ts:36-68`).

The Host runs the `@earendil-works/pi-coding-agent` SDK in-process and serves the typed `Api`/`Streams` RPC surface. It creates the RPC server, registers the full handler map, installs the toolchain Git runner, and starts the session watcher (`src/agent-host/index.ts:19-22`). It is supervised by Main: status transitions are `starting` → `ready` (`crashed`/`stopped`), a 15 s ping/10 s timeout heartbeat detects stalls, and the restart budget is 2 attempts inside a 30 s window (`src/main/host-manager.ts:17-20`, `host-manager.ts:368-416`). See [Agent Host Runtime](./agent-host-runtime.md).

## Renderer

Entry: `src/renderer/main.tsx` (React 19, built by Vite).

The renderer is a sandboxed web page (`sandbox: true`, `contextIsolation: true`, no Node) that never touches the Host port directly — all Host communication goes through `src/renderer/lib/api-client.ts`, and desktop-only services go through the `piBridge` preload surface (`src/renderer/lib/api-client.ts:5-20`). It installs `/api` fetch + EventSource shims for compatibility and boots the RPC connection before first UI interaction (`src/renderer/main.tsx:10-15`).

## How the processes connect

1. The renderer requests a Host port through `piBridge.requestHostPort()` (`api-client.ts:43-72`).
2. Main receives `desktop:connect-host`, creates a `MessageChannelMain`, hands one end to the Host with an `attach-port` message, and sends the other end to the renderer as `desktop:host-port` (`src/main/host-manager.ts:140-166`).
3. The preload transfers the `MessagePortMain` to the page via `window.postMessage` on the `pi-desktop-host-port` channel — never across `contextBridge` (which silently breaks ports) (`src/preload/preload.ts:16-26`).
4. The renderer builds an RPC client from the received port and pings `host.ping` (`api-client.ts:118-141`).
5. When the Host needs a desktop capability (credentials, toolchain resolution, managed-process dialogs, browser actions), it posts a `host-rpc` request to Main over `parentPort` (`src/agent-host/parent-rpc.ts:55-68`).

The Host and Main each hold the other's identity: Main sends a managed-process owner identity (`managed-process-owner:init`) that the Host acknowledges, and Host requests are only served for allowlisted method prefixes with validation in Main (`src/main/main.ts:591-685`).

## Entry resolution and navigation policy

- The renderer entry is resolved as: `VITE_DEV_SERVER_URL` if set (dev), else the built `app://bundle/index.html`, else `http://localhost:5173` in dev (`src/main/host-manager.ts:475-490`).
- The main window only allows navigation to `app:` URLs, or to `http://localhost:5173` in dev; other navigations are prevented and HTTP(S)/mailto links are opened externally (`src/main/window-navigation-policy.ts:1-10`, `src/main/window.ts:78-97`). `window.open` is denied.

## No-internal-server principle

- The app does not open TCP ports to host its UI or control plane. In dev, Vite serves the renderer on `localhost:5173`; in production the built renderer is served from the `app://` protocol handler.
- Messaging channels use only outbound transports (WeChat/Telegram long polling, Feishu WebSocket) and do not open local listeners (`scripts/check-desktop-security.mjs:442-444`).
- Only user-started managed project processes may bind loopback, and network-facing binds require a confirmation (see [Managed Background Processes](../systems/managed-processes.md)).

## Crash handling

- Host crashes are detected by exit + heartbeat and restarted within the budget; managed processes are reaped before restart (`src/main/host-manager.ts:345-416`).
- Renderer crashes are handled by `render-process-gone`: a bounded retry with backoff, then a crash page (`src/main/window.ts:113-133`). Load failures show a diagnostic page (`window.ts:151-156`).

## Related pages

- [Agent Host Runtime](./agent-host-runtime.md)
- [RPC and Contract Layer](./rpc-and-contracts.md)
- [Security Model](./security-model.md)
- [Desktop Shell and Lifecycle](../systems/desktop-shell-lifecycle.md)
