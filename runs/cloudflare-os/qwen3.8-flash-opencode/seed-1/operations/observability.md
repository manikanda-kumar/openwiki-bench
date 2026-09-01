---
type: operations
title: Observability and Error Reporting
description: Structured logging conventions (typed log fields, reserved secret-ish field names, ambient ALS context), the optional external issue Reporter with bounded reports, the frontend error-reporting contract, and product analytics events.
tags: [logging, observability, error-reporting, analytics, secrets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-6ca8e4368284270b70baf17c
    resource: repo://packages/backend-utils/src/error-reporting.ts
  - id: openwiki-source-1c512cdc924c5b8c80bd6e0b
    resource: repo://packages/backend-utils/src/logger-core.ts
  - id: openwiki-source-542ec152b1d74df0c2f74e1d
    resource: repo://packages/backend-utils/src/observability-context.ts
  - id: openwiki-source-2043cc78a214b08c4b322a6f
    resource: repo://packages/error-reporting/src/index.test.ts
  - id: openwiki-source-927ebcaa76ffc999778beefa
    resource: repo://packages/workshop-backend/src/analytics.ts
  - id: openwiki-source-4ac1b67126ca89980accd56f
    resource: repo://packages/workshop-backend/src/client-errors.ts
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Observability and Error Reporting

Four mechanisms: typed structured logs, an ambient per-operation context, an optional external
issue Reporter (Worker and browser paths), and product analytics.

## Structured logging (`@gadgets/backend-utils/logger`)

Each package defines its own field vocabulary (a `Fields` type) and a module-scoped logger with a
stable dot-separated `component` (gatekeepers also fix a `vendorId`)
(packages/workshop-backend/src/observability.ts#L39-L41; gatekeeper example
packages/gatekeeper-linear/src/observability.ts). Every call emits one indexed object:
`logger.warn("...", { event: "credentials.expiry.notify.failed", error: err })` — the `event` is a
required stable string, and the `error` field goes through a deliberately tiny normalization
(Error instances via `String(error)`, plain objects via their *own* string `message`, stacks
attached) without traversing causes (packages/backend-utils/src/logger-core.ts#L43-L53).

The type system enforces the no-secrets rule: a fixed set of *reserved field names* (`body`,
`header(s)`, `token`, `secret`, `prompt`, `message`, `error`, `errorStack`, `event`, `component`)
is erased from each package's extension vocabulary, so declaring a field that would carry a secret
simply isn't loggable — the vocabulary literally cannot name it
(packages/backend-utils/src/logger-core.ts#L13-L41). Levels are documented in the interface itself: `error` is "a failure that needs attention", `warn`
"from which the operation can continue", `info` a "notable lifecycle event", `debug` a "noisy
diagnostic" (packages/backend-utils/src/logger-core.ts#L56-L65).

`logger.with(fields)` returns an immutable child for object-owned context; explicit logger fields
override ambient context, call details override both, and `component` stays fixed
(packages/backend-utils/src/logger-core.ts#L58, L100-L106).

## Ambient operation context

`createObservabilityContext()` builds an AsyncLocalStorage-backed typed context per package:
loggers created from it fold ambient fields into every emission, and it must be **re-established
per operation** because it does not cross RPC, hibernation, or restart
(packages/backend-utils/src/observability-context.ts#L13-L28). The workshop's instance
(packages/workshop-backend/src/observability.ts#L8-L45) declares the shared field vocabulary
(`chatId`, `gadgetId`, `gatekeeperId`, `executionId`, …) and additionally exports `traced`, a tracer
that stamps spans with the same ambient attributes (packages/backend-utils/src/tracing.ts#L36 warns
not to wrap pipelined RPC stubs in it).

## Reporting failures to the external issue Reporter

`reportIssue(failureSite, caught, options?)` dispatches to an optional `ERROR_REPORTER` service
binding (a private Worker) *in addition to* logging; with no binding — local dev and deployments
without a destination — it is a no-op (packages/backend-utils/src/error-reporting.ts#L26-L40).
Events are built bounded on purpose: scalar-only attributes (`MAX_ATTRIBUTE_KEYS`,
`MAX_STRING_CHARS`), normalized correlation/HTTP blocks, an `occurrenceId` UUID, `severity`, and a
`handled` flag (packages/backend-utils/src/error-reporting.ts#L42-L60). Callers attach ambient
context explicitly, e.g. the overseer's catalog fallback reports
`reportIssue("overseer.catalog-fallback", error, …)` with ambient attributes
(packages/workshop-backend/src/overseer.ts#L6621) — and the same
no-secrets rules apply to attributes as to log fields.

## Frontend error reporting (separate, opt-in path)

`@gadgets/error-reporting` owns the vendor-neutral browser/Worker event contract and tolerant,
bounded normalization: `serializeException` survives hostile thrown objects (throwing getters
yield `{ type: "Object" }`, no invocation) and clips messages/stacks to hard caps
(packages/error-reporting/src/serialize-exception.ts; tests asserting exactly this at
packages/error-reporting/src/index.test.ts#L24-L42). Automatic capture is enabled only via the
build-time flag `VITE_FRONTEND_ERROR_REPORTING=true`, which also selects hidden source maps for the
Workshop bundle (packages/workshop-frontend/vite.config.ts#L41, L68;
packages/workshop-frontend/src/errorReporting.ts#L183).

The browser POSTs to the same-origin `/api/client-errors`; the backend endpoint **dispatches only
when both `FRONTEND_ERROR_REPORTER` and `FRONTEND_ERROR_RATE_LIMITER` are bound** — with either
absent it's an intentional 204 no-op; rate-limited submissions (and limiter failures) are dropped
with 204, keyed by Access identity or the connecting IP; bodies are read bounded (128 KiB) and
dispatched via `ctx.waitUntil` (packages/workshop-backend/src/client-errors.ts#L100-L153). Gatekeeper
management/configurator UIs run as Workshop-owned *opaque-origin* `srcDoc` frames: they
`postMessage` bounded reports which the host accepts only from the known frame window with origin
`'null'`, then adds host-owned surface/session context
(packages/workshop-frontend/src/errorReporting.ts#L228-L240; enforcement echoed for reviewers at
REVIEW.md#L48-L53). `reportedUserId` is client-supplied and unverified — a diagnostic label that
must never be read as authority (REVIEW.md#L54-L56).

## Product analytics

`analytics.ts` writes bounded, named lifecycle events (`account_created`, `user_authenticated`,
`gadget_created/opened/deleted`, `gadget_interaction`, `connection_created/removed`,
`blueprint_created/imported`) to an optional `PRODUCT_ANALYTICS` Cloudflare Pipelines stream —
event names and shapes documented at the module header
(packages/workshop-backend/src/analytics.ts#L5-L25; emitted e.g. on authentication at
packages/workshop-backend/src/server.ts#L689-L692).

Related: [Workshop Backend Kernel](../architecture/workshop-backend.md),
[Release Pipeline](./release-pipeline.md).
