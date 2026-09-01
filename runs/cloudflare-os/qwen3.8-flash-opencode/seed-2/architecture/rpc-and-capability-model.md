---
type: architecture
title: RPC and Capability Model
description: How the Workshop's Cap'n Web RPC works end to end — the single WebSocket session, in-band authentication, capability handoffs, stub lifecycle rules, runtime validation, and persistent stubs.
tags: [rpc, capnweb, capabilities, security, websocket]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# RPC and Capability Model

All client/server communication is Cap'n Web RPC — an object-capability protocol resembling Cloudflare's Worker-to-Worker RPC that also runs in a browser over WebSocket. This page covers the transport and lifecycle rules; the concrete interface surface lives in `packages/workshop-shared/src/api.ts` and is examined in the guide [How to Change the RPC API](../guides/changing-the-rpc-api.md).

## One session per tab

The frontend opens exactly one WebSocket RPC session to `wss(s)://<host>/api` at boot and treats it as the global root stub (`PublicApi`) (packages/workshop-frontend/src/main.tsx#L96-L101). The backend serves the same `PublicApiImpl` root over either protocol at `/api`: `POST` yields an HTTP batch response (explicitly allowed cross-origin, because authorization is *in-band* — carried inside the RPC calls — so the API is safe over WebSocket anyway), while a WebSocket upgrade yields a persistent session (packages/workshop-backend/src/server.ts#L887-L902).

## Authentication is in-band and token-derived

`PublicApi.authenticate(token)` returns an `AuthenticatedApi` — the capability for everything user-scoped (packages/workshop-shared/src/api.ts#L49-L136, #L360). The session token is a 32-byte random value; the User Durable Object stores only its SHA-256 hash, so a leaked DO storage does not yield usable tokens, and the client keeps the token in `localStorage` (packages/workshop-backend/src/user.ts#L304-L319, #L344-L352; packages/workshop-frontend/src/useAuth.ts#L60-L66). Sign-in via an auth gatekeeper likewise hands the client a `LoginAttempt` *stub* rather than a guessable login id — the result arrives through the capability, and disposing the stub cancels the wait (packages/workshop-backend/src/server.ts#L620-L633). The admin check happens once when `getAdminApi()` mints the capability; individual `AdminApi` methods do not re-check (packages/workshop-backend/src/server.ts#L592-L600).

Server-to-client pressure works the other way: the fetch handler passes an `abortSession` callback that closes the WebSocket (an `AbortSignal` wired into the Cap'n Web session options), used when e.g. the connection to a workspace Durable Object is lost — `openGadget()` detects this via a callback that gets disposed before the DO ever invokes it (packages/workshop-backend/src/server.ts#L229-L251, #L857-L864, #L915-L925).

## Resilience: replacement stubs and pipelining

Cap'n Web queues calls pipelined onto an unresolved `RpcPromise` and delivers them in order once it resolves. The frontend exploits this: when `onRpcBroken` fires, it immediately publishes `currentStub = new RpcPromise(reconnect())`, so calls issued during an outage wait for the proven replacement instead of failing against a dead socket, and React consumers see exactly two state changes per outage (packages/workshop-frontend/src/main.tsx#L137-L151). Reconnect uses jittered exponential backoff and adopts a candidate stub only after a `ping()` probe succeeds, because capnweb queues sends while the socket is still CONNECTING — an unproven stub "looks fine right up until everything pipelined onto it fails at once" (packages/workshop-frontend/src/main.tsx#L112-L135). A `ping()` probe also runs on tab-visible/online events to catch zombie sockets that passive close detection misses (packages/workshop-frontend/src/main.tsx#L154-L176).

Repo convention (AGENTS.md): wherever an RPC returns a stub, callers should pipeline onto the promise rather than awaiting it first, and cross-call sequencing is relied on by design — e.g. `subscribeToChat()` must be *initiated* before history reads so nothing is missed, without awaiting it (packages/workshop-shared/src/api.ts#L1859-L1913).

## Stub lifecycle: dispose, dup, onRpcBroken

Every `RpcStub` holds a server-side resource, so stubs must be disposed (`stub[Symbol.dispose]()` / `using`) once unreachable — the frontend disposes the previous `AuthenticatedApi` whenever a new one is set or the provider unmounts (packages/workshop-frontend/src/useAuth.ts#L25-L35, #L70-L85). Stubs received as RPC parameters are implicitly disposed at the end of the receiving method; to keep one (e.g. a subscription callback) the receiver must call `.dup()` and watch `onRpcBroken` to detect disconnect — the pattern the system prompt teaches gadget authors (packages/workshop-backend/src/agent.ts#L619-L633).

Two React-specific traps: state returned by `useState()` cannot itself be an RPC stub (a callable object is treated as an updater function), so stubs are wrapped in an object — `{stub, connectionLost}` (packages/workshop-frontend/src/main.tsx#L186-L192); and components obtaining a stub in a `useEffect` must dispose it in the cleanup (AGENTS.md).

## Runtime validation with @validateRpc

Interfaces in `workshop-shared` are type-only; the decorator `@validateRpc()` from `capnweb-validate` is applied to server-side *implementation* classes (e.g. `AuthenticatedApiImpl`, `PublicApiImpl`, `OverseerClientInterface`, gatekeeper classes) to auto-generate runtime type validation matching the TypeScript signatures — implementation code must not re-check what the decorator already covers (packages/workshop-backend/src/server.ts#L75-L76, #L635-L636; packages/workshop-backend/src/overseer.ts#L9053, #L10551-L10552).

Capability enforcement is also designed in at the type level: the reduced `use`-role view `UseOverseerInterface` `implements Overseer`, so every interface method is default-deny (throws `Unauthorized`) until a developer consciously allows it — adding a method to the interface fails compilation of the restricted view (packages/workshop-backend/src/overseer.ts#L10540-L10552).

## Persistent stubs (`ctx.restore` / `[restore]`)

<!-- openwiki: broken internal link [params] file "params" does not exist. Fix the href or restore the target, then delete this comment. -->
Hooks and other callbacks that fire in the distant future need RPC stubs that survive storage. The runtime mechanism: the target object implements a symbol-keyed `[restore](params)` method, and `ctx.restore(params)` produces a persistent stub that, when deserialized from Durable Object storage, re-invokes `[restore]` to recreate a live target (packages/workshop-shared/src/gatekeeper.ts#L1001-L1013). The Workshop additionally forges persistent stubs for gadget bindings inside one-off `executeCode` runs via a throwaway restore-forger dynamic worker that "pretends to be" the target gadget's facet (packages/workshop-backend/src/overseer.ts#L108-L131), and the backend stores irrevocable service-binding stubs, which is why the `allow_irrevocable_stub_storage` compatibility flag is enabled (packages/workshop-backend/wrangler.jsonc#L25).

## Failure-classified errors

Cross-cutting failure classes are distinguished by tagged error codes rather than message text: `OPEN_GADGET_ERROR_CODES` (workspace not found vs. access denied — a denial lets `AuthenticatedApi` prune the stale listing from the user's DO) and `AUTH_ERROR_CODES` for invalid session tokens (packages/workshop-backend/src/server.ts#L216-L227, #L256-L264; packages/workshop-backend/src/user.ts#L304-L319).
