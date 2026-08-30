---
type: security
title: Authentication, Secrets, and Provider Accounts
description: The control plane's three principal kinds (user, service, sandbox), sig1 service signatures, Better Auth browser sessions with admission policy, AES-256-GCM secret scopes, brokered SCM credentials, encrypted LLM provider accounts with managed token brokering, and commit signing.
tags: [auth, security, secrets, provider-accounts, tokens]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-c6bb3d9059aee3f5eada2df9
    resource: repo://packages/control-plane/src/auth/authenticate.ts
  - id: openwiki-source-a968e65fa8624856e8611f4c
    resource: repo://packages/control-plane/src/auth/crypto.ts
  - id: openwiki-source-a3c621c8706fc9e74c890e6b
    resource: repo://packages/control-plane/src/auth/principal.ts
  - id: openwiki-source-c720d6ba47bd3b5556146efd
    resource: repo://packages/control-plane/src/auth/service/request-authenticator.ts
  - id: openwiki-source-04e95a73b27ac15dee270647
    resource: repo://packages/control-plane/src/auth/user/admission-policy.ts
  - id: openwiki-source-0dbba27228cbefcea15be278
    resource: repo://packages/control-plane/src/auth/user/runtime.ts
  - id: openwiki-source-475734dc9ffe03d69d908b54
    resource: repo://packages/control-plane/src/db/scoped-secrets.ts
  - id: openwiki-source-557254ea34d55b02eef467a0
    resource: repo://packages/control-plane/src/env-validation.ts
  - id: openwiki-source-9175ccc37c339f0a3dfd984e
    resource: repo://packages/control-plane/src/router.ts
  - id: openwiki-source-eac7892b2e077cc812f2b4e7
    resource: repo://packages/control-plane/src/routes/model-provider-accounts.ts
  - id: openwiki-source-b4fcd225b1d428a7ab560a2d
    resource: repo://packages/control-plane/src/sandbox/sandbox-env.ts
  - id: openwiki-source-e3a0ae08e1f115f1cd7e107f
    resource: repo://packages/control-plane/src/session/connection-authenticator.ts
  - id: openwiki-source-b79e53115bc683bdc83c24f9
    resource: repo://packages/control-plane/src/session/contracts.ts
  - id: openwiki-source-965ce753a4bb1e6b17670d82
    resource: repo://packages/control-plane/src/session/openai-token-refresh-service.ts
  - id: openwiki-source-f27ecb4eb2e1918bd8820067
    resource: repo://packages/control-plane/src/session/sandbox-access.ts
  - id: openwiki-source-cc418ae85071e90eb8d81e29
    resource: repo://packages/control-plane/src/session/scm-credentials-service.ts
  - id: openwiki-source-06d3b072476cfd51c8cb67f3
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Open-Inspect is designed as a **single-tenant** system: the trust boundary is the deploying organization (a shared GitHub App installation means any admitted user can reach any installed repo; `packages/control-plane/README.md`). Within that boundary, authentication is layered by caller kind.

## Principals and route admission

Every control-plane request resolves to one principal (`packages/control-plane/src/auth/principal.ts:36–40`): `{kind:"user", userId}`, `{kind:"service", service, actor}`, or `{kind:"sandbox", sessionId}`. Route declarations plus `enforceRoutePrincipal` in `router.ts` (L282–296) gate admission: `web-service` routes require service `web`; `user` requires a human principal.

**Service principals sign, not bearer.** `authenticate()` (`packages/control-plane/src/auth/authenticate.ts:34–94`) recognizes exactly one credential at the edge: the `sig1` signature header (`X-OpenInspect-Service-Signature`, built by `packages/shared/src/service-auth.ts`). A recognized-but-invalid signature is terminal — no silent fallback. Each service has its own secret (`SERVICE_AUTH_SECRET_{WEB,SLACK_BOT,GITHUB_BOT,LINEAR_BOT}`), the signature covers method+URL+body-hash+nonce+actor, bodies are capped at 16 MiB, and nonce reuse is log-only detected in-isolate (`packages/control-plane/src/auth/service/request-authenticator.ts:26–77`). Actor assertions are namespaced per service — `slack-bot` may assert `slack:<id>`, `github-bot` `github:<id>`, and **web asserts none** (`ASSERTION_RIGHTS`, `packages/control-plane/src/auth/principal.ts:47–52`). The signature for a `service:web` request must be *paired* with a valid browser session cookie to yield a user principal; otherwise it is a service call.

**Sandbox principal.** Routes marked `auth: "sandbox"` Bearer-verify `SANDBOX_AUTH_TOKEN` *through the session's Durable Object* (`verifySandboxAuth` in `router.ts:173–212` round-trips `/internal/verify-sandbox-token`), yielding `{kind:"sandbox", sessionId}` — the token is checked against the DO-persisted `sandbox.auth_token_hash` (SHA-256, timing-safe) with a plaintext-column legacy fallback (`packages/control-plane/src/session/sandbox-access.ts:23–41`). One-sandbox-per-session means the session ID is fully implied by the bearer token; request bodies must not restate it (`identity-enforcement.ts` rejects identity-minting fields).

