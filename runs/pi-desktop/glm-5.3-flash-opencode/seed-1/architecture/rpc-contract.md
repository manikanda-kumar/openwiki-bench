---
type: architecture
title: RPC Contract Layer
description: The typed MessagePort RPC layer that connects the renderer, Agent Host, and Electron main process — wire protocol, Api/Streams surface, preload bridge, and the contract coverage gate.
tags: [ipc, rpc, contract, messageport, typescript]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T19:27:00.576Z
---

# RPC Contract Layer

All cross-process communication in Pi Agent Desktop is funneled through a small, dependency-free MessagePort RPC protocol defined in `src/contract/`. The renderer never touches raw MessagePorts directly and components never invent ad-hoc channels; the contract types in `src/contract/api.ts` are the single source of truth, and a static analysis script fails the build if implementations drift from them (`repo://src/renderer/lib/api-client.ts#L1-L4`, `repo://src/contract/rpc.ts#L1-L5`).

## Wire protocol

`src/contract/rpc.ts` defines exactly five message kinds: `request`, `response`, `subscribe`, `unsubscribe`, and `event` (`repo://src/contract/rpc.ts#L10-L50`).

- A **request** carries an id, a method name, and params; a **response** echoes the id with `ok`, `result`, or a structured `error` (`RpcErrorShape`).
- An **event** carries a `topic` + `key` and is fanned out only to subscribers whose key matches, where either side may use the wildcard `"*"` (`repo://src/contract/rpc.ts#L127-L141`).
- The protocol spec is documented in the file header as `docs/rpc-protocol.md`; that docs file is not present in this repository, so the code in `src/contract/rpc.ts` is the authoritative spec.

## Client semantics (renderer side)

`createRpcClient` wraps a DOM MessagePort and returns a `PiRpc` object with three operations (`repo://src/contract/rpc.ts#L82-L92`):

- `call(method, params)` — promise-based request with a default 120 s timeout (`DEFAULT_CALL_TIMEOUT_MS`), rejecting with an `RpcError` carrying codes such as `TIMEOUT`, `CLOSED`, or whatever the server returned (`repo://src/contract/rpc.ts#L88-L89`, `repo://src/contract/rpc.ts#L173-L205`).
- `subscribe(topic, key, handler)` — registers a local handler, sends `subscribe`, and returns an unsubscribe function that removes the handler and posts `unsubscribe`; subscriber exceptions are swallowed so one bad handler cannot break dispatch (`repo://src/contract/rpc.ts#L207-L232`, `repo://src/contract/rpc.ts#L127-L141`).
- `close()` — detaches listeners, rejects all pending requests with `CLOSED`, and closes the port (`repo://src/contract/rpc.ts#L234-L249`).
- When the port closes, all pending calls are rejected with `CLOSED` and subscriptions cleared (`repo://src/contract/rpc.ts#L143-L146`).

## Server semantics (Agent Host side)

`createRpcServer` maintains handler and per-port subscription maps and works across three port flavors: DOM MessagePorts, Node worker/utilityProcess ports (`on('message')`), and Electron `MessagePortMain` (`repo://src/contract/rpc.ts#L253-L260`, `repo://src/contract/rpc.ts#L280-L305`).

Key behaviors:

- Unknown methods fail with `METHOD_NOT_FOUND`; handler exceptions are mapped to structured errors — `RpcError` keeps its code, `ToolchainError` becomes `{ code, detail: { capability, causeCode } }`, and anything else becomes `INTERNAL` (`repo://src/contract/rpc.ts#L399-L424`).
- Each request receives an `RpcRequestContext` with a **lease** mechanism (`setLease`/`releaseLease`): handlers can attach a resource-releasing finalizer keyed per port; setting a new release under the same key releases the previous one, and when a port is forgotten all its leases are released (`repo://src/contract/rpc.ts#L330-L355`, `repo://src/contract/rpc.ts#L292-L306`).
- If a response cannot be serialized, the server attempts a `SERIALIZATION_FAILED` fallback response; if even that fails, the port is detached and closed (`repo://src/contract/rpc.ts#L425-L445`).
- `emit(topic, key, data)` pushes an event to every port with a matching subscription and forgets ports whose transport throws (`repo://src/contract/rpc.ts#L448-L470`).
- Port close is detected (ISSUE-013) and triggers `forgetPort`, which cleans up subscriptions and leases (`repo://src/contract/rpc.ts#L472-L507`).

