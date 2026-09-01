---
type: guide
title: Quickstart
description: How to run Cloudflare OS locally — pnpm run-local for a single-command try-out and pnpm dev-server + pnpm dev-client for development — plus what gets generated at startup, where data lives, and how to configure OAuth sign-in and AI Gateway in a local .dev.vars.
tags: [quickstart, local, dev-server, setup]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-1dbc01f21b86e2fc8ca05a55
    resource: repo://docs/public-server.md
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-1747f35368fa9373cdf18ef2
    resource: repo://scripts/dev-server-config.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Quickstart

Cloudflare OS runs entirely on `workerd` locally via `wrangler`. There are two ways to start it; both
need pnpm.

## Option 1: `pnpm run-local` — try it out in one command

```sh
pnpm run-local
```

then visit `http://localhost:8787`.

`scripts/run-local.ts` does three things:

1. `pnpm install` if needed.
2. Builds only what's required to *run*: `@gadgets/typed-storage` (the backend imports it via its
   built `dist`) and the frontend bundle (`vite build` -> `packages/workshop-frontend/dist`).
   Gatekeeper configurator files are generated at server startup.
3. Launches `scripts/run-dev-server.ts --serve-frontend-assets`, which serves the built frontend as
   static assets on the backend worker (the same layout as production).

Your data lives under `.wrangler/` in the repo root. The dev backend seeds an **`admin` user** so you
can exercise admin features.

## Option 2: `pnpm dev-server` + `pnpm dev-client` — development

Two terminals:

```sh
pnpm dev-server     # wrangler dev with every worker (router, backend, gatekeepers)
pnpm dev-client     # Vite dev server for the frontend
```

then visit `http://localhost:3000`. The frontend's Vite dev server proxies `/api/client-errors`,
`/blueprint-screenshot`, and `/api/site-logo` to the backend. `VITE_BACKEND_HOST` (default
`localhost:8787`) or `--port` selects the backend.

## What `pnpm dev-server` does at startup

`scripts/run-dev-server.ts`:

1. Loads a gitignored root `.dev.vars` file (`KEY=VALUE` lines) into the environment; existing shell
   values win.
2. **Discovers gatekeeper packages** by scanning `packages/gatekeeper-*` for a `wrangler.jsonc`, then
   runs a pre-flight build of what wrangler needs: the backend's format-blueprint module, each
   gatekeeper's configurator UI, and each gatekeeper's app UI.
3. **Generates dev `wrangler.dev.jsonc` files**: the root dev router gets `GATEKEEPER_*` service
   bindings for every gatekeeper; each gatekeeper gets its `BASE_URL` and, for the OAuth gatekeepers,
   `CLIENT_ID`/`CLIENT_SECRET` seeded from shared shell vars (`GITHUB_CLIENT_ID`,
   `GOOGLE_CLIENT_ID`, `CLOUDFLARE_OAUTH_CLIENT_ID`, ...); the backend gets `ADMINS: ["admin"]`, the
   `GATEKEEPER_*` bindings (entrypoint `GatekeeperVendor`; `gatekeeper-context` gets
   `sharingDomain: "dev"`), and any optional feature vars passed through (`AUTH_GATEKEEPERS`,
   `ENABLE_CLOUDFLARE_LIMITS`, `CF_AI_GATEWAY*`, `DISABLE_PASSWORD_AUTH`, `PUBLIC_BASE_URL`, ...).
4. Starts a single multi-config `wrangler dev` across all of them, then starts UI watchers once
   Wrangler is listening.

## Configuring OAuth sign-in and AI Gateway locally

Put the required variables in a root `.dev.vars` file (gitignored). A minimal public-service example
(from `docs/public-server.md`):

```
ENABLE_CLOUDFLARE_LIMITS=true
PUBLIC_BASE_URL=http://localhost:8787
AUTH_GATEKEEPERS=cloudflare,google,github

GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
CLOUDFLARE_OAUTH_CLIENT_ID=...
CLOUDFLARE_OAUTH_CLIENT_SECRET=...

CF_AI_GATEWAY=your-gateway
CF_AI_GATEWAY_PROVIDERS=anthropic,openai,google
CF_AI_GATEWAY_ACCOUNT_ID=...
CF_AI_GATEWAY_API_TOKEN=...
```

- `AUTH_GATEKEEPERS` allowlists which connected gatekeepers may sign users in (each needs its OAuth
  app, seeded into the gatekeeper Workers from the `*_CLIENT_ID`/`*_CLIENT_SECRET` vars). The primary
  account key is the provider-verified email. `DISABLE_PASSWORD_AUTH=true` hides username/password
  (ignored unless the allowlist is non-empty, to avoid lockout).
- `ENABLE_CLOUDFLARE_LIMITS=true` turns on the free daily allowance + Cloudflare-credits top-up flow.
- `CF_AI_GATEWAY*` enables the platform AI Gateway for the free tier. Gateway mode always needs
  `CF_AI_GATEWAY_ACCOUNT_ID` plus a transport: run `pnpm dev-server -- --use-workers-ai-binding` so
  the backend has a `WORKERS_AI` binding (pre-authenticated in-account; used by the webFetch tool's
  Markdown conversion too), or set `CF_AI_GATEWAY_API_TOKEN` for HTTPS. The `google` provider needs
  the token either way.

To use `MCP_ALLOW_INSECURE=true` (MCP endpoints on localhost) or pass portal config, those also go in
`.dev.vars` (see the gatekeeper READMEs).

## What to try

- "Make slides for my upcoming meeting with a customer." — uses the built-in slides blueprint.
- "Make a tic tac toe game." then "I'll be X and you be O. I've made my first move. Your turn." —
  creates and edits a gadget through the agent.
- "Make an issue dashboard for this GitHub repo." — requires the GitHub integration configured.

## Where to go next

- Development environment and the build system: the dev-workflow page.
- Deploying for real: `https://os.cloudflare.app/deploy` or the deploy-wizard/release pipeline on the
  deployment page.
- Each gatekeeper's README in `packages/gatekeeper-*/` explains its third-party OAuth setup.
