---
type: security
title: Authentication and Sign-in
description: The three sign-in paths (username/password with client-side argon2id, OAuth via authentication gatekeepers, Cloudflare Access), the verified-email identity invariant, the session token design, and why authentication configuration is env-driven and never admin-editable.
tags: [auth, passwords, oauth, sessions, argon2id, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-ca45e791592e9cf3a1e0fbad
    resource: repo://packages/workshop-backend/src/deployment-config.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-6228b9f416e46b02e20c611f
    resource: repo://packages/workshop-frontend/src/passwordHash.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Authentication and Sign-in

Accounts and sessions live in `UserDurableObject`; the RPC root decides *how* a caller proves who they are. Three paths coexist, additive by design (docs/oauth-signin.md).

## Identity is one DO keyed by a normalized name

A user account *is* `UserDurableObject.idFromName(name)` where `name` is a normalized username (`normalizeUsername`: lowercase, `^[a-z][a-z0-9_]*$`) or, for SSO paths, the **verified email** (packages/workshop-backend/src/user.ts:1765-1773; packages/workshop-backend/src/server.ts:684-712). The invariant from docs/oauth-signin.md holds in the source: every auth-capable gatekeeper must return *only* a provider-verified email — Google's `email_verified`, GitHub's primary+verified, the Cloudflare account email — because "signing in with any allowlisted gatekeeper that yields the same verified email resolves to the same account"; an unverified identity would let one email address fork (or hijack) accounts. Cloudflare Access resolves the same way (server.ts:696-718).

## Password login: the server never sees the password

The client computes `passwordHash = argon2id(password, salt = SERVICE_SALT || utf8(username), parallelism 1, iterations 3, 64 MiB, 32 bytes)` — the salt mixes in a deployment-unique constant so a stolen hash is not portable across instances, and the expensive hash runs on the user's machine (packages/workshop-frontend/src/passwordHash.ts:13-32; parameters spec'd on the `login()` doc at packages/workshop-shared/src/api.ts:86-105). The server stores one more SHA-256 round (`passwordHashHash`) so the stored verifier is not the login credential itself, compares with a constant-time `bytesEqual`, and a null `passwordHashHash` marks accounts with *no* password path (SSO-created users) (packages/workshop-backend/src/user.ts:345-368, 431-448, 220-223). Successful login/signup mints a session (below); signup can be disabled via `AdminConfig.signupsEnabled`, checked on the server in `createAccount`, the CF Access path, and the gatekeeper callback (packages/workshop-backend/src/server.ts:744-760; user.ts:326-334, 416-424; auth/login-flow.ts:112-115).

## Sessions

`#newSessionToken` returns 32 random bytes base64; the user DO stores only `SHA-256(token)` as the `sessions` row key. The browser persists `"<username>:<token>"` in localStorage and `PublicApi.authenticate` re-mints an `AuthenticatedApi` per WebSocket session — a stolen row dump yields no usable token, and the DO check is O(1) (packages/workshop-backend/src/user.ts:303-323, 339-352; packages/workshop-backend/src/server.ts:680-694). `changePassword` requires the old hash and re-runs the same scheme; `hasPasswordLogin` reports availability (user.ts:428-448).

## Sign-in via authentication gatekeepers

Enabled per deployment by the `AUTH_GATEKEEPERS` allowlist (comma-separated vendor ids; order = button order); an off-by-default additive feature — with an empty allowlist the workshop behaves as pure password/Access (packages/workshop-backend/src/auth/config.ts:1-22). `DISABLE_PASSWORD_AUTH=true` hides the password form **only when the allowlist is non-empty**, so a bad config can't lock everyone out (auth/config.ts:24-31).

The flow (docs/oauth-signin.md §"Sign-in flow", verified against source):

