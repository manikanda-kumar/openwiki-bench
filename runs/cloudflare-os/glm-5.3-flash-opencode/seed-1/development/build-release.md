---
type: operations
title: Build System, Dev Tooling, and the Release Pipeline
description: The developer toolchain — Vite+ (vp) tasks and caching rules, run-dev-server internals, and the scripts/release pipeline that builds byte-identical workers, mirrors them to R2, and publishes releases via an all-or-nothing manifest copy.
tags: [build, vite-plus, dev-server, release, deployment, manifest]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-7ebd3fe59ef5e6c4ca3515db
    resource: repo://packages/gatekeeper-github/deploy-inputs.json
  - id: openwiki-source-46a6dc3f05f1e404c37ef40d
    resource: repo://packages/workshop-backend/vite.config.ts
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-9612f94788bbd0b7c8796a78
    resource: repo://scripts/release/build-release.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-8e883af3a8837aa3a4e94cb4
    resource: repo://scripts/release/promote-release.ts
  - id: openwiki-source-3e7e0de930ab4554a6681fb3
    resource: repo://scripts/release/upload-release.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
  - id: openwiki-source-9567f7dd570f98780e70e8a0
    resource: repo://scripts/run-local.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# Build System, Dev Tooling, and the Release Pipeline

## Build orchestration: Vite+ (vp)

The workspace uses `vite-plus` (the `vp` binary) for task orchestration. `pnpm build` is `vp run -r --cache build` and `pnpm test` routes per-package tests through a shared `test` task, so each package's build/test is cached against its inputs and replayed when unchanged (root package.json). Key consequences visible in the configs:

- **Builds are type checks, not compiles.** Every package but `typed-storage` is `noEmit`; wrangler and vite bundle from source, so nothing imports another package's `dist` (AGENTS.md, "To test changes"; corroborated by `workshop-backend`'s `build` task running only `tsc`, packages/workshop-backend/vite.config.ts).
- **A cached vp run strips the environment** to a built-in set. Anything else must be declared on a *task* (`env`/`untrackedEnv` don't exist on scripts). `workshop-frontend`'s `build` task declares `env: ['VITE_*']` — the config explains that `VITE_CF_ACCESS_MODE` is inlined into the bundle and `VITE_FRONTEND_ERROR_REPORTING` selects hidden source maps, so replaying a bundle built under different values is wrong rather than merely stale (packages/workshop-frontend/vite.config.ts, `build` task comment).
- **`env` fingerprints the value, not what it points at.** `workshop-backend`'s build is therefore `cache: false` rather than `env: ['FORMAT_BLUEPRINTS_DIR']`: the variable names a blueprint directory outside the workspace, so edits inside it would be invisible to the fingerprint (packages/workshop-backend/vite.config.ts, `build:format-blueprints` comment). An uncached task runs with the full ambient environment.
- **A task may not share a name with a package.json script**; commands that would be one `&&` string are split into separate commands so each caches independently (both config files, comment blocks).
- **Tasks that read a path they also write are never cached.** The frontend bundle task excludes `dist/` from its inputs ("vp declines to cache a task that reads a path it also wrote") and excludes `**/.wrangler/**` *workspace-wide* because wrangler's scratch bundles reach past the owning package (packages/workshop-frontend/vite.config.ts).
- **tsc runs single-threaded** via root tsconfig `"singleThreaded": true` — the measured rationale is that capnweb's recursive generics make parallel checkers re-derive the same large type graphs (AGENTS.md; the setting itself is in tsconfig.json).
- Frontend dev proxying: the Vite dev server proxies `/api/client-errors`, `/blueprint-screenshot`, and `/api/site-logo` to the backend host (packages/workshop-frontend/vite.config.ts, `server.proxy`).

## Dev server: `pnpm dev-server`

`scripts/run-dev-server.ts` generates dev-only `wrangler.dev.jsonc` files with dynamic service bindings and launches `wrangler dev` for all discovered workers (run-dev-server.ts:1-8). It loads a gitignored root `.dev.vars` file (KEY=VALUE; shell env wins) for local secrets (run-dev-server.ts:46-50). Startup ordering is deliberate: a pre-flight runs `vp run -r --cache build:configurator` and `build:app:dev` (two invocations because `vp run` takes one task name) before watchers spawn, and the app watchers are deferred until Wrangler is listening — "the app watchers cannot skip their own initial build", so spawning them early would put two processes on the same `src/generated` files (run-dev-server.ts:255-276, 563). Dev-only command rewriting spawns each worker's `build.command` binary directly (resolved through the package's own `node_modules`) instead of through `pnpm exec` (run-dev-server.ts:336 comment).

