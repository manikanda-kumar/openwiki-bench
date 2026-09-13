---
type: concept
title: IPC and RPC Contract
description: The typed MessagePort RPC layer that connects Renderer and Agent Host, plus the preload bridge, Main-process desktop IPC with trust enforcement, and the Main-Host parent RPC channel.
tags: [architecture, ipc, rpc, contract, preload]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-ab729f0aba4796e9191fbadd
    resource: repo://src/agent-host/parent-rpc.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-d481412a7917f2959e804ba1
    resource: repo://src/main/ipc-trust.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# IPC and RPC Contract

Pi Agent Desktop uses three communication planes, all type-checked:

1. **Renderer ↔ Agent Host**: a MessagePort RPC protocol defined in `src/contract/rpc.ts`, carrying `Api` methods and `Streams` topics from `src/contract/api.ts`.
2. **Renderer ↔ Main**: Electron `ipcRenderer.invoke`/`ipcMain.handle` desktop channels (`desktop:*`) wrapped by the preload bridge, with sender trust enforcement.
3. **Agent Host → Main**: a parent-process request/response channel (`host-rpc`) so the Host can ask Main for capabilities it lacks (toolchain resolution, browser actions, channel secrets, managed-process reaper operations).

## The MessagePort RPC protocol

`src/contract/rpc.ts` implements a dependency-free wire protocol with five message kinds:

- `request` — `{ kind, id, method, params }`
- `response` — `{ kind, id, ok, result?, error? }`
- `subscribe` — `{ kind, id, topic, key }`
- `unsubscribe` — `{ kind, id, topic, key }`
- `event` — `{ kind, topic, key, data }`

The protocol comment references `docs/rpc-protocol.md` (`src/contract/rpc.ts:4`).

### Client (`createRpcClient`)

- `call(method, ...args)` sends a `request` and resolves on the matching `response`, rejecting on error or after a 120 s default timeout (`src/contract/rpc.ts:88`).
- `subscribe(topic, key, on)` registers a subscription id and returns an unsubscribe closure; events are delivered when topic matches and the keys are equal or either is `*` (`src/contract/rpc.ts:133`).
- The port is abstracted so the same client works with a DOM `MessagePort` (Renderer) and Electron `MessagePortMain` (Main → Host).
- On `close` all pending calls reject with `CLOSED` and subscriptions are cleared (`src/contract/rpc.ts:146`).

### Server (`createRpcServer`, runs in the Agent Host)

- `handle(handlers)` registers typed handlers for `ApiMethod`s (`src/contract/rpc.ts:432`).
- `emit(topic, key, data)` fans out events only to ports whose subscriptions match (`src/contract/rpc.ts:440`).
- **Lease mechanism**: the server tracks per-port leases (`portLeases`). `setLease(key, release)` stores a resource-finalizer keyed by name; the previous lease for the same key is released first, and all leases are released when the port is forgotten (`src/contract/rpc.ts:331`). Ports that close (`close` event) are forgotten, releasing their leases — this is `ISSUE-013` (`src/contract/rpc.ts:480`).
- Errors serialize to `RpcErrorShape`; `RpcError` (with `code`/`detail`) and `ToolchainError` get structured codes, anything else becomes `INTERNAL` (`src/contract/rpc.ts:384`).

## The `Api` / `Streams` contract

`src/contract/api.ts` defines `Api` (request/response methods) and `Streams` (server-push topics):

- `ApiMethod` groups: `host.*`, `processes.*`, `sessions.*`, `worktrees.*`, `git.*`, `agent.*`, `channels.*`, `files.*`, `models.*`, `modelsConfig.*`, `auth.*`, `skills.*`, `plugins.*`, `system.*`.
- `Streams` topics: `agent.events`, `agent.running`, `auth.login`, `sessions.changed`, `files.changed`, `channels.status/login/pairing/binding/activity`, `processes.changed/output`.
- To add a new method you extend `Api`, implement the handler in `src/agent-host/handlers.ts` via `server.handle`, and call it through `src/renderer/lib/api-client.ts`. `scripts/check-contract-coverage.mjs` enforces that every `Api` method has a Host handler (see `npm run check:contract`).

## Renderer connection flow

`src/renderer/lib/api-client.ts` boots the RPC early (`src/renderer/main.tsx:13`):

1. `waitForHostReady()` polls/subscribes to Host status until `ready` (30 s timeout; `crashed` is an immediate error) (`src/renderer/lib/api-client.ts:74`).
2. `requestHostPort()` calls `window.piBridge.requestHostPort()` (IPC to Main), then waits for a `message` event carrying a transferred `MessagePort` on the `pi-desktop-host-port` channel (`src/renderer/lib/api-client.ts:28`).
3. `createRpcClient(port)` is built and verified with a `host.ping` before being exposed.

The preload (`src/preload/preload.ts`) receives `desktop:host-port` from Main, validates the transferred port (`selectTransferredHostPort`), and forwards it to the page via `window.postMessage(..., [port])` — the MessagePort is deliberately **not** passed through `contextBridge` (which silently breaks ports), so `window.postMessage` transfer is used (`src/preload/preload.ts:18`). Preload also validates its own location via `isTrustedPreloadLocation` before exposing the bridge.

## Desktop IPC (Renderer ↔ Main) and trust enforcement

`src/main/ipc.ts` installs `desktop:*` handlers through `trustedHandle`/`trustedOn`, which first call `assertTrustedSender` (`src/main/ipc.ts:83`).

- `isTrustedDesktopIpcSender` (`src/main/ipc-trust.ts:13`) requires the sender to be exactly the main window's `webContents` and its `mainFrame`. Any other frame (an injected webview or a navigation) is rejected.
- Desktop handlers cover version/update state, Host status, toolchain state/actions, file save/open dialogs, HTML preview creation, badge/notification, UI state, theme, channel-credential writes, managed-process capability, browser operations, and diagnostics export.
- The preload exposes this surface to the sandboxed renderer as `window.piBridge` (`PiBridge` in `src/contract/desktop.ts:131`), which also adds `onHostStatus`, `onUpdateState`, `onToolchainState`, `onDeepLinkSession`, `onBrowserEvent`, and `onMenu` event listeners.

## Main → Host parent RPC

`src/agent-host/parent-rpc.ts` gives the Host a one-shot request channel to Main:

- The Host posts `{ type: "host-rpc", id, method, params }` on `process.parentPort`; `HostManager` receives it and dispatches to the Main request handler (`src/main/host-manager.ts:299`).
- The response comes back as `{ type: "host-rpc-result", id, ok, result | error }` (`src/agent-host/parent-rpc.ts:11`). Browser errors carry structured `BrowserError`/`BrowserRecovery` data (`MainProcessRpcError`).
- Main's request handler (`src/main/main.ts:591`) serves `channelSecrets.*` (via the credential vault), `toolchain.getSnapshot`/`toolchain.resolve`, `managedProcesses.getSettings/register/unregister/confirmLanBind/selectExportTarget`, and `browser.*` (dispatched to `BrowserService.handleHostRequest`).
- Unsupported methods throw `Unsupported Host request` (`src/main/main.ts:684`).

## Tests

- `src/contract/rpc.test.mjs` covers the wire protocol, subscribe/event matching, timeouts, and port teardown.
- `src/preload/preload-location-policy.test.mjs` and `src/preload/preload-message-policy.test.mjs` cover bridge hardening.
- `src/main/ipc-trust.test.mjs` covers sender validation.
- `src/agent-host/parent-rpc.ts` is exercised through handler and smoke tests.
