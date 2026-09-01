---
type: guide
title: Change guides
description: Focused, step-by-step guides for representative maintenance tasks — adding a gatekeeper, adding a bundled format blueprint, changing the shared RPC API, and running the release pipeline — with the exact files to touch and commands to verify.
tags: [guide, gatekeeper, blueprints, rpc, release]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-30239eee070a503c224c24f6
    resource: repo://packages/workshop-backend/package.json
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
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

# Change guides

These are concrete, source-grounded walkthroughs for the maintenance tasks an engineer is most likely
to do. Each names the files to touch, the build/test commands to run, and the review constraints that
apply to the kernel packages (`workshop-backend` and `workshop-shared`).

## 1. Adding a new gatekeeper

The canonical build guide is the `write-gatekeeper` skill (`.agents/skills/write-gatekeeper/`). The
high-level phases:

1. **Understand the service** and design the Session types in `packages/gatekeeper-<name>/src/types.d.ts`
   — capability-shaped, one interface per logical resource, JSDoc written *for the agent* that never
   leaks approval-queue or implementation details. **Stop and get the API reviewed before
   implementing** (the skill's Step 3).
2. **Implement the three tiers** — `GatekeeperVendor` (a `WorkerEntrypoint`), `GatekeeperUser` (a
   `WorkerEntrypoint` with `ctx.props`), and the `Gatekeeper<Session>` DO facet — plus a `UserAccount`
   Durable Object for the OAuth flow. Every DO class must appear in
   `wrangler.jsonc` `migrations[].new_sqlite_classes`. `types.txt` must be a **symlink** to
   `types.d.ts`.
3. **Register it**: add a service binding to `packages/workshop-backend/wrangler.jsonc`
   (`{ binding: "GATEKEEPER_<NAME>", service: "gatekeeper-<name>", entrypoint: "GatekeeperVendor" }`).
   The backend auto-discovers vendors from `GATEKEEPER_*` bindings, and the router routes
   `/gatekeeper/<name>/*` by scanning its own bindings — no other code changes needed.
4. **Add the resource-selection UI** (`src/configurator/`, built by
   `build-gatekeeper-configurator.ts` via the `build:configurator` Vite+ task) and/or a single-file app
   UI (`build-app.mjs` -> `build:app`).
5. **Phase 2**: wire every read through `authorizeObservation()` and every side effect through
   `submitAction()`/`applyAction()`, add caching/simulation, and choose an observer strategy
   (A/B/C/D) for `getVerifier`/`addObserver`/`removeObserver`.

Verification: `pnpm exec vp run -F @gadgets/<pkg> build` (type-check + configurator build) and
`pnpm --filter @gadgets/<pkg> test:run`. The dev server (`pnpm dev-server`) picks the new package up
automatically since it globs `packages/gatekeeper-*`.

Deployment notes: an installable OAuth gatekeeper gets `DEFAULT_CRED_INPUTS`
(`CLIENT_ID`/`CLIENT_SECRET` secrets) unless its name is in `NO_DEFAULT_CRED_INPUTS` in
`scripts/release/manifest-lib.ts` or it declares a `deploy-inputs.json`. A gatekeeper whose account
declares an agent singleton must also be in the `SINGLETON` set (and `PREINSTALL` if it ships
preinstalled), or every user would get duplicate ambient capsules.

## 2. Adding a bundled format blueprint

Bundled formats live in `packages/workshop-backend/format-blueprints/` as a `<name>.gadget` archive
plus a `<name>.json` sidecar (blueprintId, title, description, author, `output`, `revision`).

- **New**: `pnpm --filter @gadgets/workshop-backend import:format-blueprint ~/Downloads/Brief.gadget --new acme-brief`
  — writes the sidecar, rebuilds `src/generated/format-blueprints.ts`, and prints the fields worth
  editing (chiefly `output`). Make `output.id` generic (`document`, not `acme-brief`) so the Outputs
  page groups it with the rest.
- **Code update**: build the gadget in a real Workshop, export it, and run
  `pnpm --filter @gadgets/workshop-backend import:format-blueprint <export.gadget> <blueprintId>`, which
  rewrites the archive, bumps `revision`, and round-trips the bytes to check metadata and content hash.
- **Never rename a deployed `blueprintId`** — install and promotion are keyed on it, so a rename
  orphans the old entry and promotes the new id as a *second* format.
- `FORMAT_BLUEPRINTS_DIR` points the build at a fork's own directory (useful when this repo is a
  submodule).

