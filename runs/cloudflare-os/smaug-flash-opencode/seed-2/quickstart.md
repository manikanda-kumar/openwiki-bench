---
type: guide
title: Quickstart
description: Practical getting-started and daily-workflow guide for engineers — prerequisites, running the whole stack locally, the dev loop, the build/test/lint command matrix, and the change checklist.
tags: [quickstart, getting-started, dev-loop, commands]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Quickstart

This guide gets you running Cloudflare OS locally and working through a change. It is grounded in
the root `package.json`, `README.md`, `AGENTS.md`, and the `scripts/*.ts` entrypoints.

## Prerequisites

- **pnpm** (>= the version pinned in `package.json`'s `packageManager` field — 11.x). Use pnpm, not
  npm.
- Node.js and, for the runtime, workerd/wrangler (installed through the workspace development
  tooling).

## Quickest way to run the whole stack

```sh
pnpm run-local
```

Then visit `http://localhost:8787` (`README.md`). `run-local.ts` (a) installs dependencies,
(b) builds only what's needed to run — `@gadgets/typed-storage` and the frontend bundle — and
(c) launches the local server with `run-dev-server.ts --serve-frontend-assets`, which serves the
built frontend as static assets on the backend. Your data is stored in a `.wrangler` subdirectory
(`README.md`). This is a quick way to see the product, not for production use.

> Try some prompts: "Make slides for my upcoming meeting with a customer." (built-in slides
> blueprint), "Make a tic tac toe game.", "Make an issue dashboard for this GitHub repo." (needs the
> GitHub integration configured), etc. (`README.md` §"What to try").

## Development loop

During development, run the frontend and backend as two separate commands in two terminals
(`README.md` §"Developing"):

```sh
pnpm dev-server     # starts the backend + router on wrangler/workerd (default backend host)
pnpm dev-client     # starts the Vite dev server for the frontend on localhost:3000
```

Then visit `http://localhost:3000`. `dev-client` is `cd packages/workshop-frontend && pnpm run dev`.
`dev-server` builds the gatekeeper UIs first (two `vp run --cache` calls — `build:configurator` and
`build:app:dev`) before starting Wrangler, and seeds gatekeeper OAuth credentials from
`GOOGLE_*`/`GITHUB_*`/`CLOUDFLARE_OAUTH_*` shell vars (`run-dev-server.ts`, `docs/oauth-signin.md`).

Default hosts: the backend (`run-local`/`dev-server`) serves at `localhost:8787`; the Vite desktop
client at `localhost:3000`. `VITE_BACKEND_HOST` overrides where the client dials the backend
(`packages/workshop-frontend/src/main.tsx`).

## The command matrix

Build, test, and lint are **pnpm/Vite+** commands declared in the root `package.json` (`AGENTS.md`):

| Command | What it runs |
|---|---|
| `pnpm build` | `vp run -r --cache build` — type-check + codegen the whole workspace |
| `pnpm test` | `node --test 'scripts/**/*.test.ts' && vp run --filter '!cloudflare-os' --cache test` |
| `pnpm lint` | `pnpm run lint:check && pnpm run types:scripts && pnpm run types:check` |
| `pnpm lint:check` / `pnpm lint:fix` | `vp lint` / `--fix` (oxlint via Vite+, pinned; `correctness`+`suspicious` as errors) |
| `pnpm types:check` | alias for `pnpm build` |
| `pnpm types:scripts` | `tsc -p scripts/tsconfig.json` |
| `pnpm clean` | `vp run -r clean` |
| `pnpm types:generate` | regenerate worker configuration types |

Per-package:
- `pnpm --filter <pkg> test:run` — straight to vitest (use while iterating).
- `vp run -F <pkg> test` — through the Vite+ cache.
- `vp run -F <pkg> build` — one package's build (a Vite+ **task**, not a script — `pnpm --filter`
  cannot see a task).

**Lint before pushing**: CI enforces `lint:check`, `types:scripts`, and `types:check`. Run
`pnpm lint` before pushing.

## The standard change loop

1. Make a focused edit (for gatekeeper or architecture changes, read the relevant docs /
   `/openwiki/developing/change-guides.md`).
2. Iterate on tests fast: `pnpm --filter <pkg> test:run` (straight to vitest) while editing; verify
   the whole workspace with `pnpm test` when done.
3. Type-check / codegen: `pnpm build` (or `vp run -F <pkg> build`).
4. Lint: `pnpm lint`.
5. Verify the runtime if the change is behavioral: run `pnpm dev-server` + `pnpm dev-client` and
   exercise the flow; or use `pnpm run-local` for a quick full-stack check. Consider
   `pnpm preview:deploy` for an ephemeral Cloudflare preview (needs an API token; skipped on fork
   PRs).

## Some helpful cautions

- Use `test:run` while iterating; the cached `vp run ... test` replays instantly for untouched
  packages but loses to plain vitest on a just-edited package.
- A cached `vp` run **strips the environment** — a build depending on an undeclared env var will
  silently ignore it. Flags that affect output must be declared on the task.
- `pnpm build`/`clean` are `vp run -r`, not `pnpm run --recursive`; don't reintroduce a recursive
  root script.
- Configuring external services (git servers, OAuth apps) is documented per gatekeeper in its
  package `README.md` (`README.md` links them).

## Next steps

- [Architecture Overview](/openwiki/architecture/overview.md) — the system map.
- [The Workshop Backend (Kernel)](/openwiki/architecture/workshop-backend.md) — the heart of the OS.
- [Build, Test, and Lint](/openwiki/operations/build-test.md) — the task/cache model.
- [Change Guides](/openwiki/developing/change-guides.md) — representative maintenance tasks.
