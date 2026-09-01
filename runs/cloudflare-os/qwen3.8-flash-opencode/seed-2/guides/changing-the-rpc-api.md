---
type: change-guide
title: How to Change the RPC API
description: Safely modify the workshop-shared RPC interface and its backend/frontend implementations — kernel review bar, doc-comment and type-derivation rules, @validateRpc, promise pipelining, stub disposal, and the useState trap.
tags: [rpc, api, guide, capnweb, review]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# How to Change the RPC API

`packages/workshop-shared/src/api.ts` is a public API of the **kernel**: "maintainers read every line" of `workshop-backend` and of API changes in `workshop-shared`, so keep the diff small and elegant and expect it to gate the PR (REVIEW.md#L10-L16). Background on the transport: [RPC and Capability Model](../architecture/rpc-and-capability-model.md).

## The rules the review applies (with where they bite in code)

1. **Doc-comment *every* exported member** — types, consts, and functions, not just interfaces (REVIEW.md#L14-L15). The existing surface is the pattern: every `PublicApi`/`AuthenticatedApi`/`Overseer` method carries JSDoc with the security-relevant subtleties spelled out (e.g. the empty-array-vs-omitted `resourceUrlPatterns` distinction on connect, or the submitCodeChange retry contract) (packages/workshop-shared/src/api.ts#L49-L136, #L1690-L1740; gatekeeper.ts#L429-L443).
2. **Never write a hand-written interface mirroring an RPC interface with an `as unknown as` cast** — derive from the real type (`Pick`/`Required` over the actual interface) or rethink the design (REVIEW.md#L17-L18). The canonical examples are in-tree: `AccountCreatorStub = Required<Pick<GatekeeperVendor, "createAccount">>` in the User DO (packages/workshop-backend/src/user.ts#L44-L53) and the `CatalogGatekeeperFacet` derived view in the Overseer (packages/workshop-backend/src/overseer.ts#L254-L256). By contrast, the `@ts-expect-error` spots in `server.ts` are only for the known type-system gap between Cap'n Web and native RPC stubs, never capability mirrors (packages/workshop-backend/src/server.ts#L278-L281, #L547-L549).
3. **Prefer reusing an existing mechanism over adding a parallel one** (REVIEW.md#L19-L20).
4. **Split big kernel changes** by concern so `workshop-backend`/`workshop-shared` can be reviewed apart from UI (REVIEW.md#L21-L23).

## Adding or changing an interface method

- **Declare** it on the interface in `workshop-shared` (type-only; interfaces are pure contracts extended by the implementations).
- **Implement** on the server class carrying `@validateRpc()` — the decorator installs auto-generated runtime validation matching the TS signatures, so do **not** hand-write checks the decorator already covers (REVIEW.md context; packages/workshop-backend/src/server.ts#L75-L76, #L624-L625, #L635-L636). capnweb-validate stays on esbuild specifically for its Stage-3 decorator lowering (pnpm-workspace.yaml#L16-L20).
- **Check the default-deny view**: if the method is on `Overseer`, `UseOverseerInterface implements Overseer` will stop compiling until you consciously decide whether use-role collaborators may call it (packages/workshop-backend/src/overseer.ts#L10540-L10552). Treat that compile error as the design question, not the obstacle.
- **Consume** it from the frontend through the existing stubs — usually `AuthenticatedApi` (via `useAuth`) or `Overseer` (via `openGadget`).

## Write the call sites for the protocol, not for REST

**Pipeline.** If an RPC returns a stub, you may use the *promise* in place of the stub — including as an argument to another call — because Cap'n Web resolves it server-side; awaiting first just adds a round trip (REVIEW.md#L62-L64). Live examples: `openGadget()`'s result flows straight into `getGadget`/`getMetadata` chains without a "did connect succeed" barrier (packages/workshop-backend/src/server.ts#L457-L459); `getGatekeeperApp()` holds one user stub for two calls with the comment "one stub for both calls" (server.ts#L575-L579); and the API's own docs tell clients to *initiate* `subscribeToChat` before history reads without awaiting it, so no message is missed (packages/workshop-shared/src/api.ts#L1859-L1913). Lint consequence: `no-floating-promises` stays off precisely because unawaited RPC promises are idiomatic here (vite.config.ts#L22-L28).

**Dispose.** Stubs hold server-side resources; an acquired-and-never-disposed stub is a flagged leak (REVIEW.md#L67-L69). Patterns in the wild: `using gadget = await overseerResult.getGadget(...)` + `gk[Symbol.dispose]()` in `finally` blocks (packages/workshop-backend/src/server.ts#L458, #L498-L500), old-stub disposal on replacement in `useAuth` (packages/workshop-frontend/src/useAuth.ts#L76-L85), and effect cleanups that dispose what the effect obtained. The *capability* semantics matter too: disposing the `LoginAttempt` stub cancels the server-side login wait (packages/workshop-backend/src/server.ts#L620-L624), and parameter stubs die at call end unless `dup()`ed (packages/workshop-backend/src/agent.ts#L619-L623).

**The React trap.** A `useState` value that will hold an `RpcStub` must be wrapped in an object — every stub is callable at runtime, and the setter treats a function argument as an updater, so the raw stub would be *invoked* (REVIEW.md#L65-L66). Follow `main.tsx`'s `{stub, connectionLost}` shape (packages/workshop-frontend/src/main.tsx#L186-L192).

## Failure taxonomy

New error paths should follow the tagged-code convention rather than message parsing: `createOpenGadgetError(OPEN_GADGET_ERROR_CODES.*)` + `getOpenGadgetErrorCode()` for workspace-open outcomes whose codes drive cleanup (stale-listing prune), and `createAuthError(AUTH_ERROR_CODES.*)` for token failures (packages/workshop-shared/src/api.ts#L315-L342; packages/workshop-backend/src/server.ts#L256-L264; packages/workshop-backend/src/user.ts#L304-L319).

## Verify

`pnpm types:check` (the `@validateRpc` transform and the `implements` checks are compile-time), `pnpm build` to regenerate the validated entrypoints under `.wrangler/validate` (packages/workshop-backend/vite.config.ts#L30-L35), then the package tests — and for cross-boundary semantics, the integration suite speaks the *real* WebSocket API (packages/integration-tests/src/rpc-client.ts). See [Testing Approach](../development/testing.md).
