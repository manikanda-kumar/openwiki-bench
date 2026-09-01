---
type: guide
title: How to Change the Shared RPC API
description: Change guide for packages/workshop-shared/src/api.ts and the Cap'n Web contract — kernel review bar, doc-comment requirement, derived types over mirrored casts, pipelining, stub disposal, useState wrapping, and validation via @validateRpc.
tags: [guide, rpc, api, capnweb, review, validation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-2a82cf98957a45d4832b41ec
    resource: repo://packages/gatekeeper-cloudflare/src/cloudflare.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-c6d452bd9bd81052e10542e7
    resource: repo://packages/workshop-frontend/src/RpcContext.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# How to Change the Shared RPC API

`packages/workshop-shared/src/api.ts` is the client-server contract; together with
`packages/workshop-backend/` it is the **kernel**, which reviewers read line by line and hold to a
higher bar than UI or gatekeeper code (REVIEW.md#L10-L13). Treat every change as a review artifact.

## House rules (from REVIEW.md, with code evidence)

1. **Doc-comment every exported member** — types, consts, and functions, not just interfaces
   (REVIEW.md#L14-L15). The file models this: e.g. `LoginAttempt` documents that holding the stub
   *is* the capability and disposing it abandons the attempt
   (packages/workshop-shared/src/api.ts#L35-L48).
2. **Never mirror an RPC interface with a hand-written copy plus `as unknown as`.** Derive from the
   real type. `user.ts` needs required views of optional RPC methods and does it with
   `Required<Pick<GatekeeperVendor, "createAccount">>` — "derived … rather than re-declared, so
   they can't drift" (packages/workshop-backend/src/user.ts#L44-L55).
3. **Reuse existing mechanisms over parallel ones** (REVIEW.md#L18-L19) — e.g. add error cases to
   the existing `codedErrorFamily` families rather than inventing new error channels
   (packages/workshop-shared/src/api.ts#L301-L357), and follow the established subscription idiom
   (dispose-to-cancel on the returned stub, packages/workshop-shared/src/api.ts#L1598-L1612).
4. **Split large kernel changes by concern**: keep `workshop-backend`/`workshop-shared` diffs
   reviewable apart from UI, and keep kernel diffs small — fewer kernel lines is itself a goal
   (REVIEW.md#L21-L23).

## RPC semantics to preserve

- **Promise pipelining is intentional.** An RPC promise may be passed as an argument or used in
  place of the stub without awaiting; unawaited RPC promises must **not** be "fixed" as floating
  promises (that lint conflicts deliberately with this design) (REVIEW.md#L63-L64).
- **Stubs must be disposed** — `stub[Symbol.dispose]()`, `using`, or a `useEffect` cleanup; an
  acquired-but-never-disposed stub is a server-side leak worth flagging (REVIEW.md#L67-L69; live
  example: packages/workshop-backend/src/overseer.ts#L4224-L4227).
- **React `useState` cannot hold a bare stub**: every stub is callable at runtime, so the setter
  would *call* it as an updater function; wrap it in an object (REVIEW.md#L65-L66; applied in
  packages/workshop-frontend/src/RpcContext.tsx#L5-L9). Disposal alone also doesn't reject
  in-flight calls, so superseded stubs must be dropped by replacement
  (packages/workshop-frontend/src/useAuth.ts#L31-L40).

## Validation

Annotate every RPC interface implementation with `@validateRpc()` (capnweb-validate) so
auto-generated runtime validation matches the TypeScript signatures — and then **do not** write
redundant hand checks for what the generator already covers
(packages/workshop-backend/src/server.ts#L75, L624, L635;
packages/gatekeeper-github/src/github.ts#L809). Methods carrying payloads the validator can't
check (raw fetchers, opaque streams) opt out individually with `@skipRpcValidation()`
(packages/gatekeeper-cloudflare/src/cloudflare.ts#L472-L475). Semantic validation *on top of*
structure (e.g. code changes) belongs in the owning shared module, with the two-stage order
documented there (packages/workshop-shared/src/code-change.ts#L26-L38).

## Capability-security review bar

API changes around gatekeepers are checked against the invariant that a resource becomes
"ambient" only through user/admin configuration — a gatekeeper must never assert its own ambience
— and that capabilities are minted only through `user.ts:getGatekeeperClassFor()`
(REVIEW.md#L25-L37). Auth config stays out of the API surface entirely; it is env-var driven so a
compromised admin session can't change sign-in policy (REVIEW.md#L33-L37).

## Tooling that gates your change

- `pnpm build` is what `pnpm types:check` runs — a recursive cached `vp run -r --cache build`
  (package.json#L8, L20) — and every package type-checks single-threaded because root
  `tsconfig.json` sets `"singleThreaded": true`, which REVIEW.md says is measured as the fastest
  and smallest configuration (tsconfig.json#L19, REVIEW.md#L108).
- `pnpm lint` is `vp lint` (oxlint) plus the two type passes (package.json#L18-L22); pipelining
  stays exempt from floating-promise rules by design (REVIEW.md#L63-L64, L100-L107).
- Behavioral proof lives in `packages/workshop-backend` unit tests and the real-workerd
  `packages/integration-tests` suite speaking Cap'n Web over WebSocket exactly like the browser
  (docs/integration-testing.md#L24-L30) — see
  [Integration Test Harness](../testing/integration-harness.md).

## Related pages

- Contract map: [RPC and Shared API](../architecture/rpc-and-shared-api.md)
- Shipping the change: [Release Pipeline](../operations/release-pipeline.md)
