---
type: testing-overview
title: Testing Conventions
description: How Open-Inspect tests are organized and run — co-located Vitest unit tests, the control-plane workerd integration pool (Miniflare + real D1 with shared-instance cleanup), Python pytest suites for modal-infra and sandbox-runtime, module-boundary and cyclomatic-complexity checks, and the shared test helpers that make each suite work.
tags: [testing, vitest, workerd, miniflare, d1, pytest, pytest-asyncio, ruff, module-boundaries, lint-complexity, ci]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-3f197f718c93b8f921c33d1b
    resource: repo://.github/workflows/ci-python.yml
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-76ae912eac834cb396767f72
    resource: repo://packages/control-plane/Dockerfile.test
  - id: openwiki-source-8207def63e0d42ebbdef131a
    resource: repo://packages/control-plane/package.json
  - id: openwiki-source-228bee527c0473d9ce35b4b1
    resource: repo://packages/control-plane/src/background-tasks.test-support.test.ts
  - id: openwiki-source-d2fc007eee0cf9d358d38e6b
    resource: repo://packages/control-plane/src/background-tasks.test-support.ts
  - id: openwiki-source-c4619f89e26da4afa695acf5
    resource: repo://packages/control-plane/src/router.test-support.ts
  - id: openwiki-source-2dd23e2f739aa003e42b413e
    resource: repo://packages/control-plane/test/integration/apply-migrations.ts
  - id: openwiki-source-c7d0668458480b0d2499201c
    resource: repo://packages/control-plane/test/integration/cleanup.ts
  - id: openwiki-source-71e81ce4cf8561d5caee90ad
    resource: repo://packages/control-plane/test/integration/durable-object-eviction.test.ts
  - id: openwiki-source-b863ae2b9db1a7030ccce749
    resource: repo://packages/control-plane/test/integration/env.d.ts
  - id: openwiki-source-e76d3951af5b8b0e7ba66df8
    resource: repo://packages/control-plane/test/integration/google-id-token.ts
  - id: openwiki-source-d2e7fb65fbaf2c80ce9d30e0
    resource: repo://packages/control-plane/test/integration/helpers.ts
  - id: openwiki-source-943d4104d5415ff0d1667f2e
    resource: repo://packages/control-plane/test/integration/identity-seed-helpers.ts
  - id: openwiki-source-75ec625e1345e875fc2f9cc5
    resource: repo://packages/control-plane/test/integration/image-build-helpers.ts
  - id: openwiki-source-52e79f6d60680ff9c65ecd81
    resource: repo://packages/control-plane/test/integration/run-helpers.ts
  - id: openwiki-source-815761aaaace62eca8f31020
    resource: repo://packages/control-plane/test/integration/session-do-access.ts
  - id: openwiki-source-8ebf032ecc7a54a9d08a6aca
    resource: repo://packages/control-plane/test/integration/tsconfig.json
  - id: openwiki-source-ddfb56abefc4e0ab5084e835
    resource: repo://packages/control-plane/test/integration/worker-fetch.test.ts
  - id: openwiki-source-4f8f91a5dbcb8b60ce998531
    resource: repo://packages/control-plane/vitest.config.ts
  - id: openwiki-source-a1aafae6c2c67594dd82b5c1
    resource: repo://packages/control-plane/vitest.integration.config.ts
  - id: openwiki-source-6280f60dc37d39f1e28b6fd5
    resource: repo://packages/control-plane/wrangler.jsonc
  - id: openwiki-source-f3a82cef9b6d1cf3a15226ef
    resource: repo://packages/github-bot/vitest.config.ts
  - id: openwiki-source-b2a4bdf08452239c6f41ca6c
    resource: repo://packages/modal-infra/pyproject.toml
  - id: openwiki-source-0787c6cc857607a06b818031
    resource: repo://packages/modal-infra/tests/test_sandbox_launch.py
  - id: openwiki-source-246f8d2dfe4333ff6b647199
    resource: repo://packages/sandbox-runtime/pyproject.toml
  - id: openwiki-source-85a0abeb27a76547af37d0cd
    resource: repo://packages/sandbox-runtime/tests/conftest.py
  - id: openwiki-source-15b2cb6a90baaa5b5ae81a15
    resource: repo://packages/sandbox-runtime/tests/runtime_helpers.py
  - id: openwiki-source-a527d2c54bf55e6948b659b1
    resource: repo://packages/shared/src/module-boundaries.test.ts
  - id: openwiki-source-d3a155cacc03da9040e3f415
    resource: repo://packages/web/src/lib/client-auth-boundary-eslint.test.ts
  - id: openwiki-source-d763dfe33a2468865a9b9ce5
    resource: repo://ruff.toml
  - id: openwiki-source-c5051c9d3020fea8586cf18d
    resource: repo://scripts/lint-complexity-message.test.mjs
  - id: openwiki-source-841a29faf6eafcc300fd288d
    resource: repo://scripts/lint-complexity.mjs
  - id: openwiki-source-b6f224d26b4ec604e90101e3
    resource: repo://vitest.workspace.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Testing Conventions

