---
type: operations
title: Release Pipeline
description: How customer instances get deployed — byte-stable release builds with content-addressed blobs, the placeholder manifest contract, manifest-last upload with candidate/promote gating, deploy-wizard inputs, and the fork-secret security model of preview deployments.
tags: [release, deployment, r2, manifest, ci, previews]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-b2d168fe2dced2fd60170f89
    resource: repo://.github/workflows/preview.yml
  - id: openwiki-source-7ebd3fe59ef5e6c4ca3515db
    resource: repo://packages/gatekeeper-github/deploy-inputs.json
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
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Release Pipeline

The release pipeline in `scripts/release/` is the contract between this repo's CI and the
(deployment-side) deploy service. Three scripts, one manifest.

## `build-release.ts` — an immutable release directory

Every deployable worker is bundled **exactly as `wrangler deploy` would upload it** (pinned
wrangler, dry-run + outdir), alongside the Access-mode frontend asset build
(scripts/release/build-release.ts#L3-L16). Output layout:

- `manifest.json` — the release manifest (must be uploaded **last**; its presence marks the
  release complete)
- `modules/<sha256>` and `assets/<cfHash>` — worker module and static asset blobs, both
  content-addressed (build-release.ts#L6-L10)

Builds run concurrently (each bundle reads only its own package, results reassemble in package
order), which is why output must not depend on ordering (build-release.ts#L12-L15).

## `manifest-lib.ts` — the placeholder contract

The manifest is generated from each package's `wrangler.jsonc` with **account-specific values
replaced by placeholders** the deploy service resolves per customer instance:
`$ACCOUNT_ID`, `$WORKER_NAME(<pkg>)` (service bindings), `$SECRET(<name>)`,
`$KV_<BINDING>_ID`, `$R2_<BINDING>_NAME`, and `$PUBLIC_BASE_URL` — the instance's public origin,
which is also the gatekeepers' `BASE_URL` prefix and gatekeeper-context's `sharingDomain`
(scripts/release/manifest-lib.ts#L9-L14, L107-L164, L390-L445). The backend carries only
`$PUBLIC_BASE_URL` deliberately; instance-state vars like `ADMINS` and `DEPLOY_URL` are injected
by the deploy service at PUT time, never templated (manifest-lib.ts#L415-L418).

Deployable packages are every workspace package that has a `wrangler.jsonc`, read in sorted order
(manifest-lib.ts#L302-L318), and per-package
`deploy-inputs.json` overrides the wizard's default OAuth `CLIENT_ID`/`CLIENT_SECRET` secret
inputs; `NO_DEFAULT_CRED_INPUTS` exempts connectors that take no third-party credentials
(manifest-lib.ts#L239, L258-L266, L444-L446 — see
[How to Add a Gatekeeper](../guides/adding-a-gatekeeper.md)).

The manifest shape is pinned by a **golden-file test**: after an intentional change, regenerate
with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and review the golden diff
(scripts/release/manifest-lib.test.ts#L7, L59-L63).

## `upload-release.ts` — content-addressed mirror to R2

Blobs are HEAD'd before PUT so unchanged files dedupe across releases; the manifest uploads last,
"so a crashed upload never leaves a manifest pointing at missing blobs"
(scripts/release/upload-release.ts#L3-L15). Requires `R2_ENDPOINT`, `R2_BUCKET`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. With `--candidate` the manifest lands under
`candidates/<id>/` — invisible to the deploy service, which scans only `releases/` — until e2e
verification promotes it.

## `promote-release.ts` — publish is one manifest copy

Promotion copies `candidates/<id>/manifest.json` to `releases/<id>/manifest.json`; the blobs are
already in place, so publishing is that single all-or-nothing copy. Two documented caveats
(scripts/release/promote-release.ts#L3-L20):

- The copy is **not isolated** against concurrent promotions — the supersession guard is
  check-then-act — so CI must serialize promote runs (gadgets-internal CI uses a resource group).
- The **newer-release guard** makes benign races exit 0 rather than fail: if a published CI id
  (`r<run#>-<sha7>`, `ciRunNumber`/`supersededBy`) has a higher run number, the candidate is
  superseded — promoting it would *roll production back*, since the deploy service picks "latest"
  by manifest upload time. Already-promoted is likewise idempotent-exit-0; a missing candidate
  manifest is a hard error (promote-release.ts#L14-L46). Local ids are `dev-<timestamp>` and carry
  no ordering claim (promote-release.ts#L28-L33).

The manual order mirrors CI (build → upload `--candidate` → verify → promote); uploading without
`--candidate` bypasses the gate and is something CI never does.

## Preview deployments (`preview.yml`)

Per-PR previews deploy to a Cloudflare-owned account. The load-bearing security control is the
**trigger, not the `if:` guards**: this is a public repo, and GitHub structurally withholds
repository secrets from `pull_request` runs whose head is a fork, so the API token interpolates
empty there; `pull_request_target`, `workflow_run`, and `issue_comment` are therefore forbidden —
each runs privileged with untrusted inputs (`.github/workflows/preview.yml#L3-L20`). The `if:`
conditions and in-job permission re-checks are explicitly defence-in-depth, and `author_association`
must not be reintroduced as a gate because private org membership reads as `CONTRIBUTOR` and
silently skipped those previews (preview.yml#L22-L29, CONTRIBUTING.md#L14-L24 — a skipped preview
on a fork PR is working as intended; a maintainer deploys one if needed).

Related: [Configuration and Admin Settings](./configuration-and-admin.md) (what gets deployed),
[Testing and Build Tooling](../testing/testing-and-tooling.md) (what must be green first).
