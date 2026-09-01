---
type: authentication
title: Authentication and Sign-In
description: How users authenticate to the Gadgets Workshop — client-hashed passwords, Cloudflare Access JWTs, and gatekeeper-driven sign-in bridged through the PendingLogin Durable Object — and why this configuration lives in environment variables rather than the admin panel.
tags: [authentication, security, rpc, cloudflare-access, oauth]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
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
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Authentication and Sign-In

The Workshop supports three mutually compatible ways to establish a session: **username/password** login, **Cloudflare Access** SSO, and **gatekeeper-driven sign-in** ("Continue with Google/GitHub/Cloudflare"). All three converge on the same primitive: a session token of the form `<userId>:<secret>` that the client stores and later exchanges for an `AuthenticatedApi` capability via `PublicApi.authenticate(token)` (packages/workshop-shared/src/api.ts:70-79, packages/workshop-backend/src/server.ts:680-694).

## Where authentication decisions live

Auth provider configuration is deliberately **env-var driven, not part of `AdminConfig`**: `packages/workshop-backend/src/auth/config.ts` reads `DISABLE_PASSWORD_AUTH` and `AUTH_GATEKEEPERS` directly from the worker environment. A compromised admin session therefore cannot change who can sign in. (Deployment-level `AdminConfig` does own the softer question of whether *new* signups are allowed — `signupsEnabled` — which every account-creation path consults; packages/workshop-backend/src/admin-config.ts and packages/workshop-backend/src/server.ts:703,752.)

- `AUTH_GATEKEEPERS`: a comma-separated allowlist of vendor ids (lowercased, e.g. `google,github`) permitted to drive sign-in. Empty/absent means no gatekeeper sign-in. A listed vendor must also advertise `providesAuth` in its `VendorDescription` to actually be offered (packages/workshop-backend/src/auth/config.ts:14-23, packages/workshop-backend/src/server.ts:652-659).
- `DISABLE_PASSWORD_AUTH=true` disables username/password login **only if** at least one auth gatekeeper is allowlisted; otherwise password auth stays on, so a misconfiguration can never lock everyone out (packages/workshop-backend/src/auth/config.ts:30-33).
- `CF_ACCESS_AUD` + `CF_ACCESS_ISS`: when both are set, the deployment requires Cloudflare Access, and password login/signup endpoints refuse to run (packages/workshop-backend/src/server.ts:721-727, 744-751).

## Path 1: Password login (client-side hashing)

The client never sends the raw password. It derives `passwordHash` via argon2id with parameters documented on `PublicApi.login()` — salt `SERVICE_SALT + username`, 1 parallelism, 3 iterations, 64 MiB, 32-byte hash — where `SERVICE_SALT` is a fixed 16-byte constant in the shared API module (packages/workshop-shared/src/api.ts:31-33, 88-107).

The server then applies **one more SHA-256 round** and stores only that `passwordHashHash` in the user's Durable Object, so the server never sees the password or a directly reusable hash (packages/workshop-backend/src/user.ts:220, 354-367, 396-397). A successful `login()` or `createAccount()` returns a fresh 32-byte random session secret, base64-encoded; the client keeps it in `localStorage` under `authToken` and passes it to `authenticate()` thereafter (packages/workshop-backend/src/user.ts:344-352, packages/workshop-frontend/src/main.tsx:23,43).

The user DO is keyed by `idFromName(username)`, so the token's prefix routes `authenticate()` straight to the right DO; the DO verifies the secret by SHA-256-hashing it and looking up the digest in its `sessions` collection (packages/workshop-backend/src/server.ts:680-694, packages/workshop-backend/src/user.ts:80-83, 304-319).

## Path 2: Cloudflare Access

