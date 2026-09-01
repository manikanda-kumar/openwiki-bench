---
type: workflow
title: Deployment and Release Pipeline
description: How customer instances get built and shipped — byte-identical worker bundling, the placeholder manifest contract, content-addressed R2 releases with the candidate/promote gate, deploy-wizard inputs, and per-PR preview environments.
tags: [release, deployment, r2, cloudflare, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-f317ee207e1653d2033c81a4
    resource: repo://CONTRIBUTING.md
  - id: openwiki-source-dc2c5753138cb9e4a18d5cee
    resource: repo://scripts/preview/preview.ts
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
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Deployment and Release Pipeline

A "release" is an immutable bundle of every deployable Worker plus the frontend assets plus a **manifest that is the contract between this repo's CI and the deploy service** (scripts/release/build-release.ts#L3-L17).

## build-release.ts — the bundle

Every worker is produced with a **wrangler dry-run using the repo's pinned wrangler**, so a release blob is byte-identical to what `wrangler deploy` would upload — the deploy service never runs a build (scripts/release/build-release.ts#L3-L9). The frontend ships as the Access-mode asset build. Output layout: `manifest.json` plus content-addressed `modules/<sha256>` and `assets/<cfHash>` directories; worker/frontend builds run concurrently (default capped) because each reads only its package and writes only its own directory, reassembled in package order (build-release.ts#L5-L19). Release id: `r<CI_PIPELINE_IID>-<sha7>` in CI — deliberately the *per-project monotonic* run number, not the instance-global `CI_PIPELINE_ID` — else `dev-<timestamp>` (build-release.ts#L203-L208).

## manifest-lib.ts — account-independence by placeholders

The manifest is generated from each package's real `wrangler.jsonc` with account-specific values replaced by placeholders the deploy service substitutes at render time: `$ACCOUNT_ID`, `$KV_<BINDING>_ID`, `$R2_<BINDING>_NAME`, `$WORKER_NAME(<pkg>)`, `$SECRET(<name>)`, `$PUBLIC_BASE_URL` (scripts/release/manifest-lib.ts#L9-L13, #L107-L113; e.g. the backend gets `PUBLIC_BASE_URL` as a var and `gatekeeper-context` receives it as its `sharingDomain` prop — manifest-lib.ts#L418-L434). Deploy-wizard inputs: an installable gatekeeper defaults to `CLIENT_ID`/`CLIENT_SECRET` secret inputs; a per-package `deploy-inputs.json` overrides that, and `NO_DEFAULT_CRED_INPUTS` opts out the connectors that take no third-party OAuth app (context, homeassistant, scheduler, both MCP connectors — for MCP, dynamic client registration means no static app) — the wizard *blocks Install on unfilled secret inputs*, so a spurious default would make a connector uninstallable (manifest-lib.ts#L258-L268, #L330-L332, #L446). `gatekeeper-email` is marked **not installable** on customer instances (Email Routing needs a zone; the bundle still ships so the entry stays auditable). `PREINSTALL` names the ambient gatekeepers (context, scheduler) the deploy service installs with zero user interaction, enforced to take no inputs at all — and those singleton-account connectors are installed **at most once per instance**, since a second install would duplicate every user's ambient capsule (manifest-lib.ts#L271-L290).

**The manifest has a golden-file test**: any intentional manifest change must be regenerated with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and the golden diff reviewed — forcing a conscious decision on what the contract becomes (scripts/release/manifest-lib.test.ts#L4-L7, #L56-L63).

## upload → candidate → promote

`upload-release.ts` mirrors the release to R2 over the S3 API (env `R2_ENDPOINT`/`R2_BUCKET`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`), content-addressed so unchanged blobs dedupe across releases (each key is HEAD'd first); the **manifest is uploaded last** — its presence under `releases/<id>/manifest.json` *is* the completion marker, so a crashed upload can't leave a manifest pointing at missing blobs. With `--candidate` the manifest lands under `candidates/<id>/` instead, invisible to the deploy service (which scans only `releases/`) until the e2e gate passes (scripts/release/upload-release.ts#L1-L17).

`promote-release.ts` publishes by copying that one manifest file — all-or-nothing, blobs already in place. But the copy is **not isolated** (check-then-act between its LIST and PUT), so CI must serialize promote runs (gadgets-internal uses a GitLab resource group); the script's own *newer-release guard* then catches the remaining hazard: "latest" is decided by upload time at the deploy service, so promoting an older `r<run>` candidate after a newer release shipped would silently roll production back — the guard exits benign (already-promoted, superseded) rather than failing the pipeline, while a missing candidate manifest is a hard error (a phantom publish must not report success) (scripts/release/promote-release.ts#L3-L24).

By hand: `node scripts/release/build-release.ts --out release-out` → `node scripts/release/upload-release.ts --release release-out --candidate` → `node scripts/release/promote-release.ts --release-id <id>` (uploading without `--candidate` bypasses the gate — CI never does it) (upload-release.ts#L12-L16).

## The deployed topology and the public origin

A deployed instance is the router as its **only hostnamed worker**, binding the backend and every gatekeeper by service name (`$WORKER_NAME(...)` substitution) — dev's `pnpm dev-server` runs the same topology locally through generated wrangler configs (wrangler.jsonc at the root is this dev router; [Architecture Overview](../architecture/overview.md); [Toolchain, Tasks, and Build Cache](../development/toolchain-and-builds.md)). Instance-state vars (`ADMINS`, `DEPLOY_URL`, `CF_ACCESS_*`, `CF_AI_GATEWAY*`) are injected by the deploy service at PUT time, never manifest-templated (scripts/release/manifest-lib.ts#L416-L417; scripts/preview/preview.ts#L28-L31).

## Preview environments (per-PR instances)

`scripts/preview/preview.ts` deploys/tears down a **complete instance as a set of Cloudflare Worker Previews — one per pull request** — on the account named by `CLOUDFLARE_ACCOUNT_ID`, with `config`/`deploy`/`delete`/`sweep` (abandoned-preview cleanup) subcommands and a `--dry-run` (scripts/preview/preview.ts#L1-L10). Deployment runs in three tiers because each tier's service bindings must name the previews the tier before produced: (1) the 16 gatekeepers concurrently, (2) workshop-backend binding every gatekeeper preview, (3) the router binding backend + gatekeepers and owning the public origin; between tiers only the next tier's `previews.services[].preview_id` list is patched, since everything else is derived deterministically up front from the router's preview name (preview.ts#L12-L22). Security posture is asserted, not assumed: the other seventeen workers set `preview_urls: false` — a stray URL on one is a way around the router's Access — and the backend's secrets (admins, Access app) are uploaded as worker secrets between tiers, **never written into a config**, because wrangler prints config values into public CI logs (preview.ts#L24-L31; the staging config generator is `scripts/preview/staging-config.ts`, covered by its own tests). Preview deploys are the CI step deliberately withheld from fork PRs (secrets don't reach them) — see [Testing Approach](../development/testing.md) (CONTRIBUTING.md#L13-L23).
