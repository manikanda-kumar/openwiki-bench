---
type: reference
title: RPC Contract and System API
description: The typed MessagePort request/response and event-stream RPC contract connecting the Renderer to the Agent Host, its wire message kinds, subscriptions, leases, timeouts, errors, and the Main bridge for Host-to-Main calls.
tags: [rpc, contract, api, streams, messageport]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
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
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# RPC Contract and System API

All Renderer↔Agent-Host communication flows through a typed, framework-free
MessagePort RPC implemented in `src/contract/rpc.ts` and defined by
`src/contract/api.ts`.

## The typed surface

`src/contract/api.ts` defines two interfaces:

- **`Api`** — request/response methods grouped into families
  (`host.*`, `processes.*`, `sessions.*`, `worktrees.*`, `git.status`,
  `agent.*`, `channels.*`, `files.*`, `models.*`, `modelsConfig.*`, `auth.*`,
  `skills.*`, `plugins.*`, `system.*`). Each entry names its `params` and
  `result` types.
- **`Streams`** — server-push topics (`agent.events`, `agent.running`,
  `auth.login`, `sessions.changed`, `files.changed`, `channels.*`,
  `processes.changed`, `processes.output`).

`ApiMethod`/`StreamTopic` derive from these keys, and `ApiParams`/`ApiResult`
extract the per-method types, so the contract type-checks every call site.

Shared domain types live in `src/contract/types.ts` (sessions, files, models,
auth/credential mutations, `RpcErrorShape`/`RpcError`) and
`src/shared/api-types.ts`, `channel-types.ts`, `toolchains/types.ts`,
`processes.ts`, and `browser.ts`.

## Wire protocol

`src/contract/rpc.ts` defines five wire message kinds:

- `request` — `{ kind, id, method, params }`
- `response` — `{ kind, id, ok, result? | error? }`
- `subscribe` / `unsubscribe` — `{ kind, id, topic, key }`
- `event` — `{ kind, topic, key, data }`

### Client

`createRpcClient(port)` returns a `PiRpc` with `call(method, ...)` and
`subscribe(topic, key, on)`:

- Each `call` gets a unique id, a timeout timer (default 120s, configurable),
  and a pending entry. Timeouts surface as an `RpcError` with code `TIMEOUT`.
- `subscribe` records the `(topic, key)` and returns an unsubscribe function;
  events are only delivered to a subscriber when the topic and key match
  (either side may be `"*"`). Port close rejects all pending calls with code
  `CLOSED` and clears subscriptions.
- `close()` detaches listeners and closes the port.

### Server

`createRpcServer()` hosts handlers registered via `handle(handlers)`. Each
request is dispatched to the registered async handler with a
`RpcRequestContext` providing `setLease`/`releaseLease` for per-request
resource ownership. On error the server shapes a normalized `RpcErrorShape`
(code — from thrown `RpcError`, `ToolchainError` capability mapping, a generic)
and returns `ok: false`.

Ports are attached via `attachPort(port)`. The server tracks per-port
subscriptions and leases, and **drops a port when the remote closes** (ISSUE-013)
so resources are released and subscriptions forgotten
(`rpc.ts:480-495`). On a post-message serialization failure, a
`SERIALIZATION_FAILED` fallback response is attempted and then the port is
forgotten and closed (`rpc.ts:410-429`).

`emit(topic, key, data)` fans a wire event out to matching port subscriptions;
a failing port is forgotten and closed.

## Transport-agnostic ports

`AnyMessagePort` accepts a DOM `MessagePort` (`addEventListener`
+`MessageEvent.data`), a Node `worker_threads`/utilityProcess port (`.on`
EventEmitter), or an Electron `MessagePortMain` (`.on('message', e => e.data)`).
This is why the protocol is unit-testable without Electron.

## Renderer surface

The renderer's `api-client.ts` is the single facade: `ensureRpc()` waits for
Host `ready`, requests the port through the preload bridge, wraps it in
`createRpcClient`, and pings. `call`/`subscribe` wrappers expose typed
convenience helpers (`listSessions`, `getSession`, `newAgent`, `agentCommand`,
`subscribeAgentEvents`, …). `resetRpc()` drops the client so a Host restart can
reconnect.

## Host handler wiring

`registerHandlers(server)` (`src/agent-host/handlers.ts`) binds every `Api`
method to an implementation. RPC errors are raised as `RpcError` with stable
codes: `BAD_REQUEST`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `PARSE_ERROR`,
`STALE_CURSOR`, `INTERNAL`, `METHOD_NOT_FOUND`, etc.

The `handlers.ts` manager also subscribes a running-sessions stream that is a
wire event plus a `parentPort` message so Main's tray badge tracks running
sessions (`handlers.ts:722-734`).

## Host→Main bridge (callMain)

The Host needs Main-only operations (browser, toolchain, credentials,
managed-process registration/confirmations). It uses `callMain` in
`src/agent-host/parent-rpc.ts`, which frames a `{ type: "host-rpc", id, method,
params }` message on `process.parentPort`, resolves matching
`host-rpc-result` replies, and times out after 10s by default. Main dispatches
these through `hostManager`'s request handler in `main.ts`, which validates
inputs and returns the result or an error shape. Host errors that carry a
`BrowserError` shape propagate with code/retryable/recovery metadata via
`MainProcessRpcError`.

## Contract coverage

`npm run check:contract` (`scripts/check-contract-coverage.mjs`) verifies that
API methods and Host handlers are covered, so adding an `Api` method without a
handler (or vice versa) fails the gate — keeping the typed surface honest.
