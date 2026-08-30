---
type: architecture
title: Web Client
description: Next.js dashboard that authenticates users, proxies the control plane as a BFF, hydrates sessions from a secret-free snapshot, and applies live WebSocket updates.
tags: [web, nextjs, bff, websocket, opennext]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-fc3db59cefc7bbb9deebc229
    resource: repo://packages/web/next.config.ts
  - id: openwiki-source-56eeb909ebf5327cfe5481e6
    resource: repo://packages/web/open-next.config.ts
  - id: openwiki-source-e4805075016b15011ca3d9e3
    resource: repo://packages/web/src/app/(app)/(sidebar)/session/%5Bid%5D/layout.tsx
  - id: openwiki-source-56595e70a41c9bfedaa261d7
    resource: repo://packages/web/src/app/api/sessions/route.ts
  - id: openwiki-source-4ac15c2390cb9da96f061c45
    resource: repo://packages/web/src/hooks/use-sandbox-access.ts
  - id: openwiki-source-418e1ce5a2e6faaa4dfc20ec
    resource: repo://packages/web/src/hooks/use-session-transport.ts
  - id: openwiki-source-866396dcda2257f4296197f1
    resource: repo://packages/web/src/lib/browser-api-fetch.ts
  - id: openwiki-source-d3a155cacc03da9040e3f415
    resource: repo://packages/web/src/lib/client-auth-boundary-eslint.test.ts
  - id: openwiki-source-dd375617f2284a81a1df700b
    resource: repo://packages/web/src/lib/control-plane.ts
  - id: openwiki-source-c089a773c446a48abc5ca7b9
    resource: repo://packages/web/src/lib/session-snapshot.ts
  - id: openwiki-source-fcc0e7d3f88e4c8b921f292f
    resource: repo://packages/web/src/lib/session-socket/reducer.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Web Client

`packages/web` is the user-facing Next.js 16 / React 19 app. It is a **client of the control plane**, not a second session runtime. Browser code talks only to same-origin `/api/*` routes. Those routes attach a Better Auth cookie and a `service:web` `sig1` signature, then call the control plane. Live streaming uses a browser WebSocket straight to the control plane, after a BFF-minted token.

See [Control Plane](/openwiki/architecture/control-plane.md), [Realtime Protocol](/openwiki/architecture/realtime-protocol.md), and [Security Model and Authentication](/openwiki/concepts/security-and-auth.md).

## Surfaces

App Router pages under `packages/web/src/app`:

- `/login` — sign-in
- `/` — session inbox/dashboard
- `/session/[id]` — live session (timeline, prompt composer, diffs, terminal/VNC when enabled)
- `/automations` — scheduled and event-driven automations
- `/analytics`
- `/settings` and `/settings/integrations/[id]` — secrets, environments, skills, MCP, model accounts, SCM, bots

`(app)` is wrapped in `AppAuthBoundary`. Unauthenticated snapshot fetches redirect to `/login`; missing sessions render Next.js `notFound()`.

## BFF boundary

The browser must not call the control plane or use raw `fetch`. ESLint `no-restricted-globals` / `no-restricted-imports` tests in `client-auth-boundary-eslint.test.ts` reject raw `fetch` from components, hooks, and ordinary client libraries, and reject NextAuth client imports.

`browserApiFetch` is the only browser HTTP helper: it types paths as `/api/${string}`, forces `mode: "same-origin"` and `credentials: "same-origin"`.

Server routes under `packages/web/src/app/api` are the BFF:

- `/api/auth/[...auth]` proxies Better Auth through `proxyBrowserAuthRequest` (still `sig1`-signed).
- `/api/sessions` lists and creates sessions. Create **picks** allowed body fields (`repoOwner`/`repoName`, `environmentId`, `repositories`, model, skills, provider selections). Identity and SCM tokens are not taken from the client.
- Session sub-routes (prompt, archive, attachments, diffs, sandbox-access, ws-token, children, skills, …) follow the same pattern.

`controlPlaneUserFetch` refuses to call the Worker if no session cookie is present (`401`). Every request carries a fresh `service:web` signature **and** the opaque Better Auth cookie. Caller-supplied identity headers are discarded. Transport is either a Cloudflare service binding or a URL fetch (`control-plane-transport.ts`).

Middleware on `/api/*` stamps `x-trace-id` / `x-request-id` onto the request and response so BFF logs line up with control-plane logs.

## Session hydration and live updates

`session/[id]/layout.tsx` is a server component. It calls `getSessionSnapshot(id)` (`controlPlaneUserFetch` + `sessionSnapshotSchema.parse`) and provides the result through `SessionSnapshotProvider`. `401` → `/login`, `404` → `notFound()`. The HTTP snapshot is secret-free (ADR 0003).

The client page uses `useSessionSocket`:

1. `useSessionTransport` opens `NEXT_PUBLIC_WS_URL` (default `ws://localhost:8787`), mints a token via the BFF, and `subscribe`s.
2. Incoming frames are parsed with `serverMessageSchema.safeParse` before they enter the reducer (ADR 0002 boundary normalization).
3. `sessionSocketReducer` is a pure projection: `subscribed` replaces SSR state; later semantic messages update the view. Transport, token buffering, and SWR revalidation sit outside the reducer.
4. `useSandboxAccess` fetches `/api/sessions/:id/sandbox-access` only when the sandbox is ready, and refreshes on `sandbox_access_changed`. Passwords never ride the snapshot.

Reconnects use exponential backoff (max 5 attempts) except close `4001` (auth required, remint token) and `4002` (session expired). Ping interval is 30 seconds.

The composer can **warm** a session on first keystroke (`use-warm-draft-session`). Abandoned unprompted sessions are later archived by the control-plane draft sweep.

## Build-time WebSocket URL

`NEXT_PUBLIC_WS_URL` is read as `process.env.NEXT_PUBLIC_WS_URL` in client code. Next.js inlines `NEXT_PUBLIC_*` at **build** time. Terraform therefore supplies it when building the web app (`web-vercel.tf`, `web-cloudflare.tf`). Changing the control-plane WebSocket host requires a web rebuild, not just a runtime env change.

## Deploy platforms

`next.config.ts` uses `output: "standalone"` and points Turbopack/file tracing at the monorepo root so `@open-inspect/shared` resolves.

`open-next.config.ts` is `defineCloudflareConfig()` for the Cloudflare Workers path (`web_platform = "cloudflare"` in Terraform). The Vercel path uses the same Next app without OpenNext. See [Deployment and Operations](/openwiki/operations/deployment.md).

## Focused tests

Co-located Vitest covers BFF routes (`route.test.ts`), `use-session-socket`, sandbox-access, control-plane signing (`control-plane.test.ts`), and the ESLint auth boundary. UI pages under `(sidebar)` have page tests for the dashboard and automations.
