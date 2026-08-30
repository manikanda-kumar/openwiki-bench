---
type: data-model
title: D1 Data Model and Migrations
description: The control plane's shared D1 database — session index, repo metadata and encrypted secrets, environments, image builds, automations, Better Auth tables, provider accounts, and managed skills — plus the migration numbering convention and the env.DB access guardrail.
tags: [d1, database, migrations, durable-objects, data-model]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-276795f6d5ad19adb078c64e
    resource: repo://eslint.config.js
  - id: openwiki-source-3a7ac9f1def780bcacf7f603
    resource: repo://packages/control-plane/src/db/automation-store.ts
  - id: openwiki-source-475734dc9ffe03d69d908b54
    resource: repo://packages/control-plane/src/db/scoped-secrets.ts
  - id: openwiki-source-ad15a302aac7be1dd07e9481
    resource: repo://packages/control-plane/src/db/session-index.ts
  - id: openwiki-source-f49c3ab49317a2ad215805d3
    resource: repo://packages/control-plane/src/routes/shared.ts
  - id: openwiki-source-b5e52d398550648420138d80
    resource: repo://packages/control-plane/src/session/schema.ts
  - id: openwiki-source-f1227299a054c9ff35745daa
    resource: repo://scripts/d1-migrate.sh
  - id: openwiki-source-e9fa301d4d038e3a194c2f37
    resource: repo://terraform/d1/migrations/0002_create_session_index.sql
  - id: openwiki-source-47faa7109d4e4c4bca451bd7
    resource: repo://terraform/d1/migrations/0004_create_global_secrets.sql
  - id: openwiki-source-f8dd01467907e9b2c90dc26a
    resource: repo://terraform/d1/migrations/0030_automation_repositories_and_invocations.sql
  - id: openwiki-source-f1ab679ba605d6cf7b8d8d09
    resource: repo://terraform/d1/migrations/0045_api_tokens_family_expiry_index.sql
  - id: openwiki-source-8e050d031253c39b0c54bf0a
    resource: repo://terraform/d1/migrations/0047_terminal_browser_auth.sql
  - id: openwiki-source-cd1a3e41b410fe02bf76abab
    resource: repo://terraform/d1/migrations/0061_managed_skills.sql
  - id: openwiki-source-eed9efded4c4e19279a84fcd
    resource: repo://terraform/d1/migrations/0064_provider_accounts.sql
  - id: openwiki-source-ca32cc2da6748302c6ab7063
    resource: repo://terraform/environments/production/d1.tf
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Cloudflare **D1** holds everything the system must query *across* sessions; the per-session Durable Objects hold everything scoped to one session (messages, events, artifacts, participants, sandbox state) in their own SQLite (see [Session Durable Object](/openwiki/control-plane/session-durable-object.md)). As a rule of thumb: if a list page, a scheduler tick, or a boot-time resolver needs it, it's in D1.

## Migrations and application flow

Migrations are plain SQL files in `terraform/d1/migrations/`, named `NNNN_description.sql`; **69 files** currently occupy versions 0001–0070 with **0046 missing** (a deliberate historical gap: 0044/0045 → 0047). Because wrangler dedupes by numeric prefix against `_schema_migrations`, `scripts/d1-migrate.sh` fails fast on a prefix-less file *or* two files sharing a prefix — the documented hazard being two PRs each grabbing "the next number" so one migration is silently skipped forever (`scripts/d1-migrate.sh:9–35`). Terraform applies them through a `null_resource` whose trigger is the sha256 of every migration file, so any edit re-runs `d1-migrate.sh` (`terraform/environments/production/d1.tf:14–33`).

## Access discipline

Production code never touches the raw `env.DB` binding. The router wraps it per request with `instrumentD1` (`db/instrumented-d1.ts`) — collecting query counts and timing for every `http.request` log — and passes the engine-neutral `SqlDatabase` (`db/sql-database.ts`) as `ctx.db`. An ESLint `no-restricted-syntax` rule bans any `.DB` member access under `packages/control-plane/src` except the three composition roots (router + two DO constructors), each carrying an inline disable with justification (`eslint.config.js:133–151`; the contract is also documented on `RequestContext` in `routes/shared.ts:24–33`).

## Table groups

