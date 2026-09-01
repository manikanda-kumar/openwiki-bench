---
type: operations
title: Router, Release Pipeline, and Preview Deploys
description: How code ships — the router worker's binding-discovered public origin, the immutable byte-identical release build, the content-addressed R2 upload with manifest-last publishing, the candidate/promote gate with its newer-release guard, manifest placeholders and the golden test, and per-PR preview deploys.
tags: [deployment, release, r2, wrangler, previews, router]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-ffe50d92a32c39df9d02c4cc
    resource: repo://packages/router/wrangler.jsonc
  - id: openwiki-source-dc2c5753138cb9e4a18d5cee
    resource: repo://scripts/preview/preview.ts
  - id: openwiki-source-17d91516d3af4378e0f712e1
    resource: repo://scripts/preview/staging-config.ts
  - id: openwiki-source-9612f94788bbd0b7c8796a78
    resource: repo://scripts/release/build-release.ts
  - id: openwiki-source-7d8b3744f7e1cb06a10226fa
    resource: repo://scripts/release/manifest-lib.test.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-8e883af3a8837aa3a4e94cb4
    resource: repo://scripts/release/promote-release.ts
  - id: openwiki-source-3e7e0de930ab4554a6681fb3
    resource: repo://scripts/release/upload-release.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Router, Release Pipeline, and Preview Deploys

This repo builds *libraries of deployable Workers*; a customer instance is assembled by an external deploy service from a **release manifest**. One contract file (`manifest-lib.ts`) governs that boundary, so changing any worker's `wrangler.jsonc` is a release-visible event — covered here with the pipeline that produces and publishes it.

## The router: the instance's public origin

The `packages/router` Worker serves the workshop frontend and routes by path prefix: `/api/*` and `/blueprint-screenshot/*` to the backend, `/gatekeeper/<name>/*` to whichever gatekeepers are bound — **discovered by scanning its own `GATEKEEPER_*` env keys**, so "installing a gatekeeper is purely a binding change" (packages/router/src/index.ts:1-35). The suffix → path mapping lowercases and dashes (`GATEKEEPER_MCP_PORTAL` → `/gatekeeper/mcp-portal`). OAuth redirects therefore land on the gatekeeper workers themselves, never the backend (:37-40). The same worker doubles as the dev router: without an `ASSETS` binding, unmatched requests fall through to the backend — and the comments record why it doesn't proxy to the Vite dev server (HMR sockets die on every wrangler restart) (packages/router/src/index.ts:8-9, 42-56). Its wrangler config carries the frontend `assets` with `run_worker_first` for API routes (packages/router/wrangler.jsonc).

## Building a release: byte-identical and immutable

`node scripts/release/build-release.ts --out release-out` produces an immutable release directory (scripts/release/build-release.ts:1-16):

- every deployable worker is bundled **exactly as `wrangler deploy` would upload it** — a wrangler *dry-run* with the repo-pinned wrangler version, into `modules/<sha256>` content-addressed blobs;
- the Access-mode `workshop-frontend` asset build lands in `assets/<cfHash>`;
- `manifest.json` is generated last, and **its presence is what marks the release complete**;
- builds run concurrently (each bundle reads only its own package; results reassembled in package order).

`readDeployablePackages` (scripts/release/manifest-lib.ts:303-345) enumerates the deployable workers (backend, router, every `gatekeeper-*`). Unknown `wrangler.jsonc` keys **fail closed** — `HANDLED_CONFIG_KEYS` forces an explicit decision about how each new config key reaches customer instances; two bindings pass through specially: `browser` (Workers AI Browser Rendering, used for PDF export) and `artifacts` (closed-beta, dropped from customer manifests only for the allow-listed `gatekeeper-context`, which degrades gracefully) (scripts/release/manifest-lib.ts:244-256).

## The manifest: placeholders, the closed set, the golden test

The manifest is "the contract between this repo's CI and the deploy service": `manifest-lib.ts` parses each package's `wrangler.jsonc` into binding *templates* with every account-specific value replaced by a placeholder — `$ACCOUNT_ID`, `$KV_<BINDING>_ID`, `$R2_<BINDING>_NAME`, `$WORKER_NAME(<pkg>)`, `$SECRET(<name>)`, `$PUBLIC_BASE_URL` (the router's URL; the *only* backend var the manifest templates — instance-state vars like `ADMINS`/`DEPLOY_URL` are injected at PUT time) (scripts/release/manifest-lib.ts:1-17, 410-419). The placeholder list is **closed**: the deploy-side renderer errors on any unrecognized `$` token, and `manifestVersion` guards the two files evolving together (:17, :213, :530).

