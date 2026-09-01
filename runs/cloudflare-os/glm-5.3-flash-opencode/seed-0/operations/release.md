---
type: release-pipeline
title: "Release Pipeline"
description: How customer instances receive releases — build-release's byte-identical worker bundling and manifest generation, the manifest's placeholder contract, the content-addressed R2 upload with candidates, and promotion as a single all-or-nothing manifest copy with a newer-release guard.
tags: [release, ci, r2, manifest, deploy]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
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
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Release Pipeline

The pipeline under `scripts/release/` is how customer instances get deployed code: **build → upload (optionally as a candidate) → promote**, with the release **manifest** as the contract between this repo's CI and the deploy service.

## Build

`node scripts/release/build-release.ts --out release-out` bundles every deployable worker **byte-identically to what `wrangler deploy` would upload** (dry-run + outdir with the repo's pinned wrangler), builds the Access-mode frontend assets, and generates the manifest (scripts/release/build-release.ts:1-14). Output layout: `manifest.json` (uploaded last — its presence marks the release complete), `modules/<sha256>` and `assets/<cfHash>` blobs, content-addressed (scripts/release/build-release.ts:5-9). Worker and frontend builds run concurrently up to `--concurrency`; nothing about the output depends on the concurrency, since each bundle reads only its own package (scripts/release/build-release.ts:11-13). The id defaults to `r<CI_PIPELINE_IID>-<sha7>` in CI, `dev-<timestamp>` locally, overridable with `--release-id` (AGENTS.md §release pipeline).

## The manifest contract

`manifest-lib.ts` reads every deployable package's `wrangler.jsonc` (`readDeployablePackages`, sorted; any package with a wrangler config is deployable) and emits a manifest whose placeholders (`$ACCOUNT_ID`, `$WORKER_NAME(...)`, `$SECRET(...)`, `$PUBLIC_BASE_URL`, …) the deploy service substitutes (scripts/release/manifest-lib.ts:295-315). Key rules:

- **Fail closed on unknown config keys**: `HANDLED_CONFIG_KEYS` lists what the generator understands; anything else fails, because a new key on a deployable worker needs an explicit decision about how customer instances get it (scripts/release/manifest-lib.ts:238-255).
- **The backend's manifest carries only `$PUBLIC_BASE_URL`.** Its other instance-state vars (`ADMINS`, `DEPLOY_URL`, `CF_ACCESS_*`, `CF_AI_GATEWAY_*`) are injected by the deploy service at PUT time, never manifest-templated (scripts/release/manifest-lib.ts:413-417).
- Every backend gets the **Workers AI binding** hardcoded (not read from wrangler.jsonc) — webFetch's to-Markdown needs it and it is the default AI Gateway transport; cross-account gateways opt out with `CF_AI_GATEWAY_USE_BINDING=false` (scripts/release/manifest-lib.ts:419-426).
- **Gatekeeper binding expansion**: installed gatekeepers are called through `GATEKEEPER_*` service bindings at the `GatekeeperVendor` entrypoint; gatekeeper-context gets `sharingDomain: "$PUBLIC_BASE_URL"` in its binding props (scripts/release/manifest-lib.ts:427-434).
- **Deploy inputs**: a gatekeeper's `deploy-inputs.json` (or the default `CLIENT_ID`/`CLIENT_SECRET` secrets, or none for `NO_DEFAULT_CRED_INPUTS` packages) becomes pass-through `secret_text` bindings; installable gatekeepers not in that set get the default credentials, and the deploy wizard blocks Install on unfilled secret inputs — so a spurious default makes a gatekeeper uninstallable (scripts/release/manifest-lib.ts:259-270, 443-447).
- The manifest is covered by a **golden-file test** (`testdata/golden-manifest.json`); after an intentional manifest change, regenerate with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and review the golden diff (scripts/release/manifest-lib.test.ts:4-7, 56-63).

## Upload

`node scripts/release/upload-release.ts --release release-out [--candidate]` mirrors the release to R2 via the S3 API (scripts/release/upload-release.ts:1-13):

- Blobs are **content-addressed and deduped**: each key is HEAD'd first and skipped if present.
- The **manifest is uploaded LAST** — its presence under `releases/<id>/manifest.json` marks the release complete, so a crashed upload never leaves a manifest pointing at missing blobs.
- With `--candidate`, the manifest lands under `candidates/<id>/` — **invisible to the deploy service** (which scans only `releases/`) — so e2e can verify it before promotion; blob handling is identical either way.

## Promote

`node scripts/release/promote-release.ts --release-id <id>` **copies `candidates/<id>/manifest.json` to `releases/<id>/manifest.json`** — publishing is that single all-or-nothing copy; the blobs are already in place (scripts/release/promote-release.ts:1-9). The copy is **not isolated against concurrent promotions** (the newer-release guard is check-then-act), so the caller must **serialize promote runs** — gadgets-internal's CI does this with a resource group; the guard then catches the remaining hazard, a promote starting after a newer release has already published (scripts/release/promote-release.ts:4-8).

Exit-0 guards keep benign races from failing the pipeline: already-promoted (idempotent re-run) and **superseded** — a CI-format id `r<run#>-<sha>` with a higher run number already published. "Latest" is decided by manifest upload time, so promoting an older candidate after a newer one shipped would roll production back; a missing candidate manifest is a hard error (scripts/release/promote-release.ts:10-21, 23-38).

## Running by hand

Upload and promote need `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (scripts/release/upload-release.ts:10-12, scripts/release/promote-release.ts:17-18).

## Related pages

- [Build System and Dev Server](/openwiki/operations/build-and-dev.md) — the task system the bundles run under.
- [Change Guide: Adding a Gatekeeper](/openwiki/guides/add-gatekeeper.md) — where deploy inputs and installability fit.
- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md) — how installed gatekeepers surface to users.
