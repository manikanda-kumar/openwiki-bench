---
type: operations
title: Deployment and Operations
description: Terraform-driven single-tenant deployment across Cloudflare, optional Vercel or Cloudflare web, one sandbox backend, CI/CD triggers, and operational gotchas including PKCS#8 keys and two-phase Durable Object bindings.
tags: [terraform, deployment, cloudflare, vercel, modal, ci-cd]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-90318d329ff8f3e5b4839a99
    resource: repo://.github/workflows/deploy-web.yml
  - id: openwiki-source-48b66d532319d4a443905cb3
    resource: repo://.github/workflows/terraform.yml
  - id: openwiki-source-173fd173c9194b9f127bc676
    resource: repo://packages/modal-infra/deploy.py
  - id: openwiki-source-ca32cc2da6748302c6ab7063
    resource: repo://terraform/environments/production/d1.tf
  - id: openwiki-source-54d09c819f3e04f003b1e6fa
    resource: repo://terraform/environments/production/main.tf
  - id: openwiki-source-de4f55a0b48317d13d098ebb
    resource: repo://terraform/environments/production/variables.tf
  - id: openwiki-source-fcd28f905acaec24c01bda80
    resource: repo://terraform/environments/production/web-cloudflare.tf
  - id: openwiki-source-7efa2030c8716b697af137d4
    resource: repo://terraform/modules/cloudflare-worker/main.tf
  - id: openwiki-source-4dfb5d80c6ca3491595b64c7
    resource: repo://terraform/README.md
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Deployment and Operations

Open-Inspect is deployed as a **single-tenant** stack: one GitHub App installation, one control-plane Worker, one sandbox backend, one web origin. Everyone on the instance can reach every repository that App is installed on. Step-by-step credential collection is in `docs/GETTING_STARTED.md`; local-only paths are in `docs/SETUP_GUIDE.md`. This page is the operational contract: what Terraform owns, how CI ships it, and the gotchas that break a first apply.

Related: [Architecture Overview](/openwiki/architecture/overview.md), [Web Client](/openwiki/architecture/web-client.md), [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md), [Testing](/openwiki/operations/testing.md), [Quickstart](/openwiki/quickstart.md).

## What Terraform creates

Root module: `terraform/environments/production/`. State lives in Cloudflare R2 (S3-compatible). Never commit `terraform.tfvars` or state files.

| Layer | Always | Choice |
| --- | --- | --- |
| Control plane | Cloudflare Worker + `SessionDO` + D1 + KV + R2 + queues | — |
| Bots | Optional Slack / GitHub / Linear Workers via `enable_*_bot` | — |
| Web | Next.js app | `web_platform`: `vercel` (default) or `cloudflare` (OpenNext) |
| Data plane | One sandbox backend for the whole deployment | `sandbox_provider`: `modal` (default), `daytona`, `vercel`, `opencomputer`, `e2b` |

Your job is accounts + `terraform.tfvars`. Terraform creates Workers, bindings, D1, KV, the selected web host, and the selected sandbox infra wrapper.

Required tools: Terraform ≥ 1.9, Node 22+, Python 3.12 + `uv` when Modal is selected. Build `@open-inspect/shared` before the first apply (`npm run build -w @open-inspect/shared`).

## Web platform

`web_platform` must be `vercel` or `cloudflare`.

**Vercel.** Native Vercel project + env vars. Requires a real `vercel_api_token` and `vercel_team_id`. GitHub Action `.github/workflows/deploy-web.yml` deploys `packages/web` + `packages/shared` on `main` when `WEB_PLATFORM` is unset or `vercel` and Vercel secrets exist.

**Cloudflare (OpenNext).** Next.js is built as a Worker. Vercel credentials are **not** required; leave the dummy defaults (`000000000000000000000000` / `unused`). Do **not** set the Vercel token to empty string — the Vercel provider validates `api_token` on `terraform init` even when no Vercel resources are created. Optional `cloudflare_custom_domain` + `cloudflare_zone_id` attach a hostname.

`NEXT_PUBLIC_WS_URL` (and other `NEXT_PUBLIC_*`) must be present at **web build time**; Next.js inlines them. Terraform writes them into the Cloudflare production wrangler config (`packages/web/wrangler.production.toml` generated, not the checked-in local `wrangler.toml`).

Web for Cloudflare ships with the Terraform workflow (path includes `packages/web/**`). Web for Vercel ships with `deploy-web.yml`.

## Sandbox backend (exactly one)

`sandbox_provider` is deployment-wide. An unknown value or missing credentials for the selected backend fail session init rather than degrading. Capabilities and snapshot vs persist semantics live in [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md).

Terraform validates required vars per provider (Modal tokens, Daytona URL/key/snapshot, Vercel sandbox token/project, OpenComputer URL/key, E2B API key). Modal has no Terraform provider: `terraform/modules/modal-app` uses `null_resource` + `local-exec` and hashes sources for change detection.

