---
type: operations
title: Logging, tracing, and error reporting
description: The observability stack — the backend-utils structured logger and its reserved fields, the per-package observability context, the traced() span helper, the ERROR_REPORTER issue pipeline, Workers observability config, and the frontend /api/client-errors pipeline with its gating bindings.
tags: [observability, logging, tracing, error-reporting, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-6ca8e4368284270b70baf17c
    resource: repo://packages/backend-utils/src/error-reporting.ts
  - id: openwiki-source-1c512cdc924c5b8c80bd6e0b
    resource: repo://packages/backend-utils/src/logger-core.ts
  - id: openwiki-source-542ec152b1d74df0c2f74e1d
    resource: repo://packages/backend-utils/src/observability-context.ts
  - id: openwiki-source-7178db64bf65fc3e39f7ae12
    resource: repo://packages/backend-utils/src/tracing.ts
  - id: openwiki-source-7c3a8d0a7ccea7201f2f73d4
    resource: repo://packages/gatekeeper-cloudflare/README.md
  - id: openwiki-source-7d998e90fa57b94a489f8a64
    resource: repo://packages/workshop-backend/src/access.ts
  - id: openwiki-source-927ebcaa76ffc999778beefa
    resource: repo://packages/workshop-backend/src/analytics.ts
  - id: openwiki-source-4ac1b67126ca89980accd56f
    resource: repo://packages/workshop-backend/src/client-errors.ts
  - id: openwiki-source-a9925842d6314d695265e6d4
    resource: repo://packages/workshop-backend/src/observability.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Logging, tracing, and error reporting

## The structured logger

Server code logs through `@gadgets/backend-utils/logger`. A logger is created with **fixed metadata
(a dot-separated `component`, plus `vendorId` for gatekeepers)** and a package-owned field
vocabulary; every call emits one indexed object with a concrete `event` name and relevant typed
fields, passing caught values as `error` (`packages/backend-utils/src/logger-core.ts:55-67`).

The type system enforces the no-secrets rule structurally: `ReservedLogField` bans field names like
`body`, `header(s)`, `message`, `prompt`, `secret`, and `token` in both logger defaults and call
details — only `component` and `event`/`error` are permitted exceptions
(`logger-core.ts:13-43`). Caught values are normalized deliberately small: `Error` instances
stringify with stacks added (`errorStack`), plain objects contribute only an own string `message`,
and there is no cause traversal (`logger-core.ts:46-53`, `108-114`). Levels: `debug` is noisy
breadcrumbs, `info` notable lifecycle, `warn` continues best-effort, `error` needs attention.

`logger.with(fields)` is immutable (object-owned or nearby context). Explicit logger fields
override ambient context; call details override both; `component` is always fixed
(`logger-core.ts:99-107`).

## Observability context and tracing

`createObservabilityContext<Fields>()` gives a package an isolated, typed ambient context over
`AsyncLocalStorage`: `createLogger` reads it into every log line, and `with(fields, callback)`
establishes it per operation. **Context does not cross RPC, hibernation, or restart** — it must be
re-established at those boundaries, and it requires `nodejs_als`/`nodejs_compat`
(`packages/backend-utils/src/observability-context.ts:12-31`). The workshop backend declares its
field vocabulary in one place (`workshop-backend/src/observability.ts:5-43` — chatId, gadgetId,
gatekeeperId, vendorId, toolName, outcome, …), and `traced(name, callback)` runs an operation in a
trace span carrying the ambient fields as attributes; pipelined RPC stubs are deliberately not
wrapped (`packages/backend-utils/src/tracing.ts:18-36`).

## The issue reporter

`reportIssue(failureSite, caught, options?)` (`packages/backend-utils/src/error-reporting.ts:87-101`)
dispatches a bounded failure to the optional private `ERROR_REPORTER` service binding; it is a
**no-op when the binding is absent** (local dev / deployments with no issue destination). It reads
the ambient `env`/`waitUntil` from `cloudflare:workers` so a single line reports from any Worker,
DO method, or alarm without plumbing arguments. Delivery holds in both stateless Workers and DOs
(an in-flight RPC keeps the object alive), reporting failures are logged at debug rather than
swallowed, and reporting must never disturb the caller. Bounded scalar attributes only — capture
sites spread `obsContext.get()` and augment inline.

Workers-level telemetry is configured in each `wrangler.jsonc` (`observability` with head
sampling; backend traces sampled at 0.5 during the beta, noted as billable against Logs from
2026-10-01) (`packages/workshop-backend/wrangler.jsonc`).

Product analytics are separate (`workshop-backend/src/analytics.ts`): lifecycle events (account
created, gadget opened, connections changed…) recorded to a Pipelines stream, best-effort with
failures logged.

## Frontend error reports: `/api/client-errors`

The browser pipeline is opt-in (`VITE_FRONTEND_ERROR_REPORTING`) and posts to same-origin
`POST /api/client-errors` (see [the app-shell page](/openwiki/frontend/app-shell.md)). The backend
endpoint (`packages/workshop-backend/src/client-errors.ts:91-154`):

- Requires same-origin POST with JSON.
- **Dispatches only when both `FRONTEND_ERROR_REPORTER` and `FRONTEND_ERROR_RATE_LIMITER` are
  bound; otherwise it is an intentional no-op (204)** — deployments without reporting destinations
  accept and drop reports (`client-errors.ts:109-111`).
- Rate limits by CF Access identity (a privacy-preserving derived key, hashed email if no `sub`) or
  by `cf-connecting-ip`; a limiter failure degrades to dropping the report (204).
- Reads the body bounded (128 KiB), normalizes it through `@gadgets/error-reporting`'s tolerant
  contract, and forwards with `waitUntil`.

The same no-secrets rules apply to anything thrown or attached as report metadata, because
exception messages and stacks reach the external Reporter (`REVIEW.md:47-58`). Concrete enforcement
examples: the Cloudflare gatekeeper keeps filter **values** out of audit entries and logs only
numeric error `codes` because a provider message can quote a caller's value back
(`packages/gatekeeper-cloudflare/README.md:90-101`); the frontend rebuilds `pageLocation` to
origin+pathname because a share link's fragment is a bearer capability; and `reportedUserId` is a
client-supplied, unverified label that must never be read as identity or authority.
