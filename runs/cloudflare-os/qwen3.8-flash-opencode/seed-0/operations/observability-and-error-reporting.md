---
type: operations
title: Logging, Observability, and Error Reporting
description: Server-side structured logging conventions and the reserved-field ban, per-operation observability context and tracing, reportIssue to the optional Reporter binding, and the separate opt-in frontend error-reporting path including the gatekeeper iframe postMessage route into /api/client-errors.
tags: [logging, observability, error-reporting, frontend, rate-limiting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-6ca8e4368284270b70baf17c
    resource: repo://packages/backend-utils/src/error-reporting.ts
  - id: openwiki-source-1c512cdc924c5b8c80bd6e0b
    resource: repo://packages/backend-utils/src/logger-core.ts
  - id: openwiki-source-542ec152b1d74df0c2f74e1d
    resource: repo://packages/backend-utils/src/observability-context.ts
  - id: openwiki-source-7178db64bf65fc3e39f7ae12
    resource: repo://packages/backend-utils/src/tracing.ts
  - id: openwiki-source-2043cc78a214b08c4b322a6f
    resource: repo://packages/error-reporting/src/index.test.ts
  - id: openwiki-source-013c8d62690950024cd36181
    resource: repo://packages/error-reporting/src/index.ts
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
  - id: openwiki-source-a0af2f1f7ce622da8e9be8ad
    resource: repo://packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Logging, Observability, and Error Reporting

Failure visibility splits into one server-side discipline (logs + optional `reportIssue`) and one deliberately separate, opt-in browser path. Neither may carry secrets: prompts, headers, tokens, and request/response bodies are out-of-bounds for every channel here — exception messages and stacks are explicitly the thing to keep clean at capture sites (root guidance; enforced by convention plus the API shapes below).

## Server logging: typed, module-scoped, banned-field

`@gadgets/backend-utils/logger` creates structured loggers with fixed `component` metadata (packages/backend-utils/src/logger.ts:1-9). The convention: each package defines a field vocabulary and module-scoped loggers, e.g. the Workshop backend's `createWorkshopLogger(component)` binds the `WorkshopObservabilityFields` type — chatId, gadgetId, gatekeeperId, `outcome`, event names — so a field name can't mean different things across the log stream (packages/workshop-backend/src/observability.ts:4-43).

The type system *itself* participates in the no-secrets rule: `ReservedLogField` (`"body"`, `"headers"`, `"header"`, `"prompt"`, `"secret"`, `"token"`, `"error"`, `"message"`, `"component"`, `"event"`) is banned from custom-field types — the `ProhibitedFields` mapped type makes declaring them a compile error, while `error` is allowed only as the normalized caught value and `event` is the required concrete event name (packages/backend-utils/src/logger-core.ts:12-45). Caught values go through a deliberately small `normalizeError`: stringify Errors/primitives, use an own string `message` for plain objects, omit undefined — no cause traversal (packages/backend-utils/src/logger-core.ts:47-70). Levels follow the house semantics: `error` needs attention, `warn` continues best-effort, `info` is lifecycle, `debug` is breadcrumbs (e.g. report dispatch failures log at debug: packages/backend-utils/src/error-reporting.ts:91-99).

## Ambient observability context

`createObservabilityContext<Fields>()` is an AsyncLocalStorage-backed, package-owned context whose `createLogger` folds the ambient fields into every log automatically; `with(fields)` merges immutably for the callback's duration, and the context **does not cross RPC, hibernation, or restart** — each operation re-establishes it (packages/backend-utils/src/observability-context.ts:13-30). The overseer's agent turns are the pattern: `#runAgentTurn` wraps the work in `obsContext.with({operation: "agent.run", gadgetId, chatId, modelId}, ...)` inside a `traced(...)` span (packages/workshop-backend/src/overseer.ts:5703-5713), and `createTracer`'s `traced` stamps ambient context onto span attributes with sync/async correctness (packages/backend-utils/src/tracing.ts:5-20).

## `reportIssue`: failures to the optional external Reporter

`reportIssue(failureSite, caught, options?)` dispatches the same bounded `ErrorEventV1` shape to a private Reporter Worker via the optional `ERROR_REPORTER` service binding — **a no-op when the binding is absent** (local dev, deployments without an issue destination) (packages/backend-utils/src/error-reporting.ts:24-38, 87-89). Design properties recorded in the module:

- It reads ambient `env`/`waitUntil` from `cloudflare:workers`, so one line reports from any Worker/DO/alarm without plumbing; the RPC dispatches *eagerly* — in a DO the pending outbound I/O itself keeps the object alive (packages/backend-utils/src/error-reporting.ts:69-85);
- Reporting **never disturbs the caller**: every failure path is caught and logged at debug (packages/backend-utils/src/error-reporting.ts:86-100);
- Events are built without traversing arbitrary thrown objects: `serializeException` bounds message/stack, `attributes` keep only bounded scalars (`Object.create(null)` output), http `kind` collapses to the two literals, all with a `truncated` marker (packages/backend-utils/src/error-reporting.ts:41-58, 102-140).

Capture sites augment attributes with `obsContext.get()` plus local fields (pattern shown for the overseer catalog fallback in root guidance; see e.g. scheduler alarm reporting: packages/gatekeeper-scheduler/src/schedule-driver.ts:258-261, 309-322).

## The frontend path: opt-in, vendor-neutral, bounded

`packages/error-reporting` owns the browser/Worker event contract and tolerant bounded normalization. Key invariants (packages/error-reporting/src/index.ts):

- `reportedUserId` is **supplied by the client and unverified** — "the name records that it is a report, not a finding"; it is a diagnostic label that must never be read to make a decision (index.ts:87-96, 258-270);
- `pageLocation` is *rebuilt* by `normalizePageLocation` to origin + pathname only, never trusted from producers, because a share link's fragment is a bearer capability and an `href` retains credentials; non-http(s) values are dropped entirely (index.ts:80-92, 151-181);
- hostile input is survived: `serializeException` truncates oversized message/stack, ignores throwing getters, and never crashes — pinned by direct tests (packages/error-reporting/src/index.test.ts:19-40).

Enabling is a **build-time decision**: `VITE_FRONTEND_ERROR_REPORTING=true` turns on trusted first-party producers and their hidden source maps; unset means the reporting code isn't shipped (packages/workshop-frontend/src/errorReporting.ts:183; env-passthrough declares `VITE_*` on the build task, packages/workshop-frontend/vite.config.ts:37-42). Automatic capture installs **only in trusted first-party surfaces, never gadget/user code** (`installWorkshopErrorReporting`, packages/workshop-frontend/src/errorReporting.ts:214).

Browser reports go best-effort to the same-origin `POST /api/client-errors` (errorReporting.ts:191).

## Gatekeeper UIs report through the host

Gatekeeper management/configurator UIs are Workshop-owned `srcDoc` frames on an opaque origin whose CSP keeps `connect-src 'none'` — they *cannot* POST anywhere (packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx:363-373). Instead the frame postMessages bounded reports and the **host** accepts them only from its own `frameWindow` with `event.origin === 'null'`, prefixes `failureSite` with `frame:`, adds host-owned surface/gatekeeper-vendor context, and performs the same-origin POST — no direct cross-origin reporting from a gatekeeper Worker domain is added (packages/workshop-frontend/src/errorReporting.ts:229-248; SandboxedGatekeeperApp.tsx:330-350).

## The `/api/client-errors` endpoint

Handled at the backend fetch root (packages/workshop-backend/src/server.ts:812-815), `handleClientErrorRequest` is strict-by-default and deliberately silent (packages/workshop-backend/src/client-errors.ts:95-154):

- POST-only, same-origin header required, `application/json` required; body bounded at 128 KiB via a streaming reader;
- **dispatch happens only when both `FRONTEND_ERROR_REPORTER` and `FRONTEND_ERROR_RATE_LIMITER` are bound — otherwise the endpoint is an intentional no-op returning 204**, the shape for deployments without reporting;
- rate limiting keys on the verified Cloudflare Access identity when in Access mode, else `cf-connecting-ip`; any limiter failure answers 204 (silently drop, never error-echo to an attacker; dispatch failures log at debug);
- payloads pass `normalizeFrontendErrorReport` (the tolerant bounded normalizer) and dispatch through `waitUntil`; every response is a bare 204 so nothing distinguishes outcomes to the client.

## Wrangler-side observability

Each deployable worker configures `observability` in its `wrangler.jsonc` (backend: head sampling on, invocation logs off, traces at 0.5 with a dated billing caveat: packages/workshop-backend/wrangler.jsonc:94-102; gatekeepers likewise with sampling 1: packages/gatekeeper-github/wrangler.jsonc:20-25).

## Uncertainty

- The private Reporter Worker itself is external to this repo — delivery beyond `report(event)` is not established here (packages/backend-utils/src/error-reporting.ts:26-32).
