---
type: guide
title: Change Guides
description: Focused, actionable workflows for representative maintenance tasks — adding a gatekeeper, shipping a new (or updated) format blueprint, changing the shared API, and running a preview deployment.
tags: [guides, gatekeeper, format-blueprint, api, preview]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-9a451f97c575e2814ad796e9
    resource: repo://docs/integration-testing.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-dc2c5753138cb9e4a18d5cee
    resource: repo://scripts/preview/preview.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Change Guides

This page collects focused, source-grounded workflows for representative maintenance tasks. Each
guide is concrete: what to touch, what commands to run, and how to verify.

## Adding a gatekeeper

A gatekeeper is a separate Cloudflare Worker bridging the Workshop to an external service. The
`write-gatekeeper` skill (`.agents/skills/write-gatekeeper/SKILL.md`) is the authoritative
implementation guide; read it before starting. High-level steps:

1. **Study the external service.** Identify the auth model (OAuth 2.0, API keys…), the resources to
   expose and their granularities, and which operations are observations vs. side-effecting actions
   (`write-gatekeeper` Step 1).
2. **Design the Session types** in `src/types.d.ts` (a `.d.ts` of the session interface + hooks).
   Read `packages/workshop-shared/node_modules/capnweb/README.md` for what RPC supports. Design one
   interface per logical resource with capability-based methods. The skill's rule: **design the
   proposed API and STOP to let the operator review before implementing** — "getting the API right
   is the most important and delicate part" (Step 2).
