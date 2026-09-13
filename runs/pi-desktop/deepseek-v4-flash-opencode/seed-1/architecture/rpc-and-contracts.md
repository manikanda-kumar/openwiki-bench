---
type: concept
title: RPC and Contract Layer
description: How the typed Api/Streams contract, the MessagePort wire protocol, renderer and host RPC clients, host-to-main parent RPC, and static contract coverage enforcement work together.
tags: [rpc, contract, messageport, ipc, architecture]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-ab729f0aba4796e9191fbadd
    resource: repo://src/agent-host/parent-rpc.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# RPC and Contract Layer

Pi Agent Desktop has no internal HTTP service. All renderer ↔ Agent Host communication happens over a **MessagePort RPC layer** whose message surface is fully typed in `src/contract/`. A second, separate request path lets the Host ask Electron Main for trusted desktop capabilities.

## The typed contract

- `src/contract/api.ts` declares the `Api` interface — one entry per RPC method with its `params` and `result` types — and the `Streams` interface, one entry per server-push topic (`src/contract/api.ts:56-420`). `ApiMethod` and `StreamTopic` derive from these keys, and `ApiParams`/`ApiResult` map method names to their types (`api.ts:422-426`).
- Domain types live in `src/contract/types.ts`, `src/contract/processes.ts`, `src/contract/browser.ts`, and the `shared/` modules. The contract is imported as a **type-only** surface by the renderer; runtime behavior is enforced by the RPC implementation and the static coverage check below.

## Wire protocol

The wire protocol has exactly five message kinds (`src/contract/rpc.ts:15-51`):

- `request` — a call with an id, method, and params;
- `response` — `ok: true` with a result, or `ok: false` with an `RpcErrorShape`;
- `subscribe` / `unsubscribe` — topic + key registration for a port;
- `event` — a topic, key, and payload pushed from server to matching subscribers.

## RPC client

`createRpcClient` wraps a `MessagePort` (DOM, Electron `MessagePortMain`, or Node `MessagePort`) as a `PiRpc` (`src/contract/rpc.ts:100-227`):

- each `call` gets a unique id and a timeout (default 120 000 ms); a timed-out call rejects with `RPC call timed out` (`rpc.ts:88`, `rpc.ts:156-183`);
- `subscribe(topic, key, on)` matches events where `sub.key === "*"` or `msg.key === "*"` or the keys are equal, and returns an unsubscribe function (`rpc.ts:185-213`);
- when the port closes, all pending calls reject with `CLOSED` and subscriptions are dropped (`rpc.ts:146-149`).

## RPC server

`createRpcServer` runs inside the Agent Host (`src/contract/rpc.ts:304-507`):

- handlers are registered by method name via `server.handle`; an unknown method returns `METHOD_NOT_FOUND` (`rpc.ts:382-391`);
- errors are shaped on the wire: `RpcError` keeps its `code`/`detail`, `ToolchainError` is mapped with `capability` and `causeCode` detail, and anything else becomes `INTERNAL` (`rpc.ts:394-408`);
- each attached port carries its own subscription map and **lease** set. `requestContext.setLease`/`releaseLease` tie resource finalizers to the port's lifetime, released when the port is detached or closed (`rpc.ts:331-357`);
- `attachPort` handles both the DOM `addEventListener` shape and the Node `EventEmitter` shape, and registers a close listener so the port is dropped when the remote side closes (`rpc.ts:471-496`);
- a serialization failure returns `SERIALIZATION_FAILED` as a fallback response (`rpc.ts:410-429`).

## Renderer connection flow

The renderer never touches the port directly; `src/renderer/lib/api-client.ts` is the transport facade:

1. `ensureRpc` waits for the Host to report `ready` through `piBridge.getHostStatus`/`onHostStatus` (30 s timeout) (`api-client.ts:74-141`);
2. the preload relays `desktop:host-port` from Main and transfers the `MessagePortMain` to the page through `window.postMessage` on the `pi-desktop-host-port` channel — a MessagePort must not cross `contextBridge` via Promise resolve (`src/preload/preload.ts:16-26`);
3. the renderer receives the port from `window.postMessage`, builds a client, and pings `host.ping` before treating the connection as usable (`api-client.ts:43-72`, `api-client.ts:118-141`);
4. `resetRpc` drops the client so a fresh connection is made after a Host crash (`api-client.ts:12-20`).

## Main ↔ Host port wiring

- Electron Main creates a `MessageChannelMain` and hands one side to the Host with an `attach-port` message; renderer-side `port1` is returned to the caller (`src/main/host-manager.ts:161-166`, `host-manager.ts:140-159`).
- The Host's RPC server calls `server.attachPort` with the transferred port and starts serving renderer requests (`src/agent-host/index.ts:49-62`).
- Main can also issue its own one-shot RPCs to the Host through `hostManager.call`, which creates a fresh channel per call with a default 10 s timeout (`host-manager.ts:168-202`).

## Host → Main requests (parent RPC)

When the Host needs a trusted desktop capability, it calls `callMain`, which posts a `{ type: "host-rpc", id, method, params }` message to `process.parentPort` (`src/agent-host/parent-rpc.ts:55-68`).

Electron Main dispatches these through the request handler installed in `src/main/main.ts:591-685`:

- `channelSecrets.*` — credential vault access for messaging channels (`main.ts:592`);
- `toolchain.getSnapshot` / `toolchain.resolve` — snapshot and per-project resolution; `resolve` validates that `cwd` is an absolute path of bounded length, the intent is a known `ExecutionIntent`, and `trusted` is a boolean before calling the manager (`main.ts:594-607`);
- `managedProcesses.getSettings` / `register` / `unregister` / `confirmLanBind` / `selectExportTarget` — reaper and dialog services; Windows registrations are rejected unless the owner generation matches (`main.ts:608-680`);
- `browser.*` — delegated to `BrowserService` (`main.ts:681-683`);
- anything else throws `Unsupported Host request` (`main.ts:684`).

Main replies with `host-rpc-result` (`ok`/`error`); the pending map in `parent-rpc.ts` resolves or rejects the matching promise, surfacing `BrowserError` shapes and recovery hints when the error is a browser error (`parent-rpc.ts:21-38`, `host-manager.ts:299-330`).

## Contract coverage enforcement

`scripts/check-contract-coverage.mjs` statically parses TypeScript with the compiler API and asserts exact 1:1 coverage (`check-contract-coverage.mjs:229-296`):

- every `Api` method must be implemented as a key in the `server.handle({ ... })` object literal in `handlers.ts`;
- every `Streams` topic must be emitted by a `server.emit(...)` call in `src/agent-host/**/*.ts`;
- every `PiBridge` method must exist in the `preload.ts` bridge object;
- every `ipcRenderer.invoke`/`send` channel in preload must be registered by `trustedHandle`/`trustedOn`/`browserHandler` in `src/main/ipc.ts`;
- browser bridge methods, browser IPC channels, and `BrowserHostRpc` methods must each match their implementation (`check-contract-coverage.mjs:250-270`).

Missing, duplicate, or unknown entries fail the check, which runs as part of `npm run verify` (`scripts/verify.mjs:29`).

## Related pages

- [Three-Process Architecture](./three-process-architecture.md)
- [Agent Host Runtime](./agent-host-runtime.md)
- [Security Model](./security-model.md)
- [Builtin Browser](../systems/builtin-browser.md)
