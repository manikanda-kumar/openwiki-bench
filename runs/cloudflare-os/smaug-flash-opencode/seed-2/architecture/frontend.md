---
type: architecture
title: The Workshop Frontend
description: The pure-client React SPA in packages/workshop-frontend — how it opens an RPC WebSocket, hosts sandboxed gadget iframes and gatekeeper apps, and renders the home, chat / gadget editor, connections, blueprints, and admin UI.
tags: [frontend, ui, react, rpc, spa]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-c5df897833c1439c003cbf44
    resource: repo://packages/workshop-frontend/README.md
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-a0af2f1f7ce622da8e9be8ad
    resource: repo://packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# The Workshop Frontend

`packages/workshop-frontend` is the whole user interface of Cloudflare OS: a single-page
application that runs entirely in the browser and holds no authoritative state of its own. It is
the OS's "shell" in the README's hardware-prologue analogy (`README.md`, "It kind of is an
Operating System"). Everything it knows or changes goes through the RPC API defined in
`packages/workshop-shared` (see [Shared API and Cap'n Web RPC](/openwiki/architecture/shared-api.md)).

The SPA is a "fat client" by design: the app is likely to be open constantly, Gadgets cannot be
server-rendered, and a clean API boundary keeps the door open for alternative clients
(`packages/workshop-shared/src/api.ts:1` comment). The entry point is `src/main.tsx`, which renders
a TanStack Router (file-based routes in `src/routes/`) inside `FrontendErrorBoundary` and
`ThemeProvider`.

## RPC connection lifecycle

The app opens a single persistent Cap'n Web WebSocket RPC session to the backend at boot and keeps
it open for the whole session, reconnecting as needed (`packages/workshop-shared/src/api.ts:14`
comment). Connection management is deliberately hoisted out of React state and into module-level
globals in `src/main.tsx:47` (`startConnection`, `reconnect`, `handleBroken`), because React's
dev-mode double-effects were producing competing redundant WebSockets.

Key signals (all in `src/main.tsx`):

- `startConnection()` builds the `PublicApi` stub: in dev the backend host is
  `VITE_BACKEND_HOST` (default `localhost:8787`), while built assets are served from the same
  origin and use `window.location.host` in both production and `run-local` mode (`main.tsx:85`).
- `handleBroken()` sets `connectionLost`, then immediately publishes a fresh
  `RpcPromise<PublicApi>(reconnect())` (`main.tsx:151`). Because capnweb queues pipelined calls on
  an unresolved `RpcPromise` and delivers them in order once it resolves, work issued during an
  outage waits for the replacement connection instead of failing against a dead socket.
- `reconnect()` probes candidates with a `ping()` before adopting one, backing off with jitter
  (1 s to 10 s). Cap'n Web queues sends while a socket is still CONNECTING, so an unproven stub
  would look fine until everything pipelined onto it failed at once; probing is what makes recovery
  deterministic (`main.tsx:107`).
- Passive close detection misses sockets killed during laptop sleep or tab throttling, so on
  `visibilitychange` / `online` events the app "probes on wake" with a `ping()` and disposes a
  suspect stub to trigger recovery (`main.tsx:158`).

`RpcContext` (`src/RpcContext.tsx`) exposes the current stub and `connectionLost` flag. The stub is
wrapped in an object to avoid React's callable-state-setter pitfall for RPC stubs
(`RpcContext.tsx:7`).

## Boot and deployment config

On (re)connect the app re-fetches `getServerConfig()` and once it resolves (`main.tsx:227`)
applies the deployment's accent color and favicon, then serves `ServerConfigContext`. Re-fetching
on reconnect means a server restart with changed admin config is picked up. `devAutoLogin`
(`main.tsx:21`, gated on `VITE_DEV_AUTO_LOGIN`) creates/logs in a dev account in the background so
a developer never sees the login page.

## Authentication

The frontend supports two authentication modes selected at **build time** (`packages/workshop-frontend/README.md`):

- **Password mode (default)** — a username/password login page plus a `/signup` page. The client
  computes the `argon2id` password hash (see `/openwiki/operations/auth.md`) so the raw password is
  never seen by the server.
- **Cloudflare Access mode** — when building with `VITE_CF_ACCESS_MODE=true`, the login/signup
  pages are disabled and the app authenticates automatically via `authenticateFromCfAccess()` using
  the CF Access session that already gates the origin.

`src/useAuth.ts` owns the auth flow: `useAuth(publicApi)` returns `{ authenticatedApi, token,
logout, ... }`. A stored `localStorage['authToken']` triggers `authenticate(token)`, and both
authenticate paths pipeline the returned `AuthenticatedApi` stub directly into React state rather
than awaiting it (`useAuth.ts:110`). In CF Access mode `logout` redirects to
`/cdn-cgi/access/logout`. The `use` hook also names the signed-in user on frontend error reports.

`src/routes/__root.tsx` renders the shell: public routes (`/signup`, unauthenticated `/blueprint/`)
render standalone without the app chrome; the workspace editor renders fullscreen; everything else
gets the persistent left-rail `AppShell`. After login the app checks onboarding status and may show
`OnboardingWizard` before the normal chrome.

## Gadget hosting: sandboxed iframes over postMessage RPC

Each Gadget's UI runs in a sandboxed iframe that cannot reach the internet at all. Its only
communication channel is `postMessage()` to the parent frame, over which it speaks Cap'n Web RPC to
the Workshop — which hands it a stub to the Gadget's server-side Durable Object
(`packages/workshop-shared/src/api.ts:21` comment).

`src/GadgetUI.tsx` drives this. The injected gadget code is prefixed with a block that imports the
entire Cap'n Web library (embedded as a nested `data:` URL because the iframe is totally sandboxed),
opens a `MessageChannel`, posts the handshake, and creates the RPC session (`GadgetUI.tsx:25`). The
prefix also:

- monkey-patches `console` to forward logs to the parent frame (`GadgetUI.tsx:36`);
- blocks `window.open()` (only `target="_blank"` links allowed) (`GadgetUI.tsx:52`);
- forwards `Escape` keydown and ensures `_blank` links get `rel=noopener` (`GadgetUI.tsx:65`);
- reports uncaught errors and unhandled rejections to the parent (`GadgetUI.tsx:87`).

The HTML is wrapped with a strict `Content-Security-Policy` (`default-src 'none'; ... connect-src
'none'; ...`) so the iframe cannot make network requests at all (`GadgetUI.tsx:105`). The parent
side establishes the MessagePort session, bounds gadget RPC calls during disconnects, and reloads
the bundle on reconnect.

## Gatekeeper management apps

Full-page gatekeeper management UIs (e.g. the Context Library and the Scheduler) are hosted by
`src/SandboxedGatekeeperApp.tsx` in a sandboxed, network-isolated `srcDoc` iframe
(`sandbox="allow-scripts allow-modals"`, opaque origin, CSP `connect-src 'none'`). The app talks to
the gatekeeper only through the `ui` capability the Workshop relays over a MessagePort RPC session.

A `GatekeeperAppHostImpl` (`SandboxedGatekeeperApp.tsx:81`) is the object exposed to the frame: it
relays the gatekeeper's `ui` capability (rate-limited to 8 concurrent / 600 calls-min / 128 pending,
throttle on limit), validates workspace navigation and title lookups, accepts a theme subscription,
and lets the app grow its iframe to a full-viewport overlay for modals. All of this host surface is
treated as untrusted input. The handshake is accepted only from the frame's own `contentWindow` with
origin `null`.

## Main user surfaces

The TanStack route tree (`src/routes/` + `src/router.tsx`) maps the primary screens:

- `/` — the home page: gadget listing, agent composer (seeded with the deployment's "New …" format
  prompts), blueprints tab, sources.
- `/workspace/$id` — the workspace / Gadget editor: the `GadgetEditor`, `ChatInterface`, and the
  sandboxed `GadgetUI`. `/gadget/$id` is kept as a legacy redirect. (The workspace editor renders
  fullscreen, no app chrome.)
- `/blueprint/$id` — the blueprint landing page, the one authenticated public-flow surface;
  `/blueprints` — the user's published + library blueprints.
- `/explore` — featured blueprints.
- `/connections` (`Connections`) — connected accounts, auto-provisioning ("ambient") gatekeepers
  opt-in, and resources; `/gatekeepers` + `/gatekeepers/$appId` — gatekeeper management apps.
- `/admin` (`AdminPage`) — deployment admin: branding, agent instructions, resource/gatekeeper
  toggles, formats promotion, featured blueprints.
- `/outputs` — the Outputs page listing everything the user made across workspaces.
- `/profile`, `/settings`, `/signup` — account surfaces.

Components that drive shared workflows include `ShareModal`, `BlueprintModal`, `ConnectAccountModal`,
`GatekeeperModal`, `ResourcePicker`, `ObserverConfigModal`, `CodeEditor`/`CodeDiffEditor`, and the
billing `AccountSelectionModal`.

## State model

The client is intentionally stateless with respect to authority: it subscribes to lists (e.g.
`subscribeConnectedAccounts`) and re-fetches config and workspace state from the backend, rather
than persisting authority itself. `useActions`, `useActionHistory`, `otClient`, and `composerDraft`
manage UI-local working state (e.g. realtime text editing and pending chat drafts) client-side.

## Build modes

`build` is a Vite+ task (not a package.json script) declaring `env: ['VITE_*']`, so the Vite flags
(notably `VITE_CF_ACCESS_MODE`) are fingerprinted into the task cache and a changed flag is a cache
miss rather than a stale bundle. It always produces a production bundle regardless of ambient
`NODE_ENV`, and it deletes `dist/` before building to avoid stale sourcemaps on a cache hit
(`packages/workshop-frontend/README.md`). All frontend assets are bundled and either served by the
`router`'s `ASSETS` binding in production or by Vite dev in development.
