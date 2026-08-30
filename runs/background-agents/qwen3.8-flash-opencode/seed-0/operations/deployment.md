---
type: operations
title: Deployment and CI/CD
description: The Terraform delivery model — Cloudflare workers, D1 with hash-triggered migrations, queues/DLQs, KV/R2, cron triggers, the two-phase Durable Object binding procedure, provider and web-platform toggles, the Modal runbook — plus the GitHub Actions pipelines that deploy pushes to main.
tags: [terraform, deployment, ci, cloudflare, modal]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-3f197f718c93b8f921c33d1b
    resource: repo://.github/workflows/ci-python.yml
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-90318d329ff8f3e5b4839a99
    resource: repo://.github/workflows/deploy-web.yml
  - id: openwiki-source-48b66d532319d4a443905cb3
    resource: repo://.github/workflows/terraform.yml
  - id: openwiki-source-9fc8a0741745a9148f4010cd
    resource: repo://docs/GETTING_STARTED.md
  - id: openwiki-source-e6c986b54f20618691685121
    resource: repo://packages/modal-infra/tests/test_deploy.py
  - id: openwiki-source-ca32cc2da6748302c6ab7063
    resource: repo://terraform/environments/production/d1.tf
  - id: openwiki-source-de4f55a0b48317d13d098ebb
    resource: repo://terraform/environments/production/variables.tf
  - id: openwiki-source-4167b211967d9a75eed01b74
    resource: repo://terraform/environments/production/workers-control-plane.tf
  - id: openwiki-source-0532e15c798610c96a8411c7
    resource: repo://terraform/environments/production/workers-github.tf
  - id: openwiki-source-2d2e9524f398faf51ea43a7d
    resource: repo://terraform/environments/production/workers-slack.tf
  - id: openwiki-source-7efa2030c8716b697af137d4
    resource: repo://terraform/modules/cloudflare-worker/main.tf
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

A production Open-Inspect instance is **one Terraform apply**: `terraform/environments/production/` composes the control plane, bot workers, D1, queues, KV/R2, the chosen sandbox backend, and the web app. `docs/GETTING_STARTED.md` is the 10-step operator guide (fork → credentials → GitHub App → optional Slack/Linear apps → generated secrets → tfvars → deploy → post-deploy wiring → web deploy → verify).

## What Terraform creates

- **Workers** via the `cloudflare-worker` module (native worker + version + deployment pattern, `modules/cloudflare-worker/main.tf`): control-plane (always), slack-bot (default on), github-bot and linear-bot (**default off**, `enable_github_bot`/`enable_linear_bot`). Bindings assembled per worker: D1 `DB`, KV namespaces (`kv.tf`: `session_index_kv`, plus per-bot KV), R2 `MEDIA_BUCKET` (`r2.tf`), queues (`workers-control-plane.tf:5–63`, `workers-github.tf`, `workers-slack.tf` — each primary queue has a **DLQ**), service bindings between bots and the control plane (`enable_service_bindings`), and the single Durable Object: `SESSION → SessionDO` (`workers-control-plane.tf:214–216`).
- **Cron triggers must match code**: the control plane registers exactly `["* * * * *", "7,37 * * * *", "23 * * * *"]` (`workers-control-plane.tf:230`) — the automation tick + autofix health, the image-build scheduler (`IMAGE_BUILD_SCHEDULER_CRON`), and the abandoned-draft sweep (`ABANDONED_DRAFT_SWEEP_CRON`). The TF comment says it explicitly: these strings must match `scheduler.ts`/`abandoned-draft-sweep.ts`.
- **D1**: the `open-inspect-<suffix>` database plus a `null_resource` whose trigger is the sha256 of *every* migration file — editing any historical migration re-runs `scripts/d1-migrate.sh`, which validates numeric-prefix naming and duplicate prefixes before applying (`d1.tf:14–33`).
- **Per-provider infra modules**: `modal-app` (drives `packages/modal-infra/deploy.py` via null_resource — see runbook below), `daytona-infra`/`e2b-infra`/`opencomputer-infra`/`vercel-sandbox-infra` build the managed **base snapshot/template** for each backend (E2B's template rebuild is keyed by source hash; Vercel's creates a temp sandbox, uploads `packages/sandbox-runtime`, runs `bootstrap.ts`, snapshots, and wires a deterministic `VERCEL_BASE_SNAPSHOT_NAME`). Backend selection is the validated `sandbox_provider` variable (`modal|daytona|vercel|opencomputer|e2b`, default `modal`; per-backend credential variables are precondition-validated, `variables.tf:577+`).
- **Web app**: `web_platform = "vercel"` (default; resources via `web-vercel.tf`, deploys through the Vercel GitHub integration) or `"cloudflare"` (`web-cloudflare.tf` builds the OpenNext bundle, writes `wrangler.production.toml` with `[vars]` including `CONTROL_PLANE_URL`/`NEXT_PUBLIC_WS_URL`/`NEXT_PUBLIC_SANDBOX_PROVIDER`, and optionally attaches a custom domain). Because Next.js inlines `NEXT_PUBLIC_*` at build time, those vars must exist during plan/build — the AGENTS.md gotcha.

