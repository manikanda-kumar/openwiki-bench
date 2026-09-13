---
type: architecture
title: "Contract Layer and RPC Protocol"
description: "The src/contract package defines the MessagePort wire protocol, the typed Api/Streams method tables, the desktop PiBridge and Browser Host RPC contracts, and the AST-based coverage checker that keeps implementations in sync."
tags: [architecture, rpc, contract, messageport, typescript]
---

# Contract Layer and RPC Protocol

`src/contract/` is the single source of truth for every cross-process interface in Pi Agent Desktop: the MessagePort RPC wire protocol, the request/response `Api` surface, server-pushed `Streams` topics, the preload `PiBridge` desktop contract, the `BrowserHostRpc` contract, and managed-process/browser type definitions. The renderer and the Agent Host never share business code; they share only these types plus the tiny RPC runtime.

## MessagePort wire protocol

`src/contract/rpc.ts` implements a framework-free RPC with exactly five message kinds (`src/contract/rpc.ts:15-51`):

| Kind | Direction | Fields |
| --- | --- | --- |
| `request` | client → server | `id`, `method`, `params` |
| `response` | server → client | `id`, `ok`, `result?`, `error?` |
| `subscribe` | client → server | `id`, `topic`, `key` |
| `unsubscribe` | client → server | `id`, `topic`, `key` |
| `event` | server → client | `topic`, `key`, `data` |

The file's header comment points at `docs/rpc-protocol.md` as a "protocol spec", but that file does not exist in this repository; the code is the spec.

### Client mechanics (`createRpcClient`)

- `call()` assigns a monotonically increasing id (`r{n}_{ts36}`), registers a pending entry, and rejects with `RpcError{code:"TIMEOUT"}` after `callTimeoutMs` (default **120 s**, `DEFAULT_CALL_TIMEOUT_MS`) (`src/contract/rpc.ts:88`, `src/contract/rpc.ts:156-183`).
- Late/unknown responses are ignored; port close rejects all pending calls with `RpcError{code:"CLOSED"}` (`src/contract/rpc.ts:109-149`).
- `subscribe(topic, key, handler)` posts a `subscribe` frame and matches incoming `event` frames locally: a `key` of `"*"` on either side matches everything; subscriber exceptions are swallowed so one bad listener cannot break the stream (`src/contract/rpc.ts:133-143`, `src/contract/rpc.ts:185-213`).
- The renderer's transport facade (`src/renderer/lib/api-client.ts`) keeps a single `PiRpc` instance and exposes `resetRpc()` to drop it so the next call reconnects — this is the hook used for Host crash recovery (`src/renderer/lib/api-client.ts:9-21`).

### Server mechanics (`createRpcServer`)

- Handlers are registered as an `ApiHandler` partial map keyed by method name; unknown methods throw `RpcError{code:"METHOD_NOT_FOUND"}` (`src/contract/rpc.ts:382-391`).
- Error encoding is deliberate (`src/contract/rpc.ts:394-409`):
  - `RpcError` (`src/contract/types.ts:224-241`) crosses as `{ code, message, detail }`.
  - `ToolchainError` (`src/shared/toolchains/errors.ts:11-25`) crosses as its `code` with `detail: { capability, causeCode }`, so toolchain failures keep structured semantics without sharing classes across processes.
  - Anything else becomes `{ code: "INTERNAL", message }`.
- If a response cannot be serialized (e.g. a handler returned a function or DOM node), the server sends a `SERIALIZATION_FAILED` fallback and forgets/closes the port (`src/contract/rpc.ts:410-429`).
- `AnyMessagePort` abstracts the three port shapes in play — DOM `MessagePort`, Node `worker_threads`/utilityProcess ports (`EventEmitter.on`), and Electron `MessagePortMain` — choosing a listener adapter per capability (`src/contract/rpc.ts:248-302`).

### Per-port leases

Each attached port gets a `RpcRequestContext` with `setLease(key, release)` / `releaseLease(key)`. A lease set on a dead port is released immediately; replacing a lease releases the previous finalizer; port close (or serialization failure) runs all lease finalizers (`src/contract/rpc.ts:233-236`, `src/contract/rpc.ts:313-357`). The Agent Host uses this to bind `files.watch` watchers to the requesting renderer port, so watchers die with the connection (`src/agent-host/handlers.ts:1905-1913`).

## How the renderer obtains a port

The renderer never talks to the Host through `ipcMain`. The sequence is:

1. Renderer calls `piBridge.requestHostPort()` → `ipcRenderer.send("desktop:connect-host")` (`src/preload/preload.ts:68-70`).
2. Main verifies the sender, creates a `MessageChannelMain`, hands port2 to the Host utility process (`attach-port`), and transfers port1 to the page via `event.sender.postMessage("desktop:host-port", null, [port1])` (`src/main/ipc.ts:177-182`, `src/main/host-manager.ts:140-166`).
3. Preload re-transfers the port into the page world with `window.postMessage(..., [port])`, because a `MessagePort` delivered through a `contextBridge` promise resolve silently breaks; the page listens for `{ channel: "pi-desktop-host-port" }` and only accepts messages whose `event.source === window` (`src/preload/preload.ts:20-28`, `src/renderer/lib/api-client.ts:40-60`).
4. Ports requested while the Host is not ready are queued in `HostManager.pendingPorts` and flushed on `spawn` (`src/main/host-manager.ts:140-159`, `src/main/host-manager.ts:251-261`).

