---
type: architecture
title: System Architecture Overview
description: The Cloudflare OS mental model — kernel/drivers/shell/processes mapped to actual packages, the package map, and one representative request traced from the browser through the router, backend RPC root, workspace Overseer, gadget sandbox, and gatekeeper.
tags: [architecture, packages, workers, durable-objects, capability-security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-2aa79db0f81a9ae03810b504
    resource: repo://packages/typed-storage/package.json
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# System Architecture Overview

Cloudflare OS (repo root package name `cloudflare-os`) is an "AI productivity environment": an agent chat UI, sandboxed per-user "gadget" apps, and a capability-security layer ("Gatekeepers") between them and external services (README.md front matter; `package.json:2`). The README makes an OS analogy that is literally true in this codebase, so it is the best map.

## The OS analogy, grounded

| Traditional OS | This system | Where in code |
|---|---|---|
| kernel | `packages/workshop-backend` | One Worker hosting the RPC root plus the `UserDurableObject`, `OverseerDurableObject`, and `AdminSettings` DOs — [Backend Kernel](/openwiki/architecture/backend-kernel.md), [Overseer](/openwiki/architecture/overseer-workspace.md) |
| device drivers | `packages/gatekeeper-*` | One Worker per external service, speaking the shared `GatekeeperVendor`/`GatekeeperUser`/`Gatekeeper` contract — [Gatekeeper Framework](/openwiki/integrations/gatekeeper-framework.md) |
| shell | `packages/workshop-frontend` | A pure React SPA ("fat client") talking RPC over one WebSocket — [RPC Contract](/openwiki/architecture/rpc-contract.md) |
| processes | gadgets | Server-side Durable Object *facets* of the workspace DO + client-side sandboxed iframes — [Gadget Runtime](/openwiki/architecture/gadget-runtime.md) |
| executables | blueprints | Committed code snapshots shared by link, with binding *requirements* but no credentials — [Blueprints](/openwiki/architecture/blueprints.md) |
| ACLs | sharing + observers | `docs/sharing.md`, [Sharing and Observers](/openwiki/security/sharing-observers.md) |

The analogy's load-bearing part: security comes from sandboxing and capabilities, not from trusting code. A gadget's server runs as a Dynamic Worker with `globalOutbound: null`; its client runs in a `srcDoc` iframe whose CSP is `default-src 'none'` (packages/workshop-backend/src/overseer.ts:4013-4027; packages/workshop-frontend/src/GadgetUI.tsx:105-117). An agent gets *nothing* by default — resources must be explicitly "introduced", and even then every read is an auditable "observation" and every side effect an approvable "action" ([Capability Security Model](/openwiki/security/capability-model.md)).

## Package map

- **`packages/workshop-shared`** — the RPC contract both sides compile against: the client↔server API (`api.ts`), the core↔gatekeeper contract (`gatekeeper.ts`), code-change OT types (`code-change.ts`), limits/feature flags/theme. See [RPC Contract](/openwiki/architecture/rpc-contract.md).
- **`packages/workshop-backend`** — the kernel Worker (DOs, loopbacks, agent runtime, git object store, blueprint archive, admin config).
- **`packages/workshop-frontend`** — the Workshop SPA (React + Kumo + Vite).
- **`packages/router`** — the public origin Worker; pure path-prefix routing (next section).
- **`packages/gatekeeper-*`** — 14 vendor connectors plus **`mcp-shared`** (library behind the two MCP connectors), **`configurator-ui`** (type-only helpers for resource configurators), and **`gatekeeper-context`** / **`gatekeeper-scheduler`** (the auto-provisioned singleton gatekeepers).
- **`packages/backend-utils`** — logger/observability/error-reporting primitives; **`packages/error-reporting`** — the vendor-neutral browser error contract; **`packages/typed-storage`** — the Durable Object collection layer every DO uses (the only package that emits `dist`).
- **`packages/integration-tests`** — out-of-process workerd harness; **`scripts/`** — dev-server, run-local, release pipeline, preview deploys, codegen shared by packages.
- **`docs/`** — design writeups (blueprints, oauth-signin, observers, ai-gateway-billing, integration-testing, sharing, public-server); **`plans/`** — historical implementation plans. Both are *descriptive, not normative* — source and tests win.

## Routing: the public origin

The `router` Worker is the only thing users touch. It discovers its gatekeeper routes by scanning its own `GATEKEEPER_*` service bindings — so installing a gatekeeper is *only* a binding change on this worker — forwards `/api/*` and `/blueprint-screenshot/*` to the workshop backend, and serves the frontend assets for everything else (or proxies to the Vite dev server when no `ASSETS` binding exists, which is how `pnpm dev-server` reuses it) (packages/router/src/index.ts:1-57). Gatekeeper OAuth redirects land on `/gatekeeper/<name>/oauth` — the backend hosts no auth callbacks (packages/workshop-backend/src/server.ts:807-811).

## A representative flow, end to end

1. **Boot:** the SPA opens one Cap'n Web WebSocket session against `/api` — kept for the whole session, reconnecting with backoff; connection state lives in module globals because React's dev-mode double-invoke would otherwise fight over the socket (`packages/workshop-frontend/src/main.tsx:50-100`).
2. **Auth:** `login()`/`authenticate()` on the `PublicApi` resolves to a `"<username>:<token>"` session string checked by the user's `UserDurableObject`, minting an `AuthenticatedApi` capability for the socket (`packages/workshop-backend/src/server.ts:680-760`; see [Backend Kernel](/openwiki/architecture/backend-kernel.md)).
3. **Workspace:** `openGadget()` addresses the workspace's `OverseerDurableObject`, which confirms its own existence against the owner's User DO before initializing (`packages/workshop-backend/src/overseer.ts:8253-8285`).
4. **Agent turn:** a chat message starts a turn inside the Overseer DO (`#runAgentTurn` → `runAgent`, [Agent Runtime](/openwiki/architecture/agent-runtime.md)); the model's `executeCode` runs in a throwaway Dynamic Worker whose `env` is the chat's named bindings and which has zero network access (packages/workshop-backend/src/overseer.ts:7264-7285).
5. **Gatekeeper call:** `env.someBinding` is a `GatekeeperLoopback` `Fetcher`; calling it re-enters the Overseer DO via `ctx.exports` with a `GatekeeperCaller` identity, which resolves/loads the gatekeeper's *facet* (`ctx.facets.get("gatekeeper<id>")`) and starts a session, with reads recorded as observations and writes queued for approval (packages/workshop-backend/src/overseer.ts:8766-8795, 4259-4269, 2719-2733; [Gatekeeper Framework](/openwiki/integrations/gatekeeper-framework.md)).
6. **UI update:** streaming events (`textDelta`, tool previews, code diffs) fan out over the same WebSocket session to collaborators watching the chat; gadget *clients* talk to their servers over a separate `postMessage`/`MessagePort` session handed to the sandboxed iframe (packages/workshop-frontend/src/GadgetUI.tsx:16-35, 326-360).

## Runtime substrate

Everything runs on Cloudflare Workers primitives — Durable Objects, DO *facets*, and *Dynamic Workers* (the `worker_loaders` `LOADER` binding) — several of which (facets, Dynamic Workers) were added to the Workers runtime specifically for this project (README.md "Built on Workers"). The same stack runs locally on `workerd` through `wrangler`: `pnpm run-local` builds the frontend, boots every worker, and serves the app at `localhost:8787` (README.md Quick Start; scripts/run-local.ts:1-14).

## Where to go next

- Changing the client/server boundary → [Change Guide: Modifying the RPC API](/openwiki/guides/changing-the-rpc-api.md)
- Adding an external service → [Change Guide: Adding a Gatekeeper](/openwiki/guides/adding-a-gatekeeper.md)
- Shipping to a customer instance → [Router, Release Pipeline, and Preview Deploys](/openwiki/operations/router-and-release-pipeline.md)

## Uncertainty

- README describes future plans (workerd self-hosting docs, independently deployed gatekeeper services) that are *not* implemented; do not treat them as operational contracts.
