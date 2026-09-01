---
type: operations
title: Deployment, routing, and release pipeline
description: How a Cloudflare OS instance is deployed and updated — the router's routing model, the release manifest contract and placeholder templating for customer accounts, the deploy wizard inputs, and deployment-level configuration.
tags: [deployment, router, release, manifest, config]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-ca45e791592e9cf3a1e0fbad
    resource: repo://packages/workshop-backend/src/deployment-config.ts
  - id: openwiki-source-9612f94788bbd0b7c8796a78
    resource: repo://scripts/release/build-release.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-8e883af3a8837aa3a4e94cb4
    resource: repo://scripts/release/promote-release.ts
  - id: openwiki-source-3e7e0de930ab4554a6681fb3
    resource: repo://scripts/release/upload-release.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Deployment, routing, and release pipeline

This page covers the pieces that turn this repo into a running instance: the router that fronts it,
the release pipeline that builds and publishes it, and the deployment-level configuration an operator
sets.

## The router

`packages/router` is the public origin of an instance. Its fetch handler routes by path prefix:

- `/api` and `/api/*`, plus `/blueprint-screenshot*`, forward to `WORKSHOP_BACKEND`;
- `/gatekeeper/<name>/*` forwards to whichever gatekeeper is bound, discovered by **scanning its own
  `GATEKEEPER_*` service bindings** (the binding suffix, lowercased and dash-normalized, is the URL
  segment) — so installing a gatekeeper is purely a binding change, no code or config here;
- everything else serves the frontend from the `ASSETS` binding when present. In dev there is no
  `ASSETS` binding, so frontend requests fall through to the backend (and in `run-local` mode the
  backend serves the pre-built SPA with `run_worker_first` for the API routes).

It also has an `email` handler that rejects mail unless a `GATEKEEPER_EMAIL` binding is installed
(dormant until Email Routing + custom domains exist, but the handler ships anyway). Gatekeeper OAuth
redirects land on the gatekeeper Workers themselves (`/gatekeeper/<name>/oauth`), so the router has no
backend auth callbacks to proxy.

## The release pipeline

The pipeline in `scripts/release/` builds and publishes **immutable releases**:

1. **`build-release.ts`** bundles every deployable worker byte-identically — `wrangler deploy` dry-run
   with the repo's pinned wrangler (so `build`, `test`, and `release` all share one wrangler) — plus
   the Access-mode frontend asset build, and writes a **release manifest** describing it all. Output
   layout: `manifest.json` (uploaded last; its presence marks the release complete), `modules/<sha256>`
   (content-addressed worker module blobs), and `assets/<cfHash>` (static asset blobs).
2. **`upload-release.ts`** mirrors the output to R2, content-addressed, manifest last. With
   `--candidate` the manifest lands under `candidates/<id>/` (invisible to the deploy service) so e2e
   can verify it; `promote-release.ts` then copies it to `releases/<id>/`. **Publishing is that single
   all-or-nothing manifest copy.** The copy is not isolated against concurrent promotions, so CI
   serializes promote runs (a GitLab resource group) and the script's newer-release guard skips
   candidates a later release has already superseded.

Upload and promote need `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The
manifest is covered by a golden-file test (`scripts/release/manifest-lib.test.ts`); after an
intentional manifest change, regenerate with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts`.

### The release manifest contract

`manifest-lib.ts` is the contract between this repo's CI and the deploy service. It parses each
package's `wrangler.jsonc` and emits **binding templates**, replacing every account-specific value
with a placeholder the deploy-side renderer resolves from instance state:

- `$ACCOUNT_ID`, `$KV_<BINDING>_ID`, `$R2_<BINDING>_NAME` (provisioned namespaces/buckets),
- `$WORKER_NAME(<pkg>)` (another worker in this release),
- `$SECRET(<name>)` (a user-supplied secret, passed through as `secret_text`),
- `$PUBLIC_BASE_URL` (the instance's public origin, the router's URL).

The placeholder list is **closed**: the renderer fails on any `$` token it doesn't recognize, guarded
by `MANIFEST_VERSION`. The generator fails closed on any wrangler config key it doesn't handle, and on
an `artifacts` binding it doesn't know how to cut (only `gatekeeper-context`'s is, and it is dropped
from customer manifests). Workers are classified as `backend` / `router` / `gatekeeper`; gatekeepers
carry a `shortName` for routing, and only gatekeepers are `installable`. The backend's manifest
carries only `$PUBLIC_BASE_URL` plus a hardcoded `WORKERS_AI` AI binding — its instance-state vars
(`ADMINS`, `DEPLOY_URL`, `CF_ACCESS_*`, `CF_AI_GATEWAY*`) are injected by the deploy service at PUT
time, never manifest-templated.

### Deploy-wizard inputs and installability

An installable gatekeeper defaults to `DEFAULT_CRED_INPUTS` (`CLIENT_ID`/`CLIENT_SECRET` secrets) —
the wizard blocks Install on unfilled secret inputs — unless it declares a `deploy-inputs.json`, or
its name is in `NO_DEFAULT_CRED_INPUTS` (`gatekeeper-context`, `gatekeeper-homeassistant`,
`gatekeeper-scheduler`, `gatekeeper-mcp`, `gatekeeper-mcp-portal`), because those take no third-party
OAuth app credentials. `gatekeeper-email` is not installable at all (Email Routing needs a zone, which
workers.dev-hosted instances don't have), but its bundle still ships for auditability. The ambient
singletons (`gatekeeper-context`, `gatekeeper-scheduler`) are `PREINSTALL`ed on every fresh core
deploy (server-side, no user interaction) and marked `SINGLETON` (installed at most once) because a
second install would give every user a duplicate ambient capsule.

## Deployment-level configuration

Configuration splits into two deliberately separate kinds:

- **Env-var driven (auth)**: `AUTH_GATEKEEPERS` (allowlist of sign-in gatekeepers), `DISABLE_PASSWORD_AUTH`
  (ignored unless the allowlist is non-empty, to avoid lockout), `CF_ACCESS_AUD`/`CF_ACCESS_ISS`
  (Cloudflare Access mode), and the optional limits flow (`ENABLE_CLOUDFLARE_LIMITS`,
  `DAILY_LLM_CALL_LIMIT`, `MINIMUM_CLOUDFLARE_BALANCE`). Auth config is **not** in `AdminConfig` so a
  compromised admin session can't change it. `getServerConfig()` (`deployment-config.ts`) assembles
  the boot-time `ServerConfig` (no secrets) from these plus the admin-config branding.
- **Admin-config soft settings**: signups toggle, site name/logo, agent instructions,
  announcement/banner/accent, gatekeeper connector/resource availability, ambient modes, and
  promoted formats — all owned by the `AdminSettings` DO and mirrored to a reserved KV key (see the
  workshop-backend page).

The primary account key is always the user's **verified email**; signing in with any allowlisted
gatekeeper that yields the same verified email maps to the same account (`idFromName(email)`, the
same scheme as Cloudflare Access). For the public multi-user mode (Google/GitHub/Cloudflare sign-in,
free daily allowance, BYOK top-up) see `docs/public-server.md` and `docs/ai-gateway-billing.md`.
