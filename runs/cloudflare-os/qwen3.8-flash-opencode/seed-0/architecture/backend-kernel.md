---
type: subsystem
title: Backend Kernel (workshop-backend)
description: The workshop-backend Worker — the RPC root at /api, session token and password scheme, the UserDurableObject state model, the AdminSettings config owner, PendingLogin, the gatekeeper-capability chokepoint, and the Durable Object migration history.
tags: [backend, durable-objects, rpc, auth, sessions]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Backend Kernel (workshop-backend)

`workshop-backend` is the system's "kernel": one Cloudflare Worker that hosts the RPC root, the per-user state owner (`UserDurableObject`), the workspace owner (`OverseerDurableObject`, covered in [Overseer: The Workspace Durable Object](/openwiki/architecture/overseer-workspace.md)), deployment admin state (`AdminSettings`), and a set of loopback entrypoints. Everything else (gatekeepers, router, frontend) talks to it or through it.

## Worker configuration

`wrangler.jsonc` sets compatibility flags `allow_irrevocable_stub_storage`, `enhanced_error_serialization`, `global_fetch_strictly_public`, and `nodejs_compat`. The comment is explicit that `global_fetch_strictly_public` exists to protect against SSRF (notably in the webFetch tool), and that `nodejs_compat` is needed by the provider SDKs under pi and by Puppeteer-based PDF export (packages/workshop-backend/wrangler.jsonc:13-35). Storage bindings: KV namespaces `BLUEPRINTS` and `AVATARS`, R2 bucket `BLUEPRINT_CONTENT`, a `worker_loaders` binding `LOADER` (used to load gadget and code-mode workers), and a `BROWSER` binding (packages/workshop-backend/wrangler.jsonc:64-85). All Durable Object classes are reached via `ctx.exports` rather than explicit `durable_objects` bindings; the migration history is v0 (`UserDurableObject`, `OverseerDurableObject`), v1 (`AdminSettings`), v2 (`PendingLogin`) (packages/workshop-backend/wrangler.jsonc:44-63).

## The RPC root

The fetch handler treats `/api` as the RPC root: POST gets an HTTP batch session, a WebSocket upgrade gets a persistent session, both with a `PublicApiImpl` as the local main (packages/workshop-backend/src/server.ts:795-884, 887-931). Session termination is implemented by closing the WebSocket through an `abortSignal` extension to Cap'n Web's session options (a documented TODO to move to `ctx.abort()`) (packages/workshop-backend/src/server.ts:856-884). HTTP batch responses deliberately set `Access-Control-Allow-Origin: *`, because the same in-band-authorized API is already reachable cross-origin over WebSocket (packages/workshop-backend/src/server.ts:887-896).

Non-RPC routes on the same worker: the site logo, blueprint screenshot serving from R2 with immutable caching, and `POST /api/client-errors` for frontend error reporting (packages/workshop-backend/src/server.ts:795-815). There are no `/auth/*` callbacks — gatekeeper sign-in OAuth redirects land on the gatekeeper workers themselves (packages/workshop-backend/src/server.ts:807-811).

The first `/api` request of an isolate fire-and-forgets `AdminSettings.getByName("").ensureFormatBlueprintsInstalled()`, because the singleton DO would otherwise never wake after a deployment; a partial or failed install resets the in-isolate flag so the next visitor retries (packages/workshop-backend/src/server.ts:38-41, 818-853).

## Session tokens and passwords

A session token is `"<username>:<secret>"`, where the secret is 32 random bytes base64-encoded. `PublicApiImpl.authenticate` splits on `:`, addresses the user DO by `idFromName(username)`, and asks it to authenticate; the server stores only `SHA-256(secret)` as a `sessions` collection key, so a stolen KV/DO snapshot yields no usable token (packages/workshop-backend/src/server.ts:680-694; packages/workshop-backend/src/user.ts:304-323, 344-352).

Passwords follow the same "server never sees the password" design: the client computes an argon2id hash (documented on `login()` in the shared API), and the user DO stores one more SHA-256 round over that hash as `passwordHashHash`. A null `passwordHashHash` means password login is disabled for the account — which is the state for accounts created via Cloudflare Access or a sign-in gatekeeper (packages/workshop-backend/src/user.ts:354-367, 220-223, 416-431; see [Authentication and Sign-in](/openwiki/security/auth-signin.md)).

When `CF_ACCESS_AUD`/`CF_ACCESS_ISS` are configured, the fetch root verifies the Cloudflare Access JWT before the RPC session even starts and requires same-origin; `authenticateFromCfAccess()` then maps the JWT email onto the email-keyed user DO, honoring the admin `signupsEnabled` toggle (packages/workshop-backend/src/server.ts:838-860, 696-719).

Gatekeeper sign-in is bridged without exposing identifiers: `startGatekeeperLogin` creates a random-id `PendingLogin` DO and returns a `LoginAttemptImpl` stub wrapping it — the client's capability to await the result is the stub, never a guessable login id (packages/workshop-backend/src/server.ts:652-678, 619-634). `PendingLogin` holds no durable storage: the in-flight `awaitResult()` RPC keeps the DO alive, and abandonment just evicts it (packages/workshop-backend/src/auth/login-flow.ts:27-82). `LoginConnectCallbackImpl.complete()` reads the provider-verified email, resolves/creates the email-keyed user (refusing creation when signups are closed), mints a session token, and delivers it to the pending DO; a Cloudflare sign-in is the exception that requests and persists billing scopes up front (packages/workshop-backend/src/auth/login-flow.ts:84-140; packages/workshop-backend/src/server.ts:668-673).

