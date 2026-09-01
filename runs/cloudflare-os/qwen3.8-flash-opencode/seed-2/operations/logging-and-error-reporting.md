---
type: operations
title: Logging and Error Reporting
description: Server-side structured logging conventions, the typed observability context, optional external issue reporting, the gadget console-log streaming path, and the opt-in frontend error-reporting pipeline with its trust boundaries.
tags: [logging, observability, error-reporting, privacy, tails]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-6ca8e4368284270b70baf17c
    resource: repo://packages/backend-utils/src/error-reporting.ts
  - id: openwiki-source-1c512cdc924c5b8c80bd6e0b
    resource: repo://packages/backend-utils/src/logger-core.ts
  - id: openwiki-source-bd805d6aa03802d64f50db5d
    resource: repo://packages/backend-utils/src/logger.ts
  - id: openwiki-source-542ec152b1d74df0c2f74e1d
    resource: repo://packages/backend-utils/src/observability-context.ts
  - id: openwiki-source-013c8d62690950024cd36181
    resource: repo://packages/error-reporting/src/index.ts
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-4ac1b67126ca89980accd56f
    resource: repo://packages/workshop-backend/src/client-errors.ts
  - id: openwiki-source-a9925842d6314d695265e6d4
    resource: repo://packages/workshop-backend/src/observability.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Logging and Error Reporting

## Server-side structured logging

All server code logs through `@gadgets/backend-utils/logger`. `createLogger<Fields>({component})` (plus `vendorId` for gatekeepers) pins fixed metadata; the field vocabulary is **package-owned** — e.g. the Workshop backend declares every ambient field once in `WorkshopObservabilityFields` (chatId, gadgetId, gatekeeperId, outcome enum, …) and builds module loggers with `createWorkshopLogger(component)` (packages/backend-utils/src/logger.ts#L1-L9; packages/workshop-backend/src/observability.ts#L3-L46). Emitters use concrete event names with relevant fields — `logger.warn("failed to notify credential expiry", { event: "credentials.expiry.notify.failed", error: err })` — one indexed object per call; child loggers from `logger.with(fields)` carry immutable object-scoped context and inherited module fields (AGENTS convention, mirrored at packages/gatekeeper-cloudflare/src/observability.ts and friends). Caught values are passed as `error`: the core stringifies `Error`s and primitives, adds stacks as `errorStack` for Errors, and deliberately does *not* traverse causes or copy arbitrary properties (packages/backend-utils/src/logger-core.ts#L46-L113). Levels: `error` needs attention, `warn` continues best-effort, `info` notable lifecycle, `debug` breadcrumbs. Never log secrets, prompts, headers, tokens, or request/response bodies — the same rule that makes `gatekeeper-cloudflare` log only numeric provider codes ([Cloudflare Gatekeeper](../gatekeepers/cloudflare-connector.md)).

## Ambient operation context

`createObservabilityContext<Fields>()` gives one package an isolated AsyncLocalStorage of typed fields for bounded operation context needed by deep helpers or independent loggers — and the contract says it plainly: **context does not cross RPC, hibernation, or restart; re-establish it at those boundaries** (it requires `nodejs_als`/`nodejs_compat`) (packages/backend-utils/src/observability-context.ts#L1-L20; the Workshop's instance is `obsContext` with `traced` helpers, packages/workshop-backend/src/observability.ts#L41-L46). Example in the wild: the scheduler driver wraps its alarm in `obsContext.with({accountId, operation:"alarm"}, …)` (packages/gatekeeper-scheduler/src/schedule-driver.ts#L237-L239).

## External issue reporting (optional)

`reportIssue(failureSite, caught, options)` from `@gadgets/backend-utils/error-reporting` *additionally* dispatches a failure to the deployment's optional external Reporter while still logging it; **it is a no-op when the `ERROR_REPORTER` binding is absent** (local dev, deployments with no issue destination), and the dispatch is fire-and-forget via `waitUntil` (packages/backend-utils/src/error-reporting.ts#L71-L95). Reports reuse the vendor-neutral `@gadgets/error-reporting` event contract — bounded scalars only, `MAX_ATTRIBUTE_KEYS = 32`, string/stack char caps from the shared normalizer — so reported context obeys the same no-secrets rules as log fields, and *anything thrown* can reach the reporter too: exception messages and stacks leave the process (packages/error-reporting/src/index.ts#L17-L23; REVIEW.md#L49-L51).

## Gadget console logs are product data, not ops logs

A gadget's `console.*` is monkey-patched inside its iframe to post messages to the Workshop UI (see [Workshop Frontend](../frontend/workshop-ui.md)), and server-side gadget logs travel the Workers tail path: `GadgetTailLoopback` receives `tailStream` log/exception events and pushes them into `OverseerDurableObject.deliverGadgetLogs(chatId, logs)` for real-time UI delivery — with the explicit warning never to `console.log` the tail events there, because they'd spam `wrangler dev` while not being ops logs (packages/workshop-backend/src/overseer.ts#L8921-L8955). Exceptions become `error`-level log events carrying message + stack (overseer.ts#L8947-L8953).

## The frontend error-reporting pipeline (separate and opt-in)

`@gadgets/error-reporting` owns the browser/Worker event contract and tolerant bounded normalization: reports carry a trusted `surface` from an enum (`workshop`, `gatekeeper-app`, `configurator`), `pageLocation` rebuilt to origin+pathname only (a share-link fragment is a bearer capability and an `href` retains credentials), and `reportedUserId` — a *report*, not a finding: client-supplied, never read as identity or authority (packages/error-reporting/src/index.ts#L58-L120, #L255-L258; REVIEW.md#L55-L57). Capture is compiled into the frontend only with `VITE_FRONTEND_ERROR_REPORTING=true` (which also enables hidden source maps); trusted first-party surfaces only, never gadget code (packages/workshop-frontend/vite.config.ts#L38-L44; REVIEW.md#L58-L60).

Transport: the browser POSTs best-effort to the same-origin `POST /api/client-errors`. The backend endpoint is an **intentional no-op unless both `FRONTEND_ERROR_REPORTER` and `FRONTEND_ERROR_RATE_LIMITER` bindings exist**, reads bodies under a 128 KiB cap, and when Access is configured keys the limiter off `accessRateLimitKey` — a privacy-preserving derivation (Access `sub`, else a SHA-256 of the email) (packages/workshop-backend/src/client-errors.ts#L1-L40, #L109-L115; packages/workshop-backend/src/access.ts#L43-L48). Gatekeeper management/configurator frames run on Workshop-owned opaque origins, so they cannot report cross-origin directly: they `postMessage` and the Workshop host accepts a frame report only from the known frame window with origin `null`, adds host-owned surface/vendor context, and performs the same-origin POST itself (packages/workshop-frontend/src/errorReporting.ts#L227-L248; REVIEW.md#L52-L54).

## Runtime observability config

The backend Worker enables Workers observability at full log sampling with **no invocation logs** and 0.5 head-sampled traces, with a dated reminder to revisit sampling when spans start billing (packages/workshop-backend/wrangler.jsonc#L94-L101).