Open-Inspect splits testing by ecosystem and runtime fidelity. TypeScript packages use **Vitest**; Python packages use **pytest** (with **pytest-asyncio** in `asyncio_mode = "auto"`). The control plane runs two distinct suites: fast Node-environment unit tests co-located under `src/**/*.test.ts`, and a workerd integration pool (`@cloudflare/vitest-pool-workers` + Miniflare) exercising the real Worker entrypoint with real D1 bindings, Durable Objects, queues, and WebSockets. Structural checks — shared-package module boundaries and a cyclomatic-complexity report — run as tests/lint gates, and GitHub Actions CI (`ci.yml` for TypeScript, `ci-python.yml` for Python) executes lint, typecheck, and the test suites on every push and PR.

## Package test layout

| Package | Framework | Unit-test location | Integration tests | Command |
| --- | --- | --- | --- | --- |
| `shared` | Vitest | `src/**/*.test.ts` (node) | — | `npm test -w @open-inspect/shared` |
| `control-plane` | Vitest | `src/**/*.test.ts` (node) | `test/integration/**/*.test.ts` (workerd) | `npm test -w @open-inspect/control-plane`, `npm run test:integration -w @open-inspect/control-plane` |
| `web` | Vitest (+ Testing Library) | `src/**/*.test.{ts,tsx}` (node) | — | `npm test -w @open-inspect/web` |
| `github-bot` | Vitest | `src/**/*.test.ts` plus `test/**/*.test.ts` | — | `npm test -w @open-inspect/github-bot` |
| `slack-bot`, `linear-bot` | Vitest | `src/**/*.test.ts` | — | `npm test -w @open-inspect/slack-bot` / `-w @open-inspect/linear-bot` |
| `modal-infra` | pytest | `tests/test_*.py` | — | `pytest tests/ -v` (from `packages/modal-infra`) |
| `sandbox-runtime` | pytest + `node:test` | `tests/test_*.py`, plus `tests/*.test.mjs` | — | `pytest tests/ -v`, `node --test tests/*.test.mjs` |

The root `vitest.workspace.ts` is just `defineWorkspace(["packages/*/vitest.config.ts"])`, so every package's Vitest config participates in monorepo-wide runs; `npm test` at the root fans out to all workspaces. Node 22 is the minimum (root `engines`), and CI runs all TypeScript jobs on Node 22 with the npm cache.

## Control-plane unit tests (Node)

`packages/control-plane/vitest.config.ts` runs `src/**/*.test.ts` in the plain Node environment, excluding `src/index.ts` from coverage. The suite is dominated by router tests (`router.*.test.ts` — create-session, spawn-child, policy, auth, scm-credentials, analytics, autofix, session-prompt) plus env validation, media, queue routing, and worker-build tests.

The router suites share two contract-faithful test doubles:

- `src/router.test-support.ts` — `signedServiceRequest(url, init)` builds a service-authenticated `Request` via `buildServiceAuthHeaders` from `@open-inspect/shared/service-auth`. Because sig1 binds method, URL, and body, **every request is signed individually**; there is no reusable `Authorization` header. `TEST_SERVICE_SECRETS` maps `SERVICE_AUTH_SECRET_<SERVICE>` to `test-service-secret-<service>` and must match the same values the integration pool injects, so unit and integration suites exercise the identical credential material.
- `src/background-tasks.test-support.ts` — `createTestBackgroundTasks()` is a behaviorally identical double for the `BackgroundTasks` platform port (`src/platform-ports.ts`): `submit` invokes the factory synchronously, absorbs synchronous throws *and* async rejections into a `failures` list while recording `submissions`, and `settle()` drains everything. `background-tasks.test-support.test.ts` pins the double to the production contract, and `router.test-support.ts` exports one shared `TEST_BACKGROUND_TASK_CONTEXT` instance for the router suites.

