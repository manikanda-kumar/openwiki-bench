---
type: frontend
title: Frontend app shell and connectivity
description: The workshop-frontend SPA — module-global WebSocket lifecycle, auth modes, TanStack file-based routing, server config, feature flags, theming, and the frontend error-reporting pipeline.
tags: [frontend, react, routing, auth, error-reporting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-7bc5bc7e269ac1dc75353e17
    resource: repo://packages/workshop-frontend/src/FeatureFlagsContext.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-0440c9f801eb67b38e853dcf
    resource: repo://packages/workshop-frontend/src/router.tsx
  - id: openwiki-source-1edfd23988c8002efd3e2a7f
    resource: repo://packages/workshop-frontend/src/routes/__root.tsx
  - id: openwiki-source-390316a2ebc92a8cc0ecde8d
    resource: repo://packages/workshop-frontend/src/routes/gadget.%24id.tsx
  - id: openwiki-source-ef82c72a4282dac273d2a727
    resource: repo://packages/workshop-frontend/src/ServerConfigContext.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-7e19b35717925f519c29e2c1
    resource: repo://packages/workshop-shared/src/feature-flags.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Frontend app shell and connectivity

`packages/workshop-frontend` is a single-page app (the README argues for SPA over SSR explicitly:
users keep it open, gadgets need client-side sandboxing, and a clean RPC boundary makes alternative
clients possible — see `packages/workshop-shared/src/api.ts:3-25`). Entry is
`src/main.tsx`; routing is TanStack file-based under `src/routes/`.

## The connection manager (module-global, not React)

The WebSocket to `/api` is owned by module-level globals in `main.tsx`, deliberately outside React
(`main.tsx:36-58`). The specifics — `RpcPromise` swap on break, proven-connection reconnect with
jittered backoff, wake probes on visibility/network-online — are covered in
[the RPC protocol page](/openwiki/architecture/rpc-protocol.md). What the shell adds on top:

- `getBackendHost()` resolves `VITE_BACKEND_HOST` only in dev; built assets are always same-origin
  (`main.tsx:84-92`).
- On every (re)connect the shell refetches `getServerConfig()`, so a server restart with changed
  deployment config is picked up without a reload (`main.tsx:209-232`).
- `VITE_DEV_AUTO_LOGIN=true` creates/logs in a dev account before React renders so the login page
  never flashes; a failure is swallowed and the app still renders (`main.tsx:33-58`).

## Authentication

`useAuth` (`src/useAuth.ts`) implements three modes:

- **Token auth (default).** The session token from `PublicApi.login()`/`createAccount()` is stored
  in `localStorage['authToken']` and replayed via `authenticate()` on boot. `authenticate()` is
  called with **promise pipelining and no await**: the returned promise is used immediately as the
  `AuthenticatedApi` stub, so auth errors surface when the stub is first used rather than blocking
  boot (`useAuth.ts:96-119`).
- **Cloudflare Access.** `VITE_CF_ACCESS_MODE=true` switches to `authenticateFromCfAccess()`, where
  the browser already carries the Access JWT; logout redirects to `/cdn-cgi/access/logout`
  (`useAuth.ts:6`, `76-94`, `128-131`).
- **Inline login.** Pages rendered outside the auth gate (e.g. the blueprint landing page) run their
  own `useAuth` instance and call `login(token)` on success (`routes/__root.tsx:40-45`).

Stub hygiene follows the repo rules: replacing an authenticated stub disposes the old one (dispose
is idempotent, so reconnect double-dispose is fine) (`useAuth.ts:69-73`, `96-108`).

A subtle piece: `useAuth` names the signed-in user on **error reports** via
`setReportedUserId(info.id)` — keyed on the stub rather than called per-auth-path so it covers all
three modes, including the blueprint page that renders outside `AuthProvider`. Only real user
accounts name a person (`info.type === 'user'`). The value is an *unverified diagnostic label*; the
backend boundary normalizes it and never treats it as identity or authority
(`useAuth.ts:30-56`, `errorReporting.ts:204-211`).

## Routing and the shell

Routes are TanStack file-based (`src/routes/`: `index`, `workspaces`, `workspace.$id`,
`blueprints`, `blueprint.$id`, `explore`, `outputs`, `profile`, `admin`, `providers`,
`gatekeepers`, `gatekeepers_.$appId`, `context`, `signup`, and the legacy `gadget.$id`). The
router is created with scroll restoration and intent preloading (`router.tsx:1-11`).

The root route (`routes/__root.tsx`) is the auth gate and shell chooser:

- **Loading / auth-error / CF-Access-spinning / logged-out** states render full-page placeholders or
  `LoginPage` (`__root.tsx:47-85`).
- **Standalone mode**: `/signup`, and `/blueprint/$id` for signed-out visitors, render with a bare
  header and no auth wrapper — signed-in visitors of the same blueprint page get full chrome so it
  "feels native" (`__root.tsx:27-35`, `87-102`).
- **Fullscreen mode**: `/workspace/$id` (and legacy `/gadget/`, kept so chrome doesn't flash during
  the redirect) renders the editor without the app shell (`__root.tsx:36-38`, `165-181`). The
  legacy `/gadget/$id` route redirects to `/workspace/$id` preserving search params (`?chat=`,
  `?w=`) and the hash (`#share=`, `#fullscreen`) (`routes/gadget.$id.tsx:3-18`).
- **Onboarding gate**: after auth, `isOnboardingCompleted()` decides between `OnboardingWizard` and
  the shell; a failed check *skips* onboarding rather than blocking the user
  (`__root.tsx:129-163`).
- Connection loss is surfaced as a chip in whichever top bar is visible, never as a page-reflowing
  banner (`__root.tsx:165-167`).

## Server config, theme, and feature flags

`ServerConfigContext` (`src/ServerConfigContext.tsx`) publishes the deployment config fetched once
at boot: `authVendors`, `cloudflareLimitsEnabled`, `siteName`, `siteLogo`, `accentColor`, plus a
separate boolean context for "the latest config request failed". `main.tsx` applies the admin's
accent color over the brand CSS variables and the site logo as favicon, with cache-busting on the
logo URL (`main.tsx:209-260`).

Feature flags are fetched post-auth: `FeatureFlagsProvider` calls
`authenticatedApi.getUiFeatureFlags()` and merges over `DEFAULT_UI_FEATURE_FLAGS`; on failure it
falls back to defaults. The loaded value is keyed on the `authenticatedApi` stub identity, so a
replaced stub renders defaults while the new fetch is in flight
(`src/FeatureFlagsContext.tsx:18-53`). The flag registry itself lives in
`packages/workshop-shared/src/feature-flags.ts` (currently a single placeholder entry) with `dev`
values for local development.

## Frontend error reporting

Reporting is a separate, opt-in pipeline (`AGENTS.md`-level rules live in code here):

- **Compile-time gate**: enabled only when `VITE_FRONTEND_ERROR_REPORTING === 'true'` at build
  time; otherwise both `reportIssue` and automatic capture are no-ops
  (`errorReporting.ts:183-197`, `213-226`).
- **Transport**: reports POST to same-origin `/api/client-errors`
  (`errorReporting.ts:191-195`); the backend forwards only when both the `FRONTEND_ERROR_REPORTER`
  and `FRONTEND_ERROR_RATE_LIMITER` bindings exist (see
  [observability](/openwiki/operations/observability.md)).
- **Client-side throttle**: at most 10 reports per surface per 60-second window, deduplicated by a
  fingerprint of `failureSite + exception type + first stack frame`. The route is deliberately
  *absent* from the fingerprint so one fault on two routes is one issue and a navigation loop
  cannot exhaust the cap (`errorReporting.ts:66-125`).
- **Never rethrows**: the whole report path is wrapped so observability cannot change application
  behavior (`errorReporting.ts:122-124`).
- **Automatic capture** (`window.error`, `unhandledrejection`) installs before the RPC socket opens,
  and the React root reports uncaught render errors with `severity: 'fatal'`
  (`main.tsx:264-273`).
- **Gatekeeper frames**: `forwardTrustedFrameError` accepts a `postMessage` report only when
  `event.source` is the known frame window and `event.origin` is `null` (opaque-origin `srcDoc`
  frames), then forwards it with host-owned surface/vendor context
  (`errorReporting.ts:228-248`).
- `pageLocation` is rebuilt through `normalizePageLocation` (origin + pathname only) rather than
  trusted from the caller — a share link's fragment is a bearer capability and an `href` retains
  credentials (`errorReporting.ts:50-64`).
