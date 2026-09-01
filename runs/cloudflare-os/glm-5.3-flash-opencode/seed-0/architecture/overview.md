---
type: architecture-overview
title: Platform Architecture Overview
description: What the Gadgets Workshop (Cloudflare OS) is, how its packages divide responsibilities (kernel, shell, drivers, shared contracts), and the end-to-end request flow from the browser through the router into the backend's Durable Objects and gatekeeper Workers.
tags: [architecture, cloudflare-workers, durable-objects, security, gatekeepers]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-3620ea92b45bc07237ce5aea
    resource: repo://packages/workshop-frontend/src/main.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Platform Architecture Overview

This repository is **Cloudflare OS** ("Gadgets Workshop"): an AI productivity environment where every user runs private, agent-built copies of their productivity apps — **gadgets** — inside strong sandboxes, with a capability-based security layer called **gatekeepers** mediating every contact with the outside world (README.md:1-18, 52-62).

Three product pillars, from the README:

1. An **agent chat UI** where users ask agents to do tasks (README.md:14).
2. **Sandboxed application development**: agents build "gadgets" (small personal apps) that users can safely modify and share. Each gadget is a private instance running in its own sandbox, so an app bug cannot leak another user's data, and users can freely ask agents to modify the code (README.md:15, 54-62).
3. **Gatekeepers**: per-external-service security Workers that wrap APIs, handle OAuth, enforce narrow resource access, log every action, and queue side-effecting actions for human approval — with **simulated outcomes** so agents are not blocked synchronously waiting for approval (README.md:64-79).

## The operating-system analogy

The README maps the codebase onto OS concepts, and the mapping is load-bearing for understanding ownership:

| OS concept | Package |
|---|---|
| kernel | `packages/workshop-backend` |
| device drivers | `packages/gatekeeper-*` |
| shell | `packages/workshop-frontend` |
| processes | gadgets |
| executables | blueprints |

(README.md:97-110.) On the runtime side, every workspace is its own Durable Object, every gadget runs in a Dynamic Worker Facet, and gatekeepers install facets into workspaces (README.md:114-118).

## Package topology

The workspace is `packages/*` (pnpm-workspace.yaml:1-2). Grouped by role:

**Shared contracts**
- `workshop-shared` — the RPC API spoken between frontend and backend (`api.ts`), the gatekeeper contract (`gatekeeper.ts`), code-change format, feature flags, limits, theme. It owns no runtime behavior of its own; both sides import it (packages/workshop-shared/src/api.ts:1-29).
- `typed-storage` — a typed schema layer over Durable Object storage, used by collections such as the git object store (packages/workshop-backend/src/git-store.ts:50, 70-74).
- `backend-utils`, `error-reporting`, `configurator-ui` — logging/observability helpers, the vendor-neutral error-reporting contract, and type-only UI helpers for gatekeeper configurators.

**Kernel**
- `workshop-backend` — the Cloudflare Worker that authenticates users, owns all Durable Objects (users, workspaces/overseers, admin settings, pending logins), stores gadget code in git-object form, runs the AI agent loop, and mediates everything between browsers, gatekeepers, and AI providers (packages/workshop-backend/wrangler.jsonc:5-9, packages/workshop-backend/src/server.ts:14-62).
- `router` — the public origin. It routes `/api/*` and `/blueprint-screenshot/*` to the backend, `/gatekeeper/<name>/*` to whichever gatekeeper Workers are bound, and serves the frontend SPA for everything else. Gatekeepers are discovered purely by scanning `GATEKEEPER_*` env keys, so installing one is a binding change, not a code change (packages/router/src/index.ts:1-45).

**Shell**
- `workshop-frontend` — the React SPA ("fat client"): chat UI, workspace editors, admin and connections pages. It is entirely client-side and speaks Cap'n Web RPC over a persistent WebSocket (packages/workshop-shared/src/api.ts:1-24, packages/workshop-frontend/src/main.tsx:94-101).