Unit tests that need D1 stores typically `vi.mock` the store module (`SessionIndexStore`, `UserStore`, `resolveManagedSkills`, `resolveSessionProviderAuth`, `resolveRepoOrError`) instead of providing a database.

## Control-plane integration pool (workerd + real D1)

`packages/control-plane/vitest.integration.config.ts` runs `test/integration/**/*.test.ts` inside a real `workerd` runtime through the `cloudflareTest()` Vite plugin from `@cloudflare/vitest-pool-workers`. Key mechanics:

- **Config mirrors production**: `wrangler.jsonc` is a test-only Worker config declaring the `SESSION` Durable Object, `DB` D1 binding, `REPOS_CACHE` KV, and `MEDIA_BUCKET` R2; `compatibilityDate: "2024-09-23"` and `nodejs_compat` match the Terraform-managed runtime rather than the pool's default runner date. The `Env` environment (`test/integration/env.d.ts`) merges the real worker `Env` with a test-only `TEST_MIGRATIONS` migration list.
- **Real migrations**: the setup file `test/integration/apply-migrations.ts` runs `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` against the real `terraform/d1/migrations/` directory (70 numbered SQL migrations, discovered via `readD1Migrations`), so the test schema is exactly the production schema.
- **Outbound service mocking**: a Miniflare `outboundService` intercepts every outbound request — `*.modal.run` returns 404 ("Modal is unavailable in integration tests"), and OpenAI/xAI device-auth endpoints return canned integration credentials so the device-code flows can complete. Any unexpected outbound URL throws, so tests deliberately cannot silently leak network calls.
- **Static bindings**: all secrets are test values (`SERVICE_AUTH_SECRET_*`, `BROWSER_AUTH_SECRET`, GitHub/Google OAuth client ids), `UNSAFE_ALLOW_ALL_USERS: "true"` bypasses sign-in allowlists, `TOKEN_ENCRYPTION_KEY` / `REPO_SECRETS_ENCRYPTION_KEY` / `PROVIDER_ACCOUNTS_ENCRYPTION_KEY` are freshly generated 32-byte base64 AES keys (the SCM capture route encrypts inline, so a placeholder would fail at runtime), and `TEST_MIGRATIONS` carries the migration list. One queue producer (`IMAGE_BUILD_FINALIZATION_QUEUE`) is registered.
- **Shared D1 instance**: pool-workers isolates D1 storage **per test file** (files run in parallel safely), but within a file every test shares one D1 instance — `test/integration/cleanup.ts` exports `cleanD1Tables()`, a single `env.DB.exec` deleting every application table (plus resetting `skills_catalog_state`), which suites call in `beforeEach`/`afterEach`. DO SQLite state, by contrast, is per-session and reset by creating fresh named sessions per test.
- **Root error filtering**: `onUnhandledError` suppresses Better Auth's expected `APIError` rejections (redirects and `INVALID_TOKEN`) when they originate inside `better-auth/dist/api/routes/`, since the pool would otherwise report the library's intermediate rejection as unhandled.

The integration suite is the largest body of tests in the repo (95+ files) and covers the observable surface end to end through `SELF.fetch`: auth/sign-in, WebSocket client and sandbox protocols, session lifecycle and DO eviction, scheduler and automation runs, image builds, provider accounts, managed skills, webhooks, D1 migrations themselves (`migration-0057-consolidation.test.ts`, `migration-0059-*`, `migration-0066-*`, `migration-0068-*`), commit signing, media, secrets, and more.

### Helpers: `test/integration/helpers.ts`

The shared helper module is the primary authoring API for integration tests:

