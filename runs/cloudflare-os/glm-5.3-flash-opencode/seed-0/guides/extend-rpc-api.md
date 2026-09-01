---
type: change-guide
title: "Change Guide: Extending the RPC API"
description: How to add or change an RPC method across workshop-shared (the contract), workshop-backend (the implementation), and workshop-frontend (the consumer), including the kernel's doc-comment bar, capnweb-validate's role, and the pipelining/stub conventions.
tags: [guide, rpc, api, capnweb, review]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-30239eee070a503c224c24f6
    resource: repo://packages/workshop-backend/package.json
  - id: openwiki-source-ca45e791592e9cf3a1e0fbad
    resource: repo://packages/workshop-backend/src/deployment-config.ts
  - id: openwiki-source-cc617cac997161f6d93b8947
    resource: repo://packages/workshop-backend/src/do-retry.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-61160bfdcdbf3fe98a3883e5
    resource: repo://packages/workshop-frontend/src/useAuth.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Change Guide: Extending the RPC API

The RPC contract lives in one file — `packages/workshop-shared/src/api.ts` (and `gatekeeper.ts` for the gatekeeper surface) — with implementations in the backend and consumers in the frontend. A change touches all three, and the shared file is reviewed as kernel code.

## 1. Declare the method in workshop-shared

Add the method to the appropriate interface (`PublicApi`, `AuthenticatedApi`, `Overseer`, `GadgetClient`, …), and **doc-comment every exported member you add — types, consts, and functions, not just interfaces**. `REVIEW.md` makes `packages/workshop-backend` and the public API in `workshop-shared/src/api.ts` the highest-scrutiny "kernel" — maintainers read every line, so hold them to a higher bar than UI or gatekeeper code, keep the diff small and elegant, prefer reusing existing mechanisms over adding parallel ones, and when a backend change is large, split it by concern so `workshop-backend`/`workshop-shared` can be reviewed apart from UI (REVIEW.md:1-22).

Never introduce a hand-written interface that mirrors an RPC interface plus an `as unknown as` cast — derive from the real type instead (e.g. `Required<Pick<...>>` views over the source interface, as the user DO does for optional singleton methods) or rethink the design (REVIEW.md:10-11, packages/workshop-backend/src/user.ts:45-55). The narrow `@ts-expect-error Cap'n Web RPC stubs and native RPC targets are compatible` casts that do exist are conversions between capnweb's and the runtime's stub types at capability hand-off points — not type mirrors (packages/workshop-backend/src/server.ts:278, 597).

## 2. Implement it in workshop-backend

Implement the method on the matching `RpcTarget` class (`AuthenticatedApiImpl`, `OverseerClientInterface`, …), each annotated `@validateRpc()` so capnweb-validate installs runtime type validation generated from the interface's TypeScript signatures — do not write redundant validation that duplicates those checks (AGENTS.md documents this rule and the codebase applies it: packages/workshop-backend/src/server.ts:75, packages/workshop-backend/src/overseer.ts:9052+; every exported capnweb interface carries `@validateRpc()` on its implementing class). Concretely:

- Access user state through the fresh-stub-per-request `#user` getter (wrapped for DO-reset telemetry), and use `retryOnDoReset` only for pure reads (packages/workshop-backend/src/server.ts:94-98, packages/workshop-backend/src/do-retry.ts:96-110).
- Methods that hand out deeper capabilities return `RpcStub<T>` (or native stubs at hand-off points); keep the shape pipelining-friendly — throw on missing targets rather than returning null when callers will pipeline on the result, the way `openGadget` and `getGadget` do (packages/workshop-shared/src/api.ts:461-479, 1662-1666).
- Expected, client-classifiable failures should use a coded error family (`createXError`/`getXErrorCode`) like `OPEN_GADGET_ERROR_CODES`/`AUTH_ERROR_CODES` (packages/workshop-shared/src/api.ts:315-357).

## 3. Consume it in workshop-frontend

Call it through the appropriate stub. Two conventions protect React integration (applied throughout the frontend):

- **Never store an RPC stub directly in `useState`** — the setter calls function-typed values, and stubs appear callable; wrap it in an object.
- **Dispose stubs you stop using** (`stub[Symbol.dispose]()`, ideally in the effect's cleanup), and remember disposal does not reject in-flight calls — use cancellation flags for stale-result protection, as `useAuth` does (packages/workshop-frontend/src/useAuth.ts:41-56).
- Prefer **promise pipelining** where the API shape allows: capnweb resolves promise arguments server-side, so a stub can be used before its producing call resolves (packages/workshop-shared/node_modules/capnweb README is the reference; the codebase's documented patterns are `openGadget` pipelining and `useAuth`'s unawaited `whoami`) (packages/workshop-shared/src/api.ts:461-479, packages/workshop-frontend/src/useAuth.ts:38-41).

## 4. Deploy-time validation

The backend's build runs `capnweb-validate build` (its `main` is the validated output under `.wrangler/validate/`), so a signature change regenerates the RPC validators at build time — type-check with `pnpm build` and run `pnpm test` (packages/workshop-backend/wrangler.jsonc:5-9, packages/workshop-backend/package.json:8-9).

## Worked example: boot-time config

`getServerConfig()` shows the full path: a doc-commented `PublicApi` method returning a `ServerConfig` type ("contains no secrets"); `deployment-config.ts` aggregates env-driven auth config, AI Gateway billing state, and the admin-config mirror, querying auth vendors' `describe()` in parallel because the call runs on every (re)connect; and the frontend fetches it in `AppWithConnection` whenever the (re)connected stub changes (packages/workshop-backend/src/deployment-config.ts:1-40, packages/workshop-shared/src/api.ts:53-57, packages/workshop-frontend/src/main.tsx:225-241).

## Related pages

- [Cap'n Web RPC Protocol and API Surface](/openwiki/architecture/rpc-protocol.md)
- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md)
- [Frontend SPA and Connection Lifecycle](/openwiki/frontend/spa.md)