Behavior to remember: the first `/api` request installs any bundled blueprint whose manifest
fingerprint changed (`formatBlueprintsManifestVersion()` compares every installed-metadata field plus
the archive `revision`), and each bundled blueprint is promoted once ever — an upgrade never undoes an
admin's later removal or overrides. Verification: `pnpm build` regenerates the module; the golden
install/promotion behavior is exercised by the workshop-backend tests.

## 3. Changing the shared RPC API

The API is `packages/workshop-shared/src/api.ts` (Workshop <-> SPA) and
`packages/workshop-shared/src/gatekeeper.ts` (Workshop <-> gatekeepers).

- Add the method to the interface *and* implement it on the server (`server.ts`'s
  `PublicApiImpl`/`AuthenticatedApiImpl` for the client surface) and/or the gatekeeper.
- Keep `@validateRpc()` on every RPC interface/implementation; it auto-generates runtime validation
  from the TypeScript signatures, so do not write redundant checks. Use `@skipRpcValidation` only
  where a return value is an opaque stub.
- `workshop-shared` is held to a higher bar: **doc-comment every exported member** (types, consts,
  and functions — not just interfaces), keep diffs small, and never introduce a hand-written
  interface that mirrors an RPC interface plus an `as unknown as` cast.
- For expected failures, use the `codedErrorFamily` helpers so errors carry stable machine-readable
  codes (the per-code messages double as the fallback for older deployments).
- If you add a subscription, return a disposable stub whose disposal unsubscribes, and dispose the
  subscriber stub when done.

Verification: `pnpm build` (type-check across the workspace) plus the affected packages' tests.
Because `workshop-backend` is the kernel, reviewers read every line of the backend and API diffs.

## 4. Adding an admin-managed setting

Admin-configurable settings flow through `AdminConfig` in
`packages/workshop-backend/src/admin-config.ts`:

1. Add the field to `AdminConfig` (with its `DEFAULT_ADMIN_CONFIG` default).
2. Add the setter/validation on `AdminApiImpl` (`admin-settings.ts`) and the corresponding
   `updateAdminConfig` mutation — the DO serializes the read-modify-write and mirrors to KV.
3. Extend `AdminSettingsView` and the admin UI (`packages/workshop-frontend/src/AdminPage.tsx`), and
   surface it to clients via `ServerConfig` if it's boot-time UI config.
4. If the agent needs it, fold it into the prompt (e.g. `formatInstanceInstructions` for instructions).

Keep **authentication/authorization config out of AdminConfig** — it stays env-var driven
(`auth/config.ts`) so a compromised admin session can't change it.

## 5. Running and debugging the release pipeline

The pipeline lives in `scripts/release/`:

- `node scripts/release/build-release.ts --out release-out` — builds every deployable worker
  byte-identically (wrangler dry-run), builds the frontend asset variant, and writes the release
  manifest.
- `node scripts/release/upload-release.ts --release release-out --candidate` — mirrors to R2,
  content-addressed, manifest last (omit `--candidate` only to bypass the gate — CI never does).
- `node scripts/release/promote-release.ts --release-id <id>` — copies the verified candidate's
  manifest into `releases/<id>/`; publishing is that single all-or-nothing copy.

The manifest contract (`manifest-lib.ts`) replaces account-specific values with placeholders
(`$ACCOUNT_ID`, `$KV_<BINDING>_ID`, `$WORKER_NAME(...)`, `$SECRET(...)`, `$PUBLIC_BASE_URL`) and fails
closed on any unrecognized `$` token or wrangler config key. If you intentionally change the manifest
shape, regenerate the golden file with `UPDATE_GOLDEN=1 node --test scripts/release/manifest-lib.test.ts`
and review the diff; upload/promote need `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` set.

Upload and promote require real R2 credentials; if they're missing the failure is a missing-env error,
not a code bug. The newer-release guard in promote skips candidates a later release has superseded.

## Verification loop for any change

- `pnpm build` — the type-check + codegen pass (`types:check` is an alias).
- `pnpm lint` — `lint:check` (oxlint) + `types:scripts` + `types:check`.
- `pnpm test` — the root scripts suite plus the per-package cached test tasks; use
  `pnpm --filter <pkg> test:run` while iterating.
- `pnpm dev-server` + `pnpm dev-client` to exercise behavior locally (see the dev-workflow page).