3. **Create the package** following an existing gatekeeper's layout (e.g. `packages/gatekeeper-context`):
   `vendor.ts`/`index.ts` (the `GatekeeperVendor` / `GatekeeperUser` / `Gatekeeper<Session>` trio),
   a `wrangler.jsonc`, `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, and a
   `README.md` with deployment instructions.
4. **Wire auth + connected accounts** in a `GatekeeperUser` account Durable Object (token storage,
   refresh, revocation); implement a connected-account connect flow via `GatekeeperConnectCallback`.
5. **Add the observer methods** (`getVerifier` / `addObserver` / `removeObserver`) — minimal versions
   in Phase 1 so the code type-checks, with the real strategy chosen in Phase 2
   (`write-gatekeeper` responsibility 7).
6. **Add the configurator UI** (the resource-selection form). Gatekeeper configurator modules are
   compiled by `scripts/build-gatekeeper-configurator.ts` as part of package builds; declare the
   appropriate `build`/`build:configurator` Vite+ tasks in `vite.config.ts`
   (see `gatekeeper-configurator-vite-config.ts`).
7. **Bind it.** Installing a gatekeeper is purely a binding change: add a `GATEKEEPER_<NAME>`
   service binding to the `router` (which auto-discovers it by scanning `GATEKEEPER_*` keys) and to
   the backend. `pnpm dev-server` discovers gateway packages and creates the local binding.
8. **Deploy / release.** A new deployable worker must be recognized by the release manifest
   (`scripts/release/manifest-lib.ts`) and honor `deploy-inputs.json` conventions if it takes
   third-party OAuth app credentials (`NO_DEFAULT_CRED_INPUTS` in `manifest-lib.ts`).

## Shipping a new or updated format blueprint

Formats are the deployment's standard output templates. The curation workflow lives in
`packages/workshop-backend/format-blueprints/README.md` and `scripts/build-format-blueprints.mjs`:

- **Change title/description/author**: edit the `<name>.json` sidecar and rebuild — no archive
  rewrite or revision bump.
- **Update code**: build it in a real Workshop, export it, then, from the repo root:

  ```
  pnpm import:format-blueprint ~/Downloads/Gadgets-Doc-v4.gadget format.document
  ```

  This rewrites the archive, bumps `revision` in the sidecar, rebuilds
  `src/generated/format-blueprints.ts`, and reports what it did — including a `bindings [CHANGED]`
  flag when the export needs something the old copy didn't. The script round-trips the bytes it
  writes and checks metadata + content hash, because a corrupt committed archive would otherwise
  first surface at install.

- **Add a new format**:

  ```
  pnpm import:format-blueprint ~/Downloads/Brief.gadget --new acme-brief
  ```

  Edit the printed fields before deploying, chiefly `output` (the noun/plural/icon the sidecar
  owns) and `output.id` — make the grouping id **generic** (e.g. `document`) so the Outputs page
  groups `acme-brief` with the other documents. `blueprintId` defaults to the name and is the
  install key: reimporting the same id updates in place, and **changing it after deploy promotes it
  as a *second* format** while the old one stays in the menu. Rename files freely; the id is the
  load-bearing part.

- **Ship your own set**: point `FORMAT_BLUEPRINTS_DIR` at your own `<name>.gadget` + `<name>.json`
  tree. It *replaces* the default set and touches nothing in this repo — important when the repo is
  a submodule. Two lighter options need no build change: promote your own published blueprints in
  the admin Formats panel, or ship none by pointing the var at an empty directory.

The first `/api` request installs bundled blueprints whose manifest fingerprint changed (title,
description, author, output, plus `revision` for archive bytes); each is promoted only once ever.

## Changing the shared API

`packages/workshop-shared` defines the RPC contract between frontend and backend; changes here are
part of the kernel and carry a high review bar (`AGENTS.md`):

- **Doc-comment every exported member** — types, consts, and functions, not just interfaces.
- **Never hand-write an interface that mirrors an RPC interface plus an `as unknown as` cast** —
  derive from the real type instead.
- **Prefer reusing existing mechanisms** over adding parallel ones; keep diffs small and elegant.
- **Backward compatibility**: `codedErrorFamily` messages double as the classification fallback for
  older deployments that lost the code in transit, so changing a message is a compatibility break.
- **Keep validation single-sourced**: `@validateRpc()` installs runtime validation from the TS
  signatures; don't add redundant per-call checks an interface already covers.
- **Pipelining & stubs**: return RPC stubs / use promises so callers can pipeline (`openGadget`
  returns an `Overseer` promise precisely to allow pipelining). Advise obtaining and disposing
  stubs carefully (`stub[Symbol.dispose]()`) to avoid resource leaks.
- For a large change, split by concern into separate PRs (at minimum group commits so the backend +
  shared review apart from the UI).

Verify: `pnpm lint`, `pnpm build` (typecheck/codegen), and the relevant package tests via
`pnpm --filter <pkg> test:run` while iterating.

## Bumping wrangler / workerd

The `integration-tests` doc (`docs/integration-testing.md`) records the coupling: the repo pins
`workerd` through a root `overrides` entry, and a newer `wrangler` brings a newer `miniflare` that
demands a newer `workerd` than the override yields, failing the harness boot. The public package
therefore pins `wrangler` to the release whose bundled `workerd` matches the override. If you bump
`wrangler`, bump the `workerd` override in step Cells, run `pnpm build`, `pnpm test`, and re-generate
worker types (`pnpm types:generate`).

## Running a preview deployment

`scripts/preview/preview.ts` manages ephemeral Cloudflare preview deployments. Root scripts
(`package.json`):

- `pnpm preview:config` — validate the preview config
- `pnpm preview:deploy` — deploy a preview
- `pnpm preview:delete` — delete a preview
- `pnpm preview:sweep` — sweep stale previews

The deploy flow boots the gatekeepers (concurrently; nothing binds to anything), then
`workshop-backend` (binding every gatekeeper preview via `GatekeeperVendor`), then the `router`
(binding the backend preview and every gatekeeper preview, and owning `/gatekeeper/<short>`),
patching service bindings per tier (`preview.ts:554`). Preview deployments require a Cloudflare API
token and are skipped on fork PRs by design (GitHub withholds secrets) — see
`CONTRIBUTING.md` and `.github/workflows/README.md`.
