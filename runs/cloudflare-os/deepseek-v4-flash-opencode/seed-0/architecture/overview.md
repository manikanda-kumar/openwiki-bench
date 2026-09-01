---
type: architecture
title: Architecture overview
description: The system-level map of Cloudflare OS — the OS metaphor, the Workers runtime model of Durable Objects and Dynamic Worker facets, the three deployment tiers (router, workshop-backend, gatekeepers), and the capability-based security posture.
tags: [architecture, overview, workers, sandbox, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Architecture overview

Cloudflare OS is an "operating system" for AI productivity. The OS terminology is grounded in the
code's actual shape: the repo is organized the way an OS would be, with a kernel, device drivers, a
shell, processes, executables, and a security model. This page is the map; each subsystem has its own
page.

## The OS analogy

| Normal OS | Cloudflare OS | Where |
| --- | --- | --- |
| kernel | `packages/workshop-backend` | the server ("workshop-backend"), owner of all state and security chokepoints |
| device drivers | `packages/gatekeeper-*` | per-service Workers that mediate access to external systems |
| shell | `packages/workshop-frontend` | the single-page-app UI |
| processes | gadgets | private instances of apps, one sandbox per user |
| executables | blueprints | shareable gadget code |
| users | users | email/username-keyed accounts |
| ACLs | shared permissions | the permission graph (see sharing-and-observers) |
| — | agents | the AI agent, a first-class accountable actor |

## The three deployment tiers

An instance is a set of Workers with three roles:

- **The router** (`packages/router`) is the public origin. It routes by path prefix: `/api*` and
  `/blueprint-screenshot*` to the workshop backend, `/gatekeeper/<name>/*` to whichever gatekeepers
  are bound, and everything else to the frontend assets. **Routing config IS the binding set** —
  gatekeepers are discovered by scanning the router's own `GATEKEEPER_*` service bindings, so
  installing a gatekeeper is purely a binding change (`router/src/index.ts:28-35`). The same worker
  doubles as the dev router (no `ASSETS` binding, frontend requests fall through to the backend).
- **The workshop backend** (`packages/workshop-backend`) is the kernel: the `/api` entrypoint, the
  user/workspace/admin Durable Objects, the agent, and the security chokepoints.
- **Gatekeepers** (`packages/gatekeeper-*`) are separately deployed Workers, each bound to the
  backend and the router. They hold the OAuth credentials and provide capability-based APIs to
  external services (see the gatekeepers page).

The frontend (`packages/workshop-frontend`) is a pure client-side React SPA speaking Cap'n Web RPC to
`/api` over a persistent WebSocket; it never talks to gatekeepers directly.

## The runtime model

The backend is built on Workers primitives, and the mapping is explicit:

- **Every workspace is a Durable Object** — `OverseerDurableObject`, addressed by id. It owns the
  workspace's storage (typed-storage collections over DO storage), the gadget registry, chat logs,
  the git object store, the sharing graph, and the action log.
- **Every gadget runs in a Dynamic Worker Facet.** The overseer loads a gadget's `server.js` as a
  dynamic worker through the `LOADER` binding (`worker_loaders`), with `globalOutbound: null` — the
  server side of a gadget has **no internet access** by default. It can only reach the outside world
  through the specific bindings the workspace gives it (gatekeeper sessions, other gadgets).
  Gadgets are also *facets* of the overseer: the overseer can abort a facet to restart a gadget (e.g.
  when its proposed changes change).
- **Gatekeepers install facets into each workspace.** A gatekeeper binding is a DO facet under the
  overseer (`getGatekeeperFacet`), instantiated from a class minted by the user's connected account,
  so the overseer is the parent that enforces lifecycle and routing.

## Two layers of sandboxing for gadgets

A gadget is sandboxed on both sides:

- **Server**: the dynamic worker has `globalOutbound: null` (no network) and can reach external
  services only through the named bindings the user/agent explicitly granted (`executeCode` workers
  additionally get `disallow_importable_env`). See `overseer.ts:3964-4027` for the gadget loader and
  `overseer.ts:7242-7286` for the code-mode loader.
- **Client**: the gadget UI runs in a sandboxed iframe
  (`sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`, `GadgetUI.tsx:491-507`)
  with no ability to reach the network except `postMessage()` to the parent frame, through which the
  Workshop provides a Cap'n Web RPC session to the gadget's own server-side DO interface
  (`workshop-shared/src/api.ts:21-24`). The iframe's HTML is embedded as a `data:`/`srcDoc` document,
  and gatekeeper management/configurator UIs run in the same sandboxed-frame model.

## Security posture

The system is **capability-based** rather than ACL-based:

- By default, agents and gadgets have access to nothing; access is granted by *introducing* them to a
  resource (pasting a URL or clicking "add resource"). An agent can *request* a connection, which the
  user approves or denies.
- Every gatekeeper action is funneled through the `ApprovalQueue`: reads are authorized as
  observations, side effects are submitted for human approval and applied only afterward (with
  optional simulation so agents keep working), and every action is audited.
- Sharing is governed by a permission graph recomputed live at each open, plus **observer
  verification** that stops a collaborator from seeing data they could not access directly (see
  sharing-and-observers).
- Admin-disabled gatekeepers/resources are enforced at the single capability-minting chokepoint
  (`UserDurableObject.getGatekeeperClassFor`), and deployment admin settings cannot be changed by a
  compromised admin session for authentication config (auth stays env-var driven).
- External services are reached only through gatekeepers, which additionally enforce URL/host checks
  and SSRF boundaries (e.g. `global_fetch_strictly_public` on the MCP connectors).

## Established vs. aspirational

Some README framing is marketing and should not be read as a code guarantee. Notably: the claim that
"it's impossible for the slide deck app to have a security bug that leaks your slides" is the *design
goal* of the sandbox (and a leak would require a browser/runtime bug or a misconfigured binding), not
a verified property; the README's "run on workerd on your own servers" section is explicitly
"COMING SOON"; and several gatekeeper behaviors are documented as not-yet-implemented (e.g. no MCP
simulation, no per-thread observation hiding). Where a mechanism's exact behavior matters, the
subsystem pages cite the source that establishes it.
