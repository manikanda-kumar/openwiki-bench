---
type: architecture
title: Architecture Overview
description: Top-level map of Cloudflare OS — a sandboxed AI productivity OS built on Cloudflare Workers where the Workshop backend is the kernel, gatekeepers are device drivers, gadgets are processes, and blueprints are executables, all speaking Cap'n Web RPC.
tags: [architecture, overview, workers, durable-objects, capability]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Architecture Overview

Cloudflare OS ("Gadgets Workshop") is an "operating system" for AI productivity: an agent chat,
sandboxed app development, and a capability-based security framework, arranged so users can build
and run their own personal apps ("gadgets") safely. The "operating system" label is used in two
senses at once — an OS for the company to be productive with AI safely, and an OS for AI workloads
(`README.md`).

## The OS analogy, grounded in packages

`README.md` maps the normal-OS concepts onto this codebase:

| Normal OS | Cloudflare OS |
|---|---|
| kernel | `packages/workshop-backend` |
| device drivers | `packages/gatekeeper-*` |
| shell | `packages/workshop-frontend` |
| processes | gadgets |
| executables | blueprints |
| users | users |
| ACLs | shared permissions |
| ? | agents |

The "kernel" is genuinely kernel-like: `workshop-backend` connects users to programs and devices
(gadgets and gatekeepers) while enforcing sandboxing and access control. It is held to a higher
bar in review — every line matters because it defines the architecture
(`AGENTS.md`, "packages/workshop-backend"). Gatekeepers connect users and agents to external
services, like drivers connect users and programs to external devices. AI agents are treated as
actors of their own: they must be accountable to a human but have restricted permissions, which is
why the whole system is capability-based rather than ACL-based (`README.md`, "It kind of is an
Operating System").

## Package map

| Package | Role |
|---|---|
| `workshop-backend` | The kernel. The Cloudflare Worker that owns users, workspaces, gadgets, chat/agent loop, sharing, blueprints, admin config, and AI-gateway billing. |
| `workshop-frontend` | The shell. Pure single-page React app, running entirely client-side. |
| `workshop-shared` | The RPC contract between client and server, and the gatekeeper API contract. |
| `gatekeeper-*` | Device drivers. One Worker per external service (GitHub, Google, Notion, Slack, MCP, Cloudflare, Context Library, Scheduler, etc.), providing capability-based access as OAuth-connected accounts. |
| `configurator-ui` | Type-only helpers compiled into each gatekeeper's resource configurator UI. |
| `mcp-shared` | Shared library behind the two MCP gatekeepers (client, trust tiers, approval queue, scope grammar). |
| `router` | The public origin. Routes by path prefix: `/api/*` and `/blueprint-screenshot/*` to the backend, `/gatekeeper/<name>/*` to whichever gatekeepers are bound, and everything else to the frontend. |
| `typed-storage` | A typed storage layer over Durable Object SQLite (collections, singletons, indexes, transactions) used throughout the kernel. |
| `error-reporting`, `backend-utils` | Browser and server error-reporting / logging / observability foundations. |
| `integration-tests` | Boots backend + gatekeepers as real Workers in workerd and speaks Cap'n Web over a WebSocket, plus a fixture gatekeeper for observer logic. |

## Deployment shape

It is built on Cloudflare Workers, making heavy use of **Durable Objects**, **Dynamic Workers**, and
**Facets** (`README.md`): every workspace is its own Durable Object, every Gadget runs in a Dynamic
Worker Facet, and Gatekeepers install facets into each workspace to manage remote service access.
The backend `wrangler.jsonc` declares the `UserDurableObject`, `OverseerDurableObject`,
`AdminSettings`, and `PendingLogin` DO classes (migrations `v0`–`v2`), plus `BLUEPRINTS` and
`AVATARS` KV namespaces, the `BLUEPRINT_CONTENT` R2 bucket, and worker loaders. (`workerd`, the open
Workers runtime, means the platform can also run on your own servers, though the "deploy to your own
server" tooling was documented as coming soon.)

## Communication: Cap'n Web RPC

The single most important architectural choice is that **everything communicates over Cap'n Web
RPC**, a JavaScript RPC system that exposes natural TypeScript interfaces over the network with a
low-boilerplate, promise-pipelined model.

- The **client↔server** interface is defined in `packages/workshop-shared/src/api.ts`. The SPA
  opens a WebSocket RPC session at boot and keeps it open, reconnecting as needed; the whole API is
  a hierarchy of capabilities: `PublicApi` → `AuthenticatedApi` → `Overseer`
  (`packages/workshop-shared/src/api.ts:14` comment).
- **Gatekeeper↔Workshop** and **Gadget↔Workshop** use the same RPC system. Gadgets run in a
  sandboxed iframe with no network access except `postMessage()` to the parent, over which they
  speak Cap'n Web RPC to the Workshop, which hands them a stub to their server-side Durable Object
  (`packages/workshop-shared/src/api.ts:21` comment).

Key Cap'n Web conventions (see `packages/workshop-shared/node_modules/capnweb/README.md`):
- **Promise pipelining** — if an RPC returns a stub, you can use the returned promise directly in
  another call without awaiting it.
- **Stub disposal** — RPC stubs must be disposed (`stub[Symbol.dispose]()`) to avoid server-side
  resource leaks.
- **`@validateRpc()`** — RPC interfaces are annotated to install auto-generated runtime type
  validation, so redundant hand-written validation is discouraged.

## The router: one public origin

`packages/router` is the public origin of a deployed instance. Its `fetch` handler
(`packages/router/src/index.ts`) dispatches purely by path prefix:

1. Any `GATEKEEPER_*` binding: `/gatekeeper/<name>/*` proxies the request to that gatekeeper.
   Routing config *is* the binding set — installing a gatekeeper is purely a binding change, with
   no code or config change here.
2. `/api/*` and `/blueprint-screenshot/*` → the `WORKSHOP_BACKEND` worker.
3. Frontend assets via the `ASSETS` binding (production), or forwarded to the backend in dev when
   there is no assets binding.

## Security model: capability-based, deny-by-default

Two forces dominate the security posture:

- **Gatekeepers** are capability handles. Each OAuth-connected account grants access only to
  specific resources; the account (a `GatekeeperUser`) is the authority, not an asserted identity.
- **Ambient authority is opt-in.** A resource becomes "ambient" (auto-injected into every chat's
  env) only by user/admin configuration; a gatekeeper never asserts its own ambience
  (`AGENTS.md`). Auto-provisioning ("ambient") gatekeepers like the Context Library and Scheduler
  default to `optional`, deployable to `disabled` or forced `enabled`.
- **Deny-by-default introductions.** Every agent and gadget has access to nothing until the user
  *introduces* it to a resource (`README.md`, "Capability-based access control").
- **Human-in-the-loop actions.** Gatekeepers simulate side-effecting actions so the agent can
  proceed, queue approvals for later bulk review, and only actually apply them when the user
  approves, with one-at-a-time or bulk choices.

## Gadgets and blueprints

- **Gadgets** are the "processes": each user runs private instances of apps (a slide deck, a
  dashboard…), each in a separate sandbox (a Dynamic Worker Facet without internet access on the
  server side + a CSP/totally-sandboxed iframe on the client side). Data and code live in the
  workspace's Overseer Durable Object.
- **Blueprints** are the "executables": a snapshot of a gadget's source (plus binding *shape*,
  never credentials), shareable so others stamp out their own independent copy.

See [Blueprints](/openwiki/concepts/blueprints.md), [Gadgets: Lifecycle, Code, and
Chat](/openwiki/concepts/gadget-lifecycle.md), and [Sharing and Observers](/openwiki/concepts/sharing-and-observers.md).

## Runtime layering

The runtime stack: `router` (public origin) → `workshop-backend` (kernel, owns the Durable
Objects and RPC capabilities) → connected `gatekeeper-*` workers (external integrations) and the
frontend (shell). The `AdminSettings` DO owns deployment-wide "soft" config and mirrors it to a
single KV key so hot paths resolve it in one cheap KV get (see [Deployment Admin
Configuration](/openwiki/operations/admin-config.md)).

## Uncertainty

The README describes several Workers-runtime facilities (Dynamic Workers, Facets, Live Object
Bindings) as the backing mechanism for per-workspace Durable Objects and gadget sandboxing, but the
repository does not contain an independent deployment/naming guide beyond `wrangler.jsonc` and the
generated worker configuration. Where the exact mechanism differs from the conceptual description,
treat source (wrangler configs, DO class names, binding declarations) as authoritative.
