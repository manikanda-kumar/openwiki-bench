---
type: operations
title: Testing Strategy
description: How Open-Inspect verifies itself — per-package Vitest suites, control-plane integration tests in real workerd/Miniflare with migrated D1, pytest suites for the Python plane, cross-language contract tests that read the other plane's source, and the lint/boundary guardrails CI runs on every push.
tags: [testing, vitest, pytest, workerd, ci, contracts]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-3f197f718c93b8f921c33d1b
    resource: repo://.github/workflows/ci-python.yml
  - id: openwiki-source-276795f6d5ad19adb078c64e
    resource: repo://eslint.config.js
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-8207def63e0d42ebbdef131a
    resource: repo://packages/control-plane/package.json
  - id: openwiki-source-c4619f89e26da4afa695acf5
    resource: repo://packages/control-plane/src/router.test-support.ts
  - id: openwiki-source-b91d1e3d9acc6b2a85763842
    resource: repo://packages/control-plane/src/session/sql-storage.ts
  - id: openwiki-source-c7d0668458480b0d2499201c
    resource: repo://packages/control-plane/test/integration/cleanup.ts
  - id: openwiki-source-d2e7fb65fbaf2c80ce9d30e0
    resource: repo://packages/control-plane/test/integration/helpers.ts
  - id: openwiki-source-4f8f91a5dbcb8b60ce998531
    resource: repo://packages/control-plane/vitest.config.ts
  - id: openwiki-source-a1aafae6c2c67594dd82b5c1
    resource: repo://packages/control-plane/vitest.integration.config.ts
  - id: openwiki-source-d65f58f0e337b900149d1fc5
    resource: repo://packages/modal-infra/tests/test_build_sandbox_lifecycle.py
  - id: openwiki-source-a7ede82adf1ca2231d063b9b
    resource: repo://packages/modal-infra/tests/test_runtime_manifest.py
  - id: openwiki-source-85a0abeb27a76547af37d0cd
    resource: repo://packages/sandbox-runtime/tests/conftest.py
  - id: openwiki-source-5e08a4487006bd71d5acf0c3
    resource: repo://packages/web/src/hooks/use-session-transport.test.tsx
  - id: openwiki-source-a1be692c9fc24885e83e7d07
    resource: repo://packages/web/vitest.config.ts
  - id: openwiki-source-841a29faf6eafcc300fd288d
    resource: repo://scripts/lint-complexity.mjs
  - id: openwiki-source-b6f224d26b4ec604e90101e3
    resource: repo://vitest.workspace.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

CI is the spec enforcement layer: every push/PR runs lint + typecheck + tests for all TypeScript packages (`ci.yml`) and ruff + typecheck + pytest for the Python packages (`ci-python.yml`). The suite layout is deliberate — each layer is testable at the cheapest runtime that still exercises its real contracts.

## TypeScript: Vitest everywhere, per-package configs

`vitest.workspace.ts` maps the workspace to `packages/*/vitest.config.ts`; the root `npm test` fans out via `npm run test --workspaces --if-present`, and CI rebuilds `@open-inspect/shared` before any dependent test job (the build-first rule). Locations differ by package and are documented in AGENTS.md:

- **co-located units**: `control-plane`, `web`, `slack-bot`, `linear-bot`, `shared` run `src/**/*.test.ts` in a plain **node** environment (`packages/control-plane/vitest.config.ts:5`, `packages/web/vitest.config.ts:11`). The DO layer can do this because repositories code against the 13-line `sql-storage.ts` structural port — a small Node-side SQL fake exercises real schema/migration/index behavior (`session/schema.test.ts`, `message-repository.test.ts`). Web component/hook tests opt into jsdom **per file** with a `// @vitest-environment jsdom` pragma (`src/hooks/use-session-transport.test.tsx:1`) rather than paying the jsdom environment globally.
- **router-level contract tests**: `control-plane` `src/router.*.test.ts` suites drive the real route table through `router.test-support.ts`, whose `signedServiceRequest` signs each request because sig1 binds method+URL+body (there is no reusable Authorization header) using mirrored `TEST_SERVICE_SECRETS` (`src/router.test-support.ts:1–25`). `src/worker-build.test.ts` additionally runs the shared+worker builds and asserts the bundle's contents (workerd `node:async_hooks`, no polyfill) with a 60 s budget — a build-smoke test inside the unit suite.
- **github-bot uses a separate `test/` directory** (`test/handlers.test.ts`, `webhook.test.ts`, …) rather than co-location.

## Control-plane integration tests: real workerd, real migrations

`npm run test:integration -w @open-inspect/control-plane` runs `test/integration/*.test.ts` (82 files) through `@cloudflare/vitest-pool-workers` via `vitest run --config vitest.integration.config.ts`. The setup comment is the design doc (`vitest.integration.config.ts:25–62`):

