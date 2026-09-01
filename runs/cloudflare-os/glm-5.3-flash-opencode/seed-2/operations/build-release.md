---
type: operations
title: Build system, dev tooling, and release pipeline
description: The Vite+ task cache and its rules, the dev server's generated wrangler configs, PR preview deployments, the release manifest contract with its placeholder grammar, the R2 upload/promote flow, and CI.
tags: [build, vite-plus, release, ci, dev-server, caching]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-9c8e83db2fb61f177ba073be
    resource: repo://packages/workshop-frontend/vite.config.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
  - id: openwiki-source-dc2c5753138cb9e4a18d5cee
    resource: repo://scripts/preview/preview.ts
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
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Build system, dev tooling, and release pipeline

## Vite+ (vp) tasks and the cache rules

All package builds run through Vite+ tasks (`pnpm build` is `vp run -r --cache build`), not
`pnpm --filter`, because most packages declare `build` as a *task* rather than a script. The cache
has rules that fail silently rather than loudly (`REVIEW.md:71-92`):

- **A cached task sees only a built-in environment.** A build that reads an env var must *be* a
  task declaring `env` (scripts can't declare env) — `workshop-frontend`'s build declares
  `env: ['VITE_*']`, folding flag values into the fingerprint so a changed value is a reported
  cache miss rather than a stale bundle. The gatekeeper configurators get it right by having no
  `build` script at all; `gatekeeper-context`/`gatekeeper-scheduler` instead nest
  `vp run --cache build:app` inside their build script so the declaration still applies.
- **`env` fingerprints the value, not what it points at.** A var naming a path outside the
  workspace (`FORMAT_BLUEPRINTS_DIR`) needs `cache: false` instead — `workshop-backend`'s build is
  uncached for exactly this reason; an uncached task runs with the full ambient environment.
- **A task that reads a path it also writes never caches.** `workshop-frontend`'s build excludes
  its own `dist/` from `input`; the test tasks exclude vitest/wrangler scratch paths; gatekeeper
  SPA-build exclusions must be workspace-wide or the gatekeepers invalidate each other.
- **No `incremental` tsconfigs** (tsc's `.tsbuildinfo` would take the type check out of the cache
  and cost more than it saves), **no root script calling `pnpm run --recursive`**, and
  **`scripts/assert-workerd.ts` stays in workerd-pool `setupFiles`** so a failed vitest-pool-workers
  start fails the suite instead of silently passing under Node.

Type checking is one recursive `tsc` under TypeScript 7 (tsgo) with `"singleThreaded": true`
(measured both fastest and smallest); `pnpm types:check` aliases the build. Lint is oxlint via
`vp lint`, configured in the root `vite.config.ts` (correctness+suspicious as errors, plus a
repo-local `gadgets/prefer-jsdoc` rule and the integration-tests capnweb import restriction).
`pnpm test` runs the root `node --test scripts/**/*.test.ts` suite then per-package tests, filtered
`'!cloudflare-os'` — a hardcoded root package name.

## The dev server

`pnpm dev-server` (`scripts/run-dev-server.ts`) generates dev-only `wrangler.dev.jsonc` files for
all workers, then launches one multi-config `wrangler dev`:

- Discovers every `packages/gatekeeper-*` with a `wrangler.jsonc`, binding each to the backend as
  `GATEKEEPER_<NAME>` with `entrypoint: "GatekeeperVendor"` (Context gets `sharingDomain: "dev"`
  props) and to the router as plain service bindings; sets each gatekeeper's `BASE_URL` to its
  public path; injects shared OAuth credentials (`GITHUB_*` → gatekeeper-github's `CLIENT_ID`,
  etc.) and passthrough vars (`MCP_PORTAL_*`); sets `ADMINS=["admin"]`; and passes through the
  optional OAuth-signin/AI-Gateway env vars from the shell or `.dev.vars`.
- Runs a three-way pre-flight in parallel: the backend's format-blueprint module (gitignored) and
  the two UI groups (`build:configurator`, `build:app:dev` — the dev variant is unminified and must
  byte-match what the watcher's unskippable initial build writes, or Wrangler restarts the worker
  mid-startup).
- Watchers spawn only after the pre-flight: configurator watchers immediately (their build is a
  no-op write after the pre-flight), gatekeeper app watchers deferred until Wrangler is listening
  (TCP poll, 60 s backstop), because `vite build --watch` cannot skip its initial build.
- Dev-only speedups: `build.command` binaries are resolved and spawned directly instead of through
  `pnpm exec` (~0.33 s process startup per call, paid per worker per rebuild, all on the startup
  critical path); shutdown is driven by Wrangler's exit with deep process-tree kills.

`pnpm run-local` is the single-command variant: install, build `typed-storage` and the frontend
assets, then run the dev server with `--serve-frontend-assets` (the backend serves the built SPA,
mirroring production).

## Preview deployments

`scripts/preview/preview.ts` deploys a complete instance as **Worker Previews, one per PR**, in
three tiers — the 16 gatekeepers (concurrently, binding nothing), the backend (binding every
gatekeeper preview), then the router (binding everything and owning the only public hostname; the
other seventeen set `preview_urls: false` and are reachable only over service bindings, asserted
at deploy). Between tiers the next tier's `preview_id`s are patched with the ids the previous tier
returned; secrets are uploaded via the API between tiers 1 and 2 and never written into a config,
because Wrangler prints config values and the logs are public (`scripts/preview/preview.ts:1-35`).
Subcommands: `config`, `deploy`, `delete`, `sweep` (abandoned previews), `--dry-run`.

## The release pipeline

`scripts/release/` builds and publishes customer releases
(`REVIEW.md`; `manifest-lib.ts:1-25`):

- **`build-release.ts`** bundles every deployable worker **byte-identically** (wrangler dry-run
  with the pinned wrangler), builds the Access-mode frontend, and generates the **release
  manifest** — the contract between CI and the deploy service, with every account-specific value
  replaced by a placeholder: `$ACCOUNT_ID`, `$KV_<BINDING>_ID`, `$R2_<BINDING>_NAME`,
  `$WORKER_NAME(<pkg>)`, `$SECRET(<name>)`, `$PUBLIC_BASE_URL`. The placeholder list is **closed**:
  the deploy-side renderer fails on any `$` token it doesn't recognize, and `MANIFEST_VERSION`
  guards drift. `HANDLED_CONFIG_KEYS` makes an unrecognized wrangler key fail the build rather than
  pass through silently. The manifest is covered by a golden-file test — after an intentional
  change, regenerate with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and
  review the diff.
- **`upload-release.ts`** mirrors the release to R2 content-addressed, **manifest last** —
  `releases/<id>/manifest.json` is what marks a release complete, so a crashed upload never
  publishes a partial one. With `--candidate` the manifest lands under `candidates/<id>/`
  (invisible to the deploy service, which scans only `releases/`) so e2e can verify it first.
- **`promote-release.ts`** publishes by copying the candidate's manifest into `releases/<id>/` —
  all-or-nothing. The copy is **not isolated** against concurrency (check-then-act), so CI
  serializes promote runs in a resource group; the script's newer-release guard skips candidates a
  later release has already superseded (matched by the `r<pipeline>-<sha>` id format).
- Installable gatekeepers' user inputs default to OAuth `CLIENT_ID`/`CLIENT_SECRET`; a per-package
  `deploy-inputs.json` overrides, and gatekeepers that take no third-party credentials belong in
  `NO_DEFAULT_CRED_INPUTS` (a spurious default makes one uninstallable — the wizard blocks Install
  on unfilled secret inputs).

## CI

`.github/workflows/ci.yml` runs two jobs: **Lint** (`pnpm lint:check` + `types:scripts`) and
**Build and test** (`pnpm build` then `pnpm test`, 20-minute timeout because a wedged test process
would otherwise burn the 6-hour default). Setup is `voidzero-dev/setup-vp` with Corepack; only the
test job caches. Preview deployments are skipped on fork PRs by design (GitHub withholds secrets).
