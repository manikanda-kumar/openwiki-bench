---
type: architecture
title: Typed RPC Contract
description: The five-message-kind MessagePort RPC protocol, the typed Api/Streams contract between Renderer and Agent Host, the preload bridge, the renderer transport facade, and the static contract-coverage gate.
tags: [rpc, contract, messageport, preload, api-surface, streams]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-2f0c558288a8a32519e88ca2
    resource: repo://src/agent-host/file-watch.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Typed RPC Contract

All Renderer ↔ Agent Host communication flows over one typed MessagePort RPC layer defined in `src/contract/`. There is no HTTP, no localhost port, and no untyped channel: the `Api` interface is the complete request/response surface ("replaces HTTP routes"), and `Streams` enumerates every server-push topic (src/contract/api.ts:56-57, 394-423).

## Wire protocol

`src/contract/rpc.ts` implements a dependency-free protocol with exactly five message kinds: `request` (id, method, params), `response` (id, ok, result or error), `event` (topic, key, data), `subscribe` (id, topic, key), and `unsubscribe` (id, topic, key) (src/contract/rpc.ts:15-51). Key properties:

- Calls carry a 120-second default timeout and reject with an `RpcError` (`TIMEOUT`) when the Host does not answer (src/contract/rpc.ts:88, 156-183).
- Event delivery matches a subscription when the keys are equal or either side is the wildcard `*`; subscriber exceptions are swallowed so one bad listener cannot break the stream (src/contract/rpc.ts:133-143).
- Port close rejects all pending calls with `CLOSED` and clears subscriptions — this is what lets the Renderer detect and recover from a Host crash (src/contract/rpc.ts:146-149).
- The port abstraction (`AnyMessagePort`) works for DOM MessagePorts, Node `worker_threads` ports, and Electron `MessagePortMain`, normalizing `{ data }` event wrappers (src/contract/rpc.ts:248-302).

The server side (`createRpcServer`) registers handlers per method, tracks per-port subscriptions and leases, and broadcasts `emit(topic, key, data)` to matching ports (src/contract/rpc.ts:265-320).

## The Api surface

`Api` covers the whole desktop feature set in one interface: host ping/toolchain, `processes.*` (managed background processes), `sessions.*` (list/get/context/contextPage/entryContent/export/rename/delete), `agent.*` (new/command/state/generateTitle), `files.*` (list/read/download/meta/preview/index/watch), `models.*` and `modelsConfig.*`, `auth.*` (providers, API keys, OAuth login), `channels.*`, `skills.*`, `plugins.*`, and `system.*` helpers (src/contract/api.ts:57-392).

`Streams` declares the push topics and their payload types (src/contract/api.ts:395-420):

| Topic | Emitted by (Agent Host unless noted) |
| --- | --- |
| `agent.events` | per-session agent stream, keyed by session id (src/agent-host/handlers.ts:1995-1996) |
| `agent.running` | running-sessions snapshot fan-out (src/agent-host/handlers.ts:722-724) |
| `auth.login` | OAuth login progress (src/agent-host/auth-login.ts:55-57) |
| `sessions.changed` | session watcher and channel/session mutations, with `fullRefresh` semantics (src/agent-host/session-watcher.ts:47-67) |
| `files.changed` | per-path file watch service (src/agent-host/file-watch.ts:32-105) |
| `channels.status` / `channels.login` / `channels.pairing` / `channels.binding` / `channels.activity` | ChannelManager (src/agent-host/channels/channel-manager.ts:213, 434, 661-667, 821) |
| `processes.changed` / `processes.output` | ManagedProcessService (src/agent-host/managed-process/service.ts:604, 1277, 1291) |

Browser state does not use `Streams`; it travels as `browser:event` over the desktop IPC bridge and as `browser.*` host RPC methods routed to `BrowserService` (src/preload/preload.ts:175-179; src/main/main.ts:681-683).

## Preload bridge

The preload script exposes exactly one object, `window.piBridge`, via `contextBridge` under sandbox + contextIsolation (src/preload/preload.ts:1-7, 187). It provides:

- The Host MessagePort, transferred via `window.postMessage` because a MessagePort must not cross `contextBridge` inside a Promise resolution — that silently breaks the port (src/preload/preload.ts:17-26).
- Desktop IPC helpers (`desktop:*` invokes for updates, toolchains, file dialogs, browser control, diagnostics, theme, UI state) and event subscriptions (`host:status`, `host:restarted`, `host:crashed`, `update:state`, `toolchains:state`, `browser:event`, deep links, menu commands) (src/preload/preload.ts:55-185).
- Early-event replay buffers one pending event per fixed menu/deep-link channel so commands sent before React subscribes are not lost (src/preload/preload.ts:28-53).
- Location gating: the bridge is only installed when `isTrustedPreloadLocation` validates the page URL (src/preload/preload.ts:14-16).

## Renderer transport facade

`src/renderer/lib/api-client.ts` is the only path from components to the Host (src/renderer/lib/api-client.ts:1-4). `ensureRpc()` waits for Host readiness (30-second budget, racing a status poll against the `host:status` subscription), requests the port, builds the client, and validates liveness with `host.ping` before returning (src/renderer/lib/api-client.ts:22-40, 74-141). `resetRpc()` closes the client and clears caches so the next call reconnects after a Host crash (src/renderer/lib/api-client.ts:11-20). Convenience wrappers preserve the old HTTP-route naming (`listSessions`, `getSession`, ...) (src/renderer/lib/api-client.ts:164-189).

## Enforcement

`scripts/check-contract-coverage.mjs` statically parses the TypeScript AST (no runtime reflection) and enforces:

- every `Api` method has a registered Host handler, and every handler corresponds to a declared method (scripts/check-contract-coverage.mjs:51-80);
- every `server.emit` string literal names a declared `Streams` topic (scripts/check-contract-coverage.mjs:91-102);
- Browser `dispatchHostRequest` method comparisons match the browser contract (scripts/check-contract-coverage.mjs:190-200).

It runs in `npm run verify` and as `npm run check:contract`, so a contract mismatch fails the build (scripts/verify.mjs). Contract tests in src/contract/rpc.test.mjs cover the wire protocol itself.

## Representative tests

- src/contract/rpc.test.mjs — wire protocol, timeouts, subscription matching
- scripts/check-contract-coverage.test.mjs — AST extraction logic
- src/renderer/lib/api-fetch.test.mjs and related renderer contract tests under src/renderer/
