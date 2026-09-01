---
type: "Reference"
title: "Quickstart: Running and Navigating Cloudflare OS"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-2aa79db0f81a9ae03810b504
    resource: repo://packages/typed-storage/package.json
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Quickstart: Running and Navigating Cloudflare OS

## What this is

Cloudflare OS is an AI productivity environment: an agent chat UI, sandboxed app development ("gadgets" — small personal apps, each user runs their own private instance), and a security framework ("gatekeepers") that mediates every external-service access with capability-based introductions and human-in-the-loop approvals (README.md:1-22, 64-79). It is built entirely on Cloudflare Workers — Durable Objects, Dynamic Workers, and Facets — and runs on the open-source `workerd` runtime (README.md:114-121).

## Run it locally

**One command (whole stack):**

```sh
pnpm install   # pnpm is required, not npm
pnpm run-local
```

Then open http://localhost:8787. `run-local` (scripts/run-local.ts:1-13) installs dependencies, builds only what's needed (`@gadgets/typed-storage` and the frontend bundle), and launches the dev server with `--serve-frontend-assets` so the backend serves the built frontend. Data lands in `.wrangler/` — this mode is for trying the product, not production.

**Two-terminal development mode (hot reload):**

```sh
pnpm dev-server   # terminal 1: wrangler dev for all workers (backend + gatekeepers)
pnpm dev-client   # terminal 2: Vite dev server for the frontend
```

Then open http://localhost:3000. `dev-server` generates dev-only wrangler configs with dynamic service bindings, loads a gitignored root `.dev.vars` file for local secrets (`KEY=VALUE` lines; shell env wins), and defers frontend-build watchers until wrangler is listening (scripts/run-dev-server.ts:1-8, 46-50, 255-276). The Vite dev server proxies backend routes (`/api/client-errors`, `/blueprint-screenshot`, `/api/site-logo`) to the backend host (packages/workshop-frontend/vite.config.ts `server.proxy`). Optional dev flags: `--use-workers-ai-binding` (adds the Workers AI binding needed for gateway transport and webFetch's toMarkdown), `--port`.

External services (GitHub/Google sign-in, AI Gateway billing, etc.) need env configuration — see the per-package READMEs (README.md:204-218) and [AI Models and AI Gateway Billing](/openwiki/operations/ai-gateway-billing.md). A minimal `.dev.vars` example lives in docs/public-server.md:23-48.

## What to try

From README.md:34-42: ask for slides ("Make slides for my upcoming meeting with a customer" — uses a built-in blueprint), build an app from scratch ("Make a collaborative whiteboard app"), play a game with the agent ("Make a tic tac toe game" then take turns), or connect integrations ("Make an issue dashboard for this GitHub repo" — requires the GitHub gatekeeper configured).

## The command set

| Command | What it does |
| --- | --- |
| `pnpm build` (= `types:check`) | Type-check + codegen for every package via Vite+ (`vp run -r --cache build`); most packages are `noEmit` — wrangler and vite bundle from source |
| `pnpm test` | Root `node --test scripts/**/*.test.ts` suite, then per-package tests (cached); one package: `pnpm --filter <pkg> test:run` (direct) or `vp run -F <pkg> test` (cached) |
| `pnpm lint` | `lint:check` (oxlint via Vite+), `types:scripts`, `types:check` — run before pushing |
| `pnpm types:generate` | Regenerate worker types from wrangler configs |
| `pnpm dev-server` / `pnpm dev-client` | Development mode |
| `pnpm run-local` | Whole stack locally |
| `pnpm clean` | Clean all build outputs |

Testing strategy and the integration harness: [Testing](/openwiki/development/testing.md). Build/release tooling: [Build System, Dev Tooling, and the Release Pipeline](/openwiki/development/build-release.md).

## Concept → package map

The project describes itself as an operating system, and the analogy is literal (README.md:93-118):

| Concept | Package | Where to look first |
| --- | --- | --- |
| Kernel | `packages/workshop-backend` | `src/server.ts` (entrypoint), `src/overseer.ts` (workspace DO), `src/user.ts` (user DO) |
| Device drivers | `packages/gatekeeper-*` | each package's `src/<vendor>.ts` + README |
| Shell | `packages/workshop-frontend` | `src/main.tsx` (RPC bootstrap), `src/router.tsx` (TanStack routes) |
| Processes | gadgets | dynamic-worker facets inside the Overseer DO (src/overseer.ts:3958-4083) |
| Executables | blueprints | `packages/workshop-backend/src/blueprint-archive.ts`, [Blueprints and Output Formats](/openwiki/blueprints.md) |
| Users | users | `UserDurableObject` (src/user.ts:282) |
| Shared RPC contract | `packages/workshop-shared` | `src/api.ts` (client↔server), `src/gatekeeper.ts` (workshop↔gatekeeper) |

Supporting packages: `packages/typed-storage` (typed DO storage; the only package that emits `dist`), `packages/backend-utils` (logging/error reporting), `packages/error-reporting` (frontend report contract), `packages/configurator-ui` (type-only helpers for gatekeeper configurator UIs), `packages/mcp-shared` (library behind the two MCP gatekeepers), `packages/integration-tests` (e2e harness), `packages/router` (public origin).

## Where to go next

- [Architecture Overview](/openwiki/architecture/overview.md) — the worker topology and DO map.
- [The Workspace Overseer](/openwiki/workshop/workspace-overseer.md) and [The AI Agent](/openwiki/workshop/agent.md) — the two systems you'll touch most.
- [Gatekeeper Architecture](/openwiki/gatekeepers/architecture.md) — how to build or modify a connector.
- [Change Guides](/openwiki/development/change-guides.md) — file-level walkthroughs for representative changes.

Contribution policy: outside contributions are limited to small, trivially-verified fixes; larger ideas go through discussions (CONTRIBUTING.md:1-16).