## The two-phase Durable Object procedure (operationally critical)

Cloudflare rejects creating a Worker version that *binds* a not-yet-existing DO class, while the class must be created via a migration that *doesn't* emit bindings. So new deployments (and any new DO class) go: apply once with `enable_durable_object_bindings = false` (and optionally `enable_service_bindings = false`) to create the class, then flip to `true` and re-apply to add bindings (`variables.tf:620–626`; module emits bindings only when enabled, `modules/cloudflare-worker/main.tf:48–54`). The module also guards the inverse hazard with a plan-time **precondition**: deleting a DO class (`deleted_classes`) requires bindings *enabled*, or the same version would ship a control plane with no `SESSION` binding (`main.tf:118–126`). `terraform.yml` auto-emits a `scheduler-do-retirement.auto.tfvars.json` for the historical `SchedulerDO` deletion under that rule (`terraform.yml:194–196`). `GETTING_STARTED.md:677–727` walks Phase 1/Phase 2.

## Modal runbook and image rebuild rules

The `modal-app` module's `scripts/deploy.sh` runs (order pinned by `packages/modal-infra/tests/test_deploy.py:68–98`): `uv sync --frozen` → `uv run python deploy.py --build-sandbox-image` → `uv run modal deploy deploy.py`; a failed eager image build **stops the apply** rather than deploying endpoints against a stale image. Never deploy `src/app.py` directly (it doesn't import the function modules). To force a sandbox-image rebuild, bump `CACHE_BUSTER` in `src/images/base.py` — which today *equals* the shared `runtime_manifest.json` generation, so the correct operational move is bumping the manifest generation (retires incompatible prebuilt images and snapshots simultaneously — see [Sandbox Lifecycle](/openwiki/control-plane/sandbox-lifecycle.md)); Daytona is the one provider outside that sequence, keyed by its own `SANDBOX_VERSION` string (`packages/daytona-infra/src/toolchain.py:23`). Other rebuild keys: `ALLOWED_CONTROL_PLANE_HOSTS` changes are Modal-secret updates; E2B/OpenComputer/Vercel/Daytona rebuild on source-hash change through their TF modules.

## GitHub Actions

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` "CI (TypeScript)" | push/PR to `main` with path filters (TS packages, `scripts/**`, D1 migrations; md excluded) | jobs: `lint-typescript` (ESLint + complexity-reporter self-test + Prettier + Knip), `typecheck-typescript`, `build-web`, `test-cp-unit`, `test-cp-integration` (**matrix-sharded 1/2, 2/2**), `test-web`, `test-bots` — every test job builds `@open-inspect/shared` first |
| `ci-python.yml` | paths incl. the Python packages **plus** `control-plane/src/image-builds/timeouts.ts`, `shared/src/types/integrations.ts`, `modules/modal-app/scripts/deploy.sh` | ruff lint + pyright-style typecheck + pytest for sandbox-runtime and modal-infra — the extra path triggers exist because the cross-language contract tests read TS source text |
| `terraform.yml` | push/PR touching `terraform/**`, scripts, worker packages, provider packages, shared/web; also `workflow_dispatch` | `check-secrets` (external contributors never see secrets), `validate`, `plan` (builds control-plane bundle first, comments the plan), `apply` on push/dispatch — non-cancelling concurrency group |
| `deploy-web.yml` | push to `packages/web/**`/`packages/shared/**` + dispatch | Vercel `pull → build → deploy --prebuilt --prod`; self-skips when `WEB_PLATFORM` is cloudflare (Terraform owns that path) or Vercel secrets are absent |
| `openwiki-update.yml` | daily cron + dispatch | regenerates the `openwiki/` docs index in a PR |

`push → main` therefore *is* the deploy pipeline for everything except the Vercel web path; `docs/GETTING_STARTED.md:921+` lists the post-apply verification (health endpoint, sign-in, first session, provider sanity).

## Security-relevant config notes

- GitHub App private keys must be **PKCS#8** (`openssl pkcs8 -topk8 … -nocrypt`) or Workers' crypto fails at runtime.
- The `sig1` service secrets are per-service; rotate via `scripts/wrangler-secrets.sh` (also purges retired legacy auth secrets).
- Encryption keys (`REPO_SECRETS_ENCRYPTION_KEY`, `TOKEN_ENCRYPTION_KEY`, `PROVIDER_ACCOUNTS_ENCRYPTION_KEY`, `IMAGE_CALLBACK_TOKEN_PEPPER`) are generated once (GETTING_STARTED Step 5) — losing them orphans every encrypted row; the callback domain-separation prefix and secret storage formats are wire-frozen.
- Switching `sandbox_provider` deliberately requires keeping **old** provider credentials deployed until in-flight/terminal image-build cleanup drains (`docs/IMAGE_PREBUILD.md:109–112`).
