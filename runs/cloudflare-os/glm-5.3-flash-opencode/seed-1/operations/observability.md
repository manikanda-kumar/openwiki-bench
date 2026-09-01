---
type: "Reference"
title: "Observability: Logging, Error Reporting, Analytics"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-6ca8e4368284270b70baf17c
    resource: repo://packages/backend-utils/src/error-reporting.ts
  - id: openwiki-source-bd805d6aa03802d64f50db5d
    resource: repo://packages/backend-utils/src/logger.ts
  - id: openwiki-source-013c8d62690950024cd36181
    resource: repo://packages/error-reporting/src/index.ts
  - id: openwiki-source-927ebcaa76ffc999778beefa
    resource: repo://packages/workshop-backend/src/analytics.ts
  - id: openwiki-source-4ac1b67126ca89980accd56f
    resource: repo://packages/workshop-backend/src/client-errors.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-a9925842d6314d695265e6d4
    resource: repo://packages/workshop-backend/src/observability.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Observability: Logging, Error Reporting, Analytics

## Server-side logging

All server logging goes through `@gadgets/backend-utils/logger` — browser `console.*` is out of scope (though the gadget iframe forwards its console to the workshop for display, that is product UI, not server logging). The package exposes `createLogger<ExtraFields>(defaults)` over `logger-core` (backend-utils/src/logger.ts:1-8). Each consumer defines a package-owned field type and a module-scoped logger with a stable dot-separated `component` (plus `vendorId` for gatekeepers), then emits concrete event names with typed fields:

```ts
const logger = createWorkshopLogger("workshop.overseer");
logger.warn("failed to install bundled format blueprints", {
  event: "formats.install.trigger.failed", error: err,
});
```

Conventions (from the repository's contributor guidance and visible throughout the code): one indexed object per call; module/child fields such as `vendorId` inherited; `logger.with(fields)` for object-owned context; caught values passed as `error` (the helper stringifies `Error`s and primitives, uses an own `message` for plain objects, omits `undefined`, adds stacks to `Error` logs); levels are `error` (needs attention), `warn` (continues best-effort), `info` (notable lifecycle), `debug` (noisy breadcrumbs); and **never log secrets, prompts, headers, tokens, or request/response bodies**. The workshop's own field vocabulary is declared once as `WorkshopObservabilityFields` (src/observability.ts:5-35) and the module-scoped helper is `createWorkshopLogger(component)`.

For bounded operation context needed by deep helpers, independent loggers, or other observability consumers, `createObservabilityContext` (from `@gadgets/backend-utils/observability-context`) provides ambient fields re-established per operation — it does not cross RPC, hibernation, or restart, and requires `nodejs_als` (which the backend's compatibility flags include, wrangler.jsonc). The backend's `obsContext` and `traced` (a span wrapper carrying ambient fields as attributes) live in src/observability.ts:37-45.

## Backend issue reporting

`reportIssue(failureSite, caught, options?)` from `@gadgets/backend-utils/error-reporting` dispatches a failure to the optional external `ERROR_REPORTER` binding in addition to logging it; it is a **no-op when the binding is absent** (local dev, deployments without an issue destination), and dispatch failures are swallowed into `debug` logs so reporting never disturbs the caller (backend-utils/src/error-reporting.ts:87-103). Options support bounded correlation (`rayId`/`requestId`), normalized HTTP facts, and ambient attributes from the package's observability context — only bounded scalars are retained, and reported context obeys the same no-secrets rules as log fields.

## Frontend error reporting (opt-in pipeline)

The browser path is separate and gated at build time: `VITE_FRONTEND_ERROR_REPORTING=true` enables trusted frontend producers and hidden source maps at build time; deployments without reporting leave it unset (packages/workshop-frontend/vite.config.ts, `build.sourcemap`). The Workshop browser sends best-effort reports to the same-origin `POST /api/client-errors` endpoint, which:

- Rejects cross-origin posts and non-JSON content; reads a bounded body (128 KiB cap) (src/client-errors.ts:14-53, 88-101).
- **Dispatches only when both `FRONTEND_ERROR_REPORTER` and `FRONTEND_ERROR_RATE_LIMITER` are bound** — otherwise the endpoint is an intentional no-op returning 204 (src/client-errors.ts:93-94).
- Rate-limits by Cloudflare Access identity when Access is on, else by client IP; rate-limit failures fail *open* to 204 so reporting breakage never surfaces to users (src/client-errors.ts:102-120).
- Normalizes the report through `@gadgets/error-reporting`'s tolerant normalizer before dispatching via `ctx.waitUntil` (src/client-errors.ts:122-151).

**Frontend reports never convey authority.** `reportedUserId` is client-supplied and unverified — the name records that it is a report, not a finding — and "nothing may read it to make a decision or grant access" (error-reporting/src/index.ts:94-97). `pageLocation` is origin + pathname only, **rebuilt by `normalizePageLocation` from the parsed URL rather than trimmed as text**, because an `href` retains `user:password@` credentials and a share link's `#share=` fragment is a bearer capability; only `http(s)` URLs survive (error-reporting/src/index.ts:139-154).

**Gatekeeper management/configurator UIs** run as Workshop-owned opaque-origin `srcDoc` frames; they send bounded reports with `postMessage`, and the host accepts them only from the known frame window with origin `null`, adds host-owned surface/vendor context, and performs the same-origin POST (REVIEW.md, "Logging, errors and secrets"). Gatekeepers must not report errors directly from their own Worker origin.

Automatic capture is installed only in trusted first-party surfaces — never gadget or user-authored code — because exception messages and stacks reach the external Reporter.

## Durable Object reset telemetry and retry

`do-retry.ts` handles the two independent axes of workerd DO-reset rejections: `retryable`/`overloaded` describe *this call* (kj exception type) while `durableObjectReset` describes *the object* whose incarnation died (do-retry.ts:1-16).

- `wrapDoStubForTelemetry(stub, log)` proxies a DO stub so every method call that rejects with a reset-shaped error logs `user_do.reset.surfaced` (with the method name as `operation` and the DO id) and rethrows unchanged (do-retry.ts:38-74).
- `retryOnDoReset` retries only calls known to be replay-safe — pure-read delegations (src/server.ts:119-122); writes never retry. The retry jitter (250ms, full jitter) decorrelates the replay burst a mass reset produces (do-retry.ts:76-79).
- Local vitest-pool-workers aborts reject *flagless*, pinned by an integration test, so the predicates are unit-tested with synthetic production shapes (do-retry.ts:17-19).

## Product analytics

`recordAnalytics(ctx, env, event)` writes product events to a Pipelines stream (src/analytics.ts:1-30): `account_created`, `user_authenticated`, gadget lifecycle (`gadget_created`/`opened`/`deleted` with creation source blank/blueprint and open source direct/share_key), `gadget_interaction` (chat/UI/merge), connection lifecycle (`connection_created`/`removed` distinguishing gatekeeper, AI model, and agent-spawner connections), and blueprint events (`blueprint_created`/`imported`). Call sites are scattered through the API layer (e.g. gadget opens in src/server.ts:266-272, creations in src/server.ts:283-297, blueprint imports at src/server.ts:417-421).

## Workers-native observability

The backend enables Workers Logs and Traces via wrangler.jsonc's `observability` stanza (head sampling 1.0 for logs, 0.5 for traces, with a comment noting spans bill against the Logs quota from 2026-10-01). Each gatekeeper package carries its own `observability.ts` defining its field vocabulary (e.g. gatekeeper-github/src/observability.ts).
