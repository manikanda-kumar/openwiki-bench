---
type: rpc-protocol
title: "Cap'n Web RPC Protocol and API Surface"
description: How the Workshop's client-server communication is structured — the interface hierarchy in workshop-shared, WebSocket transport with pipelining, runtime validation, subscription and stub-lifecycle conventions, and coded error families.
tags: [rpc, capnweb, api, websocket, protocol]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-a785df1d3a3014d5295dc713
    resource: repo://packages/workshop-frontend/src/useActions.ts
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-911ff8ecac80ecdb084e2b11
    resource: repo://packages/workshop-frontend/src/useWorkspaceOpen.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Cap'n Web RPC Protocol and API Surface

All client-server communication in the Workshop is one RPC API, defined once in `packages/workshop-shared/src/api.ts` and consumed by both the browser SPA and the backend kernel. The client is a deliberate "fat client" SPA; the file's header lists the reasons (long-lived sessions where startup time matters less, client-side gadget sandboxing that cannot be server-rendered, and a clean boundary that makes alternative clients easy) (packages/workshop-shared/src/api.ts:1-24).

## Transport

The API operates over a WebSocket that the client opens at startup at `/api` and keeps for the whole session, reconnecting when needed (packages/workshop-shared/src/api.ts:18-19, packages/workshop-frontend/src/main.tsx:94-101). The same surface is also reachable over HTTP batch POSTs — `newWorkersRpcResponse()` dispatches POST to `newHttpBatchRpcResponse` and WebSocket upgrades to `newWorkersWebSocketRpcResponse`, and batch responses set `Access-Control-Allow-Origin: *` because the API is designed to be safe cross-origin through in-band authorization (packages/workshop-backend/src/server.ts:885-902).

The backend owns the socket lifetime: it wraps an `AbortSignal` into the session options so that killing a session (e.g. an auth failure detected later) disposes the RPC session stub, which closes the WebSocket (packages/workshop-backend/src/server.ts:857-870, 915-925).

## Interface hierarchy

Each interface is a `RpcTarget`; methods returning `RpcStub<T>` hand the client a capability pointing deeper into the system:

- `PublicApi` — pre-authentication surface: `ping`, `getServerConfig`, sign-in starters (`login`, `createAccount`, `startGatekeeperLogin`, `authenticate`, `authenticateFromCfAccess`), and public blueprint reads (packages/workshop-shared/src/api.ts:49-133).
- `AuthenticatedApi` — the post-login surface: profile/models, Cloudflare usage, connected accounts, blueprint library, and — crucially — `openGadget()` / `newGadget()` which return `RpcStub<Overseer>` (packages/workshop-shared/src/api.ts:360-478, 493).
- `Overseer` — one workspace: metadata subscriptions, workpiece list subscriptions, `createGadget`/`getGadget` (returning `GadgetClient` stubs), commit access (`getCodeAtCommit`, `getCommitLog`), and code-change submission (packages/workshop-shared/src/api.ts:1594-1723).
- `GadgetClient` — one gadget: its deployed `UiBundle` for the iframe sandbox, `connectToGadget()` returning an RPC stub to the gadget's server-side DO facet (which the frontend passes into the sandbox), export formats, and binding management (packages/workshop-shared/src/api.ts:3867-3966).
- `GatekeeperClient` — one gatekeeper connection workpiece: `describe()`, `openSession()`, creation spec (packages/workshop-shared/src/api.ts:3968-3986).

Live updates use a **subscriber pattern**: methods like `subscribeToMetadata`, `subscribeToWorkpieces`, `subscribeToPresence`, and the chat/action/console-log subscribers take an `RpcStub` of a callback interface, deliver one initial burst followed by incremental events, and return an `RpcStub<{}>` whose disposal cancels the subscription (packages/workshop-shared/src/api.ts:1598-1643, 3370-3438, 3502-3508).

## Promise pipelining

The protocol is Cap'n Web, which implements promise pipelining: a stub returned by a call can be used immediately without awaiting the call, and a promise for a future result can be passed as an argument to another call — the server resolves it before delivering the arguments. The API is shaped to exploit this: `openGadget()` is documented so that share-key redemption and gadget opening happen in a single round trip with "further calls pipelined on the returned Overseer", and it throws rather than returning null so a pipelined chain fails fast; `getGadget()` likewise "throws an exception if there is no such gadget" to stay pipelining-friendly (packages/workshop-shared/src/api.ts:461-479, 1662-1666). The frontend leans on this too — `useAuth` pipelines `whoami()` without awaiting so the answer can outlive the session that asked (packages/workshop-frontend/src/useAuth.ts:38-41).

## Runtime validation

Server-side RPC target implementations are annotated `@validateRpc()` (from `capnweb-validate`), which installs auto-generated runtime type validation matching the interface's TypeScript signatures — the codebase explicitly forbids writing redundant hand-rolled validation that duplicates it (packages/workshop-backend/src/server.ts:75, 624, 635; packages/workshop-backend/src/overseer.ts:9052, 10551-11299; AGENTS.md RPC section). The build step `capnweb-validate build` (wired into `build:worker` in workshop-backend's package.json) performs the transform.

## Stub lifecycle conventions

Two conventions protect against client-side pitfalls (both documented in AGENTS.md and applied throughout the frontend):

1. **Never put an RPC stub directly in `useState`.** React's state setter calls a function-typed value to compute the new state, and stubs look callable at runtime; stubs are therefore wrapped in an object before being stored (`RpcContext` keeps `{ stub }` for exactly this reason) (packages/workshop-frontend/src/RpcContext.tsx:5-9).
2. **Dispose stubs you no longer need.** Server-side resources back every stub; dropping one without `stub[Symbol.dispose]()` leaks them. Effect cleanup functions dispose acquired stubs — `useWorkspaceOpen` disposes its metadata subscription, overseer stub, and observer-configurator stub on cleanup (packages/workshop-frontend/src/useWorkspaceOpen.ts:67-69, 129), and `useActions` disposes subscription stubs (packages/workshop-frontend/src/useActions.ts:190).

Note that disposing a stub does not guarantee rejection of calls already in flight; code that must not be overwritten by stale async results uses cancellation flags instead (packages/workshop-frontend/src/useAuth.ts:41-45, 50-55).

## Coded error families

Expected, client-classifiable failures carry machine-readable codes. `OPEN_GADGET_ERROR_CODES` (`WORKSPACE_NOT_FOUND`, `WORKSPACE_ACCESS_DENIED`) tags `openGadget()` failures via `createOpenGadgetError`/`getOpenGadgetErrorCode`, and `AUTH_ERROR_CODES` (`INVALID_SESSION_TOKEN`, `NOT_AUTHENTICATED_WITH_ACCESS`) tags auth failures, with `AUTH_ERROR_MESSAGES` as a fallback classification when a code does not survive (packages/workshop-shared/src/api.ts:315-357).

## Related pages

- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md)
- [Frontend SPA and Connection Lifecycle](/openwiki/frontend/spa.md)
- [Change Guide: Extending the RPC API](/openwiki/guides/extend-rpc-api.md)