1. Client: `PublicApi.startGatekeeperLogin(vendorId)` — rejects vendors not allowlisted, unbound, or lacking `providesAuth` (packages/workshop-backend/src/server.ts:652-663).
2. The backend creates a random-id `PendingLogin` DO and hands the vendor `connectAccount(LoginConnectCallbackImpl, opts)` — with `{scopes: "auth"}` (transient email-only grant) for most vendors, *except Cloudflare*, which connects sign-in with billing scopes persisted because Cloudflare sign-in doubles as the AI-Gateway-billing link (server.ts:666-673; docs/oauth-signin.md:64-66).
3. The client opens the returned URL in a popup (the gatekeeper's self-closing OAuth window at `/gatekeeper/<name>/oauth` — the router owns that prefix; the backend hosts no auth callbacks) and calls `attempt.wait()`, blocked on the PendingLogin DO. The `LoginAttempt` stub is the client's capability to await the result; **no login id is ever exposed** (packages/workshop-shared/src/api.ts:39-47; packages/workshop-backend/src/server.ts:619-634).
4. The callback (`LoginConnectCallbackImpl.complete`) reads `getAuthenticatedEmail()`; null email → fail with "no verified email, can't sign in". Otherwise the email-keyed user DO runs `loginOrCreateViaGatekeeper(email, signupsEnabled)`; the returned token is delivered to `PendingLogin`, resolving `wait()`. Display name seeds from the email's local-part **only on first sign-in** — later logins never clobber a name the user changed (packages/workshop-backend/src/auth/login-flow.ts:93-140; user.ts:402-431).

Crucially, **sign-in does not persist a connected account**: the minimal-scope grant self-destructs after the email read; capability use (repos, docs, billing) requires the user to *connect* the gatekeeper afterward (`connectAccount(vendorId)` with full scopes — enforced through the same admin-disabled chokepoint as any connection) (docs/oauth-signin.md:22-28, 40-42). `PendingLogin` holds no durable storage — the in-flight wait keeps it alive, abandonment just evicts it (auth/login-flow.ts:27-40).

The auth-vendor discovery helper `getAuthVendors` parallelizes the per-vendor `describe()` RPCs but *skips* any vendor without a binding, without `providesAuth`, or whose describe() throws, preserving allowlist order for button order (packages/workshop-backend/src/deployment-config.ts:12-37; packages/workshop-backend/src/auth/auth-vendors.ts).

## Cloudflare Access mode

Setting `CF_ACCESS_AUD` (+`CF_ACCESS_ISS`) moves authentication in front of the app: the fetch root rejects cross-origin API requests, verifies the `cf-access-jwt-assertion` JWT against the team's remote JWKS (cached per issuer), and *requires* an email claim before `authenticateFromCfAccess()` maps it to the email-keyed user — creating the account on first use when signups are open (packages/workshop-backend/src/server.ts:838-856, 696-718; packages/workshop-backend/src/access.ts:8-41). In this mode `login`/`createAccount` throw outright (server.ts:722-725, 746-750), and the frontend takes an automatic Access path (`VITE_CF_ACCESS_MODE`, packages/workshop-frontend/src/useAuth.ts:6, 59-87). Access claims also give a privacy-preserving rate-limit key (`sub`, else a SHA-256 of the email) used by client-error rate limiting (access.ts:43-48).

## Why auth config is env-driven, deliberately

Deployment-admin panel config (`AdminConfig`) owns soft things — including `signupsEnabled`, explicitly labeled an *access toggle*. Which providers exist and whether passwords work are **not** in it: `admin-config.ts`'s header and `auth/config.ts` keep auth in env vars "so it can't be changed by a compromised admin session" — an admin token leak can narrow who joins, never redirect who is trusted (packages/workshop-backend/src/admin-config.ts:1-19; auth/config.ts:1-7; see [Configuration and Admin Settings](/openwiki/operations/configuration-and-admin.md)).

## Failure behavior and residual risk

- Bad tokens classify as `AUTH_ERROR_CODES.invalidSessionToken` even when non-base64 (the decoder's SyntaxError is deliberately laundered into the auth failure) (user.ts:304-313).
- Failed logins create nothing: usernames are normalized *before* DO addressing, so case/typo probes don't mint DOs; account existence is only revealed through the null/non-null of `login`/`createAccount`.
- The gatekeeper login callback logs outcomes (`no_email`, `signups_disabled`) without ever logging emails as fields beyond the user DO addressing itself.
- What this page does *not* establish: session *revocation* semantics (no logout RPC surfaced in the paths above), and password rotation propagation to open sessions.
