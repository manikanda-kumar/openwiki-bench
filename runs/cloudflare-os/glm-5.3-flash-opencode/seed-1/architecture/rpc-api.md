---
type: architecture
title: The Cap'n Web RPC API Contract
description: How the SPA, backend, and gatekeepers communicate — a persistent WebSocket speaking Cap'n Web, the PublicApi → AuthenticatedApi → Overseer → GadgetClient capability chain, runtime validation, promise pipelining, and the project's RPC coding conventions.
tags: [rpc, capnweb, api, capabilities, websocket, frontend]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-a785df1d3a3014d5295dc713
    resource: repo://packages/workshop-frontend/src/useActions.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# The Cap'n Web RPC API Contract

The UI is a "fat client" SPA talking to the backend exclusively over an RPC API. The entire client↔server surface is defined in `packages/workshop-shared/src/api.ts` as plain TypeScript `RpcTarget` interfaces, transported by Cap'n Web over a WebSocket that the client starts at startup and keeps open for the session lifetime, reconnecting as needed (api.ts:1-24). Gadgets themselves are sandboxed iframes that can only `postMessage()` to their parent; through that bridge the Workshop hands them a stub to their server-side Durable Object (api.ts:21-24).

## The capability chain

A client walks a chain of capabilities, each minted only after the previous one authorizes it:

1. **`PublicApi`** (api.ts:48-133) — the internet-facing root: `ping`, `getServerConfig`, blueprint lookup/download (no auth required; "knowing the ID is sufficient, since a blueprint is just data"), password `login`/`createAccount`, `authenticate(token)` → `AuthenticatedApi`, `authenticateFromCfAccess()`, and `startGatekeeperLogin(vendorId)` which returns `{url, attempt}` where the `attempt` stub is itself a capability — "Holding this stub is the capability to receive the resulting session token; dispose it to abandon the attempt" (api.ts:35-46).
2. **`AuthenticatedApi`** (api.ts:360+) — the per-user surface: profile and models, connected accounts, blueprint library, `listGadgets`/`newGadget`, and crucially `openGadget(id, shareKey?, configureObservers?)` → an `Overseer` stub (src/server.ts:275-281). The admin capability `getAdminApi()` returns null for non-admins; the `#isAdmin()` check happens once when the capability is minted (src/server.ts:592-600).
3. **`Overseer`** (api.ts:1594+) — the workspace surface: metadata and subscriptions, workpieces (`createGadget`, `getGadget`, `newGatekeeper`, `newAiModelGatekeeper`, `newAgentSpawnerGatekeeper`), code (`getCodeAtCommit`, `getCommitLog`, `submitCodeChange`), chats, the action log with `approveAction`/`rejectAction`, hooks, auto-approval rules, and sharing. Non-owner `use`-role openers receive a restricted `UseOverseerInterface` implementing the same interface but throwing `Unauthorized` outside the allowlist (src/overseer.ts:10552).
4. **`GadgetClient`** (api.ts:3867+) — one gadget workpiece: `getUiBundle`, `connectToGadget()` (the stub passed into the iframe sandbox), file export, and binding management (`bind`/`unbind`/`renameBinding`, blueprint annotations).
5. **`GatekeeperClient<Session>`** (api.ts:3973+) — one connection: `describe()` (the resource's RPC schema), `openSession()` → a typed session stub, `getCreationSpec()`.

The chain is deliberately pipelined: `openGadget` redeems share keys in the same RPC that opens, "which allows subsequent calls to be pipelined on the returned Overseer stub without waiting for a separate redemption step" (docs/sharing.md:44).

## Transport and session lifecycle

- The frontend opens `newWebSocketRpcSession<PublicApi>(wsUrl)` against `/api` (src/main.tsx:94-101) and passes the stub down through `RpcContext`; the stub is wrapped in an object because "React's callable-state-setter" would otherwise invoke a stub passed to `useState` (src/RpcContext.tsx:7-9).
- Reconnection is proactive: `onRpcBroken` publishes an `RpcPromise` wrapping the next connection so calls pipelined during an outage queue in order instead of failing against the dead socket, and a candidate must prove itself with a `ping()` probe before it replaces the old stub (src/main.tsx:107-153). Tab-visible/network-online events trigger probes because passive close detection misses sockets killed by laptop sleep (src/main.tsx:155-164).
- Server side, each `/api` WebSocket session gets an `abortSession` callback that closes the socket — used by `openGadgetInternal`'s loss-detection hack: a `notifyClosed` stub passed to `overseer.open()` is disposed *without being called* if the connection to the workspace DO is lost, which aborts the session and forces the client's reconnect logic (src/server.ts:229-273, 857-868).
- `/api` also accepts HTTP batch POSTs via `newHttpBatchRpcResponse`, with CORS explicitly opened because WebSocket always allows cross-origin use and the API uses in-band authorization (src/server.ts:887-902).

## Validation and error handling

- Every RPC interface implementation is annotated `@validateRpc()` (capnweb-validate), which installs generated runtime type validation matching the TypeScript signatures — e.g. `PublicApiImpl`, `AuthenticatedApiImpl`, `LoginAttemptImpl` in src/server.ts, the overseer client interfaces at src/overseer.ts:9052/10551/10805/11057, and `ExternalMessageGateway` (src/external-message-gateway.ts:9). Project policy says not to write redundant validation code that duplicates what capnweb-validate covers.
- Expected failures carry machine-readable codes built by `codedErrorFamily` (api.ts:298-357): `OPEN_GADGET_ERROR_CODES` (`WORKSPACE_NOT_FOUND`, `WORKSPACE_ACCESS_DENIED`) and `AUTH_ERROR_CODES` (`INVALID_SESSION_TOKEN`, `NOT_AUTHENTICATED_WITH_ACCESS`). The per-code message doubles as the classification fallback for errors from older deployments that lost the code in transit, so changing one is a compatibility break (api.ts:298-300). Clients match on codes via `getOpenGadgetErrorCode`/`getAuthErrorCode`, not message text.

## Subscription pattern

State that changes server-side is delivered through subscriber capabilities the client passes in: `subscribeToMetadata`, `subscribeToWorkpieces`, `subscribeToActions`, `subscribeToPresence`, `subscribeConnectedAccounts`, and chat subscribers. Each returns a disposable subscription stub; "Disposing the returned RpcStub will cancel the subscription" (api.ts:1598-1608). The frontend disposes stubs on cleanup — e.g. `useActions.ts:190,231` and GadgetUI's unmount path (src/GadgetUI.tsx:196-237). The action log pairs this with a query half: `listActions({filter})` is "the query half of the query-for-state/subscribe-for-deltas contract" (api.ts:1768-1780).

## Gatekeeper-side interfaces

The gatekeeper RPC surface (`GatekeeperVendor`, `GatekeeperUser`, `Gatekeeper`, `ApprovalQueue`, `ObservationAuthorizer`, hook interfaces) is defined in `packages/workshop-shared/src/gatekeeper.ts` and spoken over the same JavaScript RPC mechanism, with each gatekeeper deployed as an independent worker behind a service binding (gatekeeper.ts:14-17). See [Gatekeeper Architecture](/openwiki/gatekeepers/architecture.md).

## Project RPC conventions (from the repository's own guidance)

The repo's contributor guidance (AGENTS.md, REVIEW.md) enforces conventions specific to Cap'n Web. Since AGENTS.md itself is excluded from the wiki's evidence index, these are stated here with the closest in-repo evidence:

- **Use promise pipelining.** If an RPC returns a stub, use the promise directly rather than awaiting first; a promise for a future result may be passed as an argument to another call, replaced by its resolution server-side. The code does this pervasively (e.g. blueprint instantiation's pipelined gatekeeper creation, docs/blueprints.md:160).
- **Never put an RPC stub in `useState` directly.** All stubs appear callable at runtime, and the state setter calls function-shaped values; wrap the stub in an object (the pattern `RpcContext` documents, src/RpcContext.tsx:7-9).
- **Dispose stubs.** `stub[Symbol.dispose]()` releases server-side resources; React components dispose in effect cleanup (src/GadgetUI.tsx:196-237, src/useActions.ts:190-231). The `LoginAttempt` doc makes disposal semantically meaningful — disposing abandons the sign-in and cancels the server-side wait (api.ts:39-46).
- **Annotate every RPC interface with `@validateRpc()`** and don't duplicate its checks by hand.
- **Doc-comment every exported member of the `workshop-shared` public API**, and never hand-write an interface mirroring an RPC interface plus an `as unknown as` cast — derive from the real type (REVIEW.md, "High-scrutiny areas").
