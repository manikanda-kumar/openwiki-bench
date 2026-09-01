---
type: frontend-spa
title: "Frontend SPA and Connection Lifecycle"
description: The workshop-frontend single-page app — global WebSocket connection management with jittered backoff, probes, and a promise-backed stub replacement; the React context tree; file-based routing; and the conventions that keep RPC stubs safe in React state.
tags: [frontend, react, websocket, routing, capnweb]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-0440c9f801eb67b38e853dcf
    resource: repo://packages/workshop-frontend/src/router.tsx
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Frontend SPA and Connection Lifecycle

The frontend is a pure client-side React SPA. The shared API header records why: users keep it open often (cached assets, startup time less critical), gadget sandboxing requires client-side execution, a clean API boundary invites alternative clients, and it is simply easier to reason about (packages/workshop-shared/src/api.ts:1-12).

## Connection management lives outside React

WebSocket connection management is deliberately **pulled out of React effects into module-level globals**, because StrictMode's double-invoke in dev would create and instantly discard redundant connections, and disconnect handling could end up with two connections fighting to replace each other (packages/workshop-frontend/src/main.tsx:47-70). Subscribers (a plain `Set` of callbacks) are notified whenever the stub or connection state changes; `AppWithConnection` registers one and mirrors the state into React (packages/workshop-frontend/src/main.tsx:68-70, 188-223).

The reconnect machinery (packages/workshop-frontend/src/main.tsx:60-136):

- Backoff starts at **1 s and doubles to a 10 s cap**, with jitter (`0.85 + 0.3 * Math.random()`) against reconnect stampedes; the *first* backoff is skipped when the dying connection had been up a while — fast recovery from one-off blips.
- Each candidate must answer a `ping()` **probe within 20 s** before it is trusted. Cap'n Web queues sends while a socket is still CONNECTING, so an unproven stub "looks fine" right up until everything pipelined onto it fails at once — hence only a proven connection is ever published.
- On break, `handleBroken` publishes a **`RpcPromise` wrapping the reconnect future** rather than a stub: the dead stub stops being reachable immediately, and calls pipelined onto the unresolved promise are delivered in order once it resolves — work issued during the outage waits for the replacement instead of failing (packages/workshop-frontend/src/main.tsx:138-153).
- **Passive close detection misses sockets killed during laptop sleep or tab throttling**, so `visibilitychange`/`online` events trigger a wake probe (10 s timeout, only when idle ≥15 s since the last proof); a failed probe disposes the suspect stub, which fires the same recovery path with its skip-first-backoff behavior (packages/workshop-frontend/src/main.tsx:155-179).

## Context tree

`AppWithConnection` renders the provider tree: `ThemeProvider` → `RpcContext` (the `{stub, connectionLost}` pair — note the stub is **wrapped in an object exactly because React's state setter would call a function-typed value**, and an RPC stub looks callable) → `ServerConfigErrorContext` → `ServerConfigContext` → the announcement banner and router (packages/workshop-frontend/src/main.tsx:252-268, packages/workshop-frontend/src/RpcContext.tsx:5-15).

`getServerConfig()` is re-fetched whenever the (re)connected stub changes, so a server restart with changed deployment config is picked up; the fetched accent color and site logo/favicon are applied at runtime (packages/workshop-frontend/src/main.tsx:225-250).

## Routing

Routing is **TanStack Router with file-based routes** in `src/routes/` (a legacy `router.tsx` is kept for reference only): home, workspaces, workspace `$id`, outputs, blueprints and blueprint `$id`, explore, admin, profile, signup, gatekeepers and `gatekeepers_.$appId`, and a `providers` route (packages/workshop-frontend/src/router.tsx:1-8, packages/workshop-frontend/src/routes/).

Auth state flows through `useAuth(publicApi)` (packages/workshop-frontend/src/useAuth.ts:17-28): it stores the token in `localStorage` under `authToken`, authenticates on mount (or via `authenticateFromCfAccess` when built with `VITE_CF_ACCESS_MODE=true`), and keeps the resulting `AuthenticatedApi` stub in state — **wrapped in the `AuthState` object, not stored bare**, and tracked in a ref for cleanup-time disposal. Dev auto-login (`VITE_DEV_AUTO_LOGIN=true`) runs before React renders so the login page is skipped entirely, and runs in the background so an unreachable backend still renders instead of hanging (packages/workshop-frontend/src/main.tsx:17-45, 276-281).

## Error surface

The root is wrapped in `FrontendErrorBoundary`, and React's `onUncaughtError` reports through the opt-in frontend error-reporting pipeline (`reportIssue('workshop.react-root', …, {handled: false, severity: 'fatal'})`) (packages/workshop-frontend/src/main.tsx:270-287; see [Observability, Logging, and Error Reporting](/openwiki/operations/observability.md)).

## Related pages

- [Cap'n Web RPC Protocol and API Surface](/openwiki/architecture/rpc-protocol.md) — the protocol and stub conventions.
- [Gadget Sandbox and Client Integration](/openwiki/frontend/gadget-sandbox.md) — how gadget UIs embed.
- [Authentication and Sign-In](/openwiki/architecture/authentication.md) — the login paths the SPA drives.
