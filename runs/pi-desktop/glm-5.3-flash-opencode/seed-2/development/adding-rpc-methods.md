---
type: change-guide
title: Adding RPC Methods
description: End-to-end guide for adding a new Api method or Stream topic — contract typing, Host handler, renderer client, and the automated coverage gate.
tags: [rpc, contract, change-guide, handlers, api]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

Every Renderer→Host call crosses `src/contract` and is enforced by an AST-based coverage checker, so a new method is a four-touchpoint change plus one gate assertion. This guide walks the exact sequence.

## 1. Declare the method in the contract

Add an entry to the `Api` interface in `src/contract/api.ts` with `{ params, result }` types (or, for server-push data, a topic in `Streams`) (repo://src/contract/api.ts#L57-L66, repo://src/contract/api.ts#L395-L420). Because `ApiMethod`/`ApiParams`/`ApiResult` are derived key/lookup types, both the client helper signatures and the server handler map immediately pick up the new method's types (repo://src/contract/api.ts#L422-L426).

## 2. Implement the Host handler

Handlers are registered in one object literal passed to `server.handle(...)` at the bottom of `src/agent-host/handlers.ts` (repo://src/agent-host/handlers.ts#L701-L737). Conventions to keep:

- Validate params explicitly and throw `RpcError` with a code (e.g., `BAD_REQUEST`) — the server wraps unknown throws into `INTERNAL` (repo://src/agent-host/handlers.ts#L739-L742, repo://src/contract/rpc.ts#L456-L479).
- If the handler holds a resource for the caller (watcher, subscription, lock), use the request context's `setLease(key, release)` so the server releases it on unsubscribe/port close (repo://src/contract/rpc.ts#L295-L344).
- To push events, call `server.emit("your.topic", key, data)` from anywhere in the Host — the coverage scan globs all `src/agent-host/**/*.ts` for these emit sites (repo://scripts/check-contract-coverage.mjs#L296-L303).

## 3. Call it from the Renderer

Components go through the transport facade, never the port directly (repo://src/renderer/lib/api-client.ts#L1-L5): `await call("your.method", params)` or `await subscribe("your.topic", key, handler)` (repo://src/renderer/lib/api-client.ts#L151-L167). Wrap repeated patterns in a small helper module like `src/renderer/lib/agent-client.ts` does for agent commands (repo://src/renderer/lib/agent-client.ts#L4-L6).

## 4. Desktop-only capabilities go through Main, not the contract

If the method needs dialog/tray/shell/vault behavior, it does not belong in `Api`. Instead: add a `piBridge` method in `src/contract/desktop.ts`, implement it in the preload bridge over `ipcRenderer.invoke/send`, and register the channel with `trustedHandle`/`trustedOn`/`browserHandler` in `src/main/ipc.ts` (repo://src/preload/preload.ts#L55-L152, repo://src/main/ipc.ts#L68-L118). Browser-flavored channels follow the `browserHandler` + `desktop:browser:*` prefix pattern so error codes surface as `CODE: message` (repo://src/main/ipc.ts#L105-L118).

## 5. Prove coverage: `npm run check:contract`

`scripts/check-contract-coverage.mjs` parses TypeScript sources and asserts exact-set equality between (repo://scripts/check-contract-coverage.mjs#L228-L270):

- `Api` interface keys ↔ handler keys extracted from `server.handle({...})` in handlers.ts,
- `Streams` keys ↔ string-literal `server.emit(...)` topics across the whole agent-host tree (duplicates allowed),
- `PiBridge` interface keys ↔ the preload `bridge: PiBridge` literal,
- preload `ipcRenderer.invoke/send` channels ↔ `trustedHandle`/`browserHandler` and `trustedOn` registrations,
- `BrowserHostRpc` ↔ `BROWSER_HOST_METHODS` ↔ `dispatchHostRequest` cases, plus exactly one `browser:event` preload listener and at least one Main sender.

Any missing or unknown member fails with a plain diff listing, so a forgotten handler blocks `npm run verify` rather than failing at runtime (repo://scripts/check-contract-coverage.mjs#L212-L226, repo://scripts/verify.mjs#L24). The checker also hard-requires non-empty extraction on both sides, so deleting all methods or the handle target fails too (repo://scripts/check-contract-coverage.mjs#L212-L216).

## Verification checklist

1. `npm run typecheck` — contract lookup types make param/result drift a compile error on both sides (two tsconfig projects: main/host and renderer) (repo://package.json#L32).
2. `npm run check:contract` — coverage gate (repo://package.json#L35).
3. Co-located unit tests: `handlers.test.mjs`, `rpc.test.mjs` next to the code under test are run by `npm test` (repo://scripts/test.mjs).
4. `npm run verify` for the full pre-submit gate (repo://scripts/verify.mjs).

## Related pages

- [IPC and RPC Contract](/openwiki/architecture/ipc-and-rpc.md) — protocol mechanics behind these touchpoints.
- [Build and Testing](/openwiki/development/build-and-testing.md) — where each check runs.
