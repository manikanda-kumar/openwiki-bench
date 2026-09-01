---
type: guide
title: Quickstart
description: Run Cloudflare OS locally with pnpm run-local, understand the dev variants and what each command actually does, and navigate the monorepo — with pointers to the right wiki page per task.
tags: [quickstart, development, setup, pnpm]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-40275cb92c3610938f16ade3
    resource: repo://pnpm-workspace.yaml
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-1747f35368fa9373cdf18ef2
    resource: repo://scripts/dev-server-config.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Quickstart

**This repo requires pnpm, not npm** — `packageManager` pins pnpm 11.17.0 (package.json#L6-L7), and the build/test layer is Vite+ tasks that pnpm scripts delegate to. Install [pnpm](https://pnpm.io/), then:

```
pnpm run-local
```

…visit `http://localhost:8787`, and create an account on the login page — everything runs locally on `wrangler`/`workerd`, with data in a gitignored `.wrangler` directory (README.md#L22-L28, #L192-L196). Not for production, just the fastest way to see the product (README.md#L28).

`run-local` does exactly four things: `pnpm install`; a cached build of `@gadgets/typed-storage` (the one package imported via its built `dist`); a cached `build:assets` of `workshop-frontend`; then `scripts/run-dev-server.ts --serve-frontend-assets`, which starts the local router+backend with the built SPA served as static assets (scripts/run-local.ts#L3-L13, #L40-L52). Extra flags pass through (e.g. `--use-workers-ai-binding`), and `VITE_BACKEND_HOST` retargets the API host/port (run-local.ts#L20-L27; scripts/dev-server-config.ts#L2-L19).

Try prompts like *"Make slides for my upcoming meeting"*, *"Make a collaborative whiteboard app"*, or *"Make a tic tac toe game"* — the first uses the bundled slides format blueprint, the others have the agent build a gadget from scratch (README.md#L31-L37).

## Dev variants

- **`pnpm dev-server`** — the day-to-day hack loop: builds all gatekeeper UIs first (`build:configurator` + `build:app:dev`), then runs `wrangler dev` with watchers; frontend requests fall through to whatever `pnpm dev-client` serves (root wrangler.jsonc#L3-L8; [Toolchain, Tasks, and Build Cache](development/toolchain-and-builds.md)).
- **`pnpm dev-client`** — the Vite dev server for `workshop-frontend` (hot reload); open it directly (localhost:3000) and point it at a running backend with `VITE_BACKEND_HOST` (packages/workshop-frontend/src/main.tsx#L85-L90; packages/router/src/index.ts#L49-L55).
- **Sign-in gatekeepers / limits in dev** are configured by shell vars (`GOOGLE_*`, `GITHUB_*`, `CLOUDFLARE_OAUTH_*`) that `run-dev-server.ts` seeds into bindings — see [Authentication and User Accounts](backend/auth-and-users.md) (docs/public-server.md#L10-L20).

## Verify your work

```
pnpm lint     # vp lint (oxlint) + type-check the scripts + full type-check/build
pnpm build    # vp run -r --cache build  (type-check + codegen, not a compile)
pnpm test     # scripts suite, then cached per-package tests
```

(package.json#L8-L22). One package: `vp run -F <package> build`; iterating on one package's tests: `pnpm --filter <package> test:run` (uncached), `vp run -F <package> test` (cached). Know the cache rules before debugging a "why didn't it rebuild" — [Testing Approach](development/testing.md). CI runs lint/build/tests on every PR including forks; preview deployments don't (CONTRIBUTING.md#L13-L23).

## Monorepo in one screen

| Path | What it is |
|---|---|
| `packages/workshop-backend` | The kernel: auth, Overseer workspace DOs, agent, blueprints, admin |
| `packages/workshop-frontend` | React SPA (the shell) |
| `packages/workshop-shared` | The RPC API + gatekeeper protocol contracts |
| `packages/gatekeeper-*` | One Worker per external service (the drivers) |
| `packages/mcp-shared` | Library behind the two MCP connectors |
| `packages/router` | Public origin / dev router Worker |
| `packages/{typed-storage,backend-utils,configurator-ui,error-reporting}` | Support libraries |
| `packages/integration-tests` | Real-Workers e2e harness |
| `scripts/` | Dev server, release pipeline, preview deploys, build codegen |
| `docs/` | Operator-facing design notes (blueprints, sharing, oauth, limits) |

Full wiring: [Architecture Overview](architecture/overview.md).

## Where to go by task

- Understand the client↔server protocol → [RPC and Capability Model](architecture/rpc-and-capability-model.md)
- Debug a workspace/chat/action state machine → [The Overseer Workspace Object](backend/overseer-workspace.md)
- Why an agent/tool behaved that way → [Agent Runtime and Tools](backend/agent-runtime.md), [How to Change Agent Behavior](guides/agent-behavior.md)
- Add/modify a connector → [Gatekeeper Framework](gatekeepers/framework.md), [How to Add a Gatekeeper](guides/adding-a-gatekeeper.md)
- Change the shared API safely → [How to Change the RPC API](guides/changing-the-rpc-api.md)
- Ship/curate standard output formats → [How to Add a Format Blueprint](guides/adding-a-format-blueprint.md)
- Configure a deployment (sign-in, limits, admin panel) → [Admin Settings and Configuration](operations/admin-and-configuration.md), [Authentication and User Accounts](backend/auth-and-users.md)
- Trace/fix failures in production → [Logging and Error Reporting](operations/logging-and-error-reporting.md)
- Build customer releases / per-PR previews → [Deployment and Release Pipeline](operations/deployment-and-release.md)

Beyond running locally, the README also points at the hosted one-click deploy (`https://os.cloudflare.app/deploy`) and the deployment starter repo (README.md#L30-L32, #L168-L176); self-hosted `workerd` deployment is documented as "coming soon" in the README — don't expect packaged tooling for it yet (README.md#L198-L201).