**Sessions index** — `sessions` (0002; later columns for user_id, environment_id, automation_id/run_id, spawn_depth/root_session_id 0063, terminal-message projections), `session_repositories` (0032), `session_pull_requests` (0041/0042, the PR-state authority mirrored into the DO), read-state/inbox joins (`db/session-read-state.ts`, `session-inbox-store.ts`). `SessionIndexStore.getVisibleForUser` *ignores the user argument* — the code states the single-tenant visibility boundary explicitly (`db/session-index.ts:660–662`); there is no per-user repo access validation.

**Repos, environments, secrets** — `repo_metadata` (0001/0036, including `defaultEnvironmentId` and `channelAssociations`), `environments` + `environment_repositories` (0033/0035, ordered repo sets), and three encrypted secret scopes: `repo_secrets` (0001), `global_secrets` (0004), `environment_secrets` (0033). All scopes encrypt with `REPO_SECRETS_ENCRYPTION_KEY` (AES-256-GCM) through shared plumbing in `db/scoped-secrets.ts`; MCP server secrets use the same key.

**Image builds** — the unified `image_builds` table (0039; plus finalization-lease/cleanup columns 0052/0053) storing status (`building|ready|failed|superseded`), fingerprint, bound provider session, callback-token hash, and per-repo `repository_shas`; `repo_images`/settings come from earlier migrations (0009/0010).

**Automations** — `automations` (0013) plus `automation_repositories` (0030), `automation_environments` (0037), `automation_invocations` and `automation_runs` (0030/0031 rebuild; 0059 makes `invocation_id` NOT NULL). Invocation status is *derived* by one shared SQL expression (`DERIVED_INVOCATION_STATUS_SQL`, `db/automation-store.ts`), never stored. 0030/0031 are the multi-repo rewrite the docs warn is not code-revertible without a DB restore.

**Users and auth** — legacy `users`/`user_identities` (0019), `verified_email_claims` (0047), the Better Auth core tables `auth_users/auth_sessions/auth_accounts/auth_verifications` (0048–0049), `user_scm_tokens` (0008, `TOKEN_ENCRYPTION_KEY`), and the retired `api_tokens` removals (0050/0051). Identity-claim machinery lives in `db/identity-claim-store.ts`; user merges are supported by the operator script `scripts/merge-split-users.ts`.

**Provider accounts** — `model_provider_accounts`, `..._credentials`, `..._defaults`, `session_model_provider_auth`, `automation_model_provider_auth` (0064), authorizations/attempts (0065/0068); credentials encrypt with the separate `PROVIDER_ACCOUNTS_ENCRYPTION_KEY`, and the session/automation auth rows are the authority for which account a session consumes (see [Auth and Secrets](/openwiki/control-plane/auth-and-secrets.md)).

**Managed skills** — `skills`, `skill_revisions`, `skill_revision_files`, `skill_assignments` (global/repository/environment scopes with partial-unique indexes), `skill_profiles`/`skill_profile_items`, and per-session pins `session_skill_manifests`/`session_skill_revisions` (all in 0061; git-import provenance in 0069). Sessions pin revision hashes, so restores never pick up later edits.

**Misc** — `model_preferences` (0006), `integration_settings` + per-repo/per-environment bindings (0007 + later, resolved through a three-layer merge in `db/integration-settings.ts`), `mcp_servers`/`mcp_server_revisions` (0062), `commit_signing_configuration` (0043), `keyboard_shortcut_preferences` (0067), `pr_autofix_feedback` delivery receipts (0070), `child_admission_leases` (0058), and analytics event stores.

## D1 vs DO SQLite

| | D1 | DO SQLite |
| --- | --- | --- |
| Scope | installation-wide, queryable across sessions | one session, strongly consistent |
| Ownership | stores (`src/db/*.ts`) | repositories over `SqlStorage` (`src/session/*-repository.ts`) |
| Consistency | best-effort projection from the DO (e.g. title, terminal message) | authoritative for session lifecycle & events |
| Secrets | encrypted values under two keys | participant tokens, sandbox access credentials |

The DO is the source of truth for its session; D1 rows like `sessions` and `session_pull_requests` are indexes/projections that must never out-truth it — terminal-state writes and PR lifecycle events are monotonic and CAS-guarded to keep projections convergent.
