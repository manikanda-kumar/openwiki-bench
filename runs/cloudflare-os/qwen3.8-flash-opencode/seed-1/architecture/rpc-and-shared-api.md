---
type: "Reference"
title: "RPC and Shared API"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-e5f80d32275819ea07f36351
    resource: repo://packages/gatekeeper-supabase/src/types.d.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---


# RPC and Shared API

The entire client-server contract lives in `packages/workshop-shared/src/api.ts` (client-facing
Workshop API) and `packages/workshop-shared/src/gatekeeper.ts` (Workshop↔Gatekeeper API). Both
sides consume the same TypeScript interfaces; at runtime the calls travel over Cap'n Web RPC
(packages/workshop-shared/src/api.ts#L13-L20).

## API layers

- **`PublicApi`** — the internet-facing root, obtained per WebSocket session: `ping()`,
  `getServerConfig()` (boot config, no secrets), `login`/`createAccount`,
  `authenticate(token)` / `authenticateFromCfAccess()` returning `AuthenticatedApi`,
  `startGatekeeperLogin(vendorId)` for OAuth sign-in, and *unauthenticated* blueprint reads
  (`getBlueprint`, `downloadBlueprint`) where "knowing the ID is sufficient"
  (packages/workshop-shared/src/api.ts#L49-L133).
- **`AuthenticatedApi`** — per-user surface: profile, password management, model configuration,
  connected accounts, workspace access, `openGadget()`, and `getAdminApi()` which returns `null`
  for non-admins (packages/workshop-shared/src/api.ts#L360-L430, L712).
- **`Overseer`** — per-workspace surface with gadgets, chats, code changes, subscriptions
  (packages/workshop-shared/src/api.ts#L1594+).

`startGatekeeperLogin` returns a `LoginAttempt` *stub*: holding it is the capability to receive the
resulting session token, and disposing it abandons the sign-in server-side
(packages/workshop-shared/src/api.ts#L35-L48).

**Passwords never touch the server**: the client computes an argon2id hash over
`SERVICE_SALT + username` (64 MiB memory, 3 iterations), sends the hash, and the server hashes it
further before storage (packages/workshop-shared/src/api.ts#L31-L33, L88-L110).

**Admin capability minting**: `AdminApi` methods do not re-check authorization — the admin check
happens once when the capability is minted, and auth *configuration* is deliberately absent from
it (packages/workshop-shared/src/api.ts#L921-L927).

## Session lifecycle

The SPA opens the RPC WebSocket to `/api` at startup and treats the connection as long-lived:
`startConnection()` creates a `newWebSocketRpcSession<PublicApi>` and registers
`stub.onRpcBroken(handleBroken)` (packages/workshop-frontend/src/main.tsx#L95-L101). Recovery is
deliberately probe-gated: reconnection uses jittered exponential backoff and only adopts a
candidate stub that answers a `ping()` round-trip, because "capnweb queues sends while a socket is
still CONNECTING, so an unproven stub looks fine right up until everything pipelined onto it fails
at once" (packages/workshop-frontend/src/main.tsx#L106-L135). The backend serves the same
`PublicApi` root over a WebSocket upgrade or a batched POST at `/api`, and can abort a session by
closing the socket (packages/workshop-backend/src/server.ts#L816, L857, L889-L913).

## Pipelining and disposal

Cap'n Web allows a promise for a returned stub to be used in later calls *without awaiting*
(promise pipelining); API docs call this out where it matters, e.g. Supabase's
`getDatabase(): Promise<SupabaseDatabase>` is documented as "a promise you can pipeline against
without awaiting … Dispose it when finished" (packages/gatekeeper-supabase/src/types.d.ts#L115-L121).
Because every stub is callable at runtime, React state that holds one wraps it in an object —
the app's RPC context stores `{ stub, connectionLost }` precisely "to avoid React's
callable-state-setter issue" (packages/workshop-frontend/src/RpcContext.tsx#L5-L9), and `useAuth`
keeps the `AuthenticatedApi` stub inside a state object plus a ref so cleanup functions never see
a stale closure (packages/workshop-frontend/src/useAuth.ts#L17-L29). `useAuth` also illustrates
pipelining in anger: `whoami()` is called against the (possibly still-connecting) stub without
awaiting the session handshake, and identity is dropped when the stub is replaced because
"capnweb does not guarantee that disposing a stub rejects calls already in flight"
(packages/workshop-frontend/src/useAuth.ts#L31-L40). Server-side code disposes client-supplied and
self-made stubs too (e.g. `gadget[Symbol.dispose]()` after resolving export formats,
packages/workshop-backend/src/overseer.ts#L4224-L4227).

Subscriptions follow one idiom throughout `api.ts`: pass a callback/subscriber stub, and dispose
the returned `RpcStub` to cancel (e.g. `subscribeToMetadata`, `subscribeToWorkpieces`,
packages/workshop-shared/src/api.ts#L1598-L1612, L1634-L1641). Streaming cursors are RPC objects
whose `next()` is called repeatedly on the same object, exhausted by `null`, and disposed when
done (packages/workshop-shared/src/gatekeeper.ts#L20-L34).

## Runtime validation

Every RPC implementation class is decorated `@validateRpc()` (from `capnweb-validate`), which
installs auto-generated runtime type validation matching the interface's TypeScript signatures —
so hand-written re-checks of wire shape are redundant
(packages/workshop-backend/src/server.ts#L2, L75; gatekeeper example at
packages/gatekeeper-github/src/github.ts#L809). Methods whose arguments are opaque values (e.g.
`getVerifier` returning a raw service Fetcher) opt out per-method with `@skipRpcValidation()`
(packages/gatekeeper-cloudflare/src/cloudflare.ts#L472-L475). Client-supplied code changes
additionally pass semantic validation *on top* of the wire check, since the generated validator
covers structure only (packages/workshop-shared/src/code-change.ts#L26-L38).

## Coded errors

Expected failures are thrown as coded errors from shared families so clients can branch without
string matching: `codedErrorFamily` builds the `OPEN_GADGET_ERROR_CODES` (e.g. gadget deleted, no
access) and `AUTH_ERROR_CODES` families with `create*Error`/`get*ErrorCode` helpers
(packages/workshop-shared/src/api.ts#L301-L357).

## Change discipline

This API is the kernel's public surface: every exported member needs a doc comment, and
hand-written mirrors of RPC interfaces with `as unknown as` casts are rejected — see
[How to Change the Shared RPC API](../guides/changing-the-shared-api.md).
