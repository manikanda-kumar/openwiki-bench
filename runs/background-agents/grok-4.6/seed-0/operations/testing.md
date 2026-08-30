---
type: operations
title: Testing Strategy
description: Vitest versus pytest layouts, control-plane Node unit tests versus workerd/D1 integration tests, shared-package build order, and duration-unit conventions.
tags: [testing, vitest, pytest, miniflare, d1]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-8207def63e0d42ebbdef131a
    resource: repo://packages/control-plane/package.json
  - id: openwiki-source-2dd23e2f739aa003e42b413e
    resource: repo://packages/control-plane/test/integration/apply-migrations.ts
  - id: openwiki-source-c7d0668458480b0d2499201c
    resource: repo://packages/control-plane/test/integration/cleanup.ts
  - id: openwiki-source-4f8f91a5dbcb8b60ce998531
    resource: repo://packages/control-plane/vitest.config.ts
  - id: openwiki-source-a1aafae6c2c67594dd82b5c1
    resource: repo://packages/control-plane/vitest.integration.config.ts
  - id: openwiki-source-f3a82cef9b6d1cf3a15226ef
    resource: repo://packages/github-bot/vitest.config.ts
  - id: openwiki-source-b2a4bdf08452239c6f41ca6c
    resource: repo://packages/modal-infra/pyproject.toml
  - id: openwiki-source-724ba67bb21fc9cccfb2cf7a
    resource: repo://packages/slack-bot/vitest.config.ts
  - id: openwiki-source-a1be692c9fc24885e83e7d07
    resource: repo://packages/web/vitest.config.ts
  - id: openwiki-source-b6f224d26b4ec604e90101e3
    resource: repo://vitest.workspace.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Testing Strategy

TypeScript packages use **Vitest**. Python packages use **pytest** + pytest-asyncio. CI on every push and PR runs lint, typecheck, and those suites. Build `@open-inspect/shared` first whenever types change — other packages import it at build time, and CI jobs always `npm run build -w @open-inspect/shared` before typecheck or tests.

Commands live in `AGENTS.md` and `CONTRIBUTING.md`. Related: [Control Plane](/openwiki/architecture/control-plane.md), [Shared Contracts](/openwiki/architecture/shared-contracts.md), [Deployment and Operations](/openwiki/operations/deployment.md).

## Duration units

Python timeouts are **seconds** (`timeout_seconds`, Modal `timeout=`). TypeScript timeouts are **milliseconds** (`timeoutMs`, `INACTIVITY_TIMEOUT_MS`, `_MS` suffixes). Never use a bare `timeout`. Define each default once as a named constant. Tests should follow the same units as the code under test.

## Package layout

Root `vitest.workspace.ts` loads `packages/*/vitest.config.ts`. `npm test` runs workspace tests `--if-present`.

| Package | Runner | Files | Environment |
| --- | --- | --- | --- |
| `shared` | Vitest | co-located `src/**/*.test.ts` | Node |
| `control-plane` unit | Vitest (`vitest.config.ts`) | `src/**/*.test.ts` | Node |
| `control-plane` integration | Vitest (`vitest.integration.config.ts`) | `test/integration/*.test.ts` | workerd / Miniflare + real D1 |
| `web` | Vitest | `src/**/*.test.{ts,tsx}` | Node |
| `slack-bot`, `linear-bot` | Vitest | `src/**/*.test.ts` | Node |
| `github-bot` | Vitest | `src/**/*.test.ts` **and** `test/**/*.test.ts` | Node |
| `modal-infra` (and other Python infra) | pytest | `tests/test_*.py` | CPython 3.12, asyncio auto |
| Terraform | `terraform test` | `terraform/environments/production/tests/*.tftest.hcl` | Terraform workflow |

```bash
npm test -w @open-inspect/control-plane
npm run test:integration -w @open-inspect/control-plane
npm test -w @open-inspect/web
npm test -w @open-inspect/github-bot
cd packages/modal-infra && pytest tests/ -v
```

Control-plane `package.json` maps `test` → default Vitest (unit) and `test:integration` → `--config vitest.integration.config.ts`. Do not mix the two configs.

## Control-plane unit vs integration

**Unit tests** (`packages/control-plane/vitest.config.ts`) run in Node, include only `src/**/*.test.ts`, and are the fast path for stores, scheduler logic, route helpers, and sandbox clients that can be mocked.

**Integration tests** run inside a real **workerd** runtime via `@cloudflare/vitest-pool-workers` `cloudflareTest()`. They load `packages/control-plane/wrangler.jsonc`, apply D1 migrations from `terraform/d1/migrations/` (`readD1Migrations` + setup file `test/integration/apply-migrations.ts`), and talk to Durable Objects and D1 the way production does.

Pool-workers isolates D1 **per test file**, so files can run in parallel. **Within a file**, tests share one D1 instance. Call `cleanD1Tables()` in `beforeEach`/`afterEach` (`test/integration/cleanup.ts`) or you will leak automations, sessions, and users across cases.

Helpers in `test/integration/helpers.ts`: `initSession()`, `queryDO()`, `sqlDatabase()`, browser-session cookies, service-auth headers. Integration tests that need a session Durable Object go through `initSession` rather than constructing SQLite by hand.

Miniflare outbound fetches are **fail-closed** except for stubbed Modal 404s and OpenAI/xAI device-auth token endpoints. Unexpected URLs throw.

CI shards integration tests `--shard=1/2` and `2/2` with `fail-fast: false`.

## Python

`packages/modal-infra/pyproject.toml` sets `asyncio_mode = "auto"`. Run `pytest tests/ -v` from that package. Lint with `ruff check --fix && ruff format`. CI workflow `.github/workflows/ci-python.yml` lints sandbox-runtime and provider infra and runs pytest for those packages.

## Contributor conventions

- Prefer focused tests next to the code they lock (or `test/integration` when the assertion needs workerd/D1).
- Shared schema or type changes: build shared, then run the consuming package's tests.
- Control-plane D1 schema changes: add a migration; integration tests apply the full set automatically.
- Do not hit live Modal/GitHub from tests; integration outbound stubs will throw.
- Conventional commits; keep the subject under 72 characters.

## CI surface

`.github/workflows/ci.yml`: ESLint, Prettier, Knip, typecheck (after shared build), web build, shared + control-plane unit, sharded control-plane integration, web tests, bot package tests. `.github/workflows/terraform.yml` runs `terraform fmt`, `validate`, and selected `terraform test` filters.

## Focused tests of the test harness

- Integration cleanup and helpers: `packages/control-plane/test/integration/cleanup.ts`, `helpers.ts`
- Integration config / luxon CJS pin: `packages/control-plane/vitest.integration.config.ts`
- Workspace membership: `vitest.workspace.ts`
