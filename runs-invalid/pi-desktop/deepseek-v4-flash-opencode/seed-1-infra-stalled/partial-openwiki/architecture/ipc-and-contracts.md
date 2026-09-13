---
type: architecture
title: IPC and Type Contracts
description: The typed IPC/RPC layer that connects the Electron Main process, the Agent Host utility process, and the sandboxed renderer — wire protocol, contracts, preload bridge, reverse RPC, and sender-trust gating.
tags: [ipc, rpc, contracts, preload, messageport, architecture]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T13:27:03.630Z
---

# IPC and Type Contracts

Pi Agent Desktop has no internal HTTP/TCP control plane. Every cross-process interaction is carried over Electron `MessagePort` objects or `ipcMain`/`ipcRenderer` channels, and every payload type is declared in TypeScript contracts under `src/contract/`. The surfaces are:

1. **Renderer ↔ Agent Host**: a typed request/response + stream RPC protocol over a transferred `MessagePort` (`src/contract/rpc.ts`, `src/contract/api.ts`).
2. **Renderer ↔ Main**: the `piBridge` preload surface, one `ipcRenderer.invoke`/`send` channel per operation, registered in `src/main/ipc.ts`.
3. **Agent Host → Main**: a reverse one-shot RPC over `process.parentPort` for browser requests, toolchain resolution, managed-process registration, and channel secrets (`src/agent-host/parent-rpc.ts`).

## Host MessagePort RPC protocol

`src/contract/rpc.ts` defines five wire messages: `request`, `response`, `subscribe`, `unsubscribe`, and `event` (`WireMessage`, `src/contract/rpc.ts:15-51`). A request carries an `id`, a `method` name, and `params`; the response echoes the `id` with `ok` plus either a `result` or an error shape. There is no framing beyond a single `postMessage` per message, and the port type is duck-typed so the same server code works with DOM `MessagePort`, Node `worker_threads`, and Electron `MessagePortMain` (`AnyMessagePort`, `src/contract/rpc.ts:254-263`).

The client side (`createRpcClient`, `src/contract/rpc.ts:100-227`) keeps a map of in-flight requests, defaults calls to a 120 s timeout (`DEFAULT_CALL_TIMEOUT_MS`, `src/contract/rpc.ts:88`), and rejects every pending call with `CLOSED` when the port closes. Subscriptions are keyed by `(topic, key)`, and event delivery matches when either side uses the `"*"` wildcard (`src/contract/rpc.ts:133-144`).

The server side (`createRpcServer`, `src/contract/rpc.ts:304-507`) dispatches to a handler map, tracks per-port subscriptions, and releases per-port resources when a port is detached or closes. The `RpcRequestContext` given to every handler exposes lease semantics: `setLease(key, release)` installs (and replaces) a release callback keyed by lease name, and `releaseLease(key)` runs and removes it; all outstanding leases for a port are released when the port is forgotten (`src/contract/rpc.ts:331-357`). Handlers that own long-lived resources use leases — for example `files.watchStart` registers a `files.watch:<path>` lease that `files.watchStop` or port disconnect releases (`src/agent-host/handlers.ts:1899-1916`).

Errors cross the wire as `{ code, message, detail }`. The server serializes `RpcError` verbatim, converts `ToolchainError` to its code/capability/causeCode detail, and maps anything else to `INTERNAL`; if the response itself cannot be serialized it sends `SERIALIZATION_FAILED` and, on further failure, drops the port (`src/contract/rpc.ts:384-429`).

## The Api and Streams contracts

`src/contract/api.ts` is the single source of truth for the request/response surface. The `Api` interface declares `params` and `result` for every method grouped by domain: sessions (`sessions.*`), agent lifecycle (`agent.*`), worktrees and git, files, models and auth, skills/plugins, channels, managed processes (`processes.*`), and small `system.*` helpers (`Api`, `src/contract/api.ts:57-392`). The `Streams` interface declares the server-push topics, including `agent.events`, `sessions.changed`, `files.changed`, `channels.*`, and `processes.*` (`Streams`, `src/contract/api.ts:395-420`). Domain types shared with the Host and the renderer live in `src/contract/types.ts` (e.g. `RpcError` and `RpcErrorShape`, `src/contract/types.ts:224-239`).

Contract coverage is machine-checked, not advisory. `scripts/check-contract-coverage.mjs` statically parses `api.ts`, `handlers.ts`, `desktop.ts`, `preload.ts`, `ipc.ts`, `browser.ts`, and `browser-service.ts` and fails unless every `Api` method has a server handler, every `Streams` topic is emitted, every `PiBridge` method is implemented, every IPC invoke/send channel is registered, and the browser Host method set matches both the `BrowserHostRpc` interface and the `dispatchHostRequest` cases (`analyzeContractCoverage`, `scripts/check-contract-coverage.mjs:229-290`). It runs inside the `verify` gate.

## The preload bridge and Host port transfer

