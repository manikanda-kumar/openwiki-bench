---
type: client
title: Web Client (Next.js)
description: The Next.js 16 dashboard — a same-origin BFF that signs every control-plane call, plus a layered real-time stack (transport, protocol state machine, pure reducer) and the session composer with target picker and draft warming.
tags: [web, nextjs, client, websocket, bff]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-93cf7d35cafae73be72279c1
    resource: repo://packages/control-plane/src/session/abandoned-draft-sweep.ts
  - id: openwiki-source-a981adcfd6cf12f4160f2ab1
    resource: repo://packages/shared/src/browser-auth-routes.ts
  - id: openwiki-source-517c919b252e1e5089226b37
    resource: repo://packages/web/src/hooks/use-session-socket.ts
  - id: openwiki-source-418e1ce5a2e6faaa4dfc20ec
    resource: repo://packages/web/src/hooks/use-session-transport.ts
  - id: openwiki-source-294f68358148d86d783abddf
    resource: repo://packages/web/src/hooks/use-warm-draft-session.ts
  - id: openwiki-source-866396dcda2257f4296197f1
    resource: repo://packages/web/src/lib/browser-api-fetch.ts
  - id: openwiki-source-62b94ee810f436e8d1d32fc0
    resource: repo://packages/web/src/lib/browser-auth-proxy.ts
  - id: openwiki-source-f92a272da85b38851895803e
    resource: repo://packages/web/src/lib/control-plane-service.ts
  - id: openwiki-source-3422eeacde16dcad65b48f87
    resource: repo://packages/web/src/lib/control-plane-transport.ts
  - id: openwiki-source-5a210d639df2d2575b2b37c8
    resource: repo://packages/web/src/lib/sandbox-provider.ts
  - id: openwiki-source-c089a773c446a48abc5ca7b9
    resource: repo://packages/web/src/lib/session-snapshot.ts
  - id: openwiki-source-3d83e22bcd2a01754bc826ed
    resource: repo://packages/web/src/lib/session-target.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/web` is the user-facing dashboard: new-session composer, live session timeline, automations UI, and a twelve-tab settings area. It deploys either to Vercel or to Cloudflare Workers via OpenNext (`open-next.config.ts`, `wrangler.toml`; production config is Terraform-generated), and its code branches on platform in exactly two places — control-plane transport and client-IP extraction.

## The BFF boundary

Nothing in the browser talks to the control plane directly.

- **Client side** — `src/lib/browser-api-fetch.ts` types `BrowserApiPath = \`/api/${string}\`` and pins `mode: "same-origin"`, so client code physically cannot fetch an off-origin URL. ESLint-enforced boundary tests (`client-auth-boundary-eslint.test.ts`, `server-auth-boundary-eslint.test.ts`) ban raw `fetch()` from client code and ban auth frameworks from server routes.
- **Server side** — one signing boundary: `src/lib/control-plane-service.ts` `dispatchWebServiceRequest` signs with `SERVICE_AUTH_SECRET` as service `web` via shared sig1, and `sanitizeForwardedHeaders` deletes caller-supplied `Authorization`/actor headers so only this layer mints identity. Resource routes add the user's session cookie through `controlPlaneUserFetch` (`src/lib/control-plane.ts`), which returns 401 without dispatching when the cookie is missing.
- **Transport** — `src/lib/control-plane-transport.ts` prefers the Cloudflare **service binding** `CONTROL_PLANE_WORKER` when running on Workers via OpenNext (`getServiceBinding`, L51–78), falling back to a plain fetch against `CONTROL_PLANE_URL` on Vercel or in `next dev`, with a 15s timeout.
- **Auth proxy** — `/api/auth/[...auth]` proxies to the control plane's Better Auth runtime, but only for routes in the shared allowlist `BROWSER_AUTH_PROXY_ROUTES` (`packages/shared/src/browser-auth-routes.ts:8–15`: sign-in/social, GitHub/Google callbacks, get-session, sign-out, error). Responses preserve every `Set-Cookie`, strip hop-by-hop and content-encoding headers, and force `no-store`; the trusted client IP is taken from `X-Vercel-Forwarded-For` on Vercel and `CF-Connecting-IP` on Cloudflare (`src/lib/browser-auth-proxy.ts:54–59`).

