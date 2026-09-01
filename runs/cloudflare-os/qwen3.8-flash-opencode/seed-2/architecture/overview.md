---
type: architecture
title: Architecture Overview
description: How Cloudflare OS (the Gadgets Workshop) is decomposed into a kernel backend, gatekeeper "drivers", a frontend shell, and sandboxed gadget processes, and how requests and state are routed across them.
tags: [architecture, overview, monorepo, durable-objects, routing]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Architecture Overview

Cloudflare OS is an "operating system for AI productivity": users chat with agents, and both build and run small sandboxed personal apps called **Gadgets** whose access to external services is mediated by **Gatekeepers**. The repository is a pnpm monorepo whose package layout intentionally mirrors an OS:

| OS role | Package |
|---|---|
| kernel | `packages/workshop-backend` |
| device drivers | `packages/gatekeeper-*` |
| shell | `packages/workshop-frontend` |
| processes | gadgets (user-authored code, not a package) |
| executables/templates | blueprints (data shipped in `workshop-backend/format-blueprints/`) |

The backend earns the "kernel" label by connecting users to programs and devices (Gadgets and Gatekeepers) while enforcing security through application sandboxing and access control (README.md#L97-L108).

## Runtime substrate

The system is built on Cloudflare Workers and uses three runtime features heavily: **Durable Objects** (one per workspace, per user, per gadget facet), **Dynamic Workers** (executing user-authored gadget code), and **Facets** (Durable Object sub-objects). Every workspace is its own Durable Object; every Gadget runs in a Dynamic Worker Facet; Gatekeepers install facets into workspaces to manage access to remote services (README.md#L116). Everything can also run on the open-source `workerd` runtime locally — `pnpm run-local` does exactly that through `wrangler`, which drives `workerd` under the hood (README.md#L184-L200).

## Package map

- **`workshop-shared`** — the authoritative API surface: the client/server RPC interface (`src/api.ts`) and the Gatekeeper protocol contracts (`src/gatekeeper.ts`). Both frontend and backend import it; gatekeepers implement it.
- **`workshop-backend`** — the kernel Worker: authentication, the Overseer (workspace) and User Durable Objects, the agent runtime, blueprint storage, admin settings.
- **`workshop-frontend`** — a pure client-side React SPA (Vite, Kumo UI) that speaks to the backend over one persistent WebSocket (see [Workshop Frontend](../frontend/workshop-ui.md)).
- **`gatekeeper-*`** — one Cloudflare Worker per external-service integration (github, google, slack, notion, linear, confluence, email, homeassistant, spotify, supabase, zoominfo, mcp, mcp-portal, cloudflare, context, scheduler).
- **`mcp-shared`** — a library (not a Worker) shared by the two MCP connectors.
- **`router`** — the public-origin Worker that fronts a deployment (and doubles as the dev router).
- Support libraries: **`typed-storage`** (indexed Durable Object storage), **`backend-utils`** (logging/error-reporting/observability context), **`configurator-ui`** (type-only helpers for gatekeeper configurator UIs), **`error-reporting`** (browser/Worker error-report contract), **`integration-tests`** (end-to-end harness).

## Request topology

A deployment's public origin is the `router` Worker. Its routing config *is* its binding set: it discovers gatekeepers by scanning its own `GATEKEEPER_*` service bindings, so installing a gatekeeper is a redeploy-with-one-more-binding, not a code change. Path prefixes route as: `/gatekeeper/<name>/*` → that gatekeeper Worker; `/api*` and `/blueprint-screenshot/*` → `WORKSHOP_BACKEND`; everything else → frontend assets (or, in dev with no `ASSETS` binding, the backend, which forwards to the Vite dev server) (packages/router/src/index.ts#L1-L56).

In the backend Worker itself, the `fetch` handler serves the RPC API only on `/api`: HTTP `POST` gets a Cap'n Web batch response, and a WebSocket upgrade gets a persistent session whose lifetime can be aborted by the server (packages/workshop-backend/src/server.ts#L816-L868, #L887-L902). All other backend paths are narrow special cases (site logo, blueprint screenshots, `/api/client-errors`).

The backend's Durable Objects (`UserDurableObject`, `OverseerDurableObject`, `AdminSettings`, `PendingLogin`) are declared in wrangler migrations and reached dynamically via `ctx.exports` rather than an explicit `durable_objects` binding (packages/workshop-backend/wrangler.jsonc#L47-L63). Its data bindings are KV namespaces `BLUEPRINTS` and `AVATARS` plus R2 bucket `BLUEPRINT_CONTENT` (packages/workshop-backend/wrangler.jsonc#L66-L79). A production-relevant invariant: the `global_fetch_strictly_public` compatibility flag makes outbound `fetch()` strictly internet-facing (an SSRF guard, notably for the agent's `webFetch` tool), and `nodejs_compat` plus `allow_irrevocable_stub_storage` support the provider SDKs, Puppeteer-based PDF export, and persistent RPC stub storage (packages/workshop-backend/wrangler.jsonc#L12-L37).

## The Gadget execution model

A Gadget is a two-sandbox program:

- **Server code** (`server.js`) is a `DurableObject` subclass that runs inside a Dynamic Worker whose internet access is disabled; it can only reach the outside world through its injected **bindings** (Workers `env`) (README.md#L160-L162, packages/workshop-backend/src/agent.ts#L593-L611).
- **Client code** (`client.js`) runs in a fully sandboxed browser iframe, which sees a global `gadget` — a Cap'n Web RPC stub pointing at the server object — carried over a `postMessage()`-established session (README.md#L160-L162, packages/workshop-frontend/src/GadgetUI.tsx#L16-L17).

The workspace's Overseer object owns each gadget's facet: it names facets by gadget id, loads committed code through the `LOADER` worker-loader binding (cache key `${workspaceId}.${codeVersion}.${gadgetId}`), and aborts/reloads facets when code heads change (packages/workshop-backend/src/overseer.ts#L3958-L4090, wrangler.jsonc `worker_loaders`). Binding an agent or gadget to a gatekeeper resource yields a gatekeeper *session* in the workspace; hooks and persistent callbacks round-trip through loopback entrypoints the backend exports (`GatekeeperLoopback`, `GadgetTailLoopback`, `AgentSelfLoopback`, …) (packages/workshop-backend/src/overseer.ts#L8766, #L8921).

## Gatekeeper layer

Each connector follows a common shape, dictated by the contracts in `workshop-shared/src/gatekeeper.ts` and documented in [Gatekeeper Framework](../gatekeepers/framework.md): a `GatekeeperVendor` WorkerEntrypoint (bound as `GATEKEEPER_<NAME>`) that runs the OAuth connect flow, a per-account `UserAccount` Durable Object, and per-resource `Gatekeeper` Durable Object facets (e.g. `GitHubGatekeeperImpl`) that expose a session API enforcing the approval queue (packages/gatekeeper-github/src/github.ts#L1045, #L1382). Auto-provisioned connectors (context library, scheduler) additionally expose an account-level singleton and optional management UI.

## Where to go next

- Protocol mechanics (Cap'n Web, capability flow, `@validateRpc`): [RPC and Capability Model](rpc-and-capability-model.md)
- The workspace state machine: [The Overseer Workspace Object](../backend/overseer-workspace.md)
- Identity and login paths: [Authentication and User Accounts](../backend/auth-and-users.md)
- Building/running/testing: [Quickstart](../quickstart.md), [Toolchain, Tasks, and Build Cache](../development/toolchain-and-builds.md)