**Drivers (gatekeepers)**
- `gatekeeper-github`, `-google`, `-linear`, `-notion`, `-slack`, `-spotify`, `-confluence`, `-homeassistant`, `-email`, `-supabase`, `-zoominfo` — OAuth-connected external service integrations.
- `gatekeeper-cloudflare` — one connected account serving three purposes: sign-in, AI Gateway billing, and read-only Workers observability (AGENTS.md, packages/gatekeeper-cloudflare).
- `gatekeeper-context` (Context Library), `gatekeeper-scheduler` (Scheduled Tasks) — auto-provisioned gatekeepers whose accounts expose ambient agent sessions/management UIs.
- `gatekeeper-mcp` and `gatekeeper-mcp-portal` — user-pasted MCP endpoints and the admin-configured portal, sharing implementation in `mcp-shared`, whose trust boundary is its `tools.ts` (packages/mcp-shared/src).

**Support**
- `integration-tests` — an end-to-end test harness package (mock model, network interceptor, RPC client) (packages/integration-tests/src/harness.ts).

## Trust boundaries and ownership

- The backend is the **kernel**: it defines the architecture, enforces authentication, mints every capability, and is held to a stricter review bar than UI or gatekeeper code. Gatekeepers never mint Workshop capabilities; they only ever receive them (e.g. a `GatekeeperConnectCallback` Fetcher) and answer with their own (AGENTS.md; packages/workshop-shared/src/gatekeeper.ts:445-523).
- The browser SPA holds no authority of its own: it authenticates with a session token and then operates entirely through RPC capabilities handed to it, including per-workspace `Overseer` stubs (packages/workshop-shared/src/api.ts:70-133; packages/workshop-backend/src/server.ts:680-694).
- Gadgets (user-authored code) are doubly sandboxed — client-side in a locked-down iframe that can only `postMessage()` to its parent, and server-side in Dynamic Worker facets reachable only through capabilities the overseer hands out (packages/workshop-shared/src/api.ts:21-24).
- A resource becomes "ambient" (auto-injected into every chat) only through user/admin configuration of the gatekeeper; gatekeeper code cannot assert its own ambience (AGENTS.md; packages/workshop-backend/src/provisioning-policy.ts).

## End-to-end request flow

A typical session flows like this:

1. The browser loads the SPA and opens a WebSocket to `/api`, creating a Cap'n Web `PublicApi` session with jittered-backoff reconnect and probe logic (packages/workshop-frontend/src/main.tsx:94-110).
2. The router forwards `/api` traffic to `workshop-backend`, whose fetch handler validates Cloudflare Access (if configured) and upgrades the request into an RPC session rooted at `PublicApiImpl` (packages/router/src/index.ts:37-41; packages/workshop-backend/src/server.ts:840-870).
3. The client calls `authenticate(token)`; the backend resolves the user's Durable Object and returns an `AuthenticatedApiImpl` capability scoped to that user id (packages/workshop-backend/src/server.ts:680-694).
4. Opening a workspace yields an `Overseer` stub backed by that workspace's `OverseerDurableObject`, which in turn hands out `GadgetClient` stubs for each gadget, chat streams, and binding information for connected gatekeepers (packages/workshop-backend/src/overseer.ts:8204-8270; packages/workshop-shared/src/api.ts).
5. When gadget or agent code touches an external service, the call goes through the gatekeeper bound for that vendor — the backend reaches gatekeepers via `GATEKEEPER_*` service bindings discovered by name (packages/workshop-backend/src/auth/auth-vendors.ts:25-36), and side-effecting actions are queued for approval rather than executed immediately (README.md:75-79).
6. AI inference flows from the agent loop through the Cloudflare AI Gateway, with usage quotas checked per user before turns run (packages/workshop-backend/src/agent.ts:20-27; packages/workshop-backend/src/ai-gateway-billing/limits/usage-checker.ts).

## Related pages

- [Cap'n Web RPC Protocol and API Surface](/openwiki/architecture/rpc-protocol.md)
- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md)
- [Gatekeeper Contract](/openwiki/gatekeepers/contract.md)
- [Frontend SPA and Connection Lifecycle](/openwiki/frontend/spa.md)
