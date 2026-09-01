---
type: component
title: Backend server entrypoints, sessions, and auth
description: workshop-backend's fetch handler and RPC shells — PublicApi/AuthenticatedApi/AdminApi, session tokens, the three auth modes (password, Cloudflare Access, gatekeeper sign-in with PendingLogin), and the notifyClosed lost-DO detection.
tags: [backend, auth, sessions, rpc, sign-in]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Backend server entrypoints, sessions, and auth

`packages/workshop-backend/src/server.ts` is the deployable entrypoint. Its `fetch` handler serves
the site logo and blueprint screenshots as plain HTTP, `POST /api/client-errors` (frontend error
reports), and the RPC surface at `/api` (transport details in
[the RPC page](/openwiki/architecture/rpc-protocol.md)). When `CF_ACCESS_AUD` is configured, API
requests must pass a Cloudflare Access JWT check *and* a same-origin check on `Origin`
(`server.ts:840-855`).

## The RPC shells

- **`PublicApiImpl`** — the unauthenticated surface: `ping`, `getServerConfig`,
  `startGatekeeperLogin`, `authenticate`, `authenticateFromCfAccess`, `login`, `createAccount`,
  blueprint reads (`server.ts:75`, `624-792`).
- **`AuthenticatedApiImpl`** — minted by `authenticate()` after the session token checks out. It
  holds the user's `DurableObjectId` and mints a **fresh user-DO stub per request** (`#user`) so
  broken stubs never need detection; pure-read delegations retry once across a DO reset via
  `retryOnDoReset` while writes never do (a reset can't distinguish "never applied" from "applied,
  response lost") (`server.ts:93-121`).
- **`AdminApiImpl`** — returned by `getAdminApi()` **only after `#isAdmin()`** (the `ADMINS` env
  binding, JSON array or parseable string, checked against the user's DO name); the individual
  methods need no per-call re-check because the capability is minted once
  (`server.ts:100-117`, `592-600`).

Some data deliberately bypasses the user DO: avatars live in the global `AVATARS` KV namespace so
reads don't pay DO latency, validated as JPEG/PNG by magic bytes and capped at 100 KB
(`server.ts:173-198`).

## Session tokens

A session token is `"<doName>:<secret>"`. The user DO stores only `SHA-256(secret)` as the record
key; `authenticate()` splits the token, routes by `idFromName` of the first part, and lets the DO
verify (`server.ts:684-692`; `user.ts:304-352`). For password login the browser derives an
argon2id hash with the public `SERVICE_SALT` + username (`api.ts:88-107`), and the server stores a
further SHA-256 of it — the server never sees the plaintext password and the expensive hash runs
client-side. Gatekeeper sign-in keys accounts by verified email, so its token prefix is the email
(`login-flow.ts:129-131`).

## The three auth modes

Configuration is **env-var driven** in `auth/config.ts` and deliberately **not** part of
`AdminConfig`, so a compromised admin session cannot change it: `AUTH_GATEKEEPERS` is the
comma-separated allowlist of vendors that may drive sign-in (a vendor must also advertise
`providesAuth`), and `DISABLE_PASSWORD_AUTH=true` hides username/password only when the allowlist
is non-empty — otherwise password auth stays on to avoid lockout (`REVIEW.md:33-35`;
`auth/config.ts:14-30`).

1. **Password (default)** — `PublicApi.login`/`createAccount` delegate to the user DO.
2. **Cloudflare Access** — with `CF_ACCESS_AUD`/`CF_ACCESS_ISS` set, the backend verifies the
   `cf-access-jwt-assertion` header against the team's JWKS (issuer + audience checked), and
   `authenticateFromCfAccess()` resolves/creates the email-keyed user DO, honoring the deployment's
   `signupsEnabled` toggle (`access.ts:14-45`; `user.ts:326-342`).
3. **Gatekeeper sign-in** — `startGatekeeperLogin(vendorId)` checks the allowlist and
   `providesAuth`, then creates a **`PendingLogin` DO** (random id, no durable storage) and hands
   the gatekeeper a `LoginConnectCallbackImpl`; the client gets `{url, attempt}` where `attempt` is
   a capability stub wrapping the DO — the client never sees a guessable id
   (`server.ts:636-655`; `login-flow.ts:8-20`). The browser opens the gatekeeper's self-closing
   OAuth popup and awaits `attempt.wait()`; when the gatekeeper calls `complete(user)`, the
   callback reads the verified email, resolves/creates the email-keyed user DO (blocking first-time
   creation when signups are closed), mints a session, and delivers `"<email>:<secret>"` to the
   PendingLogin, which resolves the awaiting RPC (`login-flow.ts:92-144`).

The PendingLogin holds **no durable storage**: the in-flight `awaitResult()` keeps it alive, and an
abandoned attempt is simply evicted when the client disposes the `attempt` stub
(`login-flow.ts:32-38`). Sign-in itself never persists a connected account — except Cloudflare,
where sign-in doubles as the billing-only connection (`linkConnectedAccountFromLogin`)
(`login-flow.ts:123-128`). The callback's `credentialsExpired`/`credentialsRestored` are no-ops
because the transient grant has nothing persisted to update (`login-flow.ts:146-154`).

Closing signups (`AdminConfig.signupsEnabled`) blocks first-time creation on *this* path too — it
is an access toggle, not auth config (`login-flow.ts:112-114`).

## Lost-DO detection: `notifyClosed`

`#openGadgetInternal` passes a `notifyClosed` callback into `OverseerDurableObject.open()`. The
overseer holds a dup; the server sets `started = true` once `open()` resolves. If the stub is
**disposed without being called** — which is what happens when the connection to the workspace DO
dies — the server calls `abortSession`, killing the browser WebSocket so the client's reconnect
logic recovers (`server.ts:229-264`). The comment chain records the intent: implement
`onRpcBroken()` natively, and eventually reconnect to one DO without resetting the whole socket.
