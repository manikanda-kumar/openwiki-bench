---
type: "Reference"
title: "Change guide: add an RPC method"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T15:27:00.466Z
---


# Change guide: add an RPC method

This guide walks through adding a new typed request/response method to the renderer ↔ Agent Host RPC surface. The same pattern also covers new server-push `Streams` topics and, when the main process must be involved, `PiBridge`/desktop IPC methods.

## 1. Add the method to the `Api` contract

The contract is `Api` in `src/contract/api.ts`. Every method declares a `params` type and a `result` type:

```ts
export interface Api {
  "myFeature.getSummary": {
    params: { cwd: string };
    result: { total: number; label: string };
  };
}
```

Conventions:
- `params: void` for parameterless calls.
- Params and results must be JSON-serializable (they cross a MessagePort); use types from `src/contract/types.ts`, `src/shared/api-types.ts`, `src/shared/channel-types.ts`, or `src/shared/toolchains/types.ts` where a shared shape exists.
- If the method should push events later, add a matching entry to the `Streams` interface in the same file.

## 2. Implement the handler in the Agent Host

Register the handler in `registerHandlers(server)` in `src/agent-host/handlers.ts`, inside the big `server.handle({ ... })` object:

```ts
"myFeature.getSummary": async (params) => {
  const { cwd } = params as { cwd: string };
  if (!cwd || !path.isAbsolute(cwd)) throw new RpcError({ code: "BAD_REQUEST", message: "absolute cwd required" });
  // ... compute result
  return { total, label };
},
```

Notes:
- Throw `RpcError` (from `src/contract/types.ts`) with a stable `code` for expected failures; the RPC server serializes it as `{ code, message, detail }`. `ToolchainError` is mapped automatically by the server (`src/contract/rpc.ts:394-408`).
- To emit a server-push event, call `server.emit("topic", key, data)` (or use the `server` reference in scope; `emit` requires a topic key string for subscriber matching).
- If the method needs main-process capabilities, use `callMain(method, params, timeoutMs)` from `src/agent-host/parent-rpc.ts` and add the corresponding branch to the main process `setRequestHandler` (`src/main/main.ts:591-685`).

## 3. Expose a renderer helper

Components never touch the MessagePort directly. Add a typed wrapper in `src/renderer/lib/api-client.ts`:

```ts
export async function getMyFeatureSummary(cwd: string) {
  return call("myFeature.getSummary", { cwd });
}
```

`call` is typed so `params` and `result` are checked against the contract. For legacy components that still use `/api/...` HTTP-shaped routes, `src/renderer/lib/api-fetch.ts` is the shim to extend.

## 4. Desktop-side methods (main process involvement)

When the method must touch desktop capabilities, the flow is:

1. Add the method to `PiBridge` in `src/contract/desktop.ts`.
2. Implement it in `src/preload/preload.ts` using `ipcRenderer.invoke("desktop:...", ...)`.
3. Register the channel in `src/main/ipc.ts` via `trustedHandle("desktop:...", handler)` (which enforces the trusted-sender check) or `trustedOn` for `send`-style events.

The `check-contract-coverage` script statically verifies these correspondences.

## 5. Run the contract coverage gate

`scripts/check-contract-coverage.mjs` enforces exact parity between contract and implementation:

- Every `Api` method must have a matching `server.handle` key in `handlers.ts` (`extractServerHandlers`).
- Every `Streams` topic must be emitted somewhere in `src/agent-host/**/*.ts` (excluding tests).
- Every `PiBridge` method must be implemented in the preload bridge object.
- Every `ipcRenderer.invoke` channel must have a `trustedHandle`/`browserHandler` registration, and every `ipcRenderer.send`/`on` channel must have a matching listener.

Run it with:

```bash
npm run check:contract
```

A new method that is not registered (or an implementation key with no contract entry) fails the gate with a `Missing ...`/`Unknown ...` diagnostic.

## 6. Validate

```bash
npm run typecheck && npm test && npm run check:contract
```

The unit suite runs every `src/**/*.test.mjs` via the Node test runner (`scripts/test.mjs`). The `verify.mjs` gate runs these plus lint, format, security, and build checks before packaging. Add a focused test for the new handler behavior (e.g. an RPC-level test exercising `createRpcServer` + the handler), matching the existing `*.test.mjs` style.