When `CF_ACCESS_AUD`/`CF_ACCESS_ISS` are configured, every `/api` WebSocket/batch request must carry a valid `cf-access-jwt-assertion` header. `verifyCfAccessJwt()` verifies it with `jose` against the remote JWKS at `<CF_ACCESS_ISS>/cdn-cgi/access/certs`, checking issuer and audience; any verification failure yields `null` and the request is rejected with 403. Cross-origin API requests are also rejected in this mode (an `Origin` check), and the JWT must contain an email claim (packages/workshop-backend/src/access.ts:13-40, packages/workshop-backend/src/server.ts:840-855).

`PublicApi.authenticateFromCfAccess()` then creates the account on first use (profile id and initial display name derived from the email) unless deployment signups are closed (packages/workshop-backend/src/server.ts:696-719, packages/workshop-backend/src/user.ts:322-342).

## Path 3: Gatekeeper sign-in via PendingLogin

Sign-in via an authentication gatekeeper happens **before** the server knows who the user is, so it uses a rendezvous Durable Object:

1. `PublicApi.startGatekeeperLogin(vendorId)` validates the allowlist, the `GATEKEEPER_*` service binding, and `providesAuth`; creates a `PendingLogin` DO under a random unique id; hands the vendor a `LoginConnectCallbackImpl` (carrying the pending id and vendor id as entrypoint props); and returns `{url, attempt}` where `attempt` is an RPC stub wrapping the DO (packages/workshop-backend/src/server.ts:652-678, packages/workshop-backend/src/auth/login-flow.ts:1-20).
2. The browser opens `url` — the gatekeeper's self-closing OAuth popup — and awaits `attempt.wait()`, which blocks inside the `PendingLogin` DO (packages/workshop-shared/src/api.ts:35-46, packages/workshop-backend/src/auth/login-flow.ts:46-57).
3. When the gatekeeper finishes its flow it calls `LoginConnectCallbackImpl.complete(account)`, which reads the verified email, resolves/creates the email-keyed user DO (`loginOrCreateViaGatekeeper`), and delivers a `${email}:${secret}` token to the waiting browser (packages/workshop-backend/src/auth/login-flow.ts:92-144).

Two trust details matter:

- **The client never learns the PendingLogin DO's id.** The `attempt` stub *is* the capability; disposing it (popup closed, component unmounted) abandons the attempt, and the DO holds no durable storage — waiters live in memory, with a one-time result stash for the race where `deliver()` beats `awaitResult()` (packages/workshop-backend/src/server.ts:620-633, packages/workshop-backend/src/auth/login-flow.ts:32-80).
- **Sign-in grants are transient.** Most vendors are asked for `scopes: "auth"` — the minimal scopes needed to verify the email — and the grant is discarded after `complete()` reads it; sign-in therefore does not create a connected account. Cloudflare is the exception: signing in with Cloudflare also links AI Gateway billing, so it requests full (non-transient) scopes and persists the grant as a connected account (packages/workshop-backend/src/server.ts:667-674, packages/workshop-backend/src/auth/login-flow.ts:16-20, 123-131).

The OAuth redirects land on the gatekeeper Workers themselves at `/gatekeeper/<name>/oauth`; the backend hosts no `/auth/*` callbacks at all (packages/router/src/index.ts:43-45, packages/workshop-backend/src/server.ts:807-810).

## Account shape after each path

Accounts created by gatekeeper sign-in or Cloudflare Access are keyed by email and get their initial display name from the email local-part; the name is never refreshed on later logins, so a user-chosen name is not clobbered. Password login is left unset for these accounts — `hasPasswordLogin()` returns false — until the user explicitly sets a password (packages/workshop-backend/src/user.ts:402-432, 434-445).

## Related pages

- [Cap'n Web RPC Protocol and API Surface](/openwiki/architecture/rpc-protocol.md) — how `PublicApi`/`AuthenticatedApi` are exposed over the WebSocket.
- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md) — the fetch handler and session abort machinery these flows run inside.
- [Shipped Gatekeeper Connectors](/openwiki/gatekeepers/connectors.md) — which gatekeepers provide auth and how OAuth is handled per vendor.
