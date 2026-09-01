---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---


# Architecture Overview

This repository is Cloudflare OS — an "operating system" for AI productivity that provides an
agent chat UI, sandboxed "gadget" application development, and a security framework (Gatekeepers)
that applies guardrails to both agents and apps (README.md#L10-L21). The system gives every user a
**private instance** ("gadget") of the small app they need, built and modified by an agent, with
every external access brokered by a **Gatekeeper** (README.md#L56-L59).

## The three pillars

- **Gadgets** — per-user private app instances in separate sandboxes; a security bug in one app
  cannot leak another user's data because the sandbox controls all access (README.md#L54-L61).
- **Agents** — chat-driven builders that write gadget code and act through named bindings
  ([Agent Runtime and Chat](./agent-runtime.md)).
- **Gatekeepers** — capability-based security layer, "like supercharged MCP servers": each is its
  own Cloudflare Worker that wraps an external service with a clean Cap'n Web API, handles OAuth,
  narrows access to the specific resource the user intended, logs every action, and puts side
  effects through human approval (README.md#L64-L79). Approval is **asynchronous**: an action
  needing approval is *simulated* locally so the agent keeps working, and the user approves or
  rejects queued actions later ([Gatekeeper Framework](../security/gatekeeper-framework.md);
  README.md#L75-L77).

## Package map and ownership boundaries

The workspace (pnpm, root package `cloudflare-os`) divides as follows; every deployable package
carries its own `wrangler.jsonc`, and the UI packages build with Vite:

| Package | Role |
| --- | --- |
| `workshop-frontend` | The Workshop UI: a React (Kumo) single-page app that runs entirely in the browser and speaks RPC to the backend (packages/workshop-frontend/src/main.tsx#L90-L100) |
| `workshop-backend` | The Workshop server on Cloudflare Workers — the **kernel** (see below) |
| `workshop-shared` | Shared RPC API definitions between client and server (packages/workshop-shared/src/api.ts#L1-L28) |
| `router` | Public origin of a deployment: serves frontend assets and routes by path prefix (packages/router/src/index.ts#L1-L9) |
| `gatekeeper-*` | One Cloudflare Worker per external-service integration (README.md#L79) |
| `mcp-shared` | Shared library (not a Worker) behind the two MCP gatekeepers (packages/mcp-shared/README.md#L3-L6) |
| `configurator-ui` | Helpers for optional gatekeeper resource configurator UI modules |
| `backend-utils`, `typed-storage`, `error-reporting` | Support libraries: logging/tracing, DO storage schema, browser error capture |
| `integration-tests` | Real-workerd integration harness ([Integration Test Harness](../testing/integration-harness.md)) |

### The kernel bar

`packages/workshop-backend/` and the public API in `packages/workshop-shared/src/api.ts` are the
**kernel**: maintainers read every line, and it is held to a higher bar than UI or gatekeeper code
— doc comments on every exported API member, no mirrored interfaces with casts, prefer reusing
mechanisms, and split large kernel changes from UI changes at PR/commit granularity
(REVIEW.md#L10-L23; review priority order at REVIEW.md#L7-L8).

## Request topology

`packages/router` is the single public origin. It routes `/api/*` and `/blueprint-screenshot/*` to
the workshop backend, and `/gatekeeper/<name>/*` to whichever gatekeepers are bound — gatekeepers
are discovered by scanning the worker's own `GATEKEEPER_*` service bindings, so installing a
gatekeeper is purely a re-deploy with one more binding, with no router code or config changes
(packages/router/src/index.ts#L1-L35). Without an `ASSETS` binding the same worker doubles as the
dev router, falling through frontend requests to the backend (packages/router/src/index.ts#L7-L9,
L47-L58).

The frontend opens a **persistent WebSocket** RPC session to `/api` rooted at the `PublicApi`
interface (packages/workshop-frontend/src/main.tsx#L98); the backend accepts either a WebSocket
upgrade or a batched POST at `/api` and hands the session the same `PublicApi` root object
(packages/workshop-backend/src/server.ts#L889-L913). Login mints an `AuthenticatedApi`, from which
per-user Durable Objects and the `AdminApi` capability are reached
(packages/workshop-backend/src/server.ts#L71-L110).

## Backend object model

The workshop-backend entrypoint re-exports the Durable Object classes and worker entrypoints that
wrangler binds — `UserDurableObject`, `OverseerDurableObject` (one workspace each), `AdminSettings`,
`LanguageModelGatekeeper`, plus a family of `*Loopback` entrypoints used to hand self-referential
capabilities between isolate contexts (packages/workshop-backend/src/server.ts#L44-L66). Details:
[Workshop Backend Kernel](./workshop-backend.md).

## Where to go next

- RPC contract and its rules: [RPC and Shared API](./rpc-and-shared-api.md)
- Code storage and sandboxed execution: [Gadgets, Code Storage, and Collaboration](./gadgets-and-code.md)
- Security invariants: [Capability Security Model](../security/capability-security-model.md)
- Shipped integrations: [Gatekeeper Connector Catalog](../integrations/gatekeeper-connectors.md)
