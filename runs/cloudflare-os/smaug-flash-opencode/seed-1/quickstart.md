---
type: guide
title: Cloudflare OS Quickstart
description: Practical entry point for engineers working in this repository — how to run it locally, build (pnpm build), test (pnpm test), lint (pnpm lint), and the minimum conventions to respect before changing anything, plus where to start adding a new gatekeeper.
tags: [quickstart, onboarding, build]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-466eb0d7a73ecb9fa3c99255
    resource: repo://.npmrc
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---

# Cloudflare OS Quickstart

This is a practical entry point for engineers who need to understand, operate, debug, and safely
change this repository. The canonical references are `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, and
`REVIEW.md`; this page distills the essentials.

## What this is

Cloudflare OS is an "operating system" for AI productivity built on Cloudflare Workers. Users chat
with agents, agents build sandboxed personal applications called **gadgets**, and users connect
agents and gadgets to external services through **gatekeepers** (still, the README's OS analogy maps
kernel = `workshop-backend`, device drivers = `gatekeeper-*`, shell = `workshop-frontend`,
processes = gadgets, executables = blueprints). It uses Durable Objects, Dynamic Workers, and Facets.

## Running it locally

Install [pnpm](https://pnpm.io/), then:

```bash
pnpm run-local
# → visit http://localhost:8787
```

`run-local.ts` installs dependencies, builds only what's required to run (typed-storage's `dist` and
the frontend bundle), and launches the backend serving the built frontend as static assets on the
backend. Data lives under a `.wrangler` directory. This is for trying the product, not production.

For day-to-day development, run the frontend and backend as two processes in two terminals:

```bash
pnpm dev-server    # backend + router, with watchers
pnpm dev-client    # Vite dev server for the frontend
# → visit http://localhost:3000
```

## Building, testing, linting

The toolchain is **pnpm** + **Vite+ (`vp`)**, a cached task runner. The difference between a
`package.json` script and a Vite+ task matters (see [Build, Test, and Lint
Workflows](development/build-and-test.md)) — in particular, a cached `vp` run **strips the
environment**, so env-var-dependent builds must be declared as tasks.

- **Build / type-check:** `pnpm build` (a recursive `vp run -r build`; a type-check + codegen pass,
  no emit except `typed-storage`). `pnpm types:check` is an alias.
- **Test:** `pnpm test` runs the root's `node --test scripts/**/*.test.ts` suite and then the
  per-package vitest suites. Use `pnpm --filter <package> test:run` (straight vitest) while iterating
  and `pnpm test` to verify.
- **Lint:** `pnpm lint` runs what CI enforces: `lint:check` (oxlint via `vp lint`), `types:scripts`,
  and `types:check`.
- **Clean:** `pnpm clean`.

## Minimum conventions before you change anything

Respect these repository-wide rules (documented in `AGENTS.md`; `REVIEW.md` sets the review bar):

- **`pnpm`, not npm.**
- **Cap'n Web RPC conventions**: use **promise pipelining** (don't await a stub before using it); a
  promise can be passed as an argument to a call. **Dispose RPC stubs** (`stub[Symbol.dispose]()`,
  or `using`) to avoid server-side leaks; in a React `useEffect`, dispose in the cleanup. React
  `useState` must never store a naked stub — wrap it in an object. Annotate every RPC interface with
  **`@validateRpc()`** and don't write redundant validation.
- **Server-side logging** goes through `@gadgets/backend-utils/logger` with a module-scoped logger
  and a stable dot-separated `component` (plus `vendorId` for gatekeepers); pass caught values as
  `error`, use `logger.with(...)`/`createObservabilityContext` for context, and never log secrets,
  prompts, headers, tokens, or request/response bodies.
- **Auth config stays env-var driven**: `AUTH_GATEKEEPERS` and `DISABLE_PASSWORD_AUTH` live in
  `auth/config.ts`, never in `AdminConfig`, so a compromised admin session can't change them.
- **TypeScript 7 (tsgo)** is the workspace `tsc`; no tsconfig sets `baseUrl`, and single-threaded
  builds are imposed at the root tsconfig. TS7 exposes no compiler API, so build-time transpilers use
  the root `typescript6` alias.

## Your first change: add a new gatekeeper

The representative maintenance task is adding a gatekeeper for an external service. Start at the
canonical interface file `packages/workshop-shared/src/gatekeeper.ts` and follow the in-repo skill at
`.agents/skills/write-gatekeeper/SKILL.md`. The two-phase workflow:

- **Phase 1** (core): design the Session API in `src/types.d.ts`, present it for review, implement
  the Vendor/User/Instance hierarchy, add a resource selection UI, and register the
  `GATEKEEPER_<NAME>` service binding in the backend's `wrangler.jsonc`. STOP, ask to proceed.
- **Phase 2** (security): add `ApprovalQueue` logging/approvals, caching, simulation, and observer
  verification. Every side-effecting operation must be queued via `submitAction` and only applied via
  `applyAction`; every read must be authorized via `authorizeObservation` before data returns.

There is a fully-worked guide at [Change Guide — Adding a New
Gatekeeper](development/extending-gatekeepers.md), and the deeper architecture is in
[Architecture Overview](architecture/overview.md).

## Contributing

This project is not seeking outside contribution at this time; small, trivially-verified PRs (roughly
a dozen lines or fewer) are welcome, but larger or low-value PRs will be closed per `CONTRIBUTING.md`.
Preview deployments are intentionally withheld from fork PRs (they need a Cloudflare token the CI
prevents forks from reading), as documented in `.github/workflows/README.md`.
