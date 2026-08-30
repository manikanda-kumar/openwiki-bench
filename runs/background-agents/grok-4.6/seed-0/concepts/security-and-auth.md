---
type: concept
title: Security Model and Authentication
description: Single-tenant trust model, Better Auth user sessions, sig1 service authentication, sandbox and WebSocket tokens, admission policy, and identity enforcement.
tags: [security, authentication, single-tenant, sig1, better-auth, tokens]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-c6bb3d9059aee3f5eada2df9
    resource: repo://packages/control-plane/src/auth/authenticate.ts
  - id: openwiki-source-71a37d5d3a20cd1941385eef
    resource: repo://packages/control-plane/src/auth/identity-enforcement.ts
  - id: openwiki-source-a3c621c8706fc9e74c890e6b
    resource: repo://packages/control-plane/src/auth/principal.ts
  - id: openwiki-source-04e95a73b27ac15dee270647
    resource: repo://packages/control-plane/src/auth/user/admission-policy.ts
  - id: openwiki-source-dfd17894a55827ebbc727f66
    resource: repo://packages/control-plane/src/auth/user/session-authenticator.ts
  - id: openwiki-source-5856d6dafe718ec27f678566
    resource: repo://packages/shared/src/service-auth.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Security Model and Authentication

Open-Inspect is **single-tenant**. Every user of a deployment is treated as a trusted member of the same organization with access to the same repositories. The system does **not** check that a signed-in user has GitHub permission to a repository before creating a session. Shared GitHub App installation tokens are what sandboxes use to clone, fetch, and push.

This is a product boundary, not an accident. Multi-tenant isolation would need per-tenant GitHub Apps, session-create access checks, and tenant keys in the data model.

Deploy behind SSO/VPN. Install the GitHub App only on intended repositories. Restrict who can sign in. See README “Security Model (Single-Tenant Only)”.

## What “shared git credentials” means

The control plane mints short-lived GitHub App **installation** tokens and brokers them to sandboxes through the git credential helper. Any user who can start a session can work in any repo that App can see.

Pull-request **creation** is different:

- GitHub-signed-in users use their OAuth token so the PR is attributed to them and GitHub still enforces that user’s write access.
- Users who signed in another way (Google) have no SCM token; PR creation falls back to the shared GitHub App bot.

See [Source Control, Git Auth, and Pull Requests](/openwiki/workflows/source-control.md).

## Four credentials, four jobs

| Credential | Who holds it | Scope | Job |
| --- | --- | --- | --- |
| Better Auth browser session | User browser, via web BFF | The signed-in user | Prove a human (or the web BFF acting for one) |
| `sig1` service signature | web, slack-bot, github-bot, linear-bot | One signed request | Bind method/path/query/body/actor to that service’s secret |
| Sandbox auth token | Sandbox process | One session | Sandbox → control plane HTTP and sandbox WebSocket |
| WebSocket token | Browser (or other UI) | One session, 24h TTL | Client `subscribe` on `/sessions/:id/ws` |

GitHub App installation tokens and user OAuth tokens are **brokered**, not sent to the browser. Model-provider refresh tokens are likewise brokered (see [Models and Provider Accounts](/openwiki/features/model-providers.md)). Secrets injected into sandboxes are encrypted at rest in D1 (see [Secrets, Managed Skills, and MCP Servers](/openwiki/features/secrets-skills-and-mcp.md)).

## Principals

Every non-public HTTP request resolves to exactly one `Principal` before its handler runs:

- `{ kind: "user", userId }` — Better Auth session on a `service:web` channel
- `{ kind: "service", service, actor }` — bot or web-as-service; only services may carry an asserted actor
- `{ kind: "sandbox", sessionId }` — assembled in the router after the Durable Object verifies the Bearer token

`ASSERTION_RIGHTS`: `web` asserts no actor (identity arrives by token exchange). `slack-bot` / `github-bot` / `linear-bot` may assert `slack:` / `github:` / `linear:` actors.

`applyIdentityEnforcement` derives handler identity from that principal. Body fields such as `userId`, `scmToken`, `spawnSource`, and `actorUserId` are **forbidden** (HTTP 400). Display fields (`scmLogin`, names) may still ride the body.

## User sign-in and admission

The control plane owns Better Auth (`packages/control-plane/src/auth/user`). The web app proxies `/api/auth/*` with `sig1`. Protected resource reads use Better Auth `disableRefresh: true` so validation does not extend expiry or write D1 as a side effect.

Admission is **who may sign in**, not which repos they may open:

- `ALLOWED_USERS` (GitHub logins)
- `ALLOWED_EMAILS`
- `ALLOWED_EMAIL_DOMAINS`
- `ALLOWED_GITHUB_ORGS` (active org membership via GitHub API)
- `UNSAFE_ALLOW_ALL_USERS=true` only if **no** allowlist is configured

Google sign-in is admitted only through email/domain lists. GitHub sign-in can also use login or org membership. Empty allowlists without the unsafe flag deny everyone. `AdmissionDeniedError` is “user is not admitted by this deployment”.

## `sig1` service channel

`packages/shared/src/service-auth.ts` defines the signature. Each service has its own secret (`SERVICE_AUTH_SECRET_WEB`, `_SLACK_BOT`, `_GITHUB_BOT`, `_LINEAR_BOT`). Absence of a secret means that service cannot authenticate.

The signature covers the full request so a captured credential cannot be replayed against a different method, path, or body. Canonicalization is pinned by golden vectors; a layout change needs `sig2`. Service-signed bodies are capped at 16 MiB (attachment uploads). Nonce reuse is logged in-isolate (best-effort).

When the router sees a `sig1` header and the route wants a **user**, it verifies the web channel first, then the Better Auth cookie. A failed service credential is terminal; only a request with **no** recognized credential may fall through to sandbox-token verification on sandbox-accepting routes.

## Sandbox and WebSocket tokens

Sandbox tokens are hashed in the Durable Object (`auth_token_hash`). The router asks `/internal/verify-sandbox-token`; it does not keep the plaintext. Scope is that session only.

WebSocket tokens are hashed on the participant row, minted by `POST /sessions/:id/ws-token` from the verified principal, and expire after 24 hours (close `4001`). They never appear in session snapshots.

## Encryption and other secrets

`TOKEN_ENCRYPTION_KEY`, `REPO_SECRETS_ENCRYPTION_KEY`, and `PROVIDER_ACCOUNTS_ENCRYPTION_KEY` must be present, strict-base64, 32-byte AES-256 material. Missing keys throw at first touch rather than storing plaintext (see [Control Plane](/openwiki/architecture/control-plane.md)).

Inbound automation webhooks use hashed API keys (`webhook-key.ts`). GitHub/Slack/Sentry webhook routes verify provider signatures inside the handler (`handler-authenticated`), not through `sig1`.

## What this model does not do

- Per-user repo ACL at session create
- Isolation between tenants sharing one Worker
- Sending sandbox passwords on `subscribed` or `GET /sessions/:id`

Treat managed skills as trusted instruction content, not a permission boundary. An enabled skill can tell the agent to use tools and credentials already in the sandbox.