`pnpm run-local` (scripts/run-local.ts:1-13) is the one-command variant: install, build only what's needed to run (`typed-storage` and the frontend bundle), then launch the dev server with `--serve-frontend-assets`.

## The release pipeline (`scripts/release/`)

The pipeline turns the workspace into an immutable, customer-deployable release. Three scripts, run in order by CI:

1. **`build-release.ts`** — bundles every deployable worker byte-identically (wrangler dry-run + outdir with the repo's pinned wrangler), builds the Access-mode frontend asset build, and generates the release manifest. Output is content-addressed: `<out>/modules/<sha256>`, `<out>/assets/<cfHash>`, with `manifest.json` describing it all (build-release.ts:1-19). The release id defaults to `r<CI_PIPELINE_IID>-<sha7>` in CI and `dev-<timestamp>` locally, overridable with `--release-id`.
2. **`upload-release.ts`** — mirrors the release to R2 via the S3 API. Blobs are content-addressed and dedupe (each key is HEAD'd first). The manifest is uploaded **LAST** — its presence under `releases/<id>/manifest.json` is what marks the release complete, so a crashed upload never leaves a manifest pointing at missing blobs. With `--candidate`, the manifest lands under `candidates/<id>/` — invisible to the deploy service (which scans only `releases/`) until promotion (upload-release.ts:1-16). Requires `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
3. **`promote-release.ts`** — publishes a verified candidate by copying `candidates/<id>/manifest.json` to `releases/<id>/manifest.json`. Publishing is that single all-or-nothing manifest copy, but the copy is not isolated against concurrent promotions, so the caller must serialize runs (gadgets-internal CI uses a resource group). Exit-0 guards: already-promoted (idempotent re-runs) and superseded (a higher CI run number already published — promoting an older candidate after a newer one shipped would roll production back, since "latest" is decided by manifest upload time). A missing candidate manifest is a hard error (promote-release.ts:1-33).

### The manifest contract

`manifest-lib.ts` parses each package's `wrangler.jsonc` and emits binding *templates* — every account-specific value replaced by a placeholder the deploy service resolves from instance state (manifest-lib.ts:1-15):

- `$ACCOUNT_ID` — the user's account tag
- `$KV_<BINDING>_ID` / `$R2_<BINDING>_NAME` — storage provisioned at deploy time
- `$WORKER_NAME(<pkg>)` — the instance's chosen name for another worker in this release
- `$SECRET(<name>)` — a user-supplied secret, passed through as `secret_text`
- `$PUBLIC_BASE_URL` — the instance's public origin

The placeholder list is closed — the deploy-side renderer fails on any unrecognized `$` token, and `MANIFEST_VERSION` (currently 1) guards co-evolution. A golden-file test covers the manifest; after an intentional change, regenerate with `UPDATE_GOLDEN=1` and review the diff (AGENTS.md).

### Deploy-wizard input conventions

- Installable gatekeepers default to `CLIENT_ID`/`CLIENT_SECRET` secret inputs; a package's `deploy-inputs.json` overrides (e.g. gatekeeper-github's declares both secrets with setup steps and a `redirectUriTemplate`) (manifest-lib.ts:259-261, 330-332; packages/gatekeeper-github/deploy-inputs.json).
- `NO_DEFAULT_CRED_INPUTS` opts out gatekeepers that take no third-party OAuth app credentials: `gatekeeper-context` (own storage), `gatekeeper-homeassistant` (user's own URL + token), `gatekeeper-scheduler` (auto-provisioned), and both MCP gatekeepers (dynamic client registration) (manifest-lib.ts:260-267).
- The deploy wizard blocks Install on unfilled secret inputs, so a spurious default makes a gatekeeper uninstallable (AGENTS.md).
- Some workers are cut from customer manifests for account-capability reasons — e.g. gatekeeper-context's `artifacts` binding is closed-beta and cannot be provisioned in arbitrary user accounts; the gatekeeper degrades gracefully (manifest-lib.ts:250-255). `gatekeeper-email` is not installable on customer instances (Email Routing needs a zone) but ships in the release so the entry stays auditable (manifest-lib.ts:270-272).
- Backend instance-state vars (`ADMINS`, `DEPLOY_URL`, ...) are injected by the deploy service at PUT time, never manifest-templated (AGENTS.md).

## Preview environments

`pnpm preview:config|deploy|delete|sweep` (scripts/preview/) manage preview deployments; fork PRs deliberately skip preview deploys because GitHub withholds repo secrets from `pull_request` runs whose head is a fork (CONTRIBUTING.md).
