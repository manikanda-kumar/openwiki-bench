---
type: guide
title: Change Guide — Adding a New Gatekeeper
description: The full, review-oriented workflow to author, wire up, and ship a new gatekeeper package for Cloudflare OS, including the two-phase implementation path, the configurator-ui build, registration, and the review bar.
tags: [gatekeepers, change-guide, on-boarding]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
  - id: openwiki-source-3ead0cf37cd6ff5300a12e93
    resource: repo://scripts/gatekeeper-configurator-vite-config.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---

# Change Guide: Adding a New Gatekeeper

The canonical, detailed authoring guide is the in-repo `write-gatekeeper` skill
(`.agents/skills/write-gatekeeper/SKILL.md`); read that alongside the canonical interfaces in
`packages/workshop-shared/src/gatekeeper.ts`. This page gives the end-to-end workflow and the review
bar.

## The two-phase path

Adding a gatekeeper is deliberately split into two phases, with explicit STOP points for operator
review.

### Phase 1 — Core implementation

Only responsibilities 1–3 of the seven (auth management, API design, fine-grained resource granting),
plus stub observer methods so it type-checks.

1. **Study the external service** — its auth model (OAuth 2.0, API keys, …), the resources to expose
   and their granularities, and which operations are observations vs actions.
2. **Design the Session types** in `src/types.d.ts`. Read the capnweb README to know what's
   expressible. Design principles: one interface per logical resource (capability-based), methods
   return structured data, make it easy to limit authority, and keep JSDoc focused on what the agent
   needs (never leak the approval queue or internals into the `.d.ts`).
3. **STOP — present the API for review.** This is the most important and delicate part; do not
   proceed without operator approval.
4. **Implement.** Follow the SKELETON. Package structure:
   ```
   packages/gatekeeper-<name>/
   ├── src/
   │   ├── configurator/          # Optional resource-picker UI modules and UI-facing types
   │   ├── <name>.ts              # Vendor, UserAccount, UserImpl, GatekeeperImpl, SessionImpl
   │   ├── types.d.ts             # Session/Hook types (compile-time)
   │   ├── types.txt -> types.d.ts   # Symlink into types.d.ts (runtime, for getTypeScriptTypes())
   │   └── <name>-api.ts          # (optional) helper wrapping the service's HTTP API
   ├── wrangler.jsonc
   ├── package.json
   └── tsconfig.json
   ```
   `types.txt` must be a **symlink** to `types.d.ts`, never a copy.
5. **Configure and register.** Add a service binding to the backend's
   `packages/workshop-backend/wrangler.jsonc`:
   ```jsonc
   { "binding": "GATEKEEPER_<NAME>", "service": "gatekeeper-<name>", "entrypoint": "GatekeeperVendor" }
   ```
   The backend auto-discovers vendors from `GATEKEEPER_`-prefixed bindings.
6. **Add a resource selection UI** — `startResourceConfigurator(resourceUrlPattern)` returns an
   iframe to pick the resource. Consider `@gadgets/configurator-ui` for a consistent form, or produce
   your own `iframeHtml`. Prefer the optional `initialValuesFromResourceUrl` so the form opens
   pre-filled for agent requests.
7. **STOP — ask whether to proceed to Phase 2.**

Also remember in Phase 1: all DO classes must appear in `wrangler.jsonc` under
`migrations[].new_sqlite_classes`, set a **self-destruct alarm** in the `UserAccount` DO in case the
OAuth flow never completes, and read through the connect-flow security note (the returned URL must
carry a cryptographic nonce alongside the DO id).

### Phase 2 — Logging, approvals, caching, simulation, observers

Responsibilities 4–7, typically a second pass.

- **Logging/approvals**: every operation that reads external data must call `authorizeObservation()`
  (awaited before returning data); every side-effecting operation must call `submitAction()` and must
  not apply until `applyAction()`. It is critically important to cover *every* outside-world
  operation, or the gatekeeper security model is broken.
- **Caching**: store fetched data in the DO (`ctx.storage.kv` / `ctx.storage.sql`) with a TTL or
  revision id; cache transformed data (e.g. Markdown).
- **Simulation**: pending submitted actions should be reflected by reads so the agent keeps working
  and the user can batch-approve later (mutate the cache on submit, or overlay pending actions at read
  time). `gatekeeper-google` is the reference (Google Docs simulation/cache handling, BigQuery dry-run).
- **Observers**: implement `addObserver`/`removeObserver`/`getVerifier` with a per-binding strategy
  (private-only / ACL-check / data-set tracking / low-stakes). See the skill's detailed C-strategy
  implementation.

## Configurator UI build path

- Configurator UI modules live in `src/configurator/*-ui.tsx`; `resourceUrl()` returns the selected
  URL, `src/configurator/*-types.d.ts` describes the iframe-facing `ui` API, and
  `scripts/build-gatekeeper-configurator.ts` transpiles each module per-file (stripping only
  `@gadgets/configurator-ui` and type-only imports — they cannot import runtime helpers) into
  `src/generated/*.txt`.
- Its Vite+ tasks are re-exported from `scripts/gatekeeper-configurator-vite-config.ts`: `build` is a
  task that is only `tsc` and `dependsOn: ['build:configurator']`. There is **no** `build` script
  (a task may not share a name with a script). `deploy` reaches the configurator task via
  `vp run --no-cache build:configurator`, so a deploy always rebuilds from source and never replays a
  cached artifact.

Gatekeepers with no test files re-export that config's default; those with tests re-export
`withTests` (because `vitest run` exits 1 with no tests found).

## Review bar

Gatekeeper packages are **not** the kernel (the kernel bar is for `workshop-backend` and
`workshop-shared`), but they must still hold the capability-security and observer bars from
`packages/…/REVIEW.md` and the `write-gatekeeper` skill:

- Every capability the Workshop mints still flows through `UserDurableObject.getGatekeeperClassFor()`
  (which enforces disabled gatekeepers/resources) — a gatekeeper never asserts its own "ambience".
- The `ApprovalQueue` and `authorizeObservation`/`submitAction` invariants are non-negotiable.
- `getVerifier()`/`addObserver()`/`removeObserver()` are mandatory — a gatekeeper won't type-check
  without them, so the code must choose and implement the right per-binding observer strategy.
- `types.txt` → `types.d.ts` must stay a symlink, and the returned URL from connect/reconnect must
  include the cryptographic nonce.

## Reference implementations

- `gatekeeper-google` — OAuth, multiple resource types (Gmail, Docs, BigQuery), actions, caching /
  simulation, and all three observer strategies in one package.
- `gatekeeper-email` — hook-based push notifications, no actions, email address claiming, low-stakes
  observers.
- `gatekeeper-github` — clean strategy-B observer example (`GitHubVerifier.hasRepoAccess`).
- `gatekeeper-supabase`, `gatekeeper-linear`, `gatekeeper-notion` — strategy-C data-set tracking.
