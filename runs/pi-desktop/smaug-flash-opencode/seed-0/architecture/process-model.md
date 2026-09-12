---
type: architecture
title: Architecture & Process Model
description: The Pi Agent Desktop process topology — Electron main, sandboxed renderer behind preload, the supervised Agent Host utilityProcess, and the no-internal-server MessagePort RPC transport that connects them.
tags: [architecture, electron, process-model, rpc]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-8d7e2fca460658878135429d
    resource: repo://src/renderer/App.tsx
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Architecture & Process Model

Pi Agent Desktop is a pure Electron desktop app for the `pi-coding-agent`, with
no internal HTTP server and no bundled Node runtime. It is built and run as
three cooperating process categories connected by `MessagePort`s.

- **Main process** (`src/main/main.ts`) — window, menus, tray/badge, deep
  links, single instance, app protocol, updates, the built-in browser service,
  and supervision of the Agent Host.
- **Agent Host** (`src/agent-host/index.ts`) — an Electron `utilityProcess`
  that runs `pi-coding-agent` in-process and serves the full desktop API over
  a MessagePort RPC server.
- **Renderer + preload** — a sandboxed, context-isolated page
  (`src/renderer/`) with a preload (`src/preload/preload.ts`) that exposes a
  minimal `piBridge`.

## Main process responsibilities

`src/main/main.ts` is small and deliberately free of business logic. It

- registers the app protocol (`registerAppProtocol`),
- creates the main window, installs the menu and tray,
- acquires a single-instance lock and handles deep links,
- constructs a `BrowserService` for the in-app Chromium surface,
- creates a `CredentialVault` for channel secrets,
- builds the production `UpdateAdapter`/`UpdateManager` when platform-supported
  and packaged, and
- constructs and supervises the `HostManager`.

The main process also installs the desktop IPC surface (`installDesktopIpc` in
`src/main/ipc.ts`) that the renderer uses via `piBridge`, and it is the only
process allowed to touch window-native features (menus, dialogs, notifications,
tray, updates). Host-owned toolchain, session, and browser
actions are primarily driven from the renderer → Host RPC path rather than
through main.

## Agent Host responsibilities

The Host is where the agent actually runs. `src/agent-host/index.ts`

- builds the RPC server with `createRpcServer`,
- installs Git toolchain routing and desktop tool definitions,
- registers all API handlers (`registerHandlers`),
- starts the session watcher,
- applies toolchain and browser capability snapshots, and
- bridges the renderer to pi-coding-agent sessions.

The Host is supervised by `HostManager` in the main process, which restarts it
within a bounded budget if it crashes (see the page
[Agent Host & MessagePort RPC](/openwiki/architecture/agent-host-rpc.md)).

## The no-internal-server transport

There is no HTTP server. Renderer, Host, and main talk over MessagePorts. The
main process creates a `MessageChannelMain` per connection and hands the
Host-side port to the Host's `attach-port` message (`HostManager
attachRendererPort`). From then on the peer talks to the same RPC server
(`createRpcServer`) directly. The renderer's port is delivered by the preload
via `window.postMessage(..., [port])` because a MessagePort must not cross the
`contextBridge` as a Promise value (comment in `src/preload/preload.ts`). All
renderer API calls go through the facade in `src/renderer/lib/api-client.ts`.

## The renderer / preload boundary

The preload (`src/preload/preload.ts`) enables `contextBridge` and only exposes
`piBridge` (typed in `src/contract/desktop.ts`). It does not leak Node or the
full `ipcRenderer`. It also performs MessagePort selection and policy checks
(`preload-location-policy`, `preload-message-policy`) before forwarding events,
and buffers `deep-link:session` and menu commands with
`EarlyEventReplay` so late-subscribing renderer listeners do not miss events.
Desktop bridge methods cover updates, host status, toolchains, the browser
surface (`browser*`), menus, deep links, theme, logs, and diagnostics.

## Renderer Reconnecting-to-Host flow

`src/renderer/App.tsx` gates rendering on a connected RPC. On mount it calls
`ensureRpc` (via `api-client.ts`), subscribing to `onHostRestarted` and
`onHostCrashed`:

- If the Host restarts, the renderer calls `resetRpc()` (dropping the stale
  client), forces `ready=false`, and re-connects; the re-connection re-requests
  a fresh port and revalidates with `host.ping`.
- If the Host crashes beyond recovery, it shows an error card that lets the
  user retry (a full reload) or open the main logs.

Because the browser `WebContentsView` surface is owned by the main process and
survives a renderer reload, only the renderer itself needs reconnecting.

## Toolchain and browser snapshot push

The main process holds authoritative toolchain and browser policy state. On
Host ready (or on any change) it pushes a `ToolchainSnapshot` and
`BrowserCapabilitySnapshot` to the Host via `toolchain:init` /
`toolchain:changed` and `browser:init` / `browser:changed`; the Host applies
them and acks with a revision. This lets the Host enable the right tool and
browser definitions per session (see the Toolchains and Browser Service pages).

## Global entrypoints

- `package.json` `main` is `out/main/main.js`; `scripts/dev.mjs`, `build.mjs`
  and `verify.mjs` drive development, build, and the release gate
  (see [Build, Test & Release Tooling](/openwiki/operations/build-and-test.md)).
