---
type: subsystem
title: Workshop Frontend
description: The React SPA shell — session boot and reconnect, routing, the OT code-editing client, how gadget and gatekeeper UIs are hosted in network-isolated iframes, and the browser error-reporting path.
tags: [frontend, react, iframe, sandbox, ot, error-reporting]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-621b56f84037e3de99b7a3e2
    resource: repo://packages/workshop-frontend/src/otClient.ts
  - id: openwiki-source-a0af2f1f7ce622da8e9be8ad
    resource: repo://packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Workshop Frontend

`packages/workshop-frontend` is a pure client-side React SPA (Vite, TanStack Router, Kumo UI, Phosphor icons) whose only path to the backend is Cap'n Web RPC over one persistent WebSocket — the session lifecycle itself is covered in [RPC and Capability Model](../architecture/rpc-and-capability-model.md). This page covers what that session is *for*: the screens built on it, and the three ways the app hosts untrusted code (gadgets, gatekeeper SPAs, configurator forms) in browser sandboxes.

## Boot and routing

The RPC root is kept in **module globals, not React state** — dev-mode's double `useEffect` invocation would otherwise create and discard redundant WebSockets that fight to replace each other (packages/workshop-frontend/src/main.tsx#L47-L62). At boot the app opens the session, installs automatic error capture (`installWorkshopErrorReporting`), and builds the router; in dev mode with `VITE_BACKEND_HOST` the API host differs from the asset host, otherwise everything is same-origin (main.tsx#L85-L101, #L179-L182). `useAuth` holds the `AuthenticatedApi` stub (wrapped per the React-stub rule), restoring the stored token from `localStorage` or taking the Cloudflare Access path (`VITE_CF_ACCESS_MODE`), and disposes the previous stub whenever it is replaced (packages/workshop-frontend/src/useAuth.ts#L25-L85).

Routes (`src/routes/`): home/chat (`index`), `workspaces`, `workspace.$id` (the chat + editor surface), `gadget.$id`, `blueprints`/`blueprint.$id`/`explore`, `gatekeepers` (connections) and `gatekeepers_.$appId` (embedded management apps), `context` (Context Library UI), `admin`, `providers` (models), `profile`, `outputs`, `signup` — with legacy redirect handling under test (`legacyRedirects.test.tsx`).

## The editing model on the client

Chat code editing runs through **`otClient.ts`**, the classic two-buffer client behind one chat's change stream: it derives content from per-pin base trees plus the epoch's materialized changes plus accepted rows, keeps at most one in-flight `submitCodeChange()` plus one pending composition of newer local edits, transforms both over incoming remote rows, and rebases (packages/workshop-frontend/src/otClient.ts#L9-L23). Submissions *compose* — everything typed since the last ack rides one submit — so traffic lands at ~RTT granularity rather than per keystroke (otClient.ts#L17-L19). State arrives via three redundant-safe paths (`setDurableState`, `pushRow` deduped by `(generation, revision)` so subscribe-replay after reconnect is harmless, `applyLocalChange`), and generation bumps are honored per contract: content-preserving (merge) bumps carry local buffers across the boundary; destructive (revert/discard/abort) bumps drop them and rebuild (otClient.ts#L20-L28). `CodeInterface`/`CodeEditor`/`CodeDiffEditor` render the result, streaming per-row `changeApplied` previews against the same buffers.

## Hosting a gadget: `GadgetUI`

A gadget's `client.js` is untrusted code, and the hosting treats it that way (packages/workshop-frontend/src/GadgetUI.tsx):

- The iframe gets **no origin at all**: the document is a data: URL with a CSP meta tag of `default-src 'none'` allowing only `data:`/inline scripts and data-URL images/media — no network (`connect-src 'none'`), no forms, no base-uri (GadgetUI.tsx#L110-L113).
- Cap'n Web itself is embedded (it has no dependencies) as an ASCII base64 data URL; since even that must be *imported*, the final `client.js` is a **doubly-nested data URL** (URL-encoded outer, base64 inner) prefixed with injected bootstrap code (GadgetUI.tsx#L13-L26).
- The bootstrap performs the **handshake**: `window.parent.postMessage("handshake", "*", [port2])` over a `MessageChannel`; the parent answers by building the server side of the session on that port, so the iframe's `gadget` global is an RPC stub to the server Durable Object obtained via `gadget.connectToGadget(chatId)` (GadgetUI.tsx#L28-L33, #L218, #L326-L351). A second handshake or a gadget identity change mid-handshake reloads the iframe with an explicit error rather than mis-wiring two generations (GadgetUI.tsx#L209-L218, #L343-L345).
- Same bootstrap monkey-patches `console.*` to forward logs to the parent (surfaced through the console-log tail path, see [Logging and Error Reporting](../operations/logging-and-error-reporting.md)), blocks `window.open` (user-activated `target="_blank"` links still work), and forwards Escape keypresses out of the frame, which swallows keydowns (GadgetUI.tsx#L35-L67).

## Hosting gatekeeper UIs: opaque-origin srcDoc frames

The `GatekeeperUiFrame` contract is *complete HTML plus an arbitrary gatekeeper-defined capability*: the Workshop puts the HTML in a sandboxed iframe and exposes the capability over a MessagePort RPC session (packages/workshop-shared/src/gatekeeper.ts#L407-L421). Two surfaces use it — the small **resource-configurator** form (from `startResourceConfigurator`, inside the connect modal: `ResourceConfiguratorHost` dialog hosting `SandboxedResourceConfigurator`, whose parent side implements `ResourceConfiguratorHost` and consumes `ResourceConfiguratorIframe` callbacks) and the full-page **management SPAs** (`startAppUi`, e.g. the Context Library, at `/gatekeepers/$appId`) (packages/workshop-frontend/src/ResourceConfiguratorHost.tsx, SandboxedGatekeeperApp.tsx#L215-L330).

The iframe is `srcDoc={frame.iframeHtml}` with `sandbox="allow-scripts allow-modals"` — deliberately **without `allow-same-origin`**, so the frame stays an opaque (null) origin, and the shipped HTML's own CSP keeps `connect-src 'none'`: gatekeeper UIs reach the world *only* through the RPC capability, never by fetching (SandboxedGatekeeperApp.tsx#L365-L369). Handshake hygiene: only messages from the current frame window whose port matches are accepted, and a *second* handshake (an iframe reload) invalidates the session rather than silently double-binding it (SandboxedGatekeeperApp.tsx#L305-L345). The `ui` capability is `any`-typed and gatekeeper-defined — the host stays agnostic (SandboxedGatekeeperApp.tsx#L297-L299).

## Browser error reporting

Automatic capture is installed only in trusted first-party surfaces (never gadget code). The Workshop reporter POSTs bounded reports to the same-origin `/api/client-errors` endpoint (packages/workshop-frontend/src/errorReporting.ts#L185-L195). Reports from the opaque gatekeeper frames travel by `postMessage`, not cross-origin fetches: `forwardTrustedFrameError` accepts a frame report **only** when `event.source` is the known frame window *and* `event.origin === "null"`, then re-emits it host-side with host-owned surface/vendor context (errorReporting.ts#L227-L248). The whole event contract and its tolerant, bounded normalization live in the separate `@gadgets/error-reporting` package, and the build flag `VITE_FRONTEND_ERROR_REPORTING` gates whether capture is compiled in at all (see [Logging and Error Reporting](../operations/logging-and-error-reporting.md)).
