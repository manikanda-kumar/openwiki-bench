---
type: guide
title: "Change Guide: Modifying the RPC API"
description: Walkthrough for changing workshop-shared's RPC surface — declaring the method, implementing it in the kernel with the compile-time role checks that new Overseer methods must pass, wiring a frontend caller with stub-wrapping and disposal, and the validation/review rules that apply.
tags: [guide, rpc, api, validation, review]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-f984670cebcdb6f0af7b87ca
    resource: repo://packages/workshop-backend/vitest.integration.config.ts
  - id: openwiki-source-87ad9ddb85476e8803af6d66
    resource: repo://packages/workshop-frontend/src/GatekeeperAppPage.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
  - id: openwiki-source-5e1b077422a94ae165e88e4e
    resource: repo://vite.config.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Change Guide: Modifying the RPC API

The client↔server contract is the interface set in `packages/workshop-shared/src/api.ts`; the kernel↔gatekeeper contract is `src/gatekeeper.ts`. Both packages are reviewed more strictly than UI code (workshop-backend is the "kernel": keep diffs small and elegant — large changes are split by concern so shared API changes can be reviewed apart from implementation, and every exported member of the workshop-shared public API carries a JSDoc comment; this is also lint-enforced by the `gadgets/prefer-jsdoc` rule, vite.config.ts:31-33).

## The worked example pair

A real method end to end is `AuthenticatedApi.getGatekeeperApp` — use it as your template:

- **Declaration** (packages/workshop-shared/src/api.ts:689-696): returns a `GatekeeperUiFrame | null` where `ui` is an `RpcStub` — the doc-comment records the capability semantics, like `LoginAttempt`'s "holding this stub is the capability to receive the resulting session token; dispose it to abandon" (packages/workshop-shared/src/api.ts:35-47).
- **Implementation** (packages/workshop-backend/src/server.ts:565-584): a thin delegation to `UserDurableObject` (`listProvidedAccounts` + `startAccountAppUi`), self-sufficient per call because a direct URL load must not race the nav list. `AuthenticatedApiImpl` methods generally own *no state* — user-scoped data lives behind `this.#user`, read-only delegations wrapped in `retryOnDoReset`, writes never (packages/workshop-backend/src/server.ts:90-124; [Backend Kernel](/openwiki/architecture/backend-kernel.md)).
- **Caller** (packages/workshop-frontend/src/GatekeeperAppPage.tsx:16-52): fetch in `useEffect`, **wrap the frame in an object before `setState`** ("it holds a `ui` RPC stub, and we never want useState's setter to treat a stored value as an updater function"), and dispose the acquired stub in the cleanup — including the cancelled-after-resolve path, so no capability leaks on a fast navigation.

## Step 1 — declare

Add the method to the right interface (PublicApi for unauthenticated surfaces; AuthenticatedApi for session-scoped; `Overseer` :1594 and its `GadgetClient`/`GatekeeperClient` sub-capabilities for workspace surfaces; `AdminApi` :928 for deployment-admin ones). Design notes:

- **Prefer capability returns.** If the result is a live object, return `RpcStub<T>`; callers can then *pipeline* — capnweb resolves stubs by promise, so design for "usable immediately" and say so in the doc, as `newGadgetFromBlueprint` does (packages/workshop-shared/src/api.ts:653-657).
- **Mint-or-null for authorization gates**: model admin access like `getAdminApi(): Promise<RpcStub<AdminApi> | null>` — one check at mint, methods never re-check (packages/workshop-shared/src/api.ts:705-712, 919-928). Never let a *gatekeeper* or resource code assert its own ambience; ambience is a user/admin configuration (packages/workshop-backend/src/provisioning-policy.ts:1-12).
- **Expected failures** get stable codes in the existing `codedErrorFamily` patterns (`OPEN_GADGET_ERROR_CODES`, `AUTH_ERROR_CODES`) — clients branch on codes, and tests whitelist *expected* rejections by code, so an ad-hoc Error string both complicates clients and trips the fatal-unhandled-error guard (packages/workshop-shared/src/api.ts:314-358; packages/workshop-backend/vitest.integration.config.ts:30-45).
- If the method carries binding names or code-change payloads, reuse the shared validators instead of writing new ones: `validateBindingName` (api.ts:174-212) and the two-stage `code-change.ts` validators (packages/workshop-shared/src/code-change.ts:32-41).

