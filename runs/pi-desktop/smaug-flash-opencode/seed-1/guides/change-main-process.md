---
type: "Reference"
title: "Change Guide: Main Process and IPC"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-ab729f0aba4796e9191fbadd
    resource: repo://src/agent-host/parent-rpc.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-d481412a7917f2959e804ba1
    resource: repo://src/main/ipc-trust.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-0b5972d283db5b7634b87c33
    resource: repo://src/main/window.ts
  - id: openwiki-source-910e879cd3b0e278b2b0eccd
    resource: repo://src/preload/preload-location-policy.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---


# Change Guide: Main Process and IPC

This guide covers the two corners of the desktop IPC surface that engineers
most often change: **desktop IPC** (Renderer ↔ Main via preload) and the
**Agent Host Api/Streams** (Renderer ↔ Host via MessagePort). It assumes the
three-process architecture (see Architecture Overview).

## Where the pieces live

| Concern | File |
| ------- | ---- |
| Desktop contract types (`PiBridge`, `DesktopUiState`, `UpdateState`, …) | `src/contract/desktop.ts` |
| Main IPC handlers (all `desktop:*`, `browser:*` channels) | `src/main/ipc.ts` |
| Main implementation + wiring (`installDesktopIpc`, window, updates) | `src/main/main.ts` |
| Preload → `window.piBridge` surface | `src/preload/preload.ts` |
| Trusted renderer-sender guard | `src/main/ipc-trust.ts` |
| Host Api / Streams type contract | `src/contract/api.ts` |
| Wire RPC implementation | `src/contract/rpc.ts` |
| Host handlers | `src/agent-host/handlers.ts` |
| Renderer facade | `src/renderer/lib/api-client.ts` |

## Adding a Main↔Renderer (desktop) channel

Example: a new `desktop:get-frobnicator` invoke that Main answers and the
Renderer calls through `window.piBridge`.

1. **Add the type** to `src/contract/desktop.ts` — extend `PiBridge` with the
   new method (and any supporting types). Keep the signature in one place so
   preload, main, and renderer all share it.
2. **Add the Main handler** in `src/main/ipc.ts`. Register it with the trusted
   wrappers — use `trustedHandle` for `invoke` or `trustedOn` for `send` so it
   asserts the sender is the main window's main frame via
   `isTrustedDesktopIpcSender` (`src/main/ipc-trust.ts`). Do not register a raw
   `ipcMain.handle` that skips the guard.
3. **Expose it in preload** (`src/preload/preload.ts`) as a `piBridge` method
   that calls `ipcRenderer.invoke("desktop:get-frobnicator", …)`.
4. **Call it from renderer** via `window.piBridge.getFrobnicator()` (or wrap it
   in a `lib/` helper). The Renderer must stay typed through `PiBridge`.
5. **Validate inputs at Main**, not just at the Renderer — Main is the trust
   boundary.

## Adding an Agent Host Api method or Stream

Example: a new `frobnicator.list` method and a `frobnicator.changed` stream.

1. **Declare it in `src/contract/api.ts`** — add `"frobnicator.list"` to `Api`
   (with `params`/`result` types) and/or `"frobnicator.changed"` to `Streams`.
2. **Implement the handler** in `src/agent-host/handlers.ts` — extend the
   `server.handle({ … })` object. Throw `RpcError` with a stable code for
   expected failures; the server shapes errors automatically.
3. **Emit stream events** by calling `server.emit("frobnicator.changed", key, data)`.
4. **Expose to the renderer** — add a typed wrapper in
   `src/renderer/lib/api-client.ts` (`call("frobnicator.list", …)` /
   `subscribe("frobnicator.changed", …)`).

## Host→Main (callMain) changes

If the Host needs Main to do something (e.g. a new browser or credential op),
use `callMain(method, params)` from the Host and add the method to the
`requestHandler` in `src/main/main.ts` (the `if (method.startsWith("browser."))`
branch for browser ops, or a dedicated branch). Keep the `host-rpc` message
shape and the 10s default timeout in mind.

## Trust and security invariants

- The Renderer runs sandboxed with `contextIsolation` + `sandbox: true` and a
  strict CSP; `PiBridge` is the *only* surface it gets (`src/main/window.ts:48-54`,
  `src/preload/preload.ts`).
- The preload only loads from a trusted location (`app://bundle` or the Vite
  dev server on `localhost:5173`) (`src/preload/preload-location-policy.ts`);
  don't broaden that without a real reason.
- Every desktop IPC handler must go through `trustedHandle`/`trustedOn` or the
  equivalent guard in `main.ts`.

## Verification

- Run the contract-coverage gate: `npm run check:contract`
  (`scripts/check-contract-coverage.mjs`). Adding an `Api` method (or handler)
  without its counterpart fails the gate.
- Run focused unit tests: `npm run test`.
- Typecheck: `npm run typecheck`.
- For Main/Renderer integration use `npm run smoke` (Electron smoke) and
  `npm run test:browser-electron`.
- Run the full pre-commit gate: `npm run verify` (format → lint → typecheck →
  dependency contract → unit → managed-process workflows → flood → contract
  coverage → Pi compat → toolchain catalog → i18n → security → build →
  production-artifacts → smoke → browser integration → browser E2E).

## Related pages

- Architecture Overview
- RPC Contract and System API
- Testing and Quality Gates
- Quickstart
