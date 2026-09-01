---
type: workflow
title: Authentication and the User Model
description: The sign-in paths — client-hashed passwords, Cloudflare Access JWTs, and authentication gatekeepers with the PendingLogin rendezvous — plus session tokens, the UserDurableObject as identity anchor, and the env-driven auth configuration.
tags: [authentication, sign-in, sessions, cloudflare-access, oauth, user-do]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
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
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-6228b9f416e46b02e20c611f
    resource: repo://packages/workshop-frontend/src/passwordHash.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# Authentication and the User Model

## The UserDurableObject as identity anchor

Each user is one `UserDurableObject` whose id derives from a **name**: `idFromName(username)` for password accounts, `idFromName(email)` for Cloudflare Access and gatekeeper sign-in — the verified email is the canonical account key, so "signing in with any allowlisted gatekeeper that yields the same verified email resolves to the same account" (src/server.ts:686, 702, 731; docs/oauth-signin.md:16-22). The DO owns the profile (`{type: "user", name, id}`), session-token records, the workspace list, AI models, blueprint library, connected gatekeeper accounts, and outputs mirror (src/user.ts:157-226). Profile display names are written only on first sign-in and thereafter belong to the user (`setOwnDisplayName`) — later logins never clobber a customized name (src/user.ts:402-427).

## Path 1: username + password (client-hashed)

The client derives `passwordHash` with **argon2id** (parallelism 1, 3 iterations, 64 MiB, 32-byte output) over `SERVICE_SALT + utf8(username)` — the salt constant travels in `workshop-shared` (api.ts:31-33) and hashing happens in a dynamically imported chunk (src/passwordHash.ts:1-33). The server stores only a further SHA-256 of that hash (`passwordHashHash`), so "the server never sees the user's password at all" and the expensive hash runs on the client (api.ts:88-107; src/user.ts:220-223, 354-367). On success the DO mints a session: 32 random bytes returned base64 to the client, with the **SHA-256 hex of the token** stored as the session record — a leaked database cannot produce usable tokens (src/user.ts:344-352). `authenticate(token)` re-derives the hash and looks up the record; a corrupt (non-base64) token classifies as an auth failure rather than a decoder error (src/user.ts:304-319). Password login and signup are refused outright on CF Access deployments, and `DISABLE_PASSWORD_AUTH`/signups can turn them off (src/server.ts:721-771; src/auth/config.ts:30-36).

## Path 2: Cloudflare Access (SSO)

When `CF_ACCESS_AUD` is set, the `/api` fetch handler requires same-origin requests, verifies the `cf-access-jwt-assertion` JWT against the team's remote JWKS (issuer + audience must both be configured), and requires an email claim (src/server.ts:840-855; src/access.ts:1-33). `authenticateFromCfAccess()` resolves `idFromName(email)` and creates the account on first use when deployment signups are enabled (src/server.ts:696-719; src/user.ts:326-342). The same verifier guards the client-errors endpoint's rate-limit key (privacy-preserving: `access-sub:<sub>` or a SHA-256 of the email, src/access.ts:35-44; src/client-errors.ts:106-116).

## Path 3: authentication gatekeepers

Auth-capable gatekeepers (`VendorDescription.providesAuth`) use one OAuth app for both sign-in and later capability connection (docs/oauth-signin.md:1-14). The flow (src/auth/login-flow.ts:1-25; src/server.ts:652-678):

1. `PublicApi.startGatekeeperLogin(vendorId)` validates the vendor against the `AUTH_GATEKEEPERS` allowlist and its `providesAuth` declaration, creates a **`PendingLogin` DO** (random id, no durable storage), and hands the gatekeeper a `LoginConnectCallbackImpl` entrypoint keyed by `{pendingId, vendorId}`.
2. The client opens the gatekeeper's self-closing OAuth pop-up and awaits `attempt.wait()` — a capability stub wrapping the PendingLogin DO, never a guessable id; disposing the stub abandons the attempt and lets the DO be evicted (api.ts:35-46; src/auth/login-flow.ts:32-46).
3. When the gatekeeper finishes it calls `complete(user)`; the callback reads `user.getAuthenticatedEmail()` (which must be provider-verified or null), resolves/creates the email-keyed User DO (honoring the signups gate), mints a session, and delivers `"<email>:<secret>"` to the PendingLogin DO, which resolves the awaiting RPC.

Sign-in requests only **minimal scopes** and the grant is *transient* — it self-destructs after the email is read, so sign-in never leaves a broad authorization or a persistent connected account; capabilities come later via an explicit `connectAccount` with full scopes (docs/oauth-signin.md:24-52; src/server.ts:667-676 — Cloudflare is the exception, requesting and persisting billing scopes up front because sign-in with Cloudflare also links AI Gateway billing).

The auth-config code is deliberately tiny: `getAuthGatekeeperAllowlist` parses `AUTH_GATEKEEPERS` (comma-separated, lowercased), and `isPasswordAuthEnabled` honors `DISABLE_PASSWORD_AUTH=true` **only when at least one auth gatekeeper is allowlisted, otherwise password auth stays on to avoid locking everyone out** (src/auth/config.ts:12-36). Per docs/oauth-signin.md:81-88 the module layout is `auth/config.ts`, `auth/auth-vendors.ts` (binding lookup helpers), `auth/login-flow.ts` (PendingLogin + callback).

## Tokens on the wire

The client stores `"<username-or-email>:<token>"` in localStorage and passes it to `authenticate()` (src/main.tsx dev auto-login shows the shape, src/main.tsx:20-40; api.ts:70-71). The server splits, derives the DO from the name part, and validates the token part against the SHA-256-hex session record (src/server.ts:680-694).

## Policy placement

Authentication configuration stays **env-var driven and out of `AdminConfig`** so a compromised admin session cannot change it (REVIEW.md, "Capability-based security"; src/admin-config.ts:3-6). The admin-configurable adjacent knob is `signupsEnabled` — an access toggle, not auth config (src/admin-config.ts:19-23) — and the cloudflare limits flow is likewise a server env feature, exposed to the client only through `getServerConfig`'s `cloudflareLimitsEnabled` flag (src/deployment-config.ts:41-45).