Gatekeeper install inputs (scripts/release/manifest-lib.ts:236-275): each package's `deploy-inputs.json` describes wizard inputs; absent that, vendor-OAuth gatekeepers default to `CLIENT_ID`/`CLIENT_SECRET` secret inputs; `NO_DEFAULT_CRED_INPUTS` opts out connectors with no third-party OAuth app (context, homeassistant, scheduler, both MCP connectors) — **the wizard blocks Install on unfilled secret fields, so a spurious default literally makes a gatekeeper uninstallable**; `NOT_INSTALLABLE` keeps `gatekeeper-email` out of customer installs (Email Routing needs a zone) while still shipping the bundle auditable; `PREINSTALL` marks the ambient singletons installed server-side on every fresh deploy, *enforced* by requiring they take zero inputs (:443-466).

The manifest is pinned by a **golden-file test** run against the repo's *real* wrangler configs: any deployable package's config change fails CI until `testdata/golden-manifest.json` is regenerated (`UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts`) — the forced conscious decision is the point (scripts/release/manifest-lib.test.ts:1-7).

## Upload and promotion: manifest-last, then one copy

`upload-release.ts` mirrors the release to R2 via the S3 API (`R2_ENDPOINT`, `R2_BUCKET`, access keys): content-addressed blobs are HEAD'd first and skipped when present (cross-release dedup), and **the manifest uploads last** so a crashed upload never leaves a manifest pointing at missing blobs; with `--candidate` the manifest lands under `candidates/<id>/` — invisible to the deploy service, which scans only `releases/` (scripts/release/upload-release.ts:1-16, 50-80).

`promote-release.ts --release-id <id>` publishes by copying the candidate's manifest to `releases/<id>/manifest.json` — **publishing is that single all-or-nothing copy**, since blobs already sit content-addressed in place. The copy is *not isolated* against concurrent promotions (the supersession check is check-then-act across a LIST), so CI must serialize promote runs (a GitLab resource group); the **newer-release guard** then makes an older candidate's promotion a benign skip: "latest" is decided by manifest upload time, so allowing a stale PUT (which would carry the newest timestamp) would roll production back. Already-promoted re-runs exit 0 idempotently; a *missing* candidate manifest is a hard error so a phantom publish can't be reported (scripts/release/promote-release.ts:1-23). `ciRunNumber`/`supersededBy` encode the ordering semantics for `r<run>-<sha>` ids; `dev-<timestamp>` ids claim no ordering (scripts/release/promote-release.ts:27-45).

Running the whole flow by hand (documented in root guidance) is exactly the three commands above; CI's shape: build → upload `--candidate` → e2e gate → promote.

## Preview deploys: one full instance per PR

`scripts/preview/preview.ts` (root scripts `preview:config/deploy/delete/sweep`) deploys a complete 18-worker instance as Cloudflare **Worker Previews** on the account in `CLOUDFLARE_ACCOUNT_ID`, in three binding-ordered tiers — 16 gatekeepers concurrently, then workshop-backend (binding all gatekeeper previews), then the router (binding everything and owning the only hostname) — patching `previews.services[].preview_id` between tiers because every URL is derivable up front from the deterministic router preview name (scripts/preview/preview.ts:1-24). The other seventeen set `preview_urls: false` and the deploy *asserts* it: a stray URL is a way around the router (preview.ts:22-24). Backend secrets (admins, Access app) are uploaded between tiers and never written into configs, because wrangler prints config values into the workflow's public logs (preview.ts:26-29). `staging-config.ts` is the preview twin of `manifest-lib.ts`: same packages and topology, but concrete values instead of placeholders, with gatekeeper OAuth credentials deliberately absent — previews exercise routing, auth, and the agent, not third-party connector flows (scripts/preview/staging-config.ts:3-24).

Per the repo's contribution policy, preview jobs **do not run for fork PRs** — GitHub withholds secrets from fork runs, and a maintainer deploys one manually when the change needs review (CONTRIBUTING.md:12-23).

## Operational consequences

- A release is immutable once uploaded; "deploying" is the deploy service PUTting manifest-described bundles into customer accounts — this repo never talks to customer accounts.
- Rollback is promotion-shaped: re-pointing to an older release's manifest re-uploads it with a *newer* timestamp, which is precisely what `supersededBy` protects against for stale candidates.
- Self-hosted `workerd` deployment is "COMING SOON" per README — don't assume a supported path exists beyond what `run-local`/`dev-server` do.

## Uncertainty

- The deploy service's rendering of `$PLACEHOLDER`s (provisioning KV/R2, secret handling) lives outside this repo; this page documents only the manifest contract and the tests that pin it.
