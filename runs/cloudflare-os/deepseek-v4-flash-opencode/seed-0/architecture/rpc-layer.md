---
type: subsystem
title: RPC layer and shared API
description: The Cap'n Web RPC layer connecting the SPA, workshop-backend, and gatekeepers — the PublicApi/AuthenticatedApi surface, the gatekeeper interface hierarchy, @validateRpc validation, promise pipelining, and stub lifecycle conventions.
tags: [rpc, capnweb, api, validation, stubs]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# RPC layer and shared API

All client–server and gatekeeper communication is **Cap'n Web RPC**: natural TypeScript interfaces
exposed over the network, with automatic runtime validation and an object-capability model. The
interface definitions live in `packages/workshop-shared` and are imported by both the frontend and
the backend, so the two can never drift.

## The public surface: `workshop-shared/src/api.ts`

`api.ts` defines the whole Workshop API. It is deliberately a "fat client" SPA: a persistent WebSocket
RPC session opened at startup and kept for the lifetime of the session (reconnecting as needed).

Two top-level interfaces:

- **`PublicApi`** (unauthenticated): `ping()`, `getServerConfig()` (boot-time deployment config with
  no secrets), `startGatekeeperLogin(vendorId)`, `authenticate(token)`,
  `authenticateFromCfAccess()`, `login()` / `createAccount()` (password), and the unauthenticated
  blueprint reads (`getBlueprint`, `downloadBlueprint` — "knowing the ID is sufficient").
- **`AuthenticatedApi`** (returned by `authenticate`): profile, AI models, cloudflare usage,
  avatars, gadget listing/creation/opening, connected accounts, blueprints, gatekeeper management
  apps, and the admin API. `openGadget(id, shareKey?, configureObservers?)` returns an `Overseer`
  stub that can be pipelined on immediately.

### Authentication flows

- **Password**: the client hashes the password with argon2id (salt = `SERVICE_SALT + username`,
  `api.ts:88-103`) and the server stores only an additional SHA-256 of that hash — the server never
  sees the raw password. Session tokens are returned as `"<username>:<token>"`.
- **Cloudflare Access**: `authenticateFromCfAccess()` trusts the verified `cf-access-jwt-assertion`
  header (`server.ts:842-855`, `access.ts`), keying the user by the JWT's verified email.
- **Gatekeeper sign-in**: `startGatekeeperLogin()` returns the gatekeeper's OAuth URL plus an
  `attempt` stub wrapping a transient `PendingLogin` Durable Object; `attempt.wait()` resolves with a
  session token once the popup completes. Auth configuration is env-var driven
  (`AUTH_GATEKEEPERS`, `DISABLE_PASSWORD_AUTH`); see the deployment page.

### Stable error codes

Expected failures carry stable machine-readable codes. `codedErrorFamily` (`api.ts:301-312`) builds
create/classify helpers per family; the per-code messages double as the classification fallback for
errors from older deployments that lost the code in transit. Examples: `OPEN_GADGET_ERROR_CODES`
(`WORKSPACE_NOT_FOUND`, `WORKSPACE_ACCESS_DENIED`) and `AUTH_ERROR_CODES`
(`INVALID_SESSION_TOKEN`, `NOT_AUTHENTICATED_WITH_ACCESS`).

### Shared validation helpers

`validateBindingName` (`api.ts:207-220`) is the one validator applied at every chokepoint that writes
a binding name (gadget binding edges, default binding lists, chat binding maps, spawner env configs,
agent tools). It requires a JS identifier that is not a reserved word and does not collide with
`Object.prototype` members or `prototype`, since binding maps are used as plain objects where such
names would collide with inherited members.

## The gatekeeper interfaces: `workshop-shared/src/gatekeeper.ts`

`gatekeeper.ts` defines the RPC contract between the Workshop and each gatekeeper (a separate Worker
bound via service binding). The three-tier hierarchy is `GatekeeperVendor` (a `WorkerEntrypoint`),
`GatekeeperUser` (a `WorkerEntrypoint` with `ctx.props`), and `Gatekeeper<Session>` (a DO facet of
the Overseer) — see the gatekeepers page for the full model. It also defines the `ApprovalQueue`,
`ObservationAuthorizer`, `HookController`/`HookInitiator`, the agent catalog caps
(`AGENT_CATALOG_MAX_*` and `boundAgentCatalog`), resource URL matching
(`matchesResourceUrlPattern`, `resolveRequestedResource`), and `GatekeeperUiFrame` for sandboxed
configurator/management iframes.

## How `/api` serves sessions: `server.ts`

The backend's fetch handler serves everything under `/api` through `newWorkersRpcResponse`
(`server.ts:887-931`), a clone of Cap'n Web's helper that supports both transports:

- **POST** — an HTTP batch RPC session (`newHttpBatchRpcResponse`), with
  `Access-Control-Allow-Origin: *` (the API is necessarily safe for cross-origin use because it uses
  in-band authorization);
- **`Upgrade: websocket`** — a WebSocket RPC session (`newWebSocketRpcSession`), extended with an
  `abortSignal` that disposes the session when the connection is lost.

Two connection-loss mechanisms are layered here: the WebSocket session is aborted when the
`abortSession` callback fires (e.g. when the overseer DO the user opened is lost, `server.ts:229-251`),
and in Cloudflare Access mode the JWT is verified once per request before the session is minted.

## Conventions every caller must follow

These are established in the codebase and documented in the repo's AGENTS.md and code comments:

- **`@validateRpc()`** — every RPC interface/implementation carries the annotation from
  `capnweb-validate`, which installs auto-generated runtime type validation matching the interface's
  TypeScript signatures. Do not write redundant validation. `@skipRpcValidation` is used only where a
  return value is an opaque stub (e.g. `createAccount` returning a `Fetcher`).
- **Promise pipelining** — a call that returns a stub need not be awaited: the promise itself can be
  used in place of the stub in later calls, and Cap'n Web replaces an argument promise with its
  resolution server-side. `openGadget` is designed for this (share-key redemption and opening in a
  single round trip; later calls pipelined on the returned Overseer).
- **Stub disposal** — RPC stubs must be disposed (`stub[Symbol.dispose]()`, or a `using`
  declaration) to avoid leaking server-side resources; React components that obtain a stub in a
  `useEffect` must dispose it in the cleanup function.
- **`useState` and stubs** — a `useState` value must never *be* a stub (the setter treats callables
  as updater functions); wrap the stub in an object and store that.
- **Subscriptions** — `subscribe*` methods take a subscriber stub and return a stub to dispose for
  cancellation (e.g. `subscribeConnectedAccounts` returns `RpcStub<{}>` whose disposal unsubscribes).
