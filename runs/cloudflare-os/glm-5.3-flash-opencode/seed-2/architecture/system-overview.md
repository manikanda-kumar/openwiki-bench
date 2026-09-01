---
type: architecture
title: System architecture and package map
description: What Cloudflare OS is, the kernel/shell/drivers analogy mapped to real packages and Durable Objects, the worker topology with its bindings, and how a request routes from the public origin to a gadget.
tags: [architecture, packages, routing, workers, overview]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-19ad1060397c9ddb8d4e411a
    resource: repo://plans/multi-gadget.md
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# System architecture and package map

## What this product is

Cloudflare OS is an "operating system" for AI productivity, built on Cloudflare Workers. It is not
a traditional OS; the name is used in two senses documented in the README: an operating system *for
the company* to be productive with AI safely, and one *for AI workloads*, analogous to how a
traditional OS manages compute (`README.md:7-10`). Concretely it provides an agent chat UI, a
sandboxed application platform ("gadgets" — small personal apps each user runs their own copy of),
and a capability-based security layer ("Gatekeepers") that moderates every connection between an
agent or gadget and an external service (`README.md:12-17`).

The README's OS analogy maps directly onto the code (`README.md:97-110`):

| Normal OS | Cloudflare OS | Where it lives |
| --- | --- | --- |
| kernel | workshop-backend | `packages/workshop-backend` (Durable Objects) |
| device drivers | gatekeepers | `packages/gatekeeper-*` (separate Workers) |
| shell | workshop-frontend | `packages/workshop-frontend` (SPA) |
| processes | gadgets | dynamic worker facets per workspace |
| executables | blueprints | shareable code snapshots |

The kernel analogy is technical, not marketing: the backend connects users to programs and devices
while sandboxing applications and enforcing access control (`README.md:108`).

## Package map and ownership boundaries

The repo is a pnpm workspace (`package.json` names it `cloudflare-os`). The packages divide into
five groups:

**Kernel** — the highest review bar applies (`REVIEW.md:12-23`):

- `packages/workshop-backend` — the kernel itself. Every line is reviewed. Hosts all core Durable
  Objects, the agent, the git-backed code store, sharing, blueprints, and the RPC server.
- `packages/workshop-shared` — the public RPC API contracts (`api.ts`, `gatekeeper.ts`,
  `code-change.ts`, and friends). Kernel review rules apply to it too: every exported member needs a
  doc comment; hand-written interfaces that mirror an RPC interface plus an `as unknown as` cast are
  rejected; API changes are reviewed apart from UI.

**Support libraries** — not Workers, shared by the kernel and gatekeepers:

- `packages/typed-storage` — typed collections/indexes over Durable Object storage (the only
  package that emits `dist/`; everything else is bundled from source).
- `packages/backend-utils` — server-side logger, tracing, observability context, error reporting.
- `packages/error-reporting` — the vendor-neutral browser/Worker error event contract.
- `packages/configurator-ui` — type-only helpers for gatekeeper configurator UI modules.
- `packages/mcp-shared` — the library behind the two MCP-speaking gatekeepers (not a Worker).

**Gatekeepers (device drivers)** — each `packages/gatekeeper-*` is an independent Workers
application, provided to the Workshop as a service binding and reached over RPC
(`packages/workshop-shared/src/gatekeeper.ts:13-17`). This repo ships 15: `context`, `scheduler`,
`github`, `google`, `cloudflare`, `slack`, `notion`, `confluence`, `supabase`, `email`,
`homeassistant`, `linear`, `spotify`, `zoominfo`, plus the two MCP connectors (`mcp`,
`mcp-portal`).

**Frontend and edge:**

- `packages/workshop-frontend` — the SPA shell (React + Kumo UI + Phosphor icons + Vite, TanStack
  file-based routes under `src/routes/`).
- `packages/router` — the public origin worker; serves frontend assets and routes by path prefix.
- `packages/integration-tests` — end-to-end tests over real Workers.

**Tooling:** `scripts/` (dev server, release pipeline, configurator builds, shared vitest
config helpers), `plans/` (historical implementation plans), `docs/` (topic documents),
`.agents/skills/write-gatekeeper/` (the in-repo skill that guides gatekeeper work).

## Worker and storage topology

`packages/workshop-backend/wrangler.jsonc` declares the deployable surface:

- **Durable Object classes** registered by migration: `UserDurableObject` and
  `OverseerDurableObject` (v0, SQLite-backed), `AdminSettings` (v1), `PendingLogin` (v2, the
  short-lived sign-in bridge). None is bound explicitly — every DO is reached via `ctx.exports`
  (`wrangler.jsonc` comment; e.g. `overseer.ts:1706`, `server.ts:823`).
- **KV namespaces**: `BLUEPRINTS` (blueprint metadata) and `AVATARS`.
- **R2 bucket**: `BLUEPRINT_CONTENT` (blueprint code snapshots, screenshots, site logo).
- **Worker loader binding** `LOADER`: how gadget code is compiled and run (dynamic workers).
- **Browser binding** `BROWSER` (Puppeteer for gadget PDF export).
- Compatibility flags that define the sandbox: `global_fetch_strictly_public` (SSRF protection for
  `fetch()` post-DNS), `disallow_importable_env` (applied per dynamic worker), `nodejs_compat`,
  `allow_irrevocable_stub_storage` (persistent stubs for hooks).

Gatekeeper service bindings and the Workers AI binding are **not** checked in — they are generated:
`run-dev-server.ts` adds them for dev, and the deploy service instantiates the release manifest's
binding templates for production (`wrangler.jsonc` comment; see
[build & release](/openwiki/operations/build-release.md)).

The `router` worker owns the public origin (`packages/router/wrangler.jsonc`): it serves
`workshop-frontend/dist` as static assets with SPA fallback, with `run_worker_first` for `/api`,
`/blueprint-screenshot`, and `/gatekeeper/*`.

## Request routing, end to end

The router's entire routing table is its binding set (`packages/router/src/index.ts:4-9`):

1. Any `GATEKEEPER_<NAME>` env key with a matching URL prefix `/gatekeeper/<name>/...` is forwarded
   to that gatekeeper Worker. Installing a gatekeeper is purely a binding change — no code or config
   in the router (`index.ts:24-35`). Gatekeeper OAuth redirects land on the gatekeeper Workers
   themselves at `/gatekeeper/<name>/oauth`; the backend hosts no `/auth` callbacks
   (`index.ts:42-45`).
2. `/api` and `/blueprint-screenshot*` go to `WORKSHOP_BACKEND` (`index.ts:37-41`).
3. Everything else goes to `ASSETS` (production) or falls through to the backend (dev, where no
   ASSETS binding exists) (`index.ts:47-59`). The email handler similarly forwards to the email
   gatekeeper or rejects (`index.ts:62-68`).

On the backend, `/api` upgrades to a Cap'n Web RPC session (see
[the RPC page](/openwiki/architecture/rpc-protocol.md)). Authentication resolves to a per-user
`UserDurableObject` addressed by `idFromName(username-or-email)`. Opening a workspace resolves the
Overseer DO by its unique id string (`server.ts:216-227`) and hands back an `Overseer` capability
whose authorization was computed at `open()` (role, sharing graph, observer checks).

Inside the Overseer, everything is a **workpiece**: gadgets and gatekeepers share one sequential ID
namespace (`WorkpieceId`), so gadget facets are named `gadget${id}` and gatekeeper facets
`gatekeeper${id}` and can never collide (`overseer.ts:1990-2002`, `plans/multi-gadget.md`).
Gadget code is compiled by the `LOADER` binding keyed on
`<overseerId>.<codeVersion>[.chatId.sequence].<gadgetId>` and run as a dynamic worker with no
internet access (`overseer.ts:3965-3994`).

## Sandboxing model

Each gadget is double-sandboxed:

- **Server side**: a dynamic Worker whose `globalOutbound` is null — it cannot reach the internet at
  all; it can only communicate with bindings the user explicitly granted (the README states this and
  the code enforces it: `disallow_importable_env` and `globalOutbound: null` in the code-mode
  harness, `overseer.ts:69-106` and `7265-7284`).
- **Client side**: a sandboxed iframe with a restrictive CSP that can only `postMessage` to its
  parent (`GadgetUI.tsx:105-116`, `496-503`).

External access is never ambient: agents and gadgets start with access to nothing, and each
resource must be explicitly introduced (pasted URL, resource picker, or an agent request the user
accepts) (`README.md:164-171`). The runtime features the product leans on — Dynamic Workers, Facets,
persistent stubs — are called out by the README as features the Workers team added for this
system (`README.md:114-118`).
