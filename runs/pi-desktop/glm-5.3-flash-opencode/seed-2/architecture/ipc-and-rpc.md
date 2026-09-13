---
type: architecture-concept
title: IPC and RPC Contract
description: How the Renderer, Main process, and Agent Host communicate — typed MessagePort RPC, the preload bridge, trusted desktop IPC, and parent RPC.
tags: [electron, ipc, rpc, messageport, preload, contract]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

All cross-process communication in Pi Agent Desktop is funneled through a small set of typed channels: a custom MessagePort RPC protocol between Renderer and Agent Host, a strict `ipcMain.handle` surface between Renderer and Main, and a parent-port RPC from Host back to Main. There is no HTTP layer and no local TCP listener in this control path.

## The wire protocol (Renderer ↔ Host)

`src/contract/rpc.ts` defines a lightweight, dependency-free MessagePort RPC with exactly five message kinds: `request`, `response`, `subscribe`, `unsubscribe`, and `event` (repo://src/contract/rpc.ts#L15-L51). Each request carries a monotonic id (`r<n>_<timestamp36>`), and the client keeps a pending map with a default call timeout of 120 seconds, rejecting with an `RpcError` on timeout or port close (repo://src/contract/rpc.ts#L79-L90, repo://src/contract/rpc.ts#L135-L161).

- **Client** (`createRpcClient`): resolves/rejects pending calls by id, and dispatches `event` messages to subscribers whose topic matches and whose key matches either exactly or via the `*` wildcard (repo://src/contract/rpc.ts#L94-L127, repo://src/contract/rpc.ts#L163-L219).
- **Server** (`createRpcServer`): maintains per-port subscription tables, dispatches requests to registered handlers, and wraps errors into `RpcErrorShape` responses — preserving `RpcError` codes, mapping `ToolchainError` to a structured code with capability detail, and falling back to `INTERNAL` for anything else (repo://src/contract/rpc.ts#L453-L479). If a response fails to serialize, it retries once with a `SERIALIZATION_FAILED` fallback and otherwise forgets and closes the port (repo://src/contract/rpc.ts#L481-L497).
- The port abstraction (`AnyMessagePort`) deliberately supports three host environments: DOM `MessagePort` (Renderer), Node `MessagePort` (worker_threads), and Electron `MessagePortMain`, because the same protocol is reused in tests and inside the Host (repo://src/contract/rpc.ts#L238-L254, repo://src/contract/rpc.ts#L273-L293).
- The server also supports per-port **leases**: handlers receive a request context with `setLease`/`releaseLease`, and closing a port releases all of its leases so long-lived resources (e.g., file watchers) do not leak (repo://src/contract/rpc.ts#L295-L344).

## Typed API and Streams

The method surface is a single TypeScript interface, `Api`, in `src/contract/api.ts`, mapping method names to `{ params, result }` types — sessions, agent lifecycle, files, models, skills, plugins, channels, managed processes, and desktop helpers (repo://src/contract/api.ts#L57-L392). Server-push streams are typed separately in `Streams` (`agent.events`, `agent.running`, `sessions.changed`, `files.changed`, `channels.*`, `processes.changed`, `processes.output`, etc.) (repo://src/contract/api.ts#L395-L420). `ApiMethod` and `StreamTopic` are derived keys, so a method or topic missing from the interface is a type error on both ends.

Handlers are registered in one place, `registerHandlers` in `src/agent-host/handlers.ts`, which implements the desktop RPC contract inside the Host process (repo://src/agent-host/handlers.ts#L1-L11). `scripts/check-contract-coverage.mjs` verifies that every Api method has a handler; `npm run check:contract` runs it (repo://package.json#L35).

## Port path: Main creates, preload transfers, renderer adopts

The Renderer never talks to the Host directly at startup; the port is brokered by Main:

1. The Host registers an `attach-port` handler on its `parentPort`; Main forwards a fresh `MessagePortMain` via `utilityProcess.postMessage({ type: "attach-port" }, [port])` (repo://src/agent-host/index.ts#L49-L62, repo://src/main/host-manager.ts#L138-L156). Ports that arrive while the Host is spawning are queued and flushed on the `spawn` event (repo://src/main/host-manager.ts#L248-L259).
2. `HostManager.createRendererChannel()` creates a `MessageChannelMain`, attaches the Host-side port to the utility process, and returns the renderer-side port (repo://src/main/host-manager.ts#L162-L168).
3. On `desktop:connect-host` (sent by `piBridge.requestHostPort()`), Main posts `desktop:host-port` back to the sender with the port transferred (repo://src/main/ipc.ts#L160-L164).
4. The preload receives `desktop:host-port` and re-transfers the port into the page with `window.postMessage(..., [port])`. A comment in `src/preload/preload.ts` records why: a MessagePort must **not** cross `contextBridge` as a Promise resolution value — that silently breaks the port; `window.postMessage` transfer is the supported path (repo://src/preload/preload.ts#L1-L26).
5. The renderer's transport facade `src/renderer/lib/api-client.ts` listens for that `pi-desktop-host-port` message (accepting only same-window messages), wraps the port in `createRpcClient`, and validates the connection with a `host.ping` call before exposing it (repo://src/renderer/lib/api-client.ts#L43-L66, repo://src/renderer/lib/api-client.ts#L118-L135).

Before any of this, `ensureRpc()` waits for the Host to report `ready` via `piBridge.getHostStatus()`/`onHostStatus`, with a 30 s host-ready timeout and 15 s port timeout; `resetRpc()` drops the client so the next `ensureRpc()` reconnects after a Host crash (repo://src/renderer/lib/api-client.ts#L8-L17, repo://src/renderer/lib/api-client.ts#L68-L116).

Components never touch the MessagePort directly; they call the `call`/`subscribe` helpers from this facade (repo://src/renderer/lib/api-client.ts#L1-L5, repo://src/renderer/lib/api-client.ts#L151-L167).

## Desktop IPC (Renderer ↔ Main): trusted sender enforcement

Everything on `piBridge` that maps to an `ipcMain` channel is registered through `installDesktopIpc` in `src/main/ipc.ts` (repo://src/main/ipc.ts#L68-L100). Two wrappers, `trustedHandle` and `trustedOn`, refuse every invoke/send whose sender is not the live main window's exact `webContents` and `mainFrame` (repo://src/main/ipc.ts#L83-L103). The trust check itself, `isTrustedDesktopIpcSender`, compares both `event.sender === window.webContents` and `event.senderFrame === window.webContents.mainFrame` (repo://src/main/ipc-trust.ts#L12-L18), so a compromised iframe or secondary WebContents cannot invoke desktop channels.

Browser channels go one step further: `browserHandler` resolves the `BrowserService` and surfaces `BrowserError` codes as `CODE: message` strings (repo://src/main/ipc.ts#L105-L118). Other defensively validated channels include update controls (boolean-validated `desktop:update:set-automatic-checks`), toolchain actions (request-shape validation plus confirmation dialogs and error-code mapping), `desktop:open-external` (restricted to `http(s):`/`mailto:` URLs), and path-validated `desktop:show-item-in-folder` (repo://src/main/ipc.ts#L126-L175).

## Parent RPC (Host → Main)

When the Host needs Main-owned capabilities — browser confirmation, credential vault writes, file dialogs — it uses `callMain` from `src/agent-host/parent-rpc.ts`, posting `{ type: "host-rpc", id, method, params }` on `process.parentPort` with a 10 s default timeout (repo://src/agent-host/parent-rpc.ts#L55-L66). `HostManager` receives these messages and executes them through its request handler, posting back a `host-rpc-result` envelope (repo://src/main/host-manager.ts#L299-L323). Failures surface as `MainProcessRpcError`, which carries optional browser error codes, retryability, and structured recovery guidance (repo://src/agent-host/parent-rpc.ts#L20-L37).

Main also issues one-shot RPCs into the Host through `HostManager.call`, which opens a private `MessageChannel` per call and matches responses by id (repo://src/main/host-manager.ts#L170-L199).

## Snapshot ack protocol and host supervision

Policy state flows Main → Host as revisioned snapshots (`toolchain:init/changed`, `browser:init/changed`), each acknowledged by the Host with the applied revision (repo://src/agent-host/index.ts#L76-L98). On respawn, `HostManager` resets both ack revisions to `-1` because an acknowledgement from a previous Host instance is not transferable (repo://src/main/host-manager.ts#L203-L210). The Host answers `ping` with `pong`, and heartbeat liveness plus a bounded restart policy (2 restarts in a 30 s window) govern crash recovery (repo://src/agent-host/index.ts#L45-L48, repo://src/main/host-manager.ts#L17-L20).

## Failure behavior

- Client calls fail closed: timeout (`TIMEOUT`), port close (`CLOSED`), unknown method (`METHOD_NOT_FOUND`), serialization failure, or `INTERNAL` for unclassified handler throws (repo://src/contract/rpc.ts#L453-L497).
- Renderer connection attempts are bounded by explicit timeouts and race-safe status subscription, so a Host that never becomes ready cannot hang the UI silently (repo://src/renderer/lib/api-client.ts#L68-L135).
- Untrusted IPC senders are silently dropped rather than executed (repo://src/main/ipc.ts#L83-L103).

## Where to go next

- For the exact steps to add a method end-to-end, see [Adding RPC Methods](/openwiki/development/adding-rpc-methods.md).
- For how the three processes are created and supervised, see [Architecture Overview](/openwiki/architecture/overview.md).