## Step 2 — implement in the kernel

Implement classes declare `implements <Interface>`; do **not** hand-write a parallel interface plus an `as unknown as` cast — the `implements` clause is what keeps the mirror honest, and the compiler catches drift (packages/workshop-backend/src/server.ts:76, 636-637). The two accepted cast seams are native-vs-capnweb stub identity — `@ts-expect-error` with the comment "Cap'n Web RPC stubs and native RPC stubs are compatible but the type system doesn't know this" (packages/workshop-backend/src/server.ts:673-679) — and the facet-stub Proxy hacks where workerd stubs can't yet cross RPC (packages/workshop-backend/src/overseer.ts:4084-4110).

**New `Overseer` methods hit a deliberate compile-time gauntlet.** The build path implements it with `OverseerClientInterface` (full access) *and* `UseOverseerInterface`, a default-deny surface for `use`-role collaborators — the class comment states that adding any method "will fail to compile here until a developer consciously decides whether 'use' callers may invoke it" (packages/workshop-backend/src/overseer.ts:10548-10552). `GadgetClient` has the identical second gate in `UseGadgetClientInterface` (packages/workshop-backend/src/overseer.ts:11055-11060). Decide the answer consciously: implement, or `#deny()`, in the use-role class.

Annotate every RPC-implementing class with `@validateRpc()` so capnweb-validate's generated runtime validation covers argument/return shapes — and then *do not* re-check those shapes by hand: hand-written validation is only for invariants TypeScript (and thus the generator) can't express (packages/workshop-shared/src/code-change.ts:32-41 as the model of that division).

## Step 3 — wire the frontend

Frontend access goes through contexts (`useAuthenticatedApi`, `RpcContext`) over the one persistent WebSocket (packages/workshop-frontend/src/main.tsx:50-100). Apply the two rules from [RPC Contract](/openwiki/architecture/rpc-contract.md) literally: wrap any stub-bearing result in an object before storing it in `useState`, and dispose stubs you no longer need (cleanup functions, `using` on the backend). For streaming/subscription APIs, mirror `Overseer.subscribeToMetadata`'s convention: the returned subscription stub's disposal *is* the unsubscribe (packages/workshop-shared/src/api.ts:1598-1608).

## Step 4 — validate

```
vp run -F @gadgets/workshop-shared build   # type-check shared API
vp run -F @gadgets/workshop-backend build  # kernel + codegen (uncached here)
vp run -F @gadgets/workshop-frontend build
pnpm test                                   # scripts suite + per-package tasks
pnpm lint
```

`pnpm types:check` is an alias of `pnpm build` (package.json:20); both compile the *instantiated* RPC generics, which is why `singleThreaded` tsgo matters (tsconfig.json:16-20). Changes that alter RPC behavior earn integration coverage: the out-of-process harness speaks this same `/api` WebSocket contract, so an `__tests__` addition there (or in `packages/integration-tests`) exercises the wire, not a mock (packages/integration-tests/README.md).

## Review checklist

- [ ] Doc-comment on every new/changed exported member in workshop-shared (linted `gadgets/prefer-jsdoc`).
- [ ] `implements` the real interface; no mirror interface + cast.
- [ ] `@validateRpc()` on the implementation class; no validation that duplicates it.
- [ ] `Use*Interface` classes updated consciously (compile failure is the reminder).
- [ ] Stub lifecycle documented where the stub is a capability (dispose semantics).
- [ ] Frontend callers wrap stubs for `useState` and dispose in cleanup.
- [ ] Expected failures are coded errors; new codes added to the integration `onUnhandledError` expectations if they can reject independently.
- [ ] Kernel diff is minimal; shared-API change and implementation split into separately reviewable commits when large.

## Uncertainty

- The "small kernel diffs" and review-priority rules are project policy stated in human review practice; the code shows their mechanisms (implements-clauses, two-role classes, reserved validators) but cannot prove the review process itself.