- `initSession(overrides)` — creates a production-shaped session: first a `SessionIndexStore.create` row in D1, then `POST /internal/init` to the `SESSION` Durable Object stub (`env.SESSION.idFromName(sessionName)`); returns `{ stub, id, sessionName }`. `initNamedSession(name, overrides)` seeds the D1 row with a caller-chosen name (and spawn metadata: `parentSessionId`, `spawnSource`, `spawnDepth`); `initNamedSessionDO` creates only the DO. Tests needing custom init rows pass `repoOwner`, `repoName`, `repoId`, `model`, `providerAuth`, etc.
- `serviceFetch(url, init)` — fetches a route with production-equivalent credentials: sig1 built per request with `test-service-secret-<service>`, plus (for the web service) a real Better Auth user/session row and an HMAC-signed `__Secure-openinspect.session_token` cookie (`testBrowserSessionCookie` seeds `users`, `user_identities`, `auth_sessions`). Other services carry only their service credential.
- `queryDO(stub, sql, ...params)` — runs SQL against the DO's SqlStorage via `runInDurableObject`, returning `state.storage.sql.exec(...)` rows; used with `waitForSandboxStatus` to poll the `sandbox` table.
- `seedEvents(stub, events)` / `seedMessage(stub, msg)` — insert events/messages directly into DO SQLite with correct `timeline_sequence` sequencing.
- `seedSandboxAuth(stub, { authToken, sandboxId, status })` / `seedSandboxAuthHash` — bring a session's sandbox into a deterministic auth-ready state: first `waitForSandboxStatus(stub, "failed")` so the always-failing test provider spawn cannot clobber the seeded row, then `UPDATE sandbox SET auth_token(_hash) = hashToken(token), modal_sandbox_id = ..., status = 'ready'`.
- WebSocket helpers — `collectMessages(ws, { until, timeoutMs })` collects JSON frames until a predicate (start listening *before* sending the triggering message); `openClientWs(sessionName)` upgrades via `SELF.fetch` through the full worker routing path, and with `subscribe: true` generates a WS token through the DO, subscribes, and resolves on the `subscribed` replay frame; `openSandboxWs` upgrades as the sandbox data plane with `Authorization: Bearer <token>` and `X-Sandbox-ID`.
- `sqlDatabase(db)` casts the D1 binding to the engine-neutral `SqlDatabase` port and `getSetCookies(headers)` bridges workers-types' missing `getSetCookie`.

`test/integration/session-do-access.ts` is the one intentional encapsulation seam: `runInSessionDO(stub, cb)` types the stub as `SessionDO`, `componentsOf(instance)` reaches the private `runtime` accessor (which initializes on first touch) to expose the component graph behind `SessionRuntime.internals`, and `getUserEnvVars(stub)` invokes the real user-env resolver — the note there warns that renaming the DO's private `runtime` accessor surfaces only as runtime `TypeError`s across the suite, because the seam is hand-synced. Domain helpers also exist per area: `run-helpers.ts` (raw automation-run row seeding/reading), `identity-seed-helpers.ts` (canonical identity rows at a fixed timestamp), `image-build-helpers.ts` (environment and `image_builds` row seeds), `google-id-token.ts` (real RS256-signed Google ID tokens).

Execution assertions matter as much as seeding: `abandoned-draft-sweep`, `scheduler`, `automation-invocations`, and `image-build-*` suites drive `runDurableObjectAlarm` / cron paths; `durable-object-eviction.test.ts` forces eviction with `state.abort()` and reconstructs sockets from their persisted `wsid` tags to prove WebSocket state survives eviction; `worker-fetch.test.ts` covers routing basics (404, CORS preflight, `/health`, correlation headers) through `SELF.fetch`.

## Python suites (pytest + pytest-asyncio)

Both Python packages set `[tool.pytest.ini_options] asyncio_mode = "auto"`, so async tests run without explicit markers, and `[tool.ruff]` extends the repo root `ruff.toml` (target-version py312, line-length 100, rule set including pyflakes/isort/bugbear/comprehensions/pyupgrade/type-checking). Linting is `ruff check --fix && ruff format` for Python files.

`packages/sandbox-runtime/tests/` is the deep Python suite (60+ files) exercising the runtime that runs inside sandboxes: the agent bridge (SSE, ack, message tracking, reconnection, push, diff capture, event buffering, git identity, stop), supervisor lifecycle and monitoring, prompt stream, diff collector, credential helper, git signing, managed skills, MCP, media tools, repo sync/config, tool installation, and the Modal image-build entrypoint paths. Its `conftest.py` provides:

- `isolate_runtime_file_paths` (autouse) — monkeypatches the runtime's fixed file paths (`REPO_MANIFEST_FILE_PATH`, `BOOT_WARNINGS_FILE_PATH`, `TUNNEL_ENV_FILE_PATH`) to per-test `tmp_path` locations. This suite routinely runs **inside a live Open-Inspect sandbox** (agents dogfooding the repo), where `/tmp/oi-repo-manifest.json` is the running session's real manifest; without the backstop, a test driving a real `SandboxSupervisor` would overwrite live session state.
- `wire_opencode_transport(bridge, http_client)` — rebuilds `bridge.opencode_client` around a fake HTTP transport, resets the lazy prompt stream, and stashes the fake on `bridge.http_client` so tests script responses.
- `MockResponse`, `oc_message_id(timestamp_ms, counter)` — deterministic OpenCode message IDs so boundary tests can place IDs immediately before/at/after a prompt's user message.
- `runtime_helpers.py` — `make_supervisor()` and friends construct real runtime objects with a synthetic env and a `tmp_path` workspace.

`packages/modal-infra/tests/` covers the Modal/FastAPI layer: sandbox launch matrices (`test_sandbox_launch.py` parametrizes base/repository/snapshot image sources, monkeypatching `modal.Sandbox.create`), web API endpoints, env-var plumbing, tunnel ports, code server/ttyd/VNC setup, deploy, and snapshot timeouts. Secrets and Modal handles are always monkeypatched; no test talks to Modal or the network.

`sandbox-runtime` also ships `tests/*.test.mjs` (`get-child-status-format`, `provider-token-broker`, `send-child-prompt`) run with `node --test` in CI against the compiled `.js` artifacts.

## Module-boundary and lint-complexity checks

Two structural checks run as part of the TypeScript workflow:

- `packages/shared/src/module-boundaries.test.ts` — a Vitest suite that parses every production module under `packages/shared/src` with the TypeScript compiler API and asserts: (1) implementation modules never import the package-root barrel (`index.ts`) or the `types/index.ts` barrel (nor `@open-inspect/shared` directly), which keeps consumers on explicit deep imports; (2) no runtime dependency cycles; (3) no compile-time dependency cycles. A separate `describe` unit-tests the dependency collector itself (import-type expressions must be compile-time-only), using the `__dependency_fixture__` directory. Related ESLint-enforced boundaries live in other packages (e.g. web's `client-auth-boundary-eslint.test.ts` runs ESLint in-process to pin `no-restricted-imports`/`no-restricted-globals` rules).
- `scripts/lint-complexity.mjs` (`npm run lint:complexity`) — runs ESLint's `complexity` rule in classic variant (config `max: 0`) across `packages/**/*.{ts,tsx}` with `ruleFilter` isolating that rule, and reports function-level cyclomatic complexity: production and test distributions (>10/15/20/30/50), and production hotspots above 20. Test files are excluded from the hotspot table and findings are **report-only** — they never affect the exit code. `--json` emits the machine-readable report; `scripts/lint-complexity-message.mjs` parses the diagnostic (message id `complex`, pattern `complexity of (\d+)`) and is itself pinned by `scripts/lint-complexity-message.test.mjs`, which CI runs as `npm run test:lint-complexity`.

## CI wiring and required local checks

CI (`.github/workflows/ci.yml` , `.github/workflows/ci-python.yml`) runs on push to `main` and PRs touching relevant paths. TypeScript jobs: ESLint, `test:lint-complexity`, Prettier check, Knip, `typecheck` (which **builds `@open-inspect/shared` first** because dependents import it at build time), web build, shared + control-plane unit tests, control-plane integration tests **sharded in two** (`--shard=1/2`, `--shard=2/2`), web tests, and bot tests. Python jobs: Ruff lint + format check for `sandbox-runtime` and the provider packages, pytest for both, and `node --test tests/*.test.mjs` for the runtime's JS tests. MyPy runs but with `continue-on-error`. The integration pool's `Dockerfile.test` is an alternative containerized path: it copies shared + control-plane + `terraform/d1/migrations/`, builds shared, and runs `test:integration`.

Before considering a change complete: build `@open-inspect/shared` first (typecheck and integration tests need its dist), run `npm run typecheck`, `npm run lint:complexity`, the package's unit tests, the control-plane integration suite when the change touches routing/stores/DO behavior, and `ruff check --fix && ruff format` for Python. The suite's own conventions encode the known hazards: shared-D1 cleanup in `beforeEach`/`afterEach`, `cleanD1Tables()` rather than assuming isolation, deterministic seeding instead of live network, and never letting a test spawn a real sandbox (the integration `outboundService` makes Modal calls fail fast, and sandbox tests explicitly `waitForSandboxStatus(stub, "failed")` before seeding auth state).
