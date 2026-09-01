---
type: backend-kernel
title: "Backend Kernel: server.ts and API Implementations"
description: The workshop-backend worker entrypoint — its fetch handler, the PublicApi/AuthenticatedApi RPC implementations, the AdminSettings DO and AdminConfig contract, DO-reset retry/telemetry helpers, and the wrangler bindings the kernel runs on.
tags: [backend, kernel, rpc, admin, durable-objects, wrangler]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-30239eee070a503c224c24f6
    resource: repo://packages/workshop-backend/package.json
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Backend Kernel: server.ts and API Implementations

`packages/workshop-backend` is the kernel worker. Its module entrypoint is `.wrangler/validate/src/server.ts` — a build step (`build:worker`) runs the browser-runtime bundle plus `capnweb-validate build`, so the deployed module is the *validated* server source (packages/workshop-backend/wrangler.jsonc:5-9, packages/workshop-backend/package.json:8-9).

## Entrypoints and re-exports

`server.ts` declares every class the runtime needs and re-exports the Durable Object classes and entrypoints defined in sibling modules so wrangler can bind them: `PendingLogin`/`LoginConnectCallbackImpl` (auth), `AdminSettings` (admin config), `UserDurableObject`/`GatekeeperConnectCallbackImpl` (users), `OverseerDurableObject` plus the loopbacks `GatekeeperLoopback`, `GatekeeperHookLoopback`, `CodeModeTailLoopback`, `AgentSpawnerGatekeeper`, `GadgetTailLoopback`, `AgentSelfLoopback`, `TransientStubLoopback` (workspaces), `LanguageModelGatekeeper` (models), and `ExternalMessageGateway` (channel integrations) (packages/workshop-backend/src/server.ts:14-62).

All Durable Objects are reached via `ctx.exports` and need no explicit `durable_objects` binding in wrangler — the migrations section just declares the SQLite-backed classes (`UserDurableObject`, `OverseerDurableObject`, `AdminSettings`, `PendingLogin`) across tags v0–v2 (packages/workshop-backend/wrangler.jsonc:60-75).

## The fetch handler

The worker's `fetch` handles four kinds of traffic (packages/workshop-backend/src/server.ts:794-872):

1. **Site logo** (`SITE_LOGO_PATH`) and **blueprint screenshots** (`/blueprint-screenshot/*`) — served from R2 with long-lived immutable cache headers.
2. **`/api/client-errors`** — the frontend error-reporting sink (gated on optional bindings; see [Observability, Logging, and Error Reporting](/openwiki/operations/observability.md)).
3. **`/api`** — the RPC endpoint. On the *first* API request it also fires the bundled format-blueprint install into the AdminSettings DO (a module flag prevents repeats and resets on partial failure; the DO is idempotent) (packages/workshop-backend/src/server.ts:816-838).
4. Everything else: 404 (the router worker serves frontend assets, so the backend never hosts them in the default topology).

For `/api`, when `CF_ACCESS_AUD` is configured the request must present a valid Cloudflare Access JWT (verified against the issuer's JWKS) and same-origin only; the handler then upgrades the request into a Cap'n Web session rooted at `PublicApiImpl`, with an `AbortSignal` wired so `abortSession` closes the socket (packages/workshop-backend/src/server.ts:840-870, 875-902).

## PublicApiImpl and AuthenticatedApiImpl

`PublicApiImpl` (annotated `@validateRpc()`) serves the pre-auth surface — sign-in paths, server config, and public blueprint reads (packages/workshop-backend/src/server.ts:635-792). `AuthenticatedApiImpl` is the per-user surface: its constructor captures the verified user's `DurableObjectId` and grabs namespaces from `this.ctx.exports` (`OverseerDurableObject`, `AdminSettings`, `UserDurableObject`) (packages/workshop-backend/src/server.ts:75-98). Two helpers shape every user-DO access:

- `#user` mints a **fresh stub per request** (so broken-stub bookkeeping is never needed) wrapped by `wrapDoStubForTelemetry` (packages/workshop-backend/src/server.ts:94-98).
- **Admin capability minting is a one-shot check**: `#isAdmin()` compares the user id's name against the `ADMINS` env binding (JSON array or JSON-parsable string), and `getAdminApi()` returns null for non-admins, else an `AdminApiImpl` over the `AdminSettings` singleton (`getByName("")`). The check happens once at minting; individual `AdminApi` methods never re-check (packages/workshop-backend/src/server.ts:100-117, 588-600; packages/workshop-backend/src/admin-settings.ts:57-66).

## AdminConfig and the AdminSettings DO

`AdminConfig` (packages/workshop-backend/src/admin-config.ts:15-77) is the deployment's "soft" customization: `signupsEnabled`, site name/logo, agent `instanceInstructions`, announcement and banner, accent color, **disabled gatekeepers/resources**, per-vendor ambient provisioning modes, and the curated **formats** list (promoted blueprints with enable flag, agent hint, and presentation overrides). Connectors/resources default to enabled — the admin UI opts *out*.

The **AdminSettings DO is the only writer**. It is a singleton always addressed as `getByName("")`; it owns the authoritative config and mirrors it to the reserved KV key `.adminConfig` so hot paths (connect/login/agent) read it with one cheap KV get via `readAdminConfig(env)` instead of waking the DO — a single-DO-writer design that avoids KV update races (packages/workshop-backend/src/admin-config.ts:1-5, 327+; packages/workshop-backend/src/admin-settings.ts:28-66, 283). The same DO tracks which bundled format blueprints are installed (`installedFormatBlueprints`) and which have already been offered for promotion, so promotion happens exactly once per blueprint (packages/workshop-backend/src/admin-settings.ts:33-49).

## DO reset handling

`do-retry.ts` standardizes how the kernel reacts to Durable Object resets (packages/workshop-backend/src/do-retry.ts:1-15):

- `wrapDoStubForTelemetry` proxies a stub so every call that rejects with a DO-reset shape logs `user_do.reset.surfaced` (with method and DO id) and rethrows unchanged — otherwise transparent.
- `retryOnDoReset` retries **once**, with full jitter, only for calls the caller asserts are **replay-safe** (pure reads — a reset cannot distinguish "never applied" from "applied, response lost"); the thunk must mint its own fresh stub, because a captured stub is permanently broken. `shouldRetryAfterReset` is deliberately narrower than the telemetry classification: `durableObjectReset` retries even with `overloaded` set (the incarnation is dead), while a bare `retryable` (connection lost to a possibly-live object) retries only if not overloaded (packages/workshop-backend/src/do-retry.ts:36-130).

## Environment bindings

From wrangler.jsonc (packages/workshop-backend/wrangler.jsonc:16-70):

- **KV**: `BLUEPRINTS` (blueprint metadata, featured list, admin-config mirror) and `AVATARS`.
- **R2**: `BLUEPRINT_CONTENT` (blueprint code snapshots, screenshots, site logo).
- **`LOADER`**: the Workers loader binding that loads dynamic workers (executeCode harnesses, the restore forger).
- **`BROWSER`**: the Browser Rendering binding used for gadget PDF exports.
- **Compatibility flags**: `allow_irrevocable_stub_storage`, `enhanced_error_serialization`, `global_fetch_strictly_public` (SSRF protection for agent webFetch), and `nodejs_compat` (needed by the pi-ai provider SDKs and Puppeteer).
- Gatekeeper service bindings and the Workers AI binding are **added dynamically** by run-dev-server (dev) and the release generator (prod), never checked in.

## Related pages

- [UserDurableObject: Per-User State](/openwiki/backend/user-do.md)
- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md)
- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md)