Most `/api/*` routes are thin proxies built from factories (`settings-proxy.ts`, `control-plane-json-proxy.ts`, `provider-account-proxy.ts`); `app/api/sessions/route.ts` demonstrates the pattern — POST picks an explicit allowlist of body fields (including `environmentId`/`repositories`), GET reuses shared's `SESSION_LIST_QUERY_PARAMS` allowlist rather than re-parsing query strings.

## Real-time stack

Three explicit layers, each testable alone:

1. **Transport** (`src/hooks/use-session-transport.ts`) — opens `${NEXT_PUBLIC_WS_URL}/sessions/${sessionId}/ws` (L298), sends `{type:"subscribe", token, clientId}` on open where the token comes from the BFF `POST /api/sessions/[id]/ws-token`, and **validates every inbound frame against shared's `serverMessageSchema`**, closing with code 4004 on the first schema failure (`parseWsMessage`, L10–13; handler L187–196). Reconnect uses exponential backoff 1s→30s capped at 5 attempts, with a connect-epoch so a superseded attempt never opens a stale socket; close codes 4001 (auth) and 4002 (session expired) end retries; a 30s `{type:"ping"}` keepalive runs while open.
2. **Protocol state machine** (`src/hooks/use-session-socket.ts`) — outbound `prompt` (with `clientRequestId` correlation, 5s subscription wait, 15s ack timeout), `cancel_prompt`, `stop`, `typing`, and cursor-paged `fetch_history` (page size 200), each a `clientMessageSchema` variant; settles prompts on correlated `prompt_queued`/`prompt_cancelled`/`error`.
3. **Pure reducer + event log** (`src/lib/session-socket/reducer.ts`, `event-log.ts`) — snapshot hydration, presence, cost accumulation from `step_finish`, sandbox-credential clearing on lifecycle changes, and multi-repo `session_branch` attribution; token events collapse to one final event per compaction segment. SWR revalidation is driven by a pure mapper (`swr-revalidation.ts`), so sidebar/inbox refresh rules are unit-testable without React.

The session page's first paint is server-rendered: the layout fetches a snapshot validated against the same shared `sessionSnapshotSchema` and seeds the reducer, so client and server speak one contract (`src/lib/session-snapshot.ts`, `src/app/(app)/(sidebar)/session/[id]/layout.tsx`).

## Composer and session targets

- **Target model** (`src/lib/session-target.ts:12–16`) — a discriminated `SessionTarget`: `none`, `repo`, `environment`, or `repos` (ad-hoc multi-repo), with combobox sentinels `__no_repository__`/`__multiple_repositories__` and an `env:` prefix. `buildSessionTargetRequestFields` (L105–129) emits **exactly one mode** of the mutually exclusive `createSessionRequestSchema` — the exclusivity lives in shared, so the UI cannot construct an invalid combination.
- **Warming** (`src/hooks/use-warm-draft-session.ts`) — on first keystroke the composer POSTs `/api/sessions` to create a draft session so the sandbox starts warming; the request identity is canonicalized JSON (L19–37) so only a material change retires the draft; submitting consumes the draft and navigates instead of creating a second session. Abandoned drafts are swept by a control-plane cron after 8h.
- The composer page sends the first prompt over HTTP (`POST /api/sessions/[id]/prompt`, validated against shared's `promptContentSchema`), while follow-ups on the session page travel over the WebSocket.

## Settings surface

`src/components/settings/settings-registry.ts` defines the tab registry (`models`, `provider-accounts`, `skills`, `environments`, `secrets`, `scm`, `sandbox`, `images`, `integrations`, `mcp-servers`, `data-controls`, …). Panel availability follows the deployed sandbox provider — e.g. the Images tab is gated by `supportsRepoImages()` (`src/lib/sandbox-provider.ts`), mirroring the control plane's image-build provider policy.

## Testing

82 co-located API-route tests and 88 component/hook tests. Representative: `use-session-transport.test.tsx` (subscribe handshake, invalid-frame close, backoff races), `reducer.test.ts` (credential clearing, cost accumulation, history reset), `browser-auth-proxy.test.ts` (allowlist, per-platform IP header, header leaks), `session-target.test.ts` (round-trip and launchability), `use-warm-draft-session.test.tsx` (identity churn retires drafts), plus the two ESLint boundary suites that lint synthetic source files.
