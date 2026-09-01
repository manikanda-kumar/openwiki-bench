---
type: gadget-sandbox
title: "Gadget Sandbox and Client Integration"
description: How gadget UIs run in a fully sandboxed iframe with a postMessage RPC bridge to the gadget's server-side DO facet, how console logs and escape keys cross the boundary, the capsule overlay for attaching resources, and the export pipeline (default HTML/PDF, custom server formats, Puppeteer browser rendering).
tags: [sandbox, iframe, postmessage, rpc, exports, puppeteer]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-82fc262c6e105f27444f2f9b
    resource: repo://packages/workshop-backend/src/browser-export.ts
  - id: openwiki-source-67f91299c1003f4ab21542ba
    resource: repo://packages/workshop-backend/src/gadget-export.ts
  - id: openwiki-source-c8ba98fdff97dca5ebb07f94
    resource: repo://packages/workshop-frontend/src/CapsuleOverlay.tsx
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Gadget Sandbox and Client Integration

Gadgets are doubly sandboxed by design: the shared API's header states that a gadget runs in an iframe with **no ability to talk to the outside world except `postMessage()` to the parent frame**, and that through this exchange the Workshop hands the gadget a stub pointing at its server-side Durable Object (packages/workshop-shared/src/api.ts:21-24).

## The sandboxed iframe

`GadgetUI.tsx` builds the sandboxed document from the gadget's deployed `UiBundle` (packages/workshop-frontend/src/GadgetUI.tsx:294-300):

- The bundle's JS is wrapped in `createSandboxedHtml()` — a minimal HTML page with a **Content-Security-Policy that allows only `data:` sources and inline scripts, and sets `connect-src 'none'`** — so the gadget cannot fetch, frame, or submit anywhere (packages/workshop-frontend/src/GadgetUI.tsx:105-116).
- The iframe itself is `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` rendered via `srcDoc`, hence a **null origin** (packages/workshop-frontend/src/GadgetUI.tsx:494-504).
- Cap'n Web is injected as a doubly-nested data URL (the library itself is embedded with `?raw` and base64, then imported by injected code that is also a data URL), because a totally sandboxed iframe cannot load external scripts (packages/workshop-frontend/src/GadgetUI.tsx:7-24).

## The postMessage RPC bridge

The injected prefix performs the handshake and installs the client-side bridge (packages/workshop-frontend/src/GadgetUI.tsx:25-103):

1. It creates a `MessageChannel`, posts `"handshake"` with `port2` to `window.parent`, and opens `newMessagePortRpcSession(port1)` — the gadget speaks Cap'n Web to the parent over that port.
2. It monkey-patches `console` to forward every log to the parent (`{type: 'console', ...}`), captures uncaught errors and unhandled rejections the same way, blocks programmatic `window.open()` while allowing user-activated `target="_blank"` links (adding `noopener`), and forwards Escape keypresses (which the sandboxed iframe would otherwise swallow) so the workshop can exit fullscreen.
3. In the parent, the message handler **accepts messages only from its own iframe and only with `event.origin === "null"`** — an explicit paranoia check in case the frame ever browsed away (packages/workshop-frontend/src/GadgetUI.tsx:332-339).

On handshake, the parent calls `gadget.connectToGadget(chatId)` to obtain the gadget's server-side DO stub, installs it, and exposes it to the iframe through a **redirectable forwarding Proxy target** — swapping the underlying stub on reconnect redirects top-level calls without reloading the iframe; a broken stub suspends pending calls until a replacement arrives (5-second reconnect timeout) (packages/workshop-frontend/src/GadgetUI.tsx:340-380, 218-240, 130-133).

Bundle loading itself is guarded by a 20-second give-up that offers a retry button rather than a spinner that never resolves — a dropped RPC never settles, and generation counters ensure superseded loads cannot write state (packages/workshop-frontend/src/GadgetUI.tsx:283-316).

## Capsule overlay

The chat composer's `CapsuleOverlay` is the UI that attaches resources as the user types a resource URL: it positions a picker panel against the URL being typed (after `http://` completes), and resolving an item selects a connected account + resource for the workspace (packages/workshop-frontend/src/CapsuleOverlay.tsx:1-47).

## Gadget exports

Exports come in two modes, described by `GadgetExportFormat` (`mode: "browser" | "server"`), with format metadata validated by a zod schema (bounded strings, content-type regex, and browser-mode content types restricted to html/pdf/png/jpeg) (packages/workshop-backend/src/gadget-export.ts:30-95):

- **Default formats**: every gadget ships HTML and PDF exports by default (`defaultExportFormats()` returns fresh copies) (packages/workshop-backend/src/gadget-export.ts:76-99).
- **Custom server formats**: a gadget may export an optional `ExportHandler` Worker entrypoint (`GADGET_EXPORT_ENTRYPOINT`) with `getExportFormats()` and `export()`; the handler receives a *capability stub* of the gadget and must not retain it past the call. `readCustomExportFormats` treats a missing entrypoint as "no custom formats", and `exportServerFormat` applies the platform's export deadline and byte limits to the produced stream (packages/workshop-backend/src/gadget-export.ts:11-19, 102-151; packages/workshop-shared/src/api.ts:3886-3896).
- **Browser rendering** (`renderGadgetInBrowser`): the backend launches the Cloudflare **Browser Rendering** binding (Puppeteer) to render the gadget's UI server-side — used for PDF export and screenshots. The exported document is served through request interception under a strict CSP with `connect-src 'none'` and `sandbox allow-scripts`, with deadline/byte/pixel limits and a bounded close timeout (packages/workshop-backend/src/browser-export.ts:20-53, 162+, 262-273). The code notes an accepted gap: CSP/interception do not cover WebRTC/STUN, the same gap that exists for gadgets running in the user's browser iframe (packages/workshop-backend/src/browser-export.ts:40-43).

## Related pages

- [Frontend SPA and Connection Lifecycle](/openwiki/frontend/spa.md) — the session this component lives in.
- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md) — the gadget facet behind `connectToGadget`.
- [Blueprints: Templates, Archives, and Screenshots](/openwiki/backend/blueprints.md) — where the `UiBundle` code originates.
