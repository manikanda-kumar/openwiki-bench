---
type: change-guide
title: How to Add a Format Blueprint
description: Ship an output-format blueprint with the deployment — authoring and exporting the gadget, the import script and sidecar contract, the generated module and its fingerprinted install, and the absolute rule that a blueprintId never changes after deploy.
tags: [blueprints, formats, guide, build, deployment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-71504481341c35a23cc7f4af
    resource: repo://packages/workshop-backend/scripts/build-format-blueprints.mjs
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-46a6dc3f05f1e404c37ef40d
    resource: repo://packages/workshop-backend/vite.config.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# How to Add a Format Blueprint

*Format blueprints* are ordinary blueprints the deployment promotes as standard output types (docs, decks, sheets) so a fresh instance can produce them before anyone has built anything. Use this flow to add or update one. Background: [Code Storage, Git Objects, and Blueprints](../backend/code-storage-and-blueprints.md).

## 1. Build the gadget in a real Workshop

Create the gadget, polish its README/exports, then **publish a blueprint from it and download the `.gadget` archive** — that file is the input. (A brand-new format can also be captured with `--new` (format-blueprints/README.md#L63-L74).)

## 2. Import it

```
pnpm import:format-blueprint ~/Downloads/My.gadget format.my-thing
```

The script (`packages/workshop-backend/scripts/import-format-blueprint.mjs`, wired as a package.json script at packages/workshop-backend/package.json#L14) has two modes: replacing the archive for an existing `blueprintId`, or `--new <name>` writing a fresh sidecar prefilled from the export (packages/workshop-backend/format-blueprints/README.md#L64-L74). What it does, and why each piece is non-optional:

- **Rewrites the sidecar's code-derived fields and bumps `revision`.** `revision` is the reinstall trigger for the *one* input the install fingerprint cannot see — the archive bytes — and it is automated "because forgetting it is invisible (everything builds and deploys, and the old blueprint quietly stays put)" (format-blueprints/README.md#L44-L52).
- **Prints the `bindings` diff, flagged `[CHANGED]`** when the new export needs a binding the old copy didn't — instantiating users will be asked for it, so this is the line to read (README.md#L44-L50).
- **Round-trips the bytes it just wrote** and re-checks metadata and a content hash, "because these are committed as data and a corrupt archive would otherwise first surface when a deployment tried to install it" (README.md#L58-L61).

## 3. Curate the sidecar

Each blueprint is two files with the same stem in `format-blueprints/` (packages/workshop-backend/scripts/build-format-blueprints.mjs#L11-L13): the `<name>.gadget` archive (*what it does*) and a `<name>.json` sidecar (*what a human curates*) — the installer **overwrites** archive-carried presentation with sidecar values, so committed bytes stay consistent (format-blueprints/README.md#L16-L24). Sidecar keys: `blueprintId`, `title`, `description`, `output` (`{id, noun, plural, icon}`), `author`, `revision`, plus an allowed `$comment` — unknown keys are rejected at build time, as are bad icons and malformed ids (build-format-blueprints.mjs#L38-L53; example: format-blueprints/workspace-docs.json).

Two field notes:

- **`output.id` should be *generic*** (`"document"`, not `"acme-brief"`): it is the Outputs-page grouping key, so your custom "Contract" format rides with the other documents instead of minting a filter chip (format-blueprints/README.md#L70-L74; the sidecar's own `$comment` says the same).
- **Titles/descriptions/author changes need no archive rewrite or revision bump** — everything in the installed metadata contributes to the install fingerprint, so a reinstall follows on next deploy (README.md#L26-L31; src/format-blueprints.ts#L17-L24).

## 4. Build (it's automatic from here)

`build-format-blueprints.mjs` globs the directory into the gitignored generated module `src/generated/format-blueprints.ts` as base64 archives — no network needed at install time. Both `build` and `test` run the generator first, as a dedicated **uncached** task (`cache: false`, because `FORMAT_BLUEPRINTS_DIR` names a path outside the workspace and env-value fingerprints would replay stale edits — see [Toolchain, Tasks, and Build Cache](../development/toolchain-and-builds.md)) (packages/workshop-backend/vite.config.ts#L11-L40; build-format-blueprints.mjs#L1-L9). The generator validates reserved-key collisions (`.featured`, `.adminConfig`) without loading TypeScript, keeping its copy of the control-key list in sync with `blueprint-archive.ts` by comment (build-format-blueprints.mjs#L31-L33, #L53).

On deploy, the first `/api` request triggers the idempotent install into `BLUEPRINTS` KV + `BLUEPRINT_CONTENT` R2 — written *exactly like a user-published blueprint*, so nothing downstream special-cases formats (src/format-blueprints.ts#L1-L9; packages/workshop-backend/src/server.ts#L816-L838). Promotion into the New menu is separate admin curation (`AdminConfig.formats`, entries `{blueprintId, enabled, agentHint?, overrides?}`) — see [Admin Settings and Configuration](../operations/admin-and-configuration.md) (src/admin-config.ts#L49-L63, #L104-L122).

## The rule: `blueprintId` is immutable after deploy

> reimporting the same id updates that blueprint in place, and **changing it after a deployment has installed it** promotes the new id as a *second* format while the old one stays in the New menu, updated by nothing. Rename files freely; the id is the load-bearing part. (format-blueprints/README.md#L76-L81)

The install and the admin promotion are both keyed on it, so a rename orphans the old entry forever. Pick ids like `format.<thing>` and never reuse or move them.

## Forks: don't edit this directory

This repo is typically vendored as a submodule, so ship your own set via `FORMAT_BLUEPRINTS_DIR=<dir> pnpm exec vp run build` — the named directory *replaces* the bundled set wholesale and the import script honours the same variable; or skip the build change entirely by promoting your own published blueprints in the admin Formats panel (format-blueprints/README.md#L84-L111). `vp run`, not `pnpm build`, because the generation step is a Vite+ task, not a visible package script (README.md#L88-L92).
