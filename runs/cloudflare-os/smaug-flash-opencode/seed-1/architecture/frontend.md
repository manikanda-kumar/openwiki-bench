---
type: "Reference"
title: "The Workshop Frontend SPA"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-cf955a203cea8d3709da54d4
    resource: repo://packages/workshop-frontend/src/App.tsx
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-87ad9ddb85476e8803af6d66
    resource: repo://packages/workshop-frontend/src/GatekeeperAppPage.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-0440c9f801eb67b38e853dcf
    resource: repo://packages/workshop-frontend/src/router.tsx
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-a0af2f1f7ce622da8e9be8ad
    resource: repo://packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---


# The Workshop Frontend SPA

`packages/workshop-frontend` is a pure single-page app running entirely client-side. It speaks to the
backend through the Cap'n Web RPC API over a persistent WebSocket connection. It is built with React
(StrictMode), Kumo UI (`@cloudflare/kumo`), Phosphor icons, Vite, and TanStack Router.

## Bootstrap and the WebSocket RPC connection

The entry point is `src/main.tsx`. The connection is *not* managed by `useEffect`/`useState` (which
in dev mode runs twice and would create redundant WebSockets); instead it is pulled out into module
globals at the top of `main.tsx`:

- `startConnection()` builds the WebSocket URL (`ws(s)://<host>/api`) from `getBackendHost()` and
  calls `newWebSocketRpcSession<PublicApi>(wsUrl)` from capnweb, registering an `onRpcBroken`
  handler.
- `handleBroken()` — on disconnect — publishes a new `RpcPromise` that resolves to the result of
  `reconnect()`, then notifies subscribers. Because capnweb queues calls pipelined onto an unresolved
  `RpcPromise` and delivers them in order once it resolves, work issued during the outage waits for
  the replacement connection instead of failing against a known-dead socket.
- `reconnect()` probes candidate connections with jittered backoff (`ping()` under a 20s deadline)
  and resolves only to a proven connection.
- `probeOnWake()` — on tab-visible or network-online — pings the current stub to detect sockets killed
  during laptop sleep or tab throttling, disposing the suspect if it doesn't answer.

The resulting stub and the `connectionLost` boolean are stored in `RpcContext` (an object, because
React's state setter must never receive a callable stub directly). `AppWithConnection` reads the
sensitive deployment config once the stub is available via `stub.getServerConfig()`, applies the
admin accent color and site favicon/logo, and renders `<RouterProvider router={router} />` wrapped in
`ThemeProvider`, `RpcContext`, `ServerConfigContext`, and `ServerConfigErrorContext`.

The `PublicApi` stub is retrieved throughout the app by `useRpcStub()` from `RpcContext`.

## Authentication flows

Login is driven by `AuthContext` and `LoginPage`. The app supports three mechanisms:

- **Username/password** — client-side argon2id hashing via `passwordHash.ts`, then
  `createAccount`/`login`. A stored `authToken` in `localStorage` is passed to `authenticate()`,
  and `authenticateFromCfAccess()` is used when sitting behind Cloudflare Access.
- **Gatekeeper sign-in** — `startGatekeeperLogin(vendorId)` returns an OAuth popup URL and an
  `attempt` stub (`LoginAttempt`) whose `wait()` resolves once the popup completes. This is the
  flow that powers "Continue with Google/GitHub/Cloudflare" buttons.
- **Cloudflare Access** — `authenticateFromCfAccess()`.

There is also a dev auto-login path only active when `VITE_DEV_AUTO_LOGIN=true` (not a runtime
feature).

## Routing and views

Routing is entirely client-side via TanStack Router with file-based routes under `src/routes/`
(`App.tsx` is a leftover reference, no longer used). Route files include: `index` (Home), `login`
via the protected `__root`, `signup`, `workspaces`, `workspace.$id` (the editor shell),
`gadget.$id` (a gadget-opener/landing), `blueprint.$id`, `blueprints`, `explore`,
`gatekeepers` and `gatekeepers_.$appId` (the gatekeeper management page), `context`, `outputs`,
`profile`, `admin`, and `providers`.

Views are built from top-level components: `GadgetUI`, `GadgetEditor`, `GadgetUseView`,
`Connections`, `BlueprintsPage`, `SettingsPage`, `AdminPage`, `GatekeeperAppPage`, `Activity`,
`OnboardingWizard`, and `ResourcePicker`.

## Sandboxed iframe model

Gadgets and gatekeeper UIs run in rigidly sandboxed iframes.

### Gadget iframes

`GadgetUI.tsx` shows the full model. The sandboxed iframe can talk to the world only via
`postMessage()` to the parent. The entire Cap'n Web library is embedded (`import CAPNWEB_BUNDLE from
'capnweb?raw'`), base64-encoded into a `data:` URL module, and the gadget code is prefixed with a
bootstrap that:

- Opens a `MessageChannel` and posts a `handshake` to `window.parent`, transferring `port2`.
- Creates a `newMessagePortRpcSession(port1)` talking to the parent — through which the Workshop
  provides a stub pointing at the Gadget's server-side Durable Object interface.
- Monkey-patches `console.*` to forward logs to the parent.
- Blocks programmatic `window.open` (only user-activated `target=_blank` links allowed), forwards
  `Escape` keydowns to the parent, and restricts navigation/popups.

The whole code is delivered as a doubly-nested `data:` URL inside the sandboxed iframe, which is
otherwise blocked from the internet via Content-Security-Policy and iframe sandbox settings.

### Gatekeeper UIs

Full-page gatekeeper management apps (`GatekeeperAppPage` → `SandboxedGatekeeperApp`) render the
gatekeeper-supplied `iframeHtml` in an iframe with `srcDoc`, sandboxed to an opaque origin
(`allow-same-origin` is deliberately off). The Workshop exposes the gatekeeper's `ui` capability
(GatekeeperUiFrame.ui, an RPC stub) over a MessagePort session. The host accepts the iframe's
`handshake` only when `event.origin === 'null'` and `event.source` is the known frame window, so no
cross-origin frame is trusted; a second handshake invalidates any prior session. The `ui` stub is
disposed in the effect cleanup.

The resource-selection/creation flows use the same pattern through `ResourceConfiguratorHost`
(`startResourceConfigurator`), giving a self-contained iframe form whose `iframeHtml` and `ui`
capability the Workshop hosts and whose results are collected over RPC (`collectResourceUrl`).

## Error reporting

Trusted first-party surfaces install an opt-in error reporter (`errorReporting.ts`,
`FrontendErrorBoundary`). Reports to the backend's `/api/client-errors` endpoint, or via
`postMessage` from opaque-origin gatekeeper frames, never convey authority: `reportedUserId` is a
client-supplied label and `pageLocation` is rebuilt by the boundary, never trusted from producers.
Automatic capture is installed only in trusted first-party surfaces, never gadget/user-authored code.
