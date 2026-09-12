---
type: concept
title: Architecture Overview
description: A top-level map of Cloudflare OS — the operating-system analogy, the workshop backend kernel, frontend SPA shell, router, the three-tier gatekeeper hierarchy, capability-based security, and the Cap'n Web RPC contracts that connect them.
tags: [architecture, overview, cloudflare, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---

# Architecture Overview

Cloudflare OS is an "operating system" for AI productivity. Users chat with agents that perform
tasks, ask agents to build sandboxed personal applications called **gadgets**, and safely connect both
to external services through **gatekeepers**. It is built on Cloudflare Workers, making heavy use of
[Durable Objects](https://developers.cloudflare.com/durable-objects/), [Dynamic
Workers](https://blog.cloudflare.com/dynamic-workers/), and
[Facets](https://blog.cloudflare.com/durable-object-facets-dynamic-workers/): every workspace is its
own Durable Object, every gadget runs in a Dynamic Worker Facet, and gatekeepers install facets into
each workspace to manage access to remote services.

## The OS analogy

| Normal OS      | Cloudflare OS              |
|----------------|----------------------------|
| kernel         | `packages/workshop-backend`  |
| device drivers | `packages/gatekeeper-*`      |
| shell          | `packages/workshop-frontend` |
| processes      | gadgets                    |
| executables    | blueprints                 |
| users          | users                      |
| ACLs           | shared permissions         |
| —              | agents                     |

The kernel is the workshop-backend. Like a real OS kernel it connects users to programs and devices
(gadgets and gatekeepers) while implementing security by sandboxing applications and enforcing access
control. Gatekeepers are like device drivers: they connect users and agents to external services, so
the capability — not an asserted identity — is the authority. OSes traditionally treat users as the
subject and use ACLs; Cloudflare OS treats agents as first-class accountable subjects with their own
restricted permissions, using **capability-based security** rather than access-control lists.

## The packages

The repository is a pnpm workspace (`pnpm-workspace.yaml`, catalog of shared toolchain versions;
package name `cloudflare-os`). The top-level packages:

- **`workshop-backend`** — the kernel. Runs on Cloudflare Workers. RPC entrypoint, the three Durable
  Object classes (`UserDurableObject`, `OverseerDurableObject`, `AdminSettings`), the code-mode agent,
  blueprint/persistence, and the capability-security chokepoints. See
  [The Workshop Backend](kernel-backend.md).
- **`workshop-frontend`** — the shell, a pure SPA. React, Kumo UI, Phosphor icons, Vite, TanStack
  Router. Speaks RPC to the backend over a persistent WebSocket. See
  [The Workshop Frontend SPA](frontend.md).
- **`router`** — the public origin of a deployed instance. Serves the frontend assets and routes by
  path prefix to the backend and gatekeepers. Routing config *is* the binding set: it scans its own
  `GATEKEEPER_*` service bindings, so installing a gatekeeper is purely a binding change. It doubles
  as the dev router (with no `ASSETS` binding it proxies frontend requests to the Vite dev server).
- **`workshop-shared`** — shared API definitions between client and server: the RPC interface
  (`api.ts`) and the gatekeeper contracts (`gatekeeper.ts`). The RPC protocol is Cap'n Web.
- **`gatekeeper-*`** — a gatekeeper per external service (GitHub, Google, Slack, Notion, Linear,
  Cloudflare, Context Library, Scheduler, the MCP family, email, Home Assistant, Spotify, ZoomInfo,
  Supabase, Confluence). Each is a separate Cloudflare Worker.
- **`mcp-shared`** — a shared library behind the two MCP gatekeepers (hold the trust boundary,
  classification, scope grammar, OAuth, action store).
- **`configurator-ui`** — type-only component helpers for optional gatekeeper resource configurator
  UI modules, compiled by `scripts/build-gatekeeper-configurator.ts`.
- **`typed-storage`** — a shared library giving Durable Object storage a typed collection/singleton
  API.
- **`backend-utils`** — the server-side logger, observability-context, tracing, and the error
  Reporter.
- **`error-reporting`** — a vendor-neutral browser/Worker error event contract used by the Workshop
  and gatekeeper UIs.
- **`integration-tests`**: an e2e harness driving a whole deployment.

The root `scripts/` hold the build tooling (Vite+ `vp`), the gatekeeper-configurator builder, the
release pipeline, and the run-local / dev-server drivers.

## The routing model

`packages/router/src/index.ts` is the single public origin. On each request it:

1. Scans `env` for keys starting with `GATEKEEPER_`, lowercases/mangles each suffix to a slug
   (`Google` → `/gatekeeper/google`), and forwards the request to that gatekeeper's fetcher if the
   path matches. Gatekeeper OAuth redirects land on the gatekeeper Workers themselves at
   `/gatekeeper/<name>/oauth`, so there are no backend `/auth` callbacks.
2. Forwards `/api`, `/api/*`, `/blueprint-screenshot` to `env.WORKSHOP_BACKEND`.
3. Serves the built frontend assets via the `ASSETS` binding (production) — or, in dev, falls through
   to the backend, which itself serves the pre-built app under `run-local`.

A `GATEKEEPER_EMAIL` binding additionally enables the `email()` handler for inbound email routing.

## The three-tier gatekeeper hierarchy

Each gatekeeper implements three tiers (fully documented in
[Gatekeepers & the Approval Model](gatekeepers.md)):

1. **Vendor** (`GatekeeperVendor`, a `WorkerEntrypoint`) — one per service; the service binding the
   backend auto-discovers from `GATEKEEPER_*` env keys.
2. **User** (`GatekeeperUser`, a `WorkerEntrypoint`) — one human user's authenticated connection; the
   "connected account." Passes credentials and resource ids via `ctx.props`.
3. **Instance** (`Gatekeeper<Session>`, a DO facet of the Overseer) — a per-resource, per-Gadget
   binding that exposes the `Session` API to the Gadget.

## Capability-based security

Each agent and each Gadget by default has access to **nothing**. Access is granted by *introducing*
the agent or Gadget to a specific resource (e.g. pasting a GitHub repo link, or clicking "add
resource"). A resource becomes "ambient" (auto-injected) only through user or admin configuration — a
gatekeeper never asserts its own ambience (see `REVIEW.md`). The single core chokepoint is
`UserDurableObject.getGatekeeperClassFor()` in `user.ts`, where disabled gatekeepers/resources are
enforced before any capability is minted; gadget/agent code cannot reach it directly.

Every side-effecting action a Gadget or agent performs goes through an `ApprovalQueue`: reads are
authorized as observations before data is returned, and writes are queued and (typically) applied
later only after human approval — with the significant advancement that gatekeepers **simulate**
un-approved actions locally so the agent can keep working and the user can batch-approve later.

## Data and control flow

A request flows: **browser → router** (matches `/gatekeeper/<slug>` or `/api`) **→ workshop backend**
(`PublicApi` → `AuthenticatedApi` → `Overseer`) **→ user/overseer Durable Objects**, which instantiate
**gatekeeper Facets** that wrap external services over Cap'n Web RPC. Gadget client code runs in a
sandboxed iframe talking only to the Workshop via `postMessage`, receiving an RPC stub to its
server-side DO. This is all carried by the Cap'n Web RPC contracts described in
[the RPC contract page](capnweb-rpc.md).