## AuthenticatedApiImpl: the per-user facade

`AuthenticatedApiImpl` is minted per authenticated session and delegates almost every call to the user DO. Design points visible in the code:

- a fresh user-DO stub is created per request rather than held, "so we don't have to worry about detecting when a stub has become broken" (packages/workshop-backend/src/server.ts:88-98);
- pure-read delegations wrap in `retryOnDoReset` (retry once across a DO reset); writes never retry. `wrapDoStubForTelemetry` surfaces reset rejections for logging; workerd attaches the `durableObjectReset`/`retryable` flags natively (packages/workshop-backend/src/server.ts:118-124; packages/workshop-backend/src/do-retry.ts:1-40);
- admin power is decided exactly once: `#isAdmin()` compares the user id's *name* against the `ADMINS` env (JSON array or array binding), and `getAdminApi()` returns null for non-admins, minting an `AdminApiImpl` bound to the `AdminSettings` stub — the individual admin methods don't re-check (packages/workshop-backend/src/server.ts:100-118, 589-600).

## UserDurableObject: per-user state

The user DO is addressed by `idFromName(username-or-email)`, so usernames and verified emails are both stable identity keys. Its typed-storage schema (packages/workshop-backend/src/user.ts:157-226) owns:

- **collections**: `aiModels` (BYOK model configs), `gadgets` (the workspace index; a record without `lastActive` is provisional), `connectedAccounts` (gatekeeper `GatekeeperUser` stubs), `sessions`, `blueprints` (user-published), `libraryBlueprints` (saved/uploaded library entries), and `outputs` (workspace outputs mirrored by each Overseer so the Outputs page is one read of the user's own DO);
- **singletons**: `profile`, `passwordHashHash`, `preferredModel`/`quickModel`, `cloudflareBilling` (selected account + cached balance), `dailyLlmCount` (the free-tier counter that folded away a former standalone rate-limit DO), pinning and onboarding flags.

Gatekeeper vendor service bindings are discovered from `GATEKEEPER_<NAME>` env keys by `buildGatekeeperVendorMap`, so installing a connector is a binding change, not a code change (packages/workshop-backend/src/auth/auth-vendors.ts:3-35; packages/workshop-backend/src/user.ts:295-301).

**The capability chokepoint.** `UserDurableObject.getGatekeeperClassFor()` is the single core-side place where a `resourceUrl` becomes a `DurableObjectClass` capability, and it enforces the admin's disabled-gatekeeper and disabled-resource lists before returning it. The comment records the intent: it is reached only from user/UI-facing paths (`Overseer.newGatekeeper`, blueprint instantiation) — gadget and agent code cannot reach it (packages/workshop-backend/src/user.ts:1666-1692). `connectAccount` similarly refuses a vendor disabled by the admin, and ambient (auto-provisioned) account creation is deduplicated per vendor so concurrent callers share one provisioning promise (packages/workshop-backend/src/user.ts:1142-1150, 1231-1248).

## AdminSettings: the deployment config owner

`AdminSettings` is a singleton DO (addressed `getByName("")`) holding the authoritative `AdminConfig`, mirrored to the reserved `ADMIN_CONFIG_KEY` in the `BLUEPRINTS` KV namespace so hot paths resolve the config with a single cheap KV get via `readAdminConfig` (packages/workshop-backend/src/admin-settings.ts:26-58; packages/workshop-backend/src/admin-config.ts:322-330). Every setter funnels through `updateAdminConfig(patch)`, and the full read-modify-write is serialized behind an internal promise tail precisely so concurrent KV-backed mutations cannot lose updates (packages/workshop-backend/src/admin-settings.ts:63-70, 293-299).

Auth-related configuration (which sign-in providers exist, whether password login is on) is deliberately *not* in `AdminConfig` — it stays env-var driven so a compromised admin session cannot change it; `signupsEnabled` is called out in-source as an access toggle, not auth config (packages/workshop-backend/src/admin-config.ts:1-10, 15-19; packages/workshop-backend/src/auth/config.ts:1-31). See [Configuration and Admin Settings](/openwiki/operations/configuration-and-admin.md) for the full config surface.

## Ownership boundaries

| State | Owner | Notes |
|---|---|---|
| Profile, sessions, password hash, AI models, connected accounts, blueprint index, workspace index | `UserDurableObject` | SQLite DO, keyed by username/email |
| Chats, workpieces, gadget code, bindings, gatekeeper facet instances | `OverseerDurableObject` | one DO per workspace |
| Deployment `AdminConfig`, format curation, featured blueprints mirror | `AdminSettings` DO → `BLUEPRINTS` KV mirror | single writer is the DO |
| Public blueprint records (`BlueprintKvRecord`) | `BLUEPRINTS` KV | read by `PublicApi.getBlueprint` |
| Blueprint content (gzip Yjs docs), screenshots, site logo | `BLUEPRINT_CONTENT` R2 | key `<blueprintId>/<version>` |

## Uncertainty

- The exact workerd error-flag semantics in `do-retry.ts` are documented from the file's header comments and the linked Cloudflare docs; the runtime implementation lives outside this repo.
- Whether `ADMINS` may also contain display names other than the DO id name is not established beyond the includes-check shown in `#isAdmin()`.
