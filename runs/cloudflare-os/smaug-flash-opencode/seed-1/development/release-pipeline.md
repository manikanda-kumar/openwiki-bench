---
type: guide
title: Release Pipeline
description: How Cloudflare OS customer instances are deployed — build-release's byte-identical, manifest-based flow; upload to R2 content-addressed and candidate-then-promote; the placeholder-manifest contract; and the deploy-wizard input defaults.
tags: [release, deploy, ci, manifest]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-9612f94788bbd0b7c8796a78
    resource: repo://scripts/release/build-release.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-8e883af3a8837aa3a4e94cb4
    resource: repo://scripts/release/promote-release.ts
  - id: openwiki-source-3e7e0de930ab4554a6681fb3
    resource: repo://scripts/release/upload-release.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---

# Release Pipeline

Customer instances are deployed by a manifest-driven flow in `scripts/release/`. It is the contract
between this repo's CI and the deploy service: CI builds every deployable worker **byte-identically**
once per commit and produces a **release manifest**; the deploy service reads that manifest and PUTs
the bundles into customer accounts via the Workers script-upload API.

## The three scripts

- **`build-release.ts`** builds an immutable release: every deployable worker bundled exactly as
  `wrangler deploy` would upload it (wrangler dry-run + outdir, with the repo's pinned wrangler),
  plus the Access-mode `workshop-frontend` asset build, plus the release manifest describing it all.
  Output layout: `<out>/manifest.json` (upload last — its presence marks the release complete),
  `<out>/modules/<sha256>` (content-addressed worker module blobs), `<out>/assets/<cfHash>` (static
  asset blobs). The builds overlap up to `--concurrency`; bundle order doesn't affect output.
  Usage: `node scripts/release/build-release.ts --out <dir> [--release-id <id>]`.
- **`upload-release.ts`** mirrors a built release to R2 via the S3 API. Blobs are content-addressed
  so unchanged files dedupe across releases (each key is HEAD'd first). The manifest is uploaded
  **last**; with `--candidate` it lands under `candidates/<id>/manifest.json` — invisible to the
  deploy service (which scans only `releases/`) — until promotion. Env: `R2_ENDPOINT`, `R2_BUCKET`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- **`promote-release.ts`** copies `candidates/<id>/manifest.json` to `releases/<id>/manifest.json`
  after the e2e gate passes. Publishing is that single manifest copy. The copy is all-or-nothing but
  **not isolated**: CI serializes promotions (a GitLab resource group), and the script's
  `supersededBy` newer-release guard skips candidates a later release already superseded (so a stale
  PUT can't roll production back). Exit-0 guards handle already-promoted and superseded cases; a
  missing candidate manifest is a hard error.

## The manifest and its placeholders

`manifest-lib.ts` is the open-source analog of the internal `generate-wrangler-prod.js`. It parses
each package's `wrangler.jsonc` (only `HANDLED_CONFIG_KEYS` are understood — anything else fails
closed) and emits binding *templates*, replacing every account-specific value with a placeholder the
deploy service resolves from instance state:

- `$ACCOUNT_ID` — the user's account tag
- `$KV_<BINDING>_ID` / `$R2_<BINDING>_NAME` — namespaces/buckets provisioned at deploy time
- `$WORKER_NAME(<pkg>)` — the instance's chosen name for another worker in the release
- `$SECRET(<name>)` — a user-supplied secret, passed through as `secret_text`
- `$PUBLIC_BASE_URL` — the instance's public origin (router URL)

The placeholder list is **closed**: the deploy-side renderer fails on any `$` token it doesn't
recognize, so this file and the renderer must evolve together (`MANIFEST_VERSION` guards that).

**Deploy-wizard configuration:** an installable gatekeeper's user-supplied inputs default to OAuth
`CLIENT_ID`/`CLIENT_SECRET` secret inputs. A per-package `deploy-inputs.json` overrides them, and
`NO_DEFAULT_CRED_INPUTS` opts out gatekeepers that take no third-party OAuth app credentials
(gatekeeper-context, gatekeeper-homeassistant, gatekeeper-scheduler, gatekeeper-mcp,
gatekeeper-mcp-portal) — the wizard blocks Install on unfilled secret inputs, so a spurious default
would make a gatekeeper uninstallable. Backend instance-state vars (`ADMINS`, `DEPLOY_URL`, ...)
are injected by the deploy service at PUT time, never manifest-templated.

**Installability rules** encoded in `manifest-lib.ts`: `NOT_INSTALLABLE` (gatekeeper-email — Email
Routing needs a zone workers.dev instances lack) ships its bundle anyway so the entry stays auditable;
`PREINSTALL` (gatekeeper-context, gatekeeper-scheduler) are installed by the deploy service on every
fresh core deploy with no user interaction, and must take no inputs of any kind.

## The golden-file test

The manifest is covered by a golden-file test (`manifest-lib.test.ts`). After an intentional manifest
change, regenerate with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and review
the golden diff.

## Running the flow by hand

Upload and promote need `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`:

1. `node scripts/release/build-release.ts --out release-out` — builds into `release-out/`. Release id
   defaults to `r<CI_PIPELINE_IID>-<sha7>` in CI, `dev-<timestamp>` locally; override with
   `--release-id <id>`.
2. `node scripts/release/upload-release.ts --release release-out --candidate` — mirror to R2 as a
   candidate (invisible to the deploy service). Omit `--candidate` to publish directly (bypasses the
   gate — CI never does this).
3. `node scripts/release/promote-release.ts --release-id <id>` — copy the verified candidate's
   manifest into `releases/<id>/`.
