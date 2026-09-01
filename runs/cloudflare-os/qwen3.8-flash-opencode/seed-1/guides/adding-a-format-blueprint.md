---
type: guide
title: How to Add a Format Blueprint
description: Change guide for the deployment-shipped output-format blueprints — import script, sidecar curation fields, the generated module and build cache caveat, install-on-first-request mechanics, and the immutable blueprintId rule.
tags: [guide, blueprints, formats, build, codegen]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-84976954dd71269cbe84b948
    resource: repo://packages/workshop-backend/format-blueprints/README.md
  - id: openwiki-source-71504481341c35a23cc7f4af
    resource: repo://packages/workshop-backend/scripts/build-format-blueprints.mjs
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-a574c71d25e43b1a2237ccca
    resource: repo://packages/workshop-backend/src/format-blueprints.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-46a6dc3f05f1e404c37ef40d
    resource: repo://packages/workshop-backend/vite.config.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# How to Add a Format Blueprint

A *format* is an ordinary blueprint the deployment has promoted
(packages/workshop-backend/format-blueprints/README.md#L3-L5); the shipped set lives as committed
data in `packages/workshop-backend/format-blueprints/`, each blueprint being a `<name>.gadget`
archive (the code and its bindings) plus a `<name>.json` sidecar (everything human-curated:
`blueprintId`, title, description, `output`, author, `revision`)
(packages/workshop-backend/format-blueprints/README.md#L16-L24).

## Add a new format

1. Build the gadget in a real Workshop and **export** it (`.gadget` file).
2. Import it as a new blueprint:
   `pnpm import:format-blueprint ~/Downloads/Brief.gadget --new acme-brief`
   (packages/workshop-backend/package.json#L14; behavior described at
   packages/workshop-backend/format-blueprints/README.md#L60-L67). This writes the archive plus a
   starter sidecar and rebuilds the generated module.
3. Edit the sidecar before deploying — chiefly `output`: keep its `id` **generic** (`document`,
   not `acme-brief`) because the Outputs page groups by it (format-blueprints/README.md#L68-L75).

## Update an existing format's code

`pnpm import:format-blueprint <export.gadget> <blueprintId>` rewrites the archive, bumps
`revision` in the sidecar, and reports deltas — read the **`bindings`** line: `[CHANGED]` means
instantiating users will be asked for something new. `revision` exists precisely because it is the
one input the install fingerprint can't otherwise see (the archive bytes); forgetting to bump it
means the old blueprint "quietly stays put" on deployed instances
(packages/workshop-backend/format-blueprints/README.md#L36-L57).

Title/description/author changes need only a sidecar edit and rebuild — those fields are part of
the installed-version fingerprint, so a reinstall follows on the next deploy
(packages/workshop-backend/format-blueprints/README.md#L26-L30; fingerprint composition:
`blueprintId@revision + fingerprint(title, description, author, output)` in
packages/workshop-backend/src/format-blueprints.ts#L22-L38).

## Never edit a blueprintId after deploy

The id is the install key: reimporting the same id updates in place, while changing it after any
deployment installed the blueprint promotes a *second* format and leaves the old one orphaned in
the New menu, updated by nothing (packages/workshop-backend/format-blueprints/README.md#L76-L82).

## Generated module and the build-cache caveat

`scripts/build-format-blueprints.mjs` globs the blueprint directory into
`src/generated/format-blueprints.ts`, base64-embedding the binary archives
(packages/workshop-backend/scripts/build-format-blueprints.mjs#L1-L24). The generator
*validates the sidecar at build time* — non-empty strings, unknown keys rejected, `blueprintId`
restricted to `[a-zA-Z0-9._-]` and screened against the reserved KV control keys (`.featured`,
`.adminConfig`), positive integer `revision`, required `output` with a known icon — so typos fail
the build rather than mis-present in production
(packages/workshop-backend/scripts/build-format-blueprints.mjs#L25-L56).

A fork ships its own set by pointing `FORMAT_BLUEPRINTS_DIR` at a directory in its own tree —
that directory **replaces** this repo's set rather than adding to it
(packages/workshop-backend/scripts/build-format-blueprints.mjs#L3-L11). The build task
`build:format-blueprints` is deliberately `cache: false`: cached `vp` runs strip undeclared env
vars, and `env:` declarations fingerprint the variable's *value*, not the contents of the
directory it names — so with a fixed path, edits inside would replay a stale generated module
(packages/workshop-backend/vite.config.ts#L11-L25). `build` depends on the generator, so both
`pnpm build` and tests run it first (packages/workshop-backend/vite.config.ts#L36-L38).

## Runtime install mechanics (what your change deploys into)

- Trigger: the first `/api` request an isolate serves calls `AdminSettings.ensureFormatBlueprintsInstalled()`
  fire-and-forget; a partial install resets the flag so the next request retries
  (packages/workshop-backend/src/server.ts#L816-L845).
- Each entry installs through the ordinary archive parser — a corrupt bundled file fails exactly
  like a bad upload rather than half-installing (packages/workshop-backend/src/format-blueprints.ts#L40-L45).
- **Content first, metadata second**: R2 gets `<blueprintId>/<version>` (already-gzip bytes)
  before the KV record is written, because a metadata-only blueprint is broken while an orphaned
  R2 object is harmless (packages/workshop-backend/src/format-blueprints.ts#L47-L73).
- The sidecar's presentation fields overwrite the archive's, so an archive's own title/author are
  inert (packages/workshop-backend/src/format-blueprints.ts#L56-L65, format-blueprints/README.md#L22-L24).
- One bad archive is logged and skipped — it must not deny the deployment the others
  (packages/workshop-backend/src/format-blueprints.ts#L77-L97).
- Promotion into `AdminConfig.formats` is tracked separately from the install stamp so legacy
  curation still offers its bundled formats (packages/workshop-backend/src/admin-settings.ts#L39, L89-L153).

Related: [Persistence and Blueprints](../data/persistence-and-blueprints.md),
[Configuration and Admin Settings](../operations/configuration-and-admin.md).