### Modal deploy

From `packages/modal-infra`:

```bash
uv run python deploy.py --build-sandbox-image
uv run modal deploy deploy.py
# or: uv run modal deploy -m src
```

`deploy.py` imports function modules onto the Modal app. **Do not deploy `src/app.py` directly** — that file does not register the function modules. Force an image rebuild by bumping `CACHE_BUSTER` in `packages/modal-infra/src/images/base.py` (currently tied to `RUNTIME_VERSION`).

## Control-plane config is not a checked-in wrangler.toml

The control-plane Worker is created as `cloudflare_worker` + `cloudflare_worker_version` in `terraform/modules/cloudflare-worker`. Bindings (D1, KV, R2, queues, Durable Objects, service bindings, secrets) are Terraform `bindings` on the version. There is no checked-in `wrangler.toml` that production deploys from.

`packages/control-plane/wrangler.jsonc` is for local/test. `packages/web/wrangler.toml` is local OpenNext; production Cloudflare web uses the generated `wrangler.production.toml`.

D1 migrations under `terraform/d1/migrations/` are applied by `null_resource.d1_migrations` → `scripts/d1-migrate.sh` when the migrations hash or database id changes.

## Two-phase Durable Object bindings

Cloudflare cannot bind a Durable Object class in a version until a deployment has applied its migration.

**First-time deploy:**

1. `enable_durable_object_bindings = false` and `enable_service_bindings = false`
2. `terraform apply` (creates workers + migrations)
3. Set both flags `true`
4. `terraform apply` again (attaches `SESSION` and bot service bindings)

Class **deletion** must keep surviving bindings enabled: list the class in `control_plane_deleted_classes`, set migration tags, apply with `enable_durable_object_bindings = true`. The module preconditions fail the plan if deletion is attempted with bindings disabled (that would ship a control plane with no `SESSION` binding). CI maps `ENABLE_DURABLE_OBJECT_BINDINGS` (default `true` after the first deploy).

## PKCS#8 GitHub App keys

Cloudflare Workers require PKCS#8 for the GitHub App private key (`github_app_private_key`). Convert PKCS#1 PEM:

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in key.pem -out key-pkcs8.pem
```

A GitHub App is always required for sandbox repository access even when sign-in is Google-only. GitHub and/or Google OAuth client pairs enable browser sign-in; they are validated as pairs (both set or both empty).

## CI/CD

Push to `main` auto-deploys when secrets exist:

| Workflow | Triggers | What it does |
| --- | --- | --- |
| `.github/workflows/terraform.yml` | `terraform/`, `packages/*/`, `scripts/`, web when Cloudflare | Validate + `terraform test` on PRs; **apply** on `main` / `workflow_dispatch` in environment `production` |
| `.github/workflows/deploy-web.yml` | `packages/web/`, `packages/shared/` | Vercel web when `WEB_PLATFORM` is vercel |
| `.github/workflows/ci.yml` | TypeScript packages + D1 migrations | Lint, typecheck, Vitest |
| `.github/workflows/ci-python.yml` | modal/daytona/e2b/sandbox-runtime | pytest / ruff |

Terraform apply is skipped when `CLOUDFLARE_API_TOKEN` or R2 keys are missing (expected for fork PRs). `concurrency` for Terraform does **not** cancel in-progress applies. TF version is pinned (`TF_VERSION` in the workflow).

Apply builds shared + all Workers, `uv sync` in `packages/modal-infra`, then `terraform apply`. Modal deploy is part of that apply when `sandbox_provider = "modal"`.

## Operational invariants

- Single-tenant: do not share a deployment across untrusted organizations.
- One `sandbox_provider` and one `web_platform` per `deployment_name`.
- Encryption keys (`token_encryption_key`, `repo_secrets_encryption_key`, `provider_accounts_encryption_key`, `nextauth_secret`) fail closed if missing or malformed.
- `deployment_name` is in public URLs; pick something unique.
- Queues:Edit on the Cloudflare token is required for image-build finalization and Autofix.

## Extension seams

- New Worker: add `workers-*.tf` + `cloudflare-worker` module instance; first deploy may need the two-phase flags if it introduces a Durable Object.
- New sandbox backend: add `sandbox_provider` enum value, credential validations, control-plane factory branch, infra package, and CI path filters. See [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md).
- New D1 table: add `terraform/d1/migrations/NNNN_*.sql`; the hash trigger applies it.

## Focused tests

- Terraform auth/classifier tests: `terraform/environments/production/tests/*.tftest.hcl` (run from the Terraform workflow)
- Worker module DO binding preconditions: `terraform/modules/cloudflare-worker/main.tf`
- Modal deploy entry: `packages/modal-infra/deploy.py`
