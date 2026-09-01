---
type: operations
title: Change guides for common maintenance tasks
description: Step-by-step recipes for the changes this repo sees most often — adding a gatekeeper, an API method, an agent tool, an admin setting, a format blueprint — and the review rules each one trips.
tags: [change-guide, gatekeepers, api, admin, blueprints, maintenance]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
  - id: openwiki-source-0e72fba2627772fc9fce0daf
    resource: repo://scripts/run-dev-server.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Change guides for common maintenance tasks

These recipes map the recurring maintenance tasks to the exact seams they touch. Each one names the
invariant a reviewer will check, because most of the cost here is in *where* a change lands, not the
change itself.

## Adding a gatekeeper

The repository ships a dedicated skill, `.agents/skills/write-gatekeeper/SKILL.md`, which is the
authoritative walkthrough. Its core contract:

- A gatekeeper is a three-tier Worker: `GatekeeperVendor` (top-level `WorkerEntrypoint`), a
  `GatekeeperUser` per connected account (auth + token storage in an account DO), and a
  `Gatekeeper<Session>` DO class installed as a facet of the workspace's Overseer
  (`SKILL.md:9-14`).
- It must satisfy **seven responsibilities**: auth, API design, fine-grained resource granting,
  logging/approvals, caching, simulation, and observer verification (`SKILL.md:16-30`).
- The flow is two-phase with two **STOP points for operator review**: after designing
  `types.d.ts` (the agent-facing API — "the most important and delicate part") and before Phase 2
  (`SKILL.md:63-69`, `147-149`).

Concrete steps:

1. Create `packages/gatekeeper-<name>/` with `src/<name>.ts` (Vendor/User/Gatekeeper/Session),
   `src/types.d.ts` plus the **symlink** `types.txt -> types.d.ts` (never a copy), an optional
   `<name>-api.ts` HTTP wrapper, and `wrangler.jsonc` (`SKILL.md:75-87`, `325`).
2. Every DO class must appear under `migrations[].new_sqlite_classes` in its wrangler config;
   `WorkerEntrypoint` entrypoints need no migration but must be `export`ed from the main module
   (`SKILL.md:240`, `331`).
3. Bind it: add `{binding: "GATEKEEPER_<NAME>", service: "gatekeeper-<name>", entrypoint:
   "GatekeeperVendor"}` — the backend auto-discovers vendors from `GATEKEEPER_`-prefixed bindings,
   and the router routes `/gatekeeper/<name>/*` from the same binding name (`SKILL.md:89-100`,
   `auth-vendors.ts:3-31`).
4. Resource selection UI: either hand-written `iframeHtml` from
   `GatekeeperUser.startResourceConfigurator()`, or the `@gadgets/configurator-ui` helpers with
   modules in `src/configurator/*-ui.tsx` built by the shared Vite+ task. A new gatekeeper **must
   declare the `build:configurator` / `build:app:dev` tasks in its `vite.config.ts`** or
   `pnpm dev-server` will not build it (`SKILL.md:102-129`; `run-dev-server.ts` selects packages by
   which ones declare the task).
5. Implement observer verification with a strategy per resource type — A (private-only), B (single
   ACL unit), C (data-set tracking), D (low-stakes) — using the verifier "non-standard method"
   pattern; `getVerifier()`/`addObserver()`/`removeObserver()` are mandatory to type-check
   (`SKILL.md:195-251`, `334`).
6. **Deploy-wizard trap**: a gatekeeper that takes no third-party OAuth app credentials belongs in
   `NO_DEFAULT_CRED_INPUTS` in `scripts/release/manifest-lib.ts:260` — a spurious default
   `CLIENT_ID`/`CLIENT_SECRET` input makes it uninstallable, because the wizard blocks Install on
   unfilled secret inputs (`REVIEW.md:90-92`).

Reference implementations named by the skill: Google (all three observer strategies), Email
(hook-based push, strategy D), GitHub (clean strategy B), Supabase/Linear/Notion (strategy C
variants) (`SKILL.md:336-343`).

## Adding a method to the workshop-shared API

1. Declare the method on the right interface in `packages/workshop-shared/src/api.ts` (or
   `gatekeeper.ts` for gatekeeper-facing APIs) **with a complete doc comment** — every exported
   member of the public API needs one, types/consts/functions included (`REVIEW.md:14-15`).
2. If it can fail in ways the client must distinguish, add a coded-error family or reuse one;
   codes must stay stable because messages double as the classification fallback for older
   deployments (`api.ts:298-357`).
3. Implement it on the backend (`server.ts` for `AuthenticatedApi`, `overseer.ts` for `Overseer`
   and workpiece clients). `@validateRpc()` already on those classes picks up the new signature
   automatically; do not write redundant runtime checks for what the validator covers.
4. **Access control by construction**: for `Overseer`, remember that `UseOverseerInterface`
   `implements Overseer` and throws `Unauthorized` for everything outside the use allowlist — a new
   method fails to compile until you consciously decide whether `use` collaborators may call it
   (default-deny) (`docs/sharing.md:30`).
