---
type: concept
title: RPC Contract (workshop-shared)
description: How the Workshop's client, kernel, and gatekeepers communicate — Cap'n Web RPC surfaces in workshop-shared, capability-argument API semantics, promise pipelining and stub-disposal rules, @validateRpc runtime validation, and the gatekeeper interface family.
tags: [rpc, capnp-web, capabilities, validation, api]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-a60768dbbe37cf4dc037121e
    resource: repo://packages/workshop-backend/src/slash-commands.ts
  - id: openwiki-source-ab95f77aee41e7ee57caa318
    resource: repo://packages/workshop-frontend/src/GadgetEditor.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# RPC Contract (workshop-shared)

Everything in this system talks through one mechanism: interfaces of type `RpcTarget`/`WorkerEntrypoint`/`DurableObject` served over [Cap'n Web](https://github.com/cloudflare/capnweb) RPC — "similar semantics to Cloudflare's Worker-to-Worker RPC, but over a WebSocket in a browser" (root `AGENTS.md`). `packages/workshop-shared` defines both normative contract files: `src/api.ts` (client ↔ kernel) and `src/gatekeeper.ts` (kernel ↔ gatekeepers).

## Why this shape

The header of `api.ts` records the design: the UI is a fat-client SPA over **one persistent WebSocket kept open for the whole session, reconnecting as needed**, chosen because gadget sandboxing *requires* in-browser code (SSR is implausible) and a clean RPC boundary makes alternative clients easy (packages/workshop-shared/src/api.ts:1-25). The same mechanism is then reused twice more: the gadget client iframe gets its server stub through a `postMessage`-handed `MessagePort` session, and gadget/agent `env` bindings are RPC loopbacks (packages/workshop-shared/src/api.ts:22-25; see [Gadget Runtime](/openwiki/architecture/gadget-runtime.md)).

## Interfaces as capabilities

The API is written capability-first: holding a returned stub *is* the permission, and its lifecycle controls matter as much as its methods.

- **Mint-or-null:** `AuthenticatedApi.getAdminApi(): Promise<RpcStub<AdminApi> | null>` — the `#isAdmin()` check happens exactly once at mint; the `AdminApi` methods never re-check (packages/workshop-shared/src/api.ts:705-712, 919-928).
- **Name-less rendezvous:** `startGatekeeperLogin` returns a `LoginAttempt` stub whose mere possession is "the capability to receive the resulting session token; dispose it to abandon the attempt" — no login id is exposed (packages/workshop-shared/src/api.ts:39-47).
- **Subscription by stub lifetime:** `subscribeToMetadata(callback)` returns a stub whose disposal cancels the subscription (packages/workshop-shared/src/api.ts:1600-1608); presence/outputs/action views follow the same shape.
- **Coded expected failures:** expected error paths cross RPC as coded errors — `OPEN_GADGET_ERROR_CODES`/`AUTH_ERROR_CODES` with `create…Error`/`get…ErrorCode` helpers — so clients branch on codes, not messages (packages/workshop-shared/src/api.ts:314-358).
- **One id namespace:** workpieces (gadgets and gatekeeper connections) share a sequential numeric `WorkpieceId` per workspace "so derived names (facet names) can never collide across types" (packages/workshop-shared/src/api.ts:165-172).
- **One shared name validator:** `validateBindingName` is *the* chokepoint validator applied at every write of a binding name (edges, chat maps, spawner envs, agent tools), rejecting non-identifiers, reserved words, and `Object.prototype`-colliding names — because binding maps are consumed as plain objects (packages/workshop-shared/src/api.ts:174-212).

## Promise pipelining

Cap'n Web resolves stubs by *promise*, so an RPC returning a stub needs no await before use — "the promise itself can be used in place of the stub" (root `AGENTS.md`). The codebase leans on this deliberately:

- `const stub = overseer.stub.getGadget(id)` is used immediately with the comment "getGadget() pipelines on the overseer stub, so the stub is usable immediately with no extra round trip" (packages/workshop-frontend/src/GadgetEditor.tsx:1165-1170);
- `newGadgetFromBlueprint`'s contract states "the returned Overseer can be used immediately (pipelining-friendly)" (packages/workshop-shared/src/api.ts:653-656).

Stubs are callable *at runtime regardless of the server-side shape*, which powers the React rule below and also the `GatekeeperLoopback` Proxy trick (every property read is assumed to be a method) (packages/workshop-backend/src/overseer.ts:4095-4110).

## The two discipline rules for callers

1. **Dispose stubs.** Undisposed stubs leak server-side resources. The frontend's useEffect cleanup calls `stub[Symbol.dispose]()` (packages/workshop-frontend/src/GadgetEditor.tsx:1174-1175); backend helpers use `using provider = await ...` (packages/workshop-backend/src/slash-commands.ts:24-25, 51); RPC *parameters* are auto-disposed when the method returns, which is why `LoginConnectCallbackImpl.complete` notes "no explicit disposal needed" for its `account` parameter (packages/workshop-backend/src/auth/login-flow.ts:95-97).
2. **Never put a stub directly in `useState`.** React's setter treats a function argument as an updater — and since every stub *looks* callable, state would be silently computed *from* the stub instead of holding it. The pattern is to wrap it: `setGadget({ id, stub })` and `setRpcState({ stub, connectionLost })` (packages/workshop-frontend/src/GadgetEditor.tsx:1174; packages/workshop-frontend/src/main.tsx:218-221; rule stated in root `AGENTS.md`).

## `@validateRpc()` runtime validation

`@validateRpc()` from `capnweb-validate` installs generated runtime validation matching the interface's TypeScript signatures at every RPC-implementing class (packages/workshop-backend/src/server.ts:76, 624-636; packages/workshop-backend/src/overseer.ts:9052, 10805; gatekeepers likewise). Consequences encoded in the toolchain: the transform needs Stage-3 decorators and must stay on esbuild — Oxc doesn't lower them — so `vite` is pinned exactly in the catalog and `capnweb-validate` is version-locked to capnweb's peer range (pnpm-workspace.yaml:8-19; root `AGENTS.md`).

Because the RPC edge already validates declared shapes, downstream code **must not duplicate that work**: `code-change.ts` states its two-stage validators "re-check only the invariants a TypeScript type cannot express" — canonical gadget keys, path rules, size caps — with the declared shape "established before they run, by capnweb-validate's generated validator at the RPC edge" (packages/workshop-shared/src/code-change.ts:32-41). This division (validator for shape, hand-written checks for type-inexpressible semantics) is the standard to follow when changing any RPC surface.

## The gatekeeper interface family (`gatekeeper.ts`)

The kernel↔driver contract is four cooperating interfaces, each an RPC surface with security-relevant doc-commented rules:

- **`GatekeeperVendor extends WorkerEntrypoint`** — the public service entrypoint: `describe()`, `getSupportedResources()`, `getTypeScriptTypes()` (the `.d.ts` source the agent's type database is built from), `connectAccount(callback, {scopes, resourceUrlPatterns})` — where the doc mandates a **cryptographic nonce** in the returned URL to prevent replay, defines `"auth"` scopes as a transient minimal grant, and pins that omitted `resourceUrlPatterns` ≠ `[]` (all vs none) (packages/workshop-shared/src/gatekeeper.ts:445-525) — plus optional `createAccount()` for auto-provisioning, which "takes no arguments, so it carries no user identity" and is gated on the `autoProvisionsAccount` flag because RPC stubs cannot report optional-method presence (packages/workshop-shared/src/gatekeeper.ts:505-524).
- **`GatekeeperUser extends WorkerEntrypoint`** — the persistent connected-account object: it resolves a resource URL to the `DurableObjectClass` a binding will instantiate (the minted capability, per [Backend Kernel](/openwiki/architecture/backend-kernel.md)) and mints `GatekeeperUserVerifier`s for observer checks (packages/workshop-shared/src/gatekeeper.ts:567-696).
- **`Gatekeeper<Session> extends DurableObject`** — the per-binding facet, "a child of the Overseer; this interface is exposed to the Overseer, not directly to the Gadget". `startSession(approvalQueue)` returns the session capability with the core obligation spelled out: *every* operation must go through the approval queue, reads authorized **before** returning data, writes not actually performed until approved, with simulation of pending actions recommended but left to the author (packages/workshop-shared/src/gatekeeper.ts:692-740).
- **`ObservationAuthorizer` / `ApprovalQueue extends ObservationAuthorizer`** — the kernel-side authority the gatekeeper must call: `authorizeObservation(description)` returns quietly or throws, and the doc explicitly blesses fetch-then-authorize ordering for strictly-read-only operations provided nothing reaches the gadget first (packages/workshop-shared/src/gatekeeper.ts:855-880, 934). Optional surfaces (`SlashCommandProvider`, `getAgentCatalog`, `HookController`/`HookInitiator`) inherit the same posture: catalog access and slash-command expansion must be authorized as observations before returning data (packages/workshop-shared/src/gatekeeper.ts:900-912, 737-752).

## Extension points

- New RPC surface: add to `api.ts` (client-facing) or `gatekeeper.ts` (driver-facing), implement behind `@validateRpc()`, follow the guide [Change Guide: Modifying the RPC API](/openwiki/guides/changing-the-rpc-api.md).
- `code-change.ts` is the shared, module-encapsulated wire format for uncommitted edits (see [Gadget Runtime](/openwiki/architecture/gadget-runtime.md)).
- Optional methods (`createAccount?`, `getAgentCatalog?`, `getSlashCommandProvider?`) are the feature-negotiation seam — callers gate on advertised description flags, never on probing.