**Human principal.** Browser logins run Better Auth (exact-pinned version) on the control plane's D1 (`auth/user/runtime.ts`, `db/better-auth-adapter.ts`, tables `auth_users/auth_sessions/auth_accounts/auth_verifications`), with GitHub and Google providers each admitted only when fully configured (partial config fails closed). An admission policy (`auth/user/admission-policy.ts`) enforces email-domain/allowlists, GitHub orgs/usernames, or explicit `UNSAFE_ALLOW_ALL_USERS`. The web BFF proxies only the six allowlisted browser auth routes; the opaque session cookie is the sole user credential the browser holds.

## Token architecture

| Token | Purpose | Scope |
| --- | --- | --- |
| GitHub App token (RS256 App JWT → installation token, KV-cached) | repo reads, brokered git credentials | all installed repos |
| User OAuth token | PR creation as the user | user's access |
| Sandbox auth token | every sandbox→control-plane call | single session |
| WS subscribe token | client connections (hashed on the DO `participants` row, 24h TTL) | single session |
| Managed LLM access token | short-lived OpenAI/xAI account access | pinned session provider account |
| ttyd JWT (HS256 signed with the sandbox token) | terminal auth | 24h |

PR creation demonstrates the user/sandbox split: the agent pushes the branch *through the sandbox* with brokered credentials, and the control plane opens the PR with the prompting user's OAuth token — falling back to App credentials plus a manual `pull/new` URL for non-GitHub logins.

## Secrets at rest

All three secret scopes — global, per-repository, per-environment (`db/global-secrets.ts`, `repo-secrets.ts`, `environment-secrets.ts`) — share plumbing in `db/scoped-secrets.ts` and encrypt with **AES-256-GCM** via `auth/crypto.ts` (`encryptToken`, L36/L58) keyed by `REPO_SECRETS_ENCRYPTION_KEY`; the key is validated strict-base64/32-byte at startup and its absence fails composition (`requireRepoSecretsEncryptionKey`, `env-validation.ts:50–57`). Writes reject keys that normalize-collide (`foo` vs `FOO`), enforce per-scope caps and combined-size limits, and clients ever see only key *names*. Session startup resolves user env layers (global → repo/environment per session target; primary wins collisions) and system env overlays them so user secrets cannot shadow `SANDBOX_AUTH_TOKEN` or fake boot modes (`packages/control-plane/src/sandbox/sandbox-env.ts:279–337`). Participant SCM tokens and sandbox access credentials (code-server/VNC passwords, derived by domain-separated HMAC) encrypt under `TOKEN_ENCRYPTION_KEY` / the repo key inside the DO's SQLite.

## Brokered SCM credentials

Fresh and image-boot sandboxes hold **no long-lived git token**: the sandbox-side git credential helper (`packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py`) mints per-request credentials by calling `POST /sessions/:id/scm-credentials` with the sandbox bearer token. `ScmCredentialsService` (`packages/control-plane/src/session/scm-credentials-service.ts:16–50`) fronts the configured source-control provider's `generateCredentialHelperAuth`, validates the result (non-empty username/password, future expiry), maps permanent→500/transient→502, and never logs the password. The helper scopes credentials to the configured `VCS_HOST` over HTTPS, caches them in a 0600 flock'd file with a 5-min expiry buffer, and refuses stale-cache fallback — so continuously running sessions and persistent-provider resumes never ride expired embedded tokens. Snapshot restores may still receive an env-token fallback for legacy compatibility (Modal mints a fresh one on restore).

## Provider accounts and managed LLM tokens

OpenAI and xAI subscription credentials are installation-wide **provider accounts** (`model-provider-accounts/service.ts`, D1 tables 0064–0068) with credentials encrypted under a separate `PROVIDER_ACCOUNTS_ENCRYPTION_KEY`. Session creation resolves every subscription provider once and persists an immutable auth row in **D1 — the sole authority for session provider auth** (the DO keeps lifecycle authority only). In account mode the sandbox receives only a managed marker (`managed-provider-env.ts` suppresses that provider's API-key env); the in-sandbox OpenCode plugin calls `POST /sessions/:id/provider-auth/:provider/access-token` over sandbox auth, the control plane refreshes the encrypted credential and returns short-lived access with `Cache-Control: no-store`. Background services (`session/openai-token-refresh-service.ts`, `xai-token-refresh-service.ts`) keep account state healthy; startup fails closed when the D1 auth snapshot is unavailable or incomplete. Child sessions copy the parent's auth rows; changing a default moves only future sessions.

## Commit signing

Optional per-deployment SSH commit signing: `auth/openssh-ed25519.ts` + `auth/sshsig.ts` with configuration in D1 (`db/commit-signing.ts`, route `routes/commit-signing.ts`); the sandbox proxies `ssh-keygen -Y sign` payloads to the control plane via `bin/oi-git-sign`, so agent commits carry verified signatures without exposing the key material.

## Failure posture

Credential admission is fail-closed throughout: missing encryption keys fail worker composition; partial OAuth provider config disables the provider; unknown `SCM_PROVIDER` values return 501 from the router gate (`enforceImplementedScmProvider`, `router.ts:118–158`); the DO re-validates sandbox token and identity *after* async hashing so a mid-flight cancel or credential rotation cannot admit (`connection-authenticator.ts:110–151`).