The main process itself issues one-shot RPCs to the Host with `HostManager.call()`, which opens a temporary channel and matches on `kind:"response"` with its own id, rejecting on timeout (`src/main/host-manager.ts:169-202`).

## The `Api` and `Streams` tables

`src/contract/api.ts` declares two interfaces that define the entire Host surface:

- **`Api`** (`src/contract/api.ts:57-392`) — 78 request/response methods grouped by domain: `host.*`, `processes.*` (managed background processes), `sessions.*`, `worktrees.*`, `git.status`, `agent.*` lifecycle (`agent.new`, `agent.command`, `agent.state`, `agent.generateTitle`), `channels.*`, `files.*`, `models.*`/`modelsConfig.*`, `auth.*`, `skills.*`, `plugins.*`, `system.*`. Each entry is `{ params; result }`, and `ApiMethod`/`ApiParams`/`ApiResult` derive typed `call()` signatures (`src/contract/api.ts:422-426`).
- **`Streams`** (`src/contract/api.ts:395-420`) — 12 server-push topics: `agent.events`, `agent.running`, `auth.login`, `sessions.changed`, `files.changed`, five `channels.*` topics, and `processes.changed`/`processes.output`.

Every `Api` method must be implemented by a `server.handle({...})` object in `src/agent-host/handlers.ts`; every declared `Streams` topic must be emitted somewhere under `src/agent-host/` via `server.emit(...)`.

## Browser Host RPC contract

Browser operations execute in the **main** process (they own the Electron sessions), but the Agent Host needs them as tools. `src/contract/browser.ts` defines `BrowserHostRpc` — the method table for Host→main calls (`browser.*`) — plus a runtime guard: `isBrowserHostMethod()` checks membership in the `BROWSER_HOST_METHODS` `ReadonlySet` (`src/contract/browser.ts:728`, `src/contract/browser.ts:961-969`). These calls travel over the parentPort `host-rpc` / `host-rpc-result` back-channel handled in `main.ts` (see [Process Architecture](overview.md)).

## Contract coverage checker

`scripts/check-contract-coverage.mjs` (run by `npm run check:contract` and inside `npm run verify`) statically parses the TypeScript sources with the `typescript` compiler API and enforces **exact set equality** between contract and implementation for eight surfaces (`scripts/check-contract-coverage.mjs:233-266`):

| Contract source | Implementation source(s) |
| --- | --- |
| `Api` interface in `src/contract/api.ts` | string keys in `server.handle({...})` calls in `src/agent-host/handlers.ts` |
| `Streams` interface | literal `server.emit("topic", ...)` calls across all non-test `src/agent-host/**/*.ts` |
| `PiBridge` interface in `src/contract/desktop.ts` | the `bridge: PiBridge` object literal in `src/preload/preload.ts` |
| `ipcRenderer.invoke("channel")` calls in preload | `trustedHandle`/`browserHandler` registrations in `src/main/ipc.ts` |
| `ipcRenderer.send("channel")` calls in preload | `trustedOn` registrations in `src/main/ipc.ts` |
| `browser.*` bridge methods (contract split) | preload `browser*` implementations |
| `desktop:browser:*` invoke channels | `browserHandler` channel registrations |
| `BrowserHostRpc` keys | `BROWSER_HOST_METHODS` set and `browser.*` cases/comparisons inside `BrowserService.dispatchHostRequest` in `src/main/browser/browser-service.ts` |

An empty extraction on either side, a duplicate (except repeated `emit` calls for one topic), a missing entry, or an unknown entry fails the check with a named list. It additionally requires exactly one preload `on("browser:event")` listener and at least one main `send("browser:event")` sender (`scripts/check-contract-coverage.mjs:267-273`). This is why adding an RPC method is always a two-place edit — declare in `contract`, implement in `handlers.ts` (or preload/ipc) — and never a silent one.

## Practical consequences

- Wire messages are untrusted at the boundary: the client checks `typeof msg === "object"` and ignores non-matching kinds; the server ignores non-`request`/`subscribe`/`unsubscribe` frames (`src/contract/rpc.ts:117-144`, `src/contract/rpc.ts:368-380`).
- There is no authentication inside the RPC itself — trust comes from port possession: only main creates channels and hands one end to the renderer and the other to the Host process (`src/main/host-manager.ts:162-166`).
- To add a method end-to-end: extend `Api` (or `Streams`), implement in `src/agent-host/handlers.ts` (or emit via `server.emit`), and let `npm run check:contract` verify there are no orphans; see the [Change Guides](../development/change-guides.md) for the full recipe.