5. Never mint a gatekeeper capability on a new path without routing through
   `UserDurableObject.getGatekeeperClassFor()` — it is the single chokepoint where disabled
   gatekeepers and resources are enforced (`REVIEW.md:29-32`, `user.ts:1666-1691`).
6. Build: `pnpm build` (which is `types:check`); lint: `pnpm lint`. Split kernel changes by concern
   so backend/shared land apart from UI commits (`REVIEW.md:20-23`).

## Adding an agent tool

1. Declare the tool in the `tools` record inside `runAgent` with `defineTool(...)`
   (`agent.ts:2302`, `995`) — each entry carries a name, label, description constant, a TypeBox
   parameter schema, and an `execute` that returns `toolResult(...)`.
2. Extend the persisted chat-log shape: `AiToolCall` in `api.ts` is a discriminated union over
   `toolName` (`api.ts:2925-3103`). A new variant must include an `input` (and an `output` when
   replay must not re-run the call — creation/listing tools record their output exactly for this
   reason, see the `createGadget`/`listBlueprints` doc comments).
3. Replay is part of the contract: `runAgent` replays the log to rebuild `chatBindings`,
   session content, and tool outputs before prompting the model, so a tool whose effects or output
   aren't recordable will misbehave after restart (`agent.ts:1004-1123`).
4. If the tool streams to the UI, add an `AiChatStreamEvent` variant and emit it from the
   `message_update` handler in the agent loop (`agent.ts:2896-2915`, `api.ts:3243-3367`).
5. Sub-agent (spawner) chats get a restricted tool set — only `describeBinding`, `executeCode`, and
   (for callback-initiated runs) `giveUp` — so a new tool used by spawned agents must be added to
   that narrowing list explicitly (`agent.ts:2875-2883`).

## Adding an admin setting

1. Add the field to `AdminConfig` in `packages/workshop-backend/src/admin-config.ts`, plus a
   default in `DEFAULT_ADMIN_CONFIG` and tolerant parsing in `parseAdminConfig` (older stored
   configs must parse; everything defaults on (`admin-config.ts:82-94`, `284-320`).
2. Extend `serializeAdminConfig` implicitly — it just JSON-stringifies, so the field rides the KV
   mirror automatically (`admin-config.ts:322-329`).
3. Add a setter on `AdminSettings` (which serializes mutations through `adminConfigMutationTail` so
   concurrent setters can't lose updates, `admin-settings.ts:63-68`) and an `AdminApi` method
   (`AdminApiImpl`, `admin-settings.ts:564+`). The DO is the **only writer** of the authoritative
   config; other code reads via `readAdminConfig(env)` (one cheap KV get).
4. Add the UI to `packages/workshop-frontend/src/AdminPage.tsx`.
5. **Hard rule**: authentication/authorization configuration (`AUTH_GATEKEEPERS`,
   `DISABLE_PASSWORD_AUTH`) must *not* move into `AdminConfig` — it stays env-var driven in
   `auth/config.ts` so a compromised admin session cannot change it (`REVIEW.md:33-35`).

## Shipping or updating a format blueprint

1. Edit content in a real Workshop, export a `.gadget`, then import:
   `pnpm import:format-blueprint <export.gadget> <blueprintId>` (existing) or `--new <name>` (new).
   The script rewrites the archive, bumps `revision` in the sidecar, and rebuilds the generated
   module (`format-blueprints/README.md:37-52`).
2. Curation fields (title, description, author, `output` noun/plural/icon, `revision`) live in the
   `<name>.json` sidecar; the installer writes sidecar values over whatever the archive carries
   (`format-blueprints/README.md:15-21`).
3. **Never edit a `blueprintId` after deploy** — install and promotion are keyed on it; a rename
   orphans the old entry (`AGENTS.md`-level rule, restated in
   `format-blueprints/README.md` and `REVIEW.md:42-43`).
4. Nothing wakes on deploy: the first `/api` request after deploy triggers
   `AdminSettings.ensureFormatBlueprintsInstalled()`, keyed on a manifest fingerprint that includes
   the sidecar fields and the archive revision; a partial install resolves `false` and the flag
   resets so the next request retries (`server.ts:816-838`, `admin-settings.ts:78-124`).
5. Forks can ship their own set via the `FORMAT_BLUEPRINTS_DIR` override instead of touching this
   submodule (`format-blueprints/README.md`; `workshop-backend`'s `build` task is `cache: false`
   precisely because that variable names a path outside the workspace).

## Verifying a change

- `pnpm build` — codegen + the single workspace type check.
- `pnpm test` — root `node --test` scripts suite, then per-package suites (see
  [test layout](/openwiki/testing/test-layout.md)).
- `pnpm lint` — oxlint + script type check + type check, what CI enforces.
- After an **intentional release-manifest change**: regenerate the golden file with
  `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts` and review the diff
  (`REVIEW.md:88-89`).