The renderer is sandboxed and gets a single `piBridge` object via `contextBridge` (`contextBridge.exposeInMainWorld("piBridge", bridge)`, `src/preload/preload.ts:187`). The full shape is the `PiBridge` interface in `src/contract/desktop.ts:131-226`. The bridge is deliberately narrow: platform/version, update control, Host status and toolchain state, file/project operations, UI state, browser control, and a fixed set of `on*` event subscriptions. Main-to-renderer events that fire before React subscribes are buffered one generation each by `EarlyEventReplay` (deep links and menu commands, `src/preload/preload.ts:29-53`).

The Host `MessagePort` is never exposed through `contextBridge` (a Promise-resolved port silently breaks). Instead the preload listens for the `desktop:host-port` IPC event and forwards the transferred port to the page with `window.postMessage(..., "*", [port])` on the channel `"pi-desktop-host-port"` (`src/preload/preload.ts:16-26`). The renderer retrieves it in `requestHostPort()` (`src/renderer/lib/api-client.ts:43-72`), then `ensureRpc()` waits for Host `ready` (30 s), creates the RPC client, and verifies the connection with a `host.ping` round-trip before use (`src/renderer/lib/api-client.ts:118-141`).

Preload hardening lives in two small policy modules. `isTrustedPreloadLocation` only enables the port-forwarding bridge for `app://bundle` or dev-server `localhost:5173` pages (`src/preload/preload-location-policy.ts:1-11`). `selectTransferredHostPort` validates that exactly one object with working `postMessage`/`start`/`close` methods is transferred, and `isValidDeepLinkSessionMessage` constrains deep-link session ids to the UUID shape (`src/preload/preload-message-policy.ts:7-24`).

## Desktop IPC and sender trust

`src/main/ipc.ts` registers every `desktop:*` channel. `installDesktopIpc` wraps each registration in `trustedHandle` (invoke) or `trustedOn` (send), which first calls `assertTrustedSender` (`src/main/ipc.ts:83-104`). Trust means the sender's `webContents` is the main window's `webContents` and the `senderFrame` is its `mainFrame` — subframes and other `WebContents` are rejected (`isTrustedDesktopIpcSender`, `src/main/ipc.ts` / `src/main/ipc-trust.ts:13-19`). This is the boundary that keeps untrusted web content in the built-in Browser from reaching desktop capabilities.

The renderer asks for the Host port over `desktop:connect-host`; Main answers by creating a `MessageChannelMain` and transferring one side to the Host via `attachRendererPort` (`src/main/ipc.ts:177-182`, `HostManager.createRendererChannel`, `src/main/host-manager.ts:162-166`). Desktop operations that need Host services in the middle (e.g. HTML preview asset loads) call the Host through `HostManager.call`, a one-shot RPC over a fresh channel (`src/main/host-manager.ts:169-202`).

## Reverse RPC: Agent Host → Main

The Host reaches Main with `callMain(method, params, timeoutMs)` (`src/agent-host/parent-rpc.ts:55-68`), which posts `{ type: "host-rpc", id, method, params }` on `process.parentPort` and matches the async reply against `host-rpc-result`. `HostManager` receives these in its message handler and dispatches them to the request handler configured by `main.ts`: `channelSecrets.*` hits the credential vault, `toolchain.*` hits the toolchain manager, `managedProcesses.*` hits the reaper (with owner-generation checks on Windows), and `browser.*` hits `BrowserService.handleHostRequest` (`src/main/main.ts:590-685`). Browser host requests are validated against the `BrowserHostRpc` contract and the `BROWSER_HOST_METHODS` set before dispatch (`src/contract/browser.ts:728,961-969`).

## Error taxonomy

Handlers and bridges surface a small set of structured errors:

- `RpcError` — `{ code, message, detail? }`, thrown by Host handlers for business failures (`FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `BAD_REQUEST`, `PARSE_ERROR`, `STALE_CURSOR`, `RESULT_TOO_LARGE`, `INTERNAL`) (`src/contract/types.ts:230-239`).
- `ToolchainError` — adds `capability` and `causeCode` for developer-tool failures (`src/shared/toolchains/errors.ts:12-26`).
- `BrowserError` — carries `retryable`, a `recovery` reason/remediation, and `toJSON()` for the structured wire form; the recovery table classifies each code (`src/main/browser/browser-error.ts:3-36,46-110`).
- `MainProcessRpcError` — the Host-side view of a failed Main/browser request, preserving `code`/`retryable`/`recovery` (`src/agent-host/parent-rpc.ts:21-38`).

Desktop IPC handlers translate these into single-line `CODE: message` strings (e.g. `browserHandler` rethrows `BrowserError` as `${code}: ${message}`) so the renderer never receives raw objects of unknown shape (`src/main/ipc.ts:111-124`).

## Related pages

- [Architecture Overview](/openwiki/architecture/overview.md)
- [Security and Trust Model](/openwiki/security/security-model.md)
- [Agent Host: Runtime, Sessions, Models, Extensions](/openwiki/systems/agent-host.md)
- [Change Guides](/openwiki/development/change-guides.md)