- The **`cloudflareTest()` plugin** boots Miniflare with the worker's `wrangler.jsonc` bindings and `readD1Migrations()` loads the **production migration files from `terraform/d1/migrations/`**, applied once per isolate by `test/integration/apply-migrations.ts` — migrations are exercised as data, never mocked.
- The Miniflare `compatibilityDate` is pinned to `2024-09-23` to match the Terraform-managed production runtime instead of the pool's default of "today".
- Isolation is two-level: the pool gives each test **file** its own D1 storage (files run in parallel safely), but within a file tests share one D1, so `beforeEach`/`afterEach` call `cleanD1Tables()` (`test/integration/cleanup.ts:5–7`).
- An `outboundService` stub replaces the network: `*.modal.run` returns 404 ("Modal is unavailable in integration tests") and the OpenAI device-authorization/token endpoints return canned fixtures that *reject unexpected credentials* — real DO/WebSocket/alarm behavior, zero external calls.
- Shared helpers (`test/integration/helpers.ts`): `initSession` (L169) / `initNamedSession` (L323) POST `/internal/init` through a service binding, `queryDO` (L230) runs SQL against a live DO, `waitForSandboxStatus` (L240), `seedEvents`/`seedMessage` (L262/L290) for timeline fixtures, plus `sqlDatabase()` adapting the D1 binding and a 2 s integration WS timeout constant.

These suites pin the invariants unit mocks can't: prompt-enqueue/queue-cap races, sandbox WS admission fences, DO eviction recovery, scheduler admission/idempotency/auto-pause arithmetic, autofix feedback store behavior, PR-lifecycle monotonicity.

## Python: pytest suites that read the other plane

`cd packages/modal-infra && pytest tests/ -v` and the same for `packages/sandbox-runtime` (pytest + pytest-asyncio; ruff for lint/format per `ruff.toml`, wired into `lint-staged` and `ci-python.yml`). 16 modal-infra files cover the FastAPI contract (auth-before-validation, strict types, no-clone-token-on-create, restore forwards `session_config` verbatim); ~58 sandbox-runtime files cover supervisor restart budgets, boot-mode matrices, bridge reconnect/ack semantics, credential-helper scoping, and multi-repo workspace rules. Two notable patterns:

1. **Cross-language contract tests.** `tests/test_build_sandbox_lifecycle.py:44–57` literally `read_text()`s `packages/shared/src/types/integrations.ts` and regex-extracts `DEFAULT_BUILD_TIMEOUT_SECONDS`/`MAX_BUILD_TIMEOUT_SECONDS`, asserting Python equality; the same file pins callback-env names against the shared manifest `sandbox_runtime/image_build_callback_env.json` (with an *intended* divergence between the TS and Python scrub sets, asserted explicitly). `test_runtime_manifest.py:4–9` asserts `CACHE_BUSTER == RUNTIME_VERSION` and generation/minimum coherence. This is why `ci-python.yml`'s path filters include two TypeScript files and the Modal deploy script — drift fails CI, not production (`operations/deployment.md`).
2. **Dogfooding isolation fixture.** `tests/conftest.py` (L13–26, autouse) redirects the runtime's fixed paths (`/tmp/oi-repo-manifest.json`, boot warnings, tunnel env) per test because this suite routinely runs *inside a live Open-Inspect sandbox working on this repo* — a test driving a real supervisor would otherwise clobber the live session's manifest and break its push targeting.

## Boundary lint tooling

- `npm run lint` (ESLint + Prettier + Knip dead-code check) includes the guardrails that double as architecture: the `env.DB` member-access ban in control-plane (`eslint.config.js:133–151`) and session boundary rules.
- **Tests that lint synthetic source**: web's `client-auth-boundary-eslint.test.ts` / `server-auth-boundary-eslint.test.ts` run ESLint over in-memory fixtures to ban raw `fetch` and auth frameworks; shared's `module-boundaries.test.ts` (AST-driven barrel/cycle bans) is itself part of the suite.
- `npm run lint:complexity` (`scripts/lint-complexity.mjs`) is a *reporting* pass: it runs ESLint's `complexity` rule over `packages/**`, splits production vs test findings, prints a top-25 hotspot table (threshold 20) and a distribution over [10,15,20,30,50]; its message parser has its own test (`npm run test:lint-complexity`).

## Choosing the right check when contributing

| Changed | Run |
| --- | --- |
| any shared schema/type | `npm run build -w @open-inspect/shared && npm test -w @open-inspect/shared` then dependent packages |
| control-plane session/queue/lifecycle logic | `npm test -w @open-inspect/control-plane` (units) **+** `npm run test:integration -w @open-inspect/control-plane` (the workerd suites are where DO/SQL/alarm truth lives) |
| web UI/hooks/routes | `npm test -w @open-inspect/web` |
| bots | `npm test -w @open-inspect/{slack-bot,github-bot,linear-bot}` |
| modal-infra or sandbox-runtime | `pytest tests/ -v` + `ruff check --fix && ruff format` in the package |
| contract constants between planes | both suites — the Python reader-tests fail on TS-only edits |
