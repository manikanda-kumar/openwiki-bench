---
type: subsystem
title: Authentication and User Accounts
description: How identity works in the Workshop — username/password with client-side argon2id hashing, session tokens, Cloudflare Access JWT verification, gatekeeper-provided sign-in via the PendingLogin rendezvous, signup controls, and admin determination.
tags: [auth, identity, durable-objects, oauth, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
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
  - id: openwiki-source-6228b9f416e46b02e20c611f
    resource: repo://packages/workshop-frontend/src/passwordHash.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Authentication and User Accounts

## Two configuration planes

Authentication configuration is deliberately env-var driven (`auth/config.ts`, `CF_ACCESS_AUD`/`CF_ACCESS_ISS`) rather than part of `AdminConfig`: soft deployment customizations live in the AdminSettings DO, but auth providers must not be changeable by a compromised admin session (AGENTS.md; packages/workshop-backend/src/auth/config.ts#L1-L6). The one auth-adjacent soft setting is `signupsEnabled`, read from `readAdminConfig(env)` at account-creation chokepoints (packages/workshop-backend/src/server.ts#L703, #L752).

Every account is a `UserDurableObject`, addressed by `idFromName(key)` where the key is either a **normalized username** (lowercase, `^[a-z][a-z0-9_]*$`, or the login is rejected) for password accounts, or the **verified email** for Cloudflare Access and gatekeeper sign-ins — so the same email always resolves to the same account regardless of which provider was used (packages/workshop-backend/src/user.ts#L1765-L1773, #L403-L431; docs/oauth-signin.md#L18-L26).

## Password login: client-side argon2id

For username/password deployments, the client never sends the password. It computes `argon2id(password, salt = SERVICE_SALT || utf8(username), parallelism 1, iterations 3, 64 MiB, 32-byte output)` — implemented in the frontend (packages/workshop-frontend/src/passwordHash.ts#L13-L32) and specified on the interface (packages/workshop-shared/src/api.ts#L77-L96). The server stores only the **SHA-256 of that hash** (`passwordHashHash`), so even a storage dump cannot recover the client-side verifier; login compares hashes and constant-time-checks equality (packages/workshop-backend/src/user.ts#L354-L367). `createAccount` refuses if the DO already exists (username collision → null) (packages/workshop-backend/src/user.ts#L369-L401; packages/workshop-backend/src/server.ts#L744-L771).

A successful login of any kind issues a session token: 32 random bytes returned to the client (stored in `localStorage`), while the DO persists only its SHA-256 hex as the session id (packages/workshop-backend/src/user.ts#L344-L352). The `authenticate(token)` call splits `"<key>:<secret>"`, re-derives the hash, and throws a tagged `AUTH_ERROR_CODES.invalidSessionToken` on any mismatch or corrupt encoding (packages/workshop-backend/src/server.ts#L680-L694; packages/workshop-backend/src/user.ts#L304-L319).

## Cloudflare Access mode

When `CF_ACCESS_AUD` is set, password login and signup throw unconditionally, cross-origin API access is refused, and every `/api` request must carry a `cf-access-jwt-assertion` header verified against the team's remote JWKS (`CF_ACCESS_ISS/cdn-cgi/access/certs`, cached per issuer); `authenticateFromCfAccess()` then keys the user by the verified email, creating the account on first use subject to `signupsEnabled` (packages/workshop-backend/src/server.ts#L696-L742, #L842-L855; packages/workshop-backend/src/access.ts#L1-L41). A JWT without an email claim is rejected outright (packages/workshop-backend/src/server.ts#L850-L853).

## Gatekeeper sign-in (additive)

Auth-capable gatekeepers (advertising `providesAuth`) can also drive sign-in. The deployment allowlists vendor ids via `AUTH_GATEKEEPERS` (comma-separated); each listed vendor must actually be bound (`GATEKEEPER_<NAME>`) and advertise auth, or `startGatekeeperLogin` throws (packages/workshop-backend/src/auth/config.ts#L8-L24; packages/workshop-backend/src/server.ts#L652-L659). `DISABLE_PASSWORD_AUTH=true` hides the password form entirely — but is *ignored* when the allowlist is empty, an explicit anti-lockout rule (packages/workshop-backend/src/auth/config.ts#L26-L33).

The rendezvous (packages/workshop-backend/src/auth/login-flow.ts#L1-L20):

1. `PublicApi.startGatekeeperLogin(vendorId)` creates a random-id `PendingLogin` DO and a `LoginConnectCallbackImpl` facet carrying `{pendingId, vendorId}` in props, then asks the vendor to `connectAccount(callback, options)`; the client receives the OAuth popup `url` plus an `attempt` **stub** wrapping the DO — no guessable login id ever reaches the browser (packages/workshop-backend/src/server.ts#L660-L678).
2. The client opens the popup and awaits `attempt.wait()`, which blocks on the DO (packages/workshop-shared/src/api.ts#L39-L48).
3. The gatekeeper calls `LoginConnectCallbackImpl.complete(account)`. It reads `getAuthenticatedEmail()` (accounts without a verified email cannot sign in), resolves/creates the email-keyed user DO under the `signupsEnabled` gate, and delivers the `"<email>:<secret>"` token to the `PendingLogin`, which resolves the awaiting RPC (packages/workshop-backend/src/auth/login-flow.ts#L87-L145).

Sign-in requests only the minimal `auth` scope, and the resulting grant is **transient** — self-destructing after the email is read, so login never leaves a broad authorization behind. The one exception is Cloudflare: sign-in there also links AI Gateway billing, so it requests and persists the full billing scope set as a connected account (`linkConnectedAccountFromLogin`) (packages/workshop-backend/src/server.ts#L670-L673; packages/workshop-backend/src/auth/login-flow.ts#L120-L124; docs/oauth-signin.md#L28-L38).

`PendingLogin` holds no durable storage: the in-flight `awaitResult()` call keeps the DO alive, and if the user abandons (popup closed), disposing the `attempt` stub lets the DO be evicted — no alarms or cleanup paths needed (packages/workshop-backend/src/auth/login-flow.ts#L32-L41). Its `credentialsExpired`/`credentialsRestored` callbacks are deliberate no-ops for transient grants, with the Cloudflare billing path documented to degrade gracefully (packages/workshop-backend/src/auth/login-flow.ts#L147-L154).

## Account state and admin determination

The User DO owns the account's gadget listings, blueprint library, model profiles, connected gatekeeper accounts (with credential-expiry flags pushed from gatekeeper callbacks), and avatars-in-KV split (avatar bytes live in the `AVATARS` namespace, keyed by user id, not DO storage) (packages/workshop-backend/src/server.ts#L173-L198; packages/workshop-backend/src/user.ts#L28-L53). Gatekeeper accounts connected for *billing/observability* rather than user connect flows are recorded like any other, and accounts that were auto-provisioned (no OAuth) are protected from manual disconnect since deleting one destroys the user's data in that gatekeeper (packages/workshop-backend/src/user.ts#L28-L40).

Admin status is a pure function of the `ADMINS` env var — a JSON array (or string-parsed-as-array) of usernames checked against the user id's `name` — evaluated once per session when `getAdminApi()` mints the `AdminApi` capability (packages/workshop-backend/src/server.ts#L100-L117, #L588-L600). Users whose key is an email can never match a username in `ADMINS` unless it is listed verbatim; nothing in the repo suggests that is meant to work otherwise.

## Related pages

- Transport and token mechanics: [RPC and Capability Model](../architecture/rpc-and-capability-model.md)
- What gates which connector is offered: [Admin Settings and Configuration](../operations/admin-and-configuration.md)
- Public multi-user deployment recipe: docs/public-server.md (env-var table, #L6-L20)
