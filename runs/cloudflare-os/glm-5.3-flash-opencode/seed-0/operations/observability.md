---
type: observability
title: "Observability, Logging, and Error Reporting"
description: The server-side structured logger and its conventions, the per-package observability context and tracing, the issue Reporter path, and the separate opt-in frontend error-reporting pipeline with its trust rules (same-origin endpoint, rate limiting, untrusted reportedUserId, rebuilt pageLocation).
tags: [observability, logging, error-reporting, tracing, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-6ca8e4368284270b70baf17c
    resource: repo://packages/backend-utils/src/error-reporting.ts
  - id: openwiki-source-1c512cdc924c5b8c80bd6e0b
    resource: repo://packages/backend-utils/src/logger-core.ts
  - id: openwiki-source-542ec152b1d74df0c2f74e1d
    resource: repo://packages/backend-utils/src/observability-context.ts
  - id: openwiki-source-013c8d62690950024cd36181
    resource: repo://packages/error-reporting/src/index.ts
  - id: openwiki-source-4ac1b67126ca89980accd56f
    resource: repo://packages/workshop-backend/src/client-errors.ts
  - id: openwiki-source-a9925842d6314d695265e6d4
    resource: repo://packages/workshop-backend/src/observability.ts
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Observability, Logging, and Error Reporting

Two pipelines exist, deliberately separate: **server-side logging/reporting** (`@gadgets/backend-utils`) and **frontend browser error reporting** (`@gadgets/error-reporting` + the backend's `/api/client-errors` sink).

## Server-side logging

`createLogger<Fields>({component, ...})` builds a structured Workers logger with **fixed metadata and a typed field vocabulary** (packages/backend-utils/src/logger.ts:1-11, packages/backend-utils/src/logger-core.ts:52-58). The conventions, enforced by the type system (packages/backend-utils/src/logger-core.ts:4-49):

- `ReservedLogField`s (`body`, `headers`, `prompt`, `secret`, `token`, …) are **prohibited as package field names** — the schema makes it a type error to declare or log a field with a secret-shaped name, with `event` and `component` the only exceptions (as the required discriminator/fixed metadata).
- Each call emits one indexed object: `{component, event, ...fields, error?}`; `component` is fixed (defaults win, explicit fields override ambient context, call details override both) (packages/backend-utils/src/logger-core.ts:114-127).
- Level semantics are documented on the interface: `debug` = noisy diagnostic, `info` = notable lifecycle, `warn` = a failure the operation continues past, `error` = a failure needing attention (packages/backend-utils/src/logger-core.ts:54-58).
- Caught values are passed as `error`; the helper stringifies `Error` instances, uses an object's own `message` for plain objects, and adds stacks — deliberately without traversing causes or copying arbitrary properties (packages/backend-utils/src/logger-core.ts:59-66).
- `logger.with(fields)` returns an **immutable** child logger for object-owned context (packages/backend-utils/src/logger-core.ts:74-76).

Gatekeepers name their loggers with a `vendorId` field (e.g. `component: "gatekeeper.github", vendorId: VENDOR_ID`), and every module logs concrete `event` names with relevant typed fields (packages/workshop-backend/src/observability.ts:41-43, packages/gatekeeper-github/src/observability.ts).

## Observability context and tracing

`createObservabilityContext<Fields>()` creates an **AsyncLocalStorage-backed, package-owned context**: `withContext(fields, callback)` re-establishes bounded operation context for deep helpers, and loggers created through the context read it as ambient fields. Context **does not cross RPC, hibernation, or restart** — it must be re-established at those boundaries; it requires `nodejs_als` (or `nodejs_compat`) (packages/backend-utils/src/observability-context.ts:13-31). The workshop root defines its field vocabulary once (`WorkshopObservabilityFields`), exports `obsContext`, builds every `createWorkshopLogger(component)` through it, and exposes `traced` (a tracer reading the same context) (packages/workshop-backend/src/observability.ts:5-46).

## The issue Reporter path

`reportIssue(failureSite, caught, options?)` (packages/backend-utils/src/error-reporting.ts:87-102) is a **no-op when the `ERROR_REPORTER` binding is absent** (local dev, deployments without an issue destination). Otherwise it builds a bounded `ErrorEventV1` — schema version, occurrence id, severity, `handled`, bounded exception via `serializeException`, and **only bounded scalar attributes** (`MAX_ATTRIBUTE_KEYS = 32`) — and dispatches via `waitUntil`, so a dispatch failure never disturbs the caller. Ambient fields come from the package's observability context; capture-site fields augment them. The same no-secrets rule as logs applies: never put secrets, prompts, tokens, headers, or bodies in thrown errors or report metadata (REVIEW.md:47-56).

## Frontend error reporting

A separate, opt-in pipeline (packages/workshop-frontend/src/errorReporting.ts:183-233):

- `VITE_FRONTEND_ERROR_REPORTING=true` at build time enables trusted frontend producers (and their hidden source maps); deployments without reporting leave it unset and every report call is a no-op.
- The Workshop browser installs `window.error`/`unhandledrejection` capture **before the RPC WebSocket opens**, and sends best-effort reports to the same-origin `POST /api/client-errors`.
- `reportedUserId` is supplied by the client and **unverified — the name records that it is a report, not a finding**: a diagnostic label that must never be read to make a decision (packages/error-reporting/src/index.ts:91-96, packages/workshop-frontend/src/errorReporting.ts:205-209).
- `pageLocation` is **origin and pathname only, rebuilt by `normalizePageLocation`** rather than trusted from producers — a share link's fragment is a bearer capability and an `href` retains credentials; non-`http(s)` URLs (blob:, about:srcdoc) are dropped entirely (packages/error-reporting/src/index.ts:84-90).
- Reports never convey authority: the report type is documented as "no field in this report conveys authority" (packages/error-reporting/src/index.ts:75-76).

### The backend sink

`handleClientErrorRequest` (packages/workshop-backend/src/client-errors.ts:98-159) is **deliberately a no-op unless both `FRONTEND_ERROR_REPORTER` and `FRONTEND_ERROR_RATE_LIMITER` are bound** (204 immediately). Otherwise: POST-only, same-origin only, JSON-only, a 128 KiB bounded body, a rate-limit key derived from the verified Cloudflare Access identity (or `cf-connecting-ip` otherwise — and a rate-limiter failure fails **closed** to 204), then `normalizeFrontendErrorReport` (tolerant, bounded) and a `waitUntil` dispatch to the Reporter with host-owned surface/vendor context added (packages/workshop-backend/src/client-errors.ts:98-159, 60-96).

### Gatekeeper frames

Gatekeeper management/configurator UIs run as Workshop-owned **opaque-origin `srcDoc` frames**; they send bounded reports with `postMessage`, and the host (`forwardTrustedFrameError`) accepts them **only from the known frame window with `event.origin === "null"`**, adds host-owned surface/vendor context, and performs the same-origin POST — gatekeeper Workers never report cross-origin directly (packages/workshop-frontend/src/errorReporting.ts:236-244, packages/error-reporting/src/index.ts:19-20, 104-108).

## Related pages

- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md) — where the sink is wired into the fetch handler.
- [Frontend SPA and Connection Lifecycle](/openwiki/frontend/spa.md) — when capture installs relative to the RPC session.
