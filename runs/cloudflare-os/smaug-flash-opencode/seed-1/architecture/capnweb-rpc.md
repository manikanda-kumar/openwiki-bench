---
type: "Reference"
title: "Cap'n Web RPC Contract"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---


# Cap'n Web RPC Contract

Every boundary in Cloudflare OS between a client and a server — and between Workers — is an RPC
interface written in plain TypeScript and transported by **Cap'n Web** (`capnweb`). This page
describes those contracts and the conventions that govern them: the three top-level client-facing
surfaces in `packages/workshop-shared/src/api.ts`, the gatekeeper interfaces in
`packages/workshop-shared/src/gatekeeper.ts`, and the runtime rules (promise pipelining, stub
disposal, `@validateRpc`) every RPC caller and implementer must follow.

## Why RPC and why a persistent session

The API between the Gadgets Workshop service and the front-end UI is "a good old fat client SPA"
that speaks RPC over a **WebSocket** the client starts at startup and keeps open for the lifetime of
the session, reconnecting as needed. The design notes in `api.ts` give the rationale: an SPA avoids
alternative-client friction holsteins, and — decisively — Gadgets themselves are sandboxed on the
client side, which requires running code in the browser and is not plausible to server-side render. A
single clean RPC boundary also makes it easy to build alternative clients
(`packages/workshop-shared/src/api.ts`). The RPC interface uses Cloudflare's JavaScript RPC, which
exposes natural JavaScript/TypeScript interfaces over the network.

Gadgets run inside a sandboxed iframe that cannot talk to the outside world except via
`postMessage()` to the parent frame. Through those `postMessage()` exchanges, the Gadget speaks RPC
to the Workshop, which among other things hands the Gadget a stub pointing at its server-side Durable
Object interface.

## The three client-facing RPC surfaces

`packages/workshop-shared/src/api.ts` declares the API between the Workshop service and the front-end.
It is divided into three top-level `RpcTarget` interfaces by lifecycle and privilege:

### `PublicApi`

The unauthenticated entrypoint, served by `PublicApiImpl` in
`packages/workshop-backend/src/server.ts`. It is the object bound as `localMain` in
`newWorkersRpcResponse`, so the very first RPC call on a session is always here. It provides:

- `ping()` — a round-trip health check.
- `getServerConfig()` — boot-time deployment config (auth mode, sign-in vendors, limits flags,
  banners). Contains no secrets.
- Authentication: `startGatekeeperLogin(vendorId)`, `authenticate(token)`,
  `authenticateFromCfAccess()`, `login(username, passwordHash)`, `createAccount(...)`.
- Public blueprint metadata: `getBlueprint(id)` and `downloadBlueprint(id)`.

`startGatekeeperLogin` returns a `{ url, attempt }` pair where `url` is the OAuth popup to open and
`attempt` is an `RpcStub<LoginAttempt>` — a capability that lets the client await the login result.
The stub wraps a `PendingLogin` Durable Object; its id is never exposed to the client
(`server.ts`). Disposing the `attempt` stub abandons the sign-in.

### `AuthenticatedApi`

Returned by `authenticate()`/`authenticateFromCfAccess()`/`login()`, this is the whole user-facing
surface after login. It covers profile, AI models, connected accounts, blueprints, admin, and the
`openGadget()`/`newGadget()` entrypoints that mint an `Overseer` capability. A few notable members:

- `openGadget(id, shareKey?, configureObservers?)` opens a workspace, optionally redeeming a share
  key in the same round trip)Skip, and returns an `Overseer` stub. Designed to be pipeline-friendly.
- `subscribeConnectedAccounts(subscriber, filter?)` uses a subscriber `RpcStub` and a returned
  unsubscriber stub (see subscription pattern below).
- `getAdminApi()` mints an `AdminApi` capability only if the caller is a deployment admin; the
  `#isAdmin()` check happens once at mint time.

### `Overseer`

The per-workspace capability returned by `openGadget`. It is the second big surface in `api.ts` and
mixes workspace-level concerns — the gadget registry, committed code (git), per-chat uncommitted
changes (a revisioned change stream over commits), chats, actions/hooks, sharing, and blueprints —
with per-gadget operations delivered through the `GadgetClient` sub-capability (`getGadget`).
Subscriptions here include `subscribeToMetadata`, `subscribeToPresence`, `subscribeToWorkpieces`,
`subscribeToActions`, `subscribeToChat`, and `subscribeToConsoleLogs`.

The Overseer also is where the **action/approval model** is surfaced to the user:
`listActions`/`approveAction`/`rejectAction`, `listHooks`/`enableHook`/`disableHook`/`deleteHook`, and
the auto-approval rule API (`setAutoApprovedActionKind`, `removeAutoApprovedActionKind`,
`listAutoApprovedActionKinds`, `listPreApprovableActions`).

## Mandatory conventions for RPC code

The repository-wide conventions for writing RPC are stated in `AGENTS.md` and must be respected in
every caller and implementer:

- **Promise pipelining.** Cap'n Web uses it extensively. When an RPC returns a stub, you need not
  await the RPC before using the stub — the promise can be used in place of the stub. Also, a promise
  for a future result can be passed as an argument to another call; the promise resolves on the
  server side before delivering the arguments. This is why `openGadget` and `newGadgetFromBlueprint`
  return stubs that can be called immediately.
- **State cannot hold a naked stub.** In React, `useState()` calls the setter with any callable —
  and RPC stubs are callable — so a state value meant to hold an `RpcStub` must be wrapped in an
  object.
- **Dispose stubs.** RPC stubs must be disposed to prevent server-side resource leaks. Call
  `stub[Symbol.dispose]()` when finished, or use a `using` declaration. In a React `useEffect`, the
  cleanup function should dispose the stub.
- **`@validateRpc()` on every interface.** All RPC interfaces should carry the `@validateRpc()`
  decorator from `capnweb-validate`, which installs auto-generated runtime type validation matching
  the interface's TypeScript signatures. Do not write redundant validation code that duplicates the
  checks it covers.
- **Subscriptions return a disposable stub.** The subscribed-api pattern throughout `api.ts` is:
  pass an `RpcStub` subscriber (an `RpcTarget` callback object you implement), and the method returns
  an `RpcStub<{}>` whose disposal cancels the subscription — e.g.
  `subscribeConnectedAccounts` returning `Promise<RpcStub<{}>>`.

## Session transport: WebSocket + HTTP batch

`packages/workshop-backend/src/server.ts` implements its own fetcher that exposes the same `PublicApi`
over both transport flavors:

- `POST /api` yields an HTTP **batch** RPC response, with
  `Access-Control-Allow-Origin: *` set because WebSocket already allows cross-origin.
- A `Upgrade: websocket` request yields a raw WebSocket RPC session.

Both are produced by a local clone of Cap'n Web's `newWorkersRpcResponse`, extending the session
options with an `abortSignal`. The `abortSession` callback closes the WebSocket when a DO connection
is lost (`stub[Symbol.dispose]()` on abort). The router (`packages/router/src/index.ts`) forwards
`/api` and `/api/*` to the backend.

## The gatekeeper contracts

`packages/workshop-shared/src/gatekeeper.ts` defines the RPC interface between the Workshop and
each gatekeeper (a separate Worker), accessible to the Workshop itself — not to Gadgets or agents.
The root interface is `GatekeeperVendor`, implemented by the service binding that is scanned from
`GATEKEEPER_*` env keys.

### `GatekeeperVendor` and `GatekeeperUser`

The three-tier hierarchy:

- **`GatekeeperVendor`** (a `WorkerEntrypoint`) — one per service. `describe()`, `connectAccount()`,
  `getSupportedResources()`, `getTypeScriptTypes()`, and optionally `createAccount()` for
  auto-provisioning gatekeepers.
- **`GatekeeperUser`** (a `WorkerEntrypoint`) — a human user's authenticated connection.
  `describe()`, `getGatekeeperClassFor(url)`, `startResourceConfigurator`, `revoke()`, `reconnect()`,
  `getAuthenticatedEmail()`, `getVerifier()`, `ensureResources()`, and the optional singleton/UI
  methods `getSingletonGatekeeperClass()` / `startAppUi()`.
- **`Gatekeeper<Session>`** (a DO facet of the Overseer) — per-resource, per-Gadget binding.

`GatekeeperConnectCallback` is the `Fetcher` the Workshop provides to `connectAccount` so the
gatekeeper can notify the Workshop that the flow completed (`complete`), that credentials expired
(`credentialsExpired`), or were restored (`credentialsRestored`).

### The approval queue and observations

Two interfaces encode the security model:

- **`ApprovalQueue`** extends `ObservationAuthorizer`. `authorizeObservation(description)` authorizes
  a read and must be awaited before returning data; `submitAction(action, description)` queues a
  side-effecting action asynchronously; `bindHook(...)` registers a persistent callback hook.
- **`Gatekeeper<Session>.startSession(approvalQueue)`** yields a `Session` capability. Every
  operation through a session must go through the queue: observations authorized before data is
  returned, actions not actually performed until approved disjoint.

Actions and observations are described by `ActionDescription` and `ObservationDescription`, which
carry policy hints: `ActionKind` (stable tag + label keyed by auto-approval rules), `autoApprovable`,
`implementsRevert`, `awaitDecision`, and — on the observation side — `prohibitAllSharing` and
`excludeObservers`.

When action review has been delegated to the model, the server calls back into the bound gatekeeper
via `applyAction(action)` (apply side effects), `rejectAction(action)` (clean up), and
`revertAction(action)` (attempt to reverse an applied action).

## Bounded discovery metadata

A gatekeeper can expose a bounded **agent catalog** through `getAgentCatalog(authorizer)`: a list of
`AgentCatalogEntry` items the agent uses to discover what is reachable through a session before
reading everything. This is untrusted data injected into the agent's context, so it is size-capped by
`AGENT_CATALOG_MAX_ENTRIES` (1000) and per-field length caps, applied via `boundAgentCatalog()`
(`gatekeeper.ts`). Catalogs are also an observation: the implementation must call `authorizeObservation`
before returning metadata.
