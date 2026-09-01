---
type: architecture
title: Cap'n Web RPC protocol and API boundary
description: How the browser, gadgets, and gatekeepers talk to the backend — the /api endpoint, workshop-shared interface contracts, promise pipelining, stub lifecycle, and MessagePort sessions for gadget iframes.
tags: [architecture, rpc, capnweb, api, frontend, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
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
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Cap'n Web RPC protocol and API boundary

Every conversation between the browser, a gadget's server-side object, and a gatekeeper is a
[Cap'n Web](https://github.com/cloudflare/capnweb) RPC call. There is no REST layer: the workshop
speaks one RPC dialect everywhere, over a single `/api` endpoint for the browser, over service
bindings between Workers, and over `MessagePort`s between the parent page and sandboxed gadget
iframes. This page describes the transport, the interface contracts that define it, and the
lifecycle rules (pipelining, disposal, reconnection) the codebase depends on.

## One endpoint, two transports

The backend's `fetch` handler serves the whole client API at `/api`
(`packages/workshop-backend/src/server.ts:816-869`). Two request shapes are accepted:

- **HTTP batch** (`POST /api`): delegated to Cap'n Web's `newHttpBatchRpcResponse`. Batch responses
  always set `Access-Control-Allow-Origin: *` — the comment explains why this is safe: the WebSocket
  transport always allows cross-origin requests anyway, so the API is designed to be
  cross-origin-safe through **in-band authorization** (the `authenticate()` token), not origin
  checks (`packages/workshop-backend/src/server.ts:887-902`).
- **WebSocket upgrade**: delegated to `newWorkersWebSocketRpcResponse`, which pairs a WebSocket and
  opens a Cap'n Web session over it (`packages/workshop-backend/src/server.ts:904-931`). The
  browser keeps this socket open for the whole session and reconnects when it breaks.

Anything else returns 400. Other paths on the backend (`/api/client-errors`,
`/blueprint-screenshot/*`, the site logo) are plain HTTP, not RPC.

The server extends Cap'n Web's session options with an `abortSignal`
(`packages/workshop-backend/src/server.ts:875-883`). `abortSession` disposes the session stub when
the server wants to kill the connection — notably when the connection to a workspace DO is lost
(see [Stub lifecycle](#stub-lifecycle-and-disposal)).

## The client connection manager

`packages/workshop-frontend/src/main.tsx` manages the WebSocket at module scope, deliberately
*outside* React. The comment at `main.tsx:36-58` explains why: React StrictMode double-runs
effects, which would create and throw away connections and let two sockets fight to replace each
other.

Key mechanics:

- `startConnection()` opens `ws(s)://<backend-host>/api` and registers `onRpcBroken`
  (`main.tsx:94-101`).
- `handleBroken()` swaps the dead stub for `new RpcPromise<PublicApi>(reconnect())`
  (`main.tsx:140-156`). Cap'n Web queues calls pipelined onto an unresolved `RpcPromise` and
  delivers them once it resolves, so work issued during an outage waits for the replacement socket
  instead of failing against a socket known to be gone.
- `reconnect()` retries with jittered backoff (1 s initial, 10 s max), and only returns a stub that
  has *proven itself* by answering a `ping()` probe within a deadline — an unproven stub looks fine
  until everything pipelined onto it fails at once (`main.tsx:110-138`).
- `probeOnWake()` pings on tab-visibility and network-online events, because passive close
  detection misses sockets killed during laptop sleep (`main.tsx:158-176`).
- Subscribers hear exactly two events per outage — "lost" here, "restored" in `reconnect` — because
  the stub is replaced once, as a promise (`main.tsx:106-108`).

`RpcContext` (`packages/workshop-frontend/src/RpcContext.tsx`) publishes the stub and a
`connectionLost` flag to the app. The stub is stored **wrapped in an object** `{ stub, ... }` — the
setter returned by `useState()` calls anything callable (including an `RpcStub`, which is callable
by construction) to compute a state value, so a bare stub in state would be invoked
(`RpcContext.tsx:5-9`). This is one of the repo's review rules (`REVIEW.md:65-66`).

## The interface hierarchy

`packages/workshop-shared/src/api.ts` is the contract between client and server; it is imported by
both sides and validated at the boundary (below). The layers:

| Interface | Granted by | Purpose |
| --- | --- | --- |
| `PublicApi` | every `/api` session | unauthenticated: `ping`, `getServerConfig`, `startGatekeeperLogin`, `authenticate`/`authenticateFromCfAccess`, `login`/`createAccount`, `getBlueprint`, `downloadBlueprint` (`api.ts:48-133`) |
| `AuthenticatedApi` | `authenticate()` with a session token | the user's full API: profile, models, gadget registry, `openGadget`, connected accounts, blueprints, `getAdminApi()` |
| `Overseer` | `openGadget()` / `newGadget()` | per-workspace operations: chats, code changes, actions, sharing, blueprints |
| `WorkpieceClient` → `GadgetClient` / `GatekeeperClient` | `Overseer` | per-workpiece sub-capabilities (`api.ts:3811+`, `3867+`) |
| `AdminApi` | `AuthenticatedApi.getAdminApi()` for admins only | deployment settings (`admin-settings.ts`) |

The `Overseer` stub handed back by `openGadget` is a *native* Workers RPC stub
(`cloudflare:workers`) cast to a Cap'n Web stub with an explicit `@ts-expect-error` because the two
systems are runtime-compatible but not type-compatible
(`packages/workshop-backend/src/server.ts:275-281`).

Expected failures travel as **coded errors**: `codedErrorFamily()` attaches a stable machine-readable
`code` to an `Error` and uses the per-code message as a classification fallback for older
deployments that lost the code in transit (`api.ts:298-357`). `OPEN_GADGET_ERROR_CODES`
(`WORKSPACE_NOT_FOUND`, `WORKSPACE_ACCESS_DENIED`) and `AUTH_ERROR_CODES` are the two families; the
not-found/access-denied distinction deliberately reveals no workspace metadata to an unauthorized
caller.

## Runtime validation with `@validateRpc()`

Every RPC implementation in the repo is annotated `@validateRpc()` from `capnweb-validate`, which
installs auto-generated runtime validation derived from the interface's TypeScript signatures —
argument shapes are checked at the RPC edge, so handlers do not re-check what the validator already
covered. It is applied across the backend (`server.ts:75`, `overseer.ts`'s client interfaces) and in
every gatekeeper worker (searching for `@validateRpc()` finds it in all 15 gatekeeper packages and
`mcp-shared`).

The one documented escape hatch is `@skipRpcValidation()` on GitHub's `getVerifier()`
(`packages/gatekeeper-github/src/github.ts:1328-1332`) — a method whose return type (a native
`Fetcher`) does not fit the generated validator's model.

## Promise pipelining

Promise pipelining is a deliberate, load-bearing convention: an RPC that returns a promise can be
passed as an *argument* to another call, or used in place of a stub, without being awaited first —
the runtime replaces it with its resolution on the server side before delivering the arguments.
`REVIEW.md:61-64` warns reviewers **not** to flag unawaited RPC promises as floating promises.

Where it matters:

- The observer-open path pipelines verifier minting straight into gatekeeper calls; the docs note
  that callers may pass the returned promise directly into `addObserver()` without awaiting
  (`docs/observers.md:186-190`), and the overseer runs its verification set with `Promise.all` so
  Cap'n Web can batch the underlying RPCs.
- On the client, the broken-connection path relies on `RpcPromise` queueing (above).

## Stub lifecycle and disposal

Stubs must be disposed with `stub[Symbol.dispose]()` (or a `using` declaration, or a `useEffect`
cleanup) when no longer needed; an undisposed stub is a server-side leak (`REVIEW.md:67-69`).
Concrete disposal points visible in the code:

- The server's WebSocket adapter disposes the session stub when the `abortSignal` fires
  (`server.ts:915-925`).
- `main.tsx`'s `disposeQuietly()` disposes candidates and suspects during reconnection
  (`main.tsx:103-108`, `166-171`).
- `PublicApi.startGatekeeperLogin()` documents that disposing the returned `attempt` stub is how the
  client *abandons* a sign-in — disposal is a capability revocation, not just hygiene
  (`api.ts:35-46`).

Two server-side tricks ride on the same machinery:

- **Lost-DO detection.** `#openGadgetInternal` passes a `notifyClosed` callback into
  `OverseerDurableObject.open()`. The callback is disposed without being called if the connection to
  the workspace DO dies; the disposed-but-not-called state is treated as "lost connection" and the
  whole browser WebSocket is aborted so the client's reconnect logic can take over
  (`server.ts:229-251`).
- **Fresh stubs per request.** The `AuthenticatedApi` mints a fresh user-DO stub for every request
  so broken stubs never have to be detected (`server.ts:93-98`). A reset DO poisons every existing
  stub to it, so captured stubs are permanently broken; `retryOnDoReset()` retries a *replay-safe*
  call once through a thunk that mints its stub fresh, and `wrapDoStubForTelemetry()` surfaces reset
  rejections as telemetry without changing them
  (`packages/workshop-backend/src/do-retry.ts:27-31`, `84-109`).

## Gadget iframe sessions

A gadget's client code runs in a sandboxed iframe with no network access (CSP `connect-src 'none'`,
`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`; see
[the gadget iframe page](/openwiki/frontend/gadget-iframe.md)). To give it RPC anyway, the workshop
injects the entire Cap'n Web bundle *into the iframe as a doubly-nested data URL* — the outer code
is a data URL, and it `import`s Cap'n Web from an inner base64 data URL, because a sandboxed iframe
can load nothing else (`packages/workshop-frontend/src/GadgetUI.tsx:7-33`).

The injected prefix opens a `MessageChannel`, posts one port to the parent with a `"handshake"`
message, and builds the session with `newMessagePortRpcSession(port1)` (`GadgetUI.tsx:25-33`). The
parent answers by opening its own session on the other port with a *forwarding target* that exposes
the gadget's server-side capability (`GadgetUI.tsx:363-372`), obtained via
`GadgetClient.connectToGadget()` — which returns the gadget's running facet stub
(`packages/workshop-backend/src/overseer.ts:10841-10849`).

One mechanical caveat: facet stubs currently cannot cross RPC directly, so the overseer wraps the
facet `Fetcher` in a `Proxy` that makes it look like an `RpcTarget` — marked in the code as a hack
pending runtime support (`overseer.ts:4085-4099`).

## What this buys

Because the whole surface is one typed RPC API with generated validation:

- Gadgets are automatically agent-friendly — an agent can call the same `GadgetClient` API the UI
  uses, which is why the platform needs no per-app MCP server (`README.md:137-143`).
- Adding an API method is a single interface change in `workshop-shared` plus implementations on
  both sides; the validator keeps the wire contract honest (see
  [change guides](/openwiki/change-guides/common-tasks.md)).
