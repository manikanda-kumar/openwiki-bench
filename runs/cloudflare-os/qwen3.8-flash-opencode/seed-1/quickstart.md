---
type: quickstart
title: Quickstart
description: Get the Gadgets Workshop running locally in one command, split frontend/backend for development, configure OAuth and AI-gateway vars via .dev.vars, and run build, tests, and lint.
tags: [quickstart, local-dev, pnpm, wrangler, dev-vars]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-1dbc01f21b86e2fc8ca05a55
    resource: repo://docs/public-server.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-1747f35368fa9373cdf18ef2
    resource: repo://scripts/dev-server-config.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Quickstart

Prerequisite: pnpm (the repo pins its package manager in `packageManager` at
package.json#L5). The whole stack runs on `wrangler`/workerd locally.

## One command

```
pnpm run-local
```

then visit **http://localhost:8787** (README.md#L22-L26, L186-L192). This installs dependencies,
builds *only what's needed to run* — `@gadgets/typed-storage` (imported via its built `dist`) and
the frontend asset bundle — then launches the dev server with `--serve-frontend-assets`, so the
backend serves the built SPA and state persists under a local `.wrangler/` directory
(scripts/run-local.ts#L3-L14; README.md#L192-L194). Extra flags pass through to the dev server
(run-local.ts#L21).

What to try first: prompts like "Make a collaborative whiteboard app" or the bundled slides
blueprint (README.md#L33-L38).

## Developing with hot reload

Run two terminals:

```
pnpm dev-server   # generates wrangler.dev.jsonc binding files, builds gatekeeper UIs, boots all workers
pnpm dev-client   # Vite dev server for the frontend
```

then visit **http://localhost:3000** (README.md#L220-L227). The dev server discovers every
`packages/gatekeeper-*` directory and synthesizes dev-only `GATEKEEPER_*` service bindings, and
without an `ASSETS` binding the same router worker proxies to the backend
(scripts/run-dev-server.ts#L1-L14, L82-L104; packages/router/src/index.ts#L7-L9, L47-L58). In this
mode the router does *not* forward to Vite (HMR sockets die on every workerd restart) — that's why
`dev-client` is a separate command opened on its own port
(packages/router/src/index.ts#L49-L57; package.json#L16-L18).

## Optional integrations (`.dev.vars`)

Password logins work out of the box; OAuth sign-in, external gatekeepers, and the AI Gateway free
tier need configuration. Put `KEY=VALUE` lines in a gitignored root `.dev.vars` —
`pnpm dev-server` loads it automatically — and each `packages/gatekeeper-*/README.md` documents
that vendor's OAuth app setup (docs/public-server.md#L24-L47; README.md#L207-L220). A minimal
taste (public-service mode with Cloudflare-hosted AI):

```
ENABLE_CLOUDFLARE_LIMITS=true
PUBLIC_BASE_URL=http://localhost:8787
AUTH_GATEKEEPERS=cloudflare,google,github
GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
CLOUDFLARE_OAUTH_CLIENT_ID=... CLOUDFLARE_OAUTH_CLIENT_SECRET=...
CF_AI_GATEWAY=your-gateway
CF_AI_GATEWAY_PROVIDERS=anthropic,openai,google
CF_AI_GATEWAY_ACCOUNT_ID=...
CF_AI_GATEWAY_API_TOKEN=...
```

(docs/public-server.md#L27-L47 — note `CF_AI_GATEWAY_ACCOUNT_ID` is always required with a
gateway, and the token is required unless the `WORKERS_AI` binding carries gateway traffic, which
is only valid when the gateway lives in the worker's own account, docs/public-server.md#L49-L58.)

## Build, test, lint

```
pnpm build   # cached recursive type check + codegen ("vp run -r --cache build")
pnpm test    # scripts suite, then cached per-package vitest runs
pnpm lint    # oxlint (vp lint) + type-checks of scripts and the workspace
```

(package.json#L7-L23). `pnpm build` is also `pnpm types:check` — this workspace type-checks, it
doesn't compile (wrangler/vite bundle from source). Expect the caching rules to bite when builds
behave oddly (env stripping, output-exclusion); they're the subject of
[Testing and Build Tooling](./testing/testing-and-tooling.md), which also explains `test:run` vs cached
`vp run test` for iterating on one package. CI-enforced checks and fork-PR behavior:
[Release Pipeline](./operations/release-pipeline.md), CONTRIBUTING.md#L16-L24.

## Where next

- Orientation: [Architecture Overview](./architecture/overview.md)
- Running as a public multi-user service vs self-hosting:
  [Configuration and Admin Settings](./operations/configuration-and-admin.md)
- Deploying customer instances (not covered here): [Release Pipeline](./operations/release-pipeline.md)
