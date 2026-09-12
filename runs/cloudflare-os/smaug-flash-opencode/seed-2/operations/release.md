---
type: operations
title: "Release Pipeline"
description: The scripts/release pipeline — byte-identical worker bundling, the release manifest contract with placeholders, the R2 content-addressed upload and promote flow, and the deploy wizard config.
tags: [release, deploy, r2, manifest, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-9612f94788bbd0b7c8796a78
    resource: repo://scripts/release/build-release.ts
  - id: openwiki-source-7d8b3744f7e1cb06a10226fa
    resource: repo://scripts/release/manifest-lib.test.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-3e7e0de930ab4554a6681fb3
    resource: repo://scripts/release/upload-release.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Release Pipeline

`scripts/release/` is how customer instances get deployed. The pipeline (`AGENTS.md` §"Release
pipeline") builds every deployable worker byte-identically, generates a **release manifest** that is
the contract between this repo's CI and the deploy service, mirrors the release to R2
content-addressed (manifest last), and promotes it once verified.

## `build-release.ts`: byte-identical bundles + the manifest

`scripts/release/build-release.ts` bundles every deployable worker exactly as `wrangler deploy`
would upload it (dry-run + outdir, with the repo's pinned wrangler), builds the Access-mode frontend
asset build, and generates the release manifest. Output layout:

```
<out>/manifest.json       the release manifest (uploaded LAST)
<out>/modules/<sha256>    worker module blobs, content-addressed
<out>/assets/<cfHash>     static asset blobs, content-addressed
```

The builds overlap (up to `--concurrency` at a time); results are reassembled in package order. The
release id defaults to `r<CI_PIPELINE_IID>-<sha7>` in CI and `dev-<timestamp>` locally, overridable
with `--release-id`.

## The manifest contract (`manifest-lib.ts`)

`manifest-lib.ts` parses each package's `wrangler.jsonc` and emits binding **templates** — every
account-specific value replaced by a placeholder the deploy service resolves from instance state
(`manifest-lib.ts:1`):

| Placeholder | Meaning |
|---|---|
| `$ACCOUNT_ID` | the user's account tag |
| `$KV_<BINDING>_ID` | a KV namespace provisioned at deploy time |
| `$R2_<BINDING>_NAME` | an R2 bucket provisioned at deploy time |
| `$WORKER_NAME(<pkg>)` | the instance's chosen name for another worker in this release |
| `$SECRET(<name>)` | a user-supplied secret, passed through as `secret_text` |
| `$PUBLIC_BASE_URL` | the instance's public origin (the router's URL) |

The placeholder list is **closed**: the deploy-side renderer fails on any `$` token it doesn't
recognize, so `manifest-lib.ts` and the renderer must evolve together, guarded by `MANIFEST_VERSION`.

## `upload-release.ts`: content-addressed R2

`scripts/release/upload-release.ts` mirrors a built release directory to R2 via the S3 API
(env `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Blobs are
content-addressed, so each key is `HEAD`'d first and skipped if present — unchanged files dedupe
across releases. **The manifest is uploaded LAST**; its presence under `releases/<id>/manifest.json`
is what marks a release complete, so a crashed upload never leaves a manifest pointing at missing
blobs (`upload-release.ts:1`).

With `--candidate` the manifest lands under `candidates/<id>/` (invisible to the deploy service,
which scans only `releases/`) until `promote-release.ts` copies it after the e2e gate passes. Blob
handling is identical either way. `promote-release.ts` has a newer-release guard and CI serializes
promotions (a GitLab resource group), since the copy is not isolated against concurrent promotions.

Manual flow (needs `R2_*` env):
1. `node scripts/release/build-release.ts --out release-out`
2. `node scripts/release/upload-release.ts --release release-out --candidate`
3. `node scripts/release/promote-release.ts --release-id <id>`

(Omit `--candidate` to publish directly — CI never does this.)

## Golden-file test

The manifest is covered by a golden-file test. After an intentional manifest change, regenerate
with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and **review the golden
diff**.

## The deploy wizard config

An installable gatekeeper's user-supplied inputs default to OAuth `CLIENT_ID`/`CLIENT_SECRET`
secrets; a per-package `deploy-inputs.json` overrides them (e.g. `packages/gatekeeper-google`,
`-github`, `-slack`, `-notion` all carry one). `NO_DEFAULT_CRED_INPUTS` in `manifest-lib.ts` opts out
gatekeepers that take no third-party OAuth app credentials (the wizard blocks Install on unfilled
secret inputs, so a spurious default would make a gatekeeper uninstallable). Backend instance-state
vars (`ADMINS`, `DEPLOY_URL`, …) are injected by the deploy service at PUT time, never
manifest-templated.

## Uncertainty

The deploy-service renderer and the e2e gate the candidate flow sits behind are not in this
repository (they belong to the closed deploy platform); this page documents only the scripts that
exist here.
