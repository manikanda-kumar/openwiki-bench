---
type: quickstart
title: Quickstart
description: Orientation for Open-Inspect — what it is, the three-tier map, package list, day-one commands, and task-oriented routing into the wiki for deploying, debugging sessions, changing protocols, adding providers, or working on bots and automations.
tags: [quickstart, navigation, setup, monorepo]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-48b66d532319d4a443905cb3
    resource: repo://.github/workflows/terraform.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-ad15a302aac7be1dd07e9481
    resource: repo://packages/control-plane/src/db/session-index.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-34e06057c714bce9a57f0b88
    resource: repo://packages/control-plane/src/sandbox/provider-name.ts
  - id: openwiki-source-9a736cd5ab523477b47ea706
    resource: repo://packages/control-plane/src/sandbox/provider.ts
  - id: openwiki-source-0f7dc7a19c00389ea0e86e0f
    resource: repo://packages/control-plane/src/session/durable-object.ts
  - id: openwiki-source-893ac0a294bbda5cd7dd3bc7
    resource: repo://packages/control-plane/src/session/message-repository.ts
  - id: openwiki-source-4b89134f3f6974b1017cbfb4
    resource: repo://packages/control-plane/src/session/message-router.ts
  - id: openwiki-source-b5e52d398550648420138d80
    resource: repo://packages/control-plane/src/session/schema.ts
  - id: openwiki-source-a1aafae6c2c67594dd82b5c1
    resource: repo://packages/control-plane/vitest.integration.config.ts
  - id: openwiki-source-173fd173c9194b9f127bc676
    resource: repo://packages/modal-infra/deploy.py
  - id: openwiki-source-d65f58f0e337b900149d1fc5
    resource: repo://packages/modal-infra/tests/test_build_sandbox_lifecycle.py
  - id: openwiki-source-e6c986b54f20618691685121
    resource: repo://packages/modal-infra/tests/test_deploy.py
  - id: openwiki-source-cbd064f0f85a511828117a62
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/bridge.py
  - id: openwiki-source-53baf5b30ac8c2cc7a323980
    resource: repo://packages/shared/src/types/prompts.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
  - id: openwiki-source-418e1ce5a2e6faaa4dfc20ec
    resource: repo://packages/web/src/hooks/use-session-transport.ts
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-d891859c5e5b394a5a032cb6
    resource: repo://scripts/cf-logs.ts
  - id: openwiki-source-de4f55a0b48317d13d098ebb
    resource: repo://terraform/environments/production/variables.tf
  - id: openwiki-source-7efa2030c8716b697af137d4
    resource: repo://terraform/modules/cloudflare-worker/main.tf
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

**Open-Inspect is a background coding agent system**: send a prompt, close your laptop, review the PR later. Sessions run in isolated cloud sandboxes decoupled from your connection, are multiplayer and persistent, and can be started from web, Slack, GitHub, Linear, cron/webhook automations, or parent agents spawning children. It is explicitly **single-tenant** — all admitted users trust-share one GitHub App installation, with no per-repo access validation (`README.md:20–40`).

## The system in one paragraph

A **Cloudflare control plane** (`packages/control-plane`: a Worker + one `SessionDO` per session backed by embedded SQLite, sharing D1 for the session index/secrets/automations) never executes code — it queues prompts, streams events, and orchestrates a **data plane** sandbox chosen from Modal / Daytona / E2B / OpenComputer / Vercel. Each sandbox runs the provider-agnostic Python `packages/sandbox-runtime` supervisor, which clones repos, starts OpenCode (the agent), and connects a WebSocket **bridge back** to the same session DO. Clients — Next.js web app and three Hono bot workers — speak one protocol defined in `packages/shared`. Full detail: [Architecture Overview](/openwiki/architecture.md).

## Packages

| Package | What it is |
| --- | --- |
| `packages/shared` | Zod wire schemas, sig1 service auth, model catalog — build it first |
| `packages/control-plane` | CF Worker + `SessionDO`, router, scheduler, image builds, D1 stores |
| `packages/web` | Next.js 16 dashboard (BFF + real-time UI) |
| `packages/slack-bot` / `github-bot` / `linear-bot` | chat/issue → session workers |
| `packages/modal-infra` | Modal-side FastAPI data plane + base image |
| `packages/sandbox-runtime` | in-sandbox supervisor/bridge (Python) |
| `packages/{daytona,e2b,opencomputer}-infra` | provider template/snapshot build tooling |
| `terraform/` | the whole deployment; D1 migrations in `terraform/d1/migrations/` |

## Day one (development)

```bash
npm install && npm run build            # shared is built first by the root script
npm run typecheck                       # tsc across all TS packages
npm run lint:fix && npm run format      # ESLint + Prettier
npm test -w @open-inspect/control-plane
npm run test:integration -w @open-inspect/control-plane   # real workerd + D1
cd packages/modal-infra && uv sync --frozen && pytest tests/ -v   # + ruff check/format
```

`npm run build -w @open-inspect/shared` **must** precede builds/tests of dependents whenever you touch it — other packages import it at build time. Python tooling lives in `packages/modal-infra` and `packages/sandbox-runtime` (`uv`-managed; ruff per `ruff.toml`). How to test what you changed: [Testing Strategy](/openwiki/operations/testing.md).

## Day one (deployment)

<!-- openwiki: broken internal link [docs/GETTING_STARTED.md] file "docs/GETTING_STARTED.md" does not exist. Fix the href or restore the target, then delete this comment. -->
Deploy your own instance through the 10-step guided flow — **[onboarding skill](docs/GETTING_STARTED.md)** or the conversational path via the repo's `onboarding` skill. Critical gotchas, expanded on [Deployment and CI/CD](/openwiki/operations/deployment.md):

- **Two-phase DO deploy**: first apply with `enable_durable_object_bindings = false` (creates the class), re-apply with `true` (adds bindings).
- **PKCS#8 GitHub App key**: `openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt` — Workers reject PEM SEC1 keys.
- **Modal**: `uv run python deploy.py --build-sandbox-image` *before* `uv run modal deploy deploy.py`; never deploy `src/app.py` directly.
- **Provider/web toggles** are Terraform variables: `sandbox_provider`, `web_platform`, `enable_github_bot`, `enable_linear_bot`.
- Pushes to `main` auto-deploy via Terraform/Vercel/Modal workflows — see the CI/CD page.

## I want to… (task routing)

| Task | Start here |
| --- | --- |
| Understand flows (prompts, events, reconnects) | [Architecture](/openwiki/architecture.md) → [Prompt Queue & Event Stream](/openwiki/control-plane/prompt-and-event-pipeline.md) |
| Debug one session | [Session Durable Object](/openwiki/control-plane/session-durable-object.md); logs by session/trace id via `scripts/cf-logs.ts`; `docs/DEBUGGING_PLAYBOOK.md` |
| Why did my sandbox die / restart? | [Sandbox Lifecycle Manager](/openwiki/control-plane/sandbox-lifecycle.md) + [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md) |
| Add/swap a sandbox provider | [Sandbox Provider Abstraction](/openwiki/data-plane/sandbox-providers.md) (checklist at the bottom) + `docs/provider-contribution-checklist.md` |
| Change the WebSocket/HTTP protocol | edit schemas in [Shared Package](/openwiki/clients/shared-package.md) first, then both sides' consumers ([Web Client](/openwiki/clients/web-client.md)) |
| Work on auth, secrets, tokens | [Authentication, Secrets, Provider Accounts](/openwiki/control-plane/auth-and-secrets.md) |
| Automations / cron / webhook triggers | [Automation Engine](/openwiki/control-plane/automation-engine.md) + `docs/AUTOMATIONS.md` |
| Slow first prompt / prebuilds | [Image Prebuild System](/openwiki/control-plane/image-prebuilds.md) |
| Slack/GitHub/Linear behavior | the [integrations](/openwiki/integrations/slack-bot.md) pages |
| D1 schema change | [D1 Data Model](/openwiki/control-plane/d1-data-model.md) — mind the migration-prefix rule |
| The btrfs of it all — repo state | `packages/` map above; per-package READMEs are API references |

## Conventions you'll hit immediately

Durations: **seconds in Python, milliseconds in TS**, units in the name (`DEFAULT_SANDBOX_TIMEOUT_SECONDS` vs `INACTIVITY_TIMEOUT_MS`), each default defined once. Repo owners may be **nested namespaces** (`group/subgroup`) — only `repo_name` is one path segment; use the shared identity helpers (`packages/shared/src/types/repositories.ts:172–205`). Commit messages: conventional commits, ≤72-char subjects. Control-plane routes use `ctx.db`, never `env.DB` (ESLint). `AGENTS.md` at the repo root is the canonical contributor brief.
