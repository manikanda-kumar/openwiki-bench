---
type: frontend
title: Gadget iframe sandbox and gatekeeper UI hosting
description: How the workshop renders gadget UIs in a network-isolated sandboxed iframe (data-URL Cap'n Web injection, MessagePort RPC handshake) and hosts gatekeeper configurator and app UIs the same way, with rate-limited capabilities and origin-checked error reporting.
tags: [frontend, security, iframe, rpc, sandbox]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-c8ba98fdff97dca5ebb07f94
    resource: repo://packages/workshop-frontend/src/CapsuleOverlay.tsx
  - id: openwiki-source-def7ad403d9800d292e1ae76
    resource: repo://packages/workshop-frontend/src/errorReporting.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-d774f52167d067394c263a5d
    resource: repo://packages/workshop-frontend/src/ResourceConfiguratorHost.tsx
  - id: openwiki-source-a0af2f1f7ce622da8e9be8ad
    resource: repo://packages/workshop-frontend/src/SandboxedGatekeeperApp.tsx
  - id: openwiki-source-3a5a75a55ee93ec742c9fe70
    resource: repo://packages/workshop-frontend/src/SandboxedResourceConfigurator.tsx
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Gadget iframe sandbox and gatekeeper UI hosting

Three kinds of untrusted HTML run inside the workshop browser: a gadget's own client code, a
gatekeeper's resource-configurator form, and a gatekeeper's full-page management app. All three are
hosted as opaque-origin `srcDoc` iframes and speak RPC to their host over a `MessagePort` Cap'n Web
session — never over the network.

## The gadget UI iframe

`GadgetUI.tsx` renders a gadget's UI from a `UiBundle` fetched with `GadgetClient.getUiBundle()`:

- The bundle's `jsCode` is wrapped by `createSandboxedHtml()` into a document with a strict CSP —
  `default-src 'none'`, `script-src data: 'unsafe-inline'`, and crucially `connect-src 'none'` — so
  even a gadget that tries to reach the network cannot
  (`packages/workshop-frontend/src/GadgetUI.tsx:105-116`).
- The iframe element carries `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`
  and no `allow-same-origin`, so the frame is an opaque origin (`GadgetUI.tsx:491-506`).

### Injecting Cap'n Web into a sandbox

Because the frame can load nothing from the network, Cap'n Web itself is shipped *inside* the
iframe: the whole `capnweb` module is imported at build time (`capnweb?raw`), base64-encoded, and
embedded. The injected prefix imports Cap'n Web from a `data:text/javascript` URL *inside an outer
script that is itself a data URL* — a doubly-nested data URL, base64 inside and percent-encoding
outside, to avoid double-escaping (`GadgetUI.tsx:7-33`). The same prefix also hardens the frame:

- `console.*` is monkey-patched to forward every log to the parent as a `{type: 'console'}`
  postMessage (`GadgetUI.tsx:35-49`).
- `window.open` is blocked — only user-activated `target="_blank"` links are allowed, and the click
  handler appends `noopener` to their `rel` (`GadgetUI.tsx:51-84`).
- `Escape` keydowns are forwarded as `{type: 'escape'}` because a focused sandboxed iframe swallows
  them and the workshop uses Escape to exit fullscreen gadget mode (`GadgetUI.tsx:62-69`).
- Uncaught errors and unhandled rejections are forwarded as console-level error messages
  (`GadgetUI.tsx:86-101`).

### The handshake

The injected code opens a `MessageChannel`, posts one port to the parent with the message
`"handshake"`, and builds its RPC session on the other port (`GadgetUI.tsx:25-33`). The parent
validates the message before trusting it: `event.source` must be the iframe's own `contentWindow`
and `event.origin` must be the *string* `"null"` (opaque origins serialize as `"null"`, not JS
`null`) (`GadgetUI.tsx:330-338`).

On handshake the parent:

1. Calls `GadgetClient.connectToGadget(chatId)` to obtain the gadget's **server-side** stub (the
   running facet, see [gadget execution](/openwiki/kernel/gadget-execution.md)).
2. Wraps it in a *forwarding target* — a `Proxy` over a fresh `RpcTarget` that resolves each method
   against the current gadget stub, or defers calls onto a pending promise while a reconnect is in
   flight — so top-level calls survive stub swaps without reloading the frame
   (`GadgetUI.tsx:357-370`).
3. Opens `newMessagePortRpcSession(port, forwardingTarget)` as the capability the frame sees
   (`GadgetUI.tsx:370`).

### Reload and reconnect semantics

The component is defensive about dropped RPCs, because a disposed stub's in-flight calls never
settle:

- A UI-bundle load that exceeds 20 s gives up and offers a **retry button** instead of an infinite
  spinner — the call is idempotent and "a button is a far better answer than a spinner that never
  resolves" (`GadgetUI.tsx:130-132`, `279-287`).