## The Api / Streams contract surface

`src/contract/api.ts` declares two interfaces that together form the Host's public surface (`repo://src/contract/api.ts#L3`):

- **`Api`** — request/response methods, each typed `{ params; result }`. Groups include `host.*`, `sessions.*` (list/get/context/contextPage/entryContent/export/delete/rename), `agent.*` (new/command/state/generateTitle), `files.*` (list/read/download/meta/preview/index/watchStart/watchStop), `auth.*`, `models.*`, `skills.*`, `plugins.*`, `worktrees.*`, `git.*`, `system.*`, `channels.*` (22 methods covering accounts, connect/start/stop/restart/probe, login flows, pairing, bindings, and test send), and `processes.*` (12 methods: list/get/read/wait/write/stop/stopAll/restart/dismiss/export) (`repo://src/contract/api.ts#L16-L388`).
- **`Streams`** — server-push topics: `agent.events`, `agent.running`, `auth.login`, `sessions.changed`, `files.changed`, `channels.status`, `channels.login`, `channels.pairing`, `channels.binding`, `channels.activity`, `processes.changed`, and `processes.output` (`repo://src/contract/api.ts#L395-L418`).

The Agent Host implements this surface in `registerHandlers` (`repo://src/agent-host/handlers.ts#L701`); every method in `Api` must have exactly one handler there, which the contract coverage check enforces (below).

## Preload bridge and desktop channels

Two transports exist beside the Host RPC:

1. **Host RPC** — the renderer's `piBridge.requestHostPort()` triggers Main to open a MessageChannel; the preload forwards the port to the page via `window.postMessage` transfer because MessagePorts silently break when resolved across `contextBridge` (`repo://src/preload/preload.ts#L1-L27`).
2. **Desktop IPC** — the `PiBridge` interface in `src/contract/desktop.ts` exposes desktop capabilities such as updates, host status, toolchain state/actions, file save/open dialogs, HTML previews, badges, UI state, diagnostics, channel credentials, and ~30 `browser*` methods (`repo://src/contract/desktop.ts#L131-L231`). The preload implements this `bridge` object with `ipcRenderer.invoke/send/on`, and Main registers the matching handlers through `trustedHandle`/`trustedOn`/`browserHandler` wrappers that verify the sender (`repo://src/main/ipc.ts#L87-L129`, `repo://src/main/ipc-trust.ts#L13-L20`).

## Renderer transport facade

`src/renderer/lib/api-client.ts` is the only place components touch RPC. `ensureRpc()` coordinates a single connection: it waits for Host readiness (30 s budget, racing a status subscription against `getHostStatus` to avoid a ready-transition window), obtains the transferred port (15 s timeout), builds the client, and validates connectivity with a `host.ping` (10 s timeout) (`repo://src/renderer/lib/api-client.ts#L15-L18`, `repo://src/renderer/lib/api-client.ts#L117-L138`). `resetRpc()` drops the client so the next call reconnects after Host crash recovery (`repo://src/renderer/lib/api-client.ts#L6-L13`). Convenience wrappers preserve the naming of the app's earlier HTTP routes (`listSessions`, `getSession`, `sendAgentCommand`, …) but all delegate to typed `call()` (`repo://src/renderer/lib/api-client.ts#L153-L190`).

## Contract coverage gate

`scripts/check-contract-coverage.mjs` statically parses the TypeScript sources (using the `typescript` compiler API) and asserts exact, bidirectional coverage between declarations and implementations (`repo://scripts/check-contract-coverage.mjs#L226-L281`):

- Every `Api` method has a matching handler in `handlers.ts`, and vice versa.
- Every `Streams` topic is emitted by Agent Host code.
- Every `PiBridge` method is implemented by the preload `bridge` object.
- Every preload `invoke` channel has a matching `trustedHandle`/`browserHandler` registration, and every `send` channel has a `trustedOn` listener.
- Browser-specific invariants: bridge↔preload method parity, `BrowserHostRpc`↔`BROWSER_HOST_METHODS`↔`BrowserService` dispatch parity, exactly one `browser:event` preload listener, and at least one Main sender for `browser:event`.

The gate runs as part of `npm run check:contract` and inside `npm run verify` (`repo://scripts/verify.mjs#L36`), so adding a contract method without wiring all layers fails before packaging.
