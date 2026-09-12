---
type: operations
title: "Authentication and Sign-in"
description: The three auth modes (password, Cloudflare Access, gatekeeper OAuth) and their configuration — AUTH_GATEKEEPERS, DISABLE_PASSWORD_AUTH, email-keyed identity, transient login grants, and the PendingLogin DO.
tags: [auth, oauth, password, access, sign-in]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Authentication and Sign-in

Cloudflare OS supports three authentication modes. Auth configuration is deliberately **env-var
driven** (`src/auth/config.ts`) and *not* in the admin-configurable `AdminConfig`, so it can't be
changed by a compromised admin session.

## 1. Password mode (default)

Users log in with a username + password. The scheme is designed so the **server never sees the raw
password**:

- The client computes `argon2id({ password, salt: SERVICE_SALT + username, ... })` as a
  `passwordHash` and sends that to `login()`/`createAccount()` (`packages/workshop-shared/src/api.ts`,
  `login`/`createAccount` doc). `SERVICE_SALT` is a fixed 16-byte constant in `api.ts:31`.
- The server **does not store that hash either** — it re-hashes (further server-side hashing) before
  persistence, "achieving roughly the same security guarantees as traditional server-side password
  hashing" while keeping the expensive client-side hash off the busy server.

Password auth can be disabled with `DISABLE_PASSWORD_AUTH=true` for OAuth-only — but only takes
effect when at least one auth gatekeeper is allowlisted, otherwise everyone is locked out
(`src/auth/config.ts:30`).

## 2. Cloudflare Access mode

Deployed behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/), Access
handles identity before the user reaches the app. The frontend calls `authenticateFromCfAccess()`;
the server reads the `cf-access-jwt-assertion` header and verifies it using **jose** with the
configured `CF_ACCESS_AUD` + `CF_ACCESS_ISS` (a remote JWKS from
`{CF_ACCESS_ISS}/cdn-cgi/access/certs`), throwing if either issuer or audience is missing
(`src/access.ts:13`). The frontend builds in this mode with `VITE_CF_ACCESS_MODE=true`. Access
claims also drive a privacy-preserving rate-limit key (derived from `sub` or a SHA-256 of the
email) used by the client-error endpoint (`src/access.ts:42`).

## 3. Gatekeeper OAuth sign-in

The deployment opts gatekeepers into sign-in via **`AUTH_GATEKEEPERS`** (a comma-separated
allowlist of vendor ids). Each listed auth-capable gatekeeper (`providesAuth`) gets a "Continue with…"
button alongside the username/password form. This is an **additive, off-by-default** feature.

### Identity: verified email

The primary account key is always the user's **verified email**. Signing in with any allowlisted
gatekeeper that yields the same verified email resolves to the same account — its
`UserDurableObject` is addressed by `idFromName(email)` (same scheme as Cloudflare Access)
(`docs/oauth-signin.md` §"Identity"). Each gatekeeper must return an email the provider has verified
(Google `email_verified`, GitHub primary+verified, Cloudflare account email) or the account can be
taken over; otherwise it returns null and can't sign in (`gatekeeper.ts` `getAuthenticatedEmail`).

### Incremental scopes and transient grants

Sign-in requests only **minimal scopes** needed to verify the email (Google `openid email profile`,
GitHub `read:user user:email`, Cloudflare `offline_access user-details.read`), and the gatekeeper
grant created for login is **transient** — it self-destructs shortly after the email is read. Sign-in
never leaves a broad authorization lying around. The fuller capability scopes (repos, Gmail/Docs, AI
Gateway billing) are requested only later when the user explicitly **connects** the gatekeeper
(`connectAccount(vendorId)` with default `scopes: "full"`), which persists a usable connected account
(`docs/oauth-signin.md` §"Incremental scopes"). `GatekeeperConnectOptions.scopes` chooses `"auth"` vs
`"full"`.

### Sign-in flow and the PendingLogin DO

1. The client calls `PublicApi.startGatekeeperLogin(vendorId)`. The backend creates a short-lived
   `PendingLogin` DO, hands the gatekeeper a `LoginConnectCallbackImpl`, and returns the gatekeeper's
   OAuth `url` plus an `attempt` stub (a capability wrapping the `PendingLogin` DO — no login id is
   exposed).
2. The client opens `url` in a pop-up (the gatekeeper's self-closing OAuth window) and calls
   `attempt.wait()`, which blocks on the `PendingLogin` DO.
3. When the gatekeeper finishes, it calls `complete(user)`. The callback reads
   `user.getAuthenticatedEmail()`, resolves/creates the email-keyed `UserDurableObject`, mints a
   session, and delivers the `"<email>:<secret>"` token to the `PendingLogin` DO, resolving the
   awaiting RPC.
4. The client stores the token and authenticates as usual.

`PendingLogin` is a DO reached via `ctx.exports` (no explicit binding), holds no durable storage, and
is evicted once the login completes or the client disposes the `attempt` stub
(`docs/oauth-signin.md` §"Storage / bindings").

## Sessions and tokens

Sessions are `LoginSessionRecord`s keyed by the SHA-256 of the token; the client holds `"<email>:<secret>"`
in `localStorage` and passes it to `authenticate(token)`. Auth errors carry stable codes
(`AUTH_ERROR_CODES`: `INVALID_SESSION_TOKEN` / `NOT_AUTHENTICATED_WITH_ACCESS`).

## Configuration summary

`docs/public-server.md` and `docs/oauth-signin.md` give the full env table:

- `AUTH_GATEKEEPERS=cloudflare,google,github` — allowlists which gatekeepers sign users in (order =
  button order).
- `DISABLE_PASSWORD_AUTH=true` — OAuth-only (ignored unless `AUTH_GATEKEEPERS` is non-empty).
- `CF_ACCESS_ISS`, `CF_ACCESS_AUD` — CF Access JWT verification (backend).
- Each gatekeeper's OAuth app credentials live on the **gatekeeper Workers** (client id/secret),
  registered with the redirect URI `${PUBLIC_BASE_URL}/gatekeeper/<name>/oauth`. In dev,
  `run-dev-server.ts` seeds them from `GOOGLE_*` / `GITHUB_*` / `CLOUDFLARE_OAUTH_*` shell vars.

## Uncertainty

The `argon2id` parameters (`parallelism: 1`, `iterations: 3`, `memorySize: 64 MiB`, `hashLength: 32`,
salt `SERVICE_SALT + username`) are documented in the `api.ts` docstring as the client-side step; the
server's further hashing step is described there but its exact parameters live server-side and are
not restated here. Treat `api.ts` as authoritative for the documented scheme.