- If the gadget stub breaks, the session is suspended behind a pending promise; a replacement stub
  is fetched (`connectToGadget` again, 5 s timeout) and the pending calls are replayed onto it;
  failure reloads the whole iframe (`GadgetUI.tsx:191-244`).
- Generation counters ensure a superseded load or connection can never write state after being
  replaced (`GadgetUI.tsx:148-155`, `273-277`).
- `reloadTrigger` (bumped when the gadget's code changes) marks the view invalidated and reloads it
  when visible; a hidden tab just drops its content until shown again
  (`GadgetUI.tsx:247-262`).

## Gatekeeper app UIs

`SandboxedGatekeeperApp.tsx` hosts a gatekeeper's `GatekeeperUiFrame` (its `iframeHtml` plus its own
`ui` capability) the same way — with different sandboxing and a richer host capability:

- The iframe is `sandbox="allow-scripts allow-modals"` (modals for the app's unsaved-changes
  guard), explicitly **not** `allow-same-origin`, plus `allow="clipboard-write"`; the frame's own
  CSP keeps `connect-src 'none'` (`SandboxedGatekeeperApp.tsx:363-374`).
- The host capability (`GatekeeperAppHostImpl`) is a `RpcTarget` that the frame reaches over the
  MessagePort session. It does not hand the gatekeeper's `ui` stub to the frame raw: the relay goes
  through `createRateLimitedCapability` — 8 concurrent calls, 600 per minute, 128 pending, with
  throttling rather than rejection (`SandboxedGatekeeperApp.tsx:78-114`, `195-211`).
- Workshop-owned host services the app can ask for: a `present` controller that grows the iframe to
  a full-viewport overlay for app-level modals (returning the content-pane rect and whether the
  resize actually happened), `openTarget` navigation to `/workspace/$id`, an `openPrompt` jump to
  the home composer, and `resolveWorkspaceTitles` — a **lookup-only** title resolver (the app can
  name workspace IDs it already holds but learn nothing new), TTL-cached for 10 s and capped at 100
  IDs per query (`SandboxedGatekeeperApp.tsx:22-49`, `250-297`).
- Theme is pushed host-to-frame: the workshop's resolved light/dark mode and the deployment's
  validated accent color (`SandboxedGatekeeperApp.tsx:232-242`).
- Handshake uses the same `event.source`/`origin === 'null'` validation, and a second handshake
  (iframe reload) invalidates the old session (`SandboxedGatekeeperApp.tsx:334-346`).

## Resource configurator iframes

`SandboxedResourceConfigurator.tsx` (hosted by `ResourceConfiguratorHost.tsx` inside the connect
modal) runs a gatekeeper's `ResourceConfiguratorFrame` with `sandbox="allow-scripts"` and the same
origin-null handshake. The host capability implements the shared `ResourceConfiguratorHost`
contract from `workshop-shared`: it carries the `gatekeeper` stub, `getInitialResource()` (the
resource URL an agent's connection request pre-filled, so the form opens pre-filled and editable),
`resize(height, layoutHeight)` for modal layout, `setSelectionReady()` to enable the *Add
connection* button, and `forwardScroll()` so gestures over the form still scroll the modal
(`packages/workshop-shared/src/gatekeeper.ts:347-405`; `SandboxedResourceConfigurator.tsx:52`,
`214`, `361-369`, `393`). When the user adds the connection, the host calls the frame's
`collectResourceUrl()`.

## Capsules: pasting a URL in the composer

CapsuleOverlay is the composer-side entry point for introductions: when the user types a URL that
looks like a resource, the overlay offers the ResourcePicker so they can choose the connected
account and resource to grant (`CapsuleOverlay.tsx:7-32`). It is positioned against the line the
URL sits on and sized against the real viewport space above the composer.

## Error reporting isolation

Gatekeeper frames may report failures, but never from their own origin: the frame posts a bounded
report with `postMessage`, and the host accepts it only after the same validation as the handshake
(`event.source === frameWindow && event.origin === 'null'`), then forwards it through the
workshop's reporter with **host-owned** surface and vendor context
(`SandboxedGatekeeperApp.tsx:341-343`; `errorReporting.ts:228-248`). This is why the
`VITE_FRONTEND_ERROR_REPORTING` rule says gatekeeper UIs must not report directly from their own
Worker domain — the frame has no network access anyway, and the host adds the trusted context.

## What the sandbox buys

Combined with the server side (a dynamic worker with no internet, bindings-only), the client iframe
means a gadget is sandboxed twice: its code cannot reach the internet from either side except
through resources the user explicitly granted (`README.md:159-163`). The iframe's only capability is
the gadget's own server-side API; even that is delivered through a forwarding proxy the workshop
controls.
