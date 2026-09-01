---
type: operations
title: Admin configuration and deployment settings
description: How deployment admins configure the instance — the AdminSettings singleton DO, the reserved KV mirror, the AdminConfig shape (formats, gatekeepers, ambient modes, branding, signups), the format-blueprint install-on-first-request flow, and the deliberate split from env-driven auth config.
tags: [admin, configuration, kv, formats, gatekeepers]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-a440089ab010f00583c612b8
    resource: repo://packages/workshop-backend/src/auth/login-flow.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Admin configuration and deployment settings

Deployment admins manage "soft" instance customization through one object: `AdminConfig`
(`packages/workshop-backend/src/admin-config.ts:15-57`). It covers `signupsEnabled`, `siteName`,
site-logo presence, agent `instanceInstructions`, `announcement`, `banner`, `accentColor`,
`disabledResources` (per-vendor disabled URL patterns), `disabledGatekeepers`,
`ambientGatekeeperModes`, and `formats` (the curated standard output formats). Everything defaults
to *enabled*; the admin UI opts things **out**. Authentication/authorization config
(`AUTH_GATEKEEPERS`, `DISABLE_PASSWORD_AUTH`) is deliberately **not** here — it stays env-var
driven so a compromised admin session cannot change it (`admin-config.ts:1-9`; `REVIEW.md:33-35`).

## The singleton DO + KV mirror pattern

`AdminSettings` is a Durable Object **always addressed as `getByName("")`** (`admin-settings.ts:49-57`).
It is the **only writer** of the authoritative config; every other reader goes through
`readAdminConfig(env)` — a single cheap KV get of the reserved `​.adminConfig` key in the
`BLUEPRINTS` namespace (`admin-config.ts:326-329`; `blueprint-archive.ts:11-15`). The DO exists so
a singleton writer can serialize updates to KV without races; hot paths (connect, sign-in, the
agent, `getGatekeeperClassFor`, `startHook`) never wake the DO.

Every config read backfills missing fields from `DEFAULT_ADMIN_CONFIG`, so a config persisted
before a field existed reads as the default rather than `undefined` on the first upgraded
deployment (`admin-settings.ts:262-267`). Every mutation funnels through `#mutateAdminConfig`,
which serializes the full read-modify-write on `adminConfigMutationTail` so external KV I/O cannot
let concurrent setters lose updates — and rolls DO storage back if the KV mirror write fails
(`admin-settings.ts:63-68`, `273-289`). A no-op mutation still re-mirrors, which repairs the
partial-failure state where DO storage succeeded but KV failed (`admin-settings.ts:349-358`).

## What the panel manages

The admin UI (`packages/workshop-frontend/src/AdminPage.tsx`) talks to `AdminApi` — a capability
obtained via `AuthenticatedApi.getAdminApi()` (null for non-admins; the access check happens once
at minting). `AdminApiImpl` is a thin validation+forwarding facade over the DO: the client never
receives a stub to the DO's internal methods, and a disabled gatekeeper/resource can't be
re-enabled via a crafted request (`admin-settings.ts:543-560`).

- **Formats**: promote/remove/update/reorder blueprints as the deployment's standard output
  formats. Removing a bundled format is refused — the RPC enforces it, not just the panel; it is
  disabled instead, keeping overrides/hint/position. Every agent hint is truncated to
  `MAX_AGENT_HINT` (400 chars) because hints ride the system prompt on every turn. Promoting a
  blueprint that declares no output generates a hidden grouping id so the admin only names the
  human-facing noun/plural/icon (`admin-settings.ts:361-409`).
- **Gatekeepers and resources**: `setResourceEnabled` / `setGatekeeperMode` per vendor; the settings
  view lists every bound vendor's resource types annotated with enabled state, forwarding the
  requesting admin's id so RBAC-gated gatekeepers still reveal their resources
  (`admin-settings.ts:293-323`, `473-495`). `setGatekeeperMode` accepts `enabled`/`disabled` for
  any vendor but requires the vendor to actually `autoProvisionsAccount` before accepting the
  default-mode deletion (`optional`) (`admin-settings.ts:473-486`).
- **Branding and notices**: site name, logo upload/reset (serialized separately from config via
  `siteLogoMutationTail`), announcement, banner, accent color — with per-field length validation
  (`admin-settings.ts:577-634`).
- **Signups**: an access toggle covering password *and* gatekeeper first-use creation
  (`admin-config.ts:16-21`).

## Format blueprints: install on first request

Nothing wakes on deploy, so a fresh deployment is provisioned by its **first `/api` visitor**: the
server fires a one-shot `ctx.waitUntil(AdminSettings.ensureFormatBlueprintsInstalled())`, guarded
by an isolate-level `formatBlueprintInstallStarted` flag that is cleared on failure or partial
completion so the next request retries (`server.ts:816-838`). The DO coalesces concurrent callers
onto one install (`#installInFlight`), compares the shipped manifest fingerprint against its
`installedFormatBlueprints` stamp, installs any changed archives into KV + R2, mirrors them into
its featured collection, and stamps the version **only when the whole manifest is live** — a
partial install resolves `false` so the caller retries later (`admin-settings.ts:78-124`).

Promotion of bundled formats is tracked separately (`promotedFormatBlueprints`) from the install
stamp, so promotion happens exactly once per blueprint and an admin's later removal sticks
(`admin-settings.ts:33-43`). The same DO also maintains the featured-blueprints mirror: the
authoritative featured bit lives in the publishing user's DO, and blueprint updates/deletions call
`syncFeaturedBlueprint`/`deleteFeaturedBlueprint` to keep the publishable snapshot current
(`admin-settings.ts:221-258`).

## Forks

The shipped format set is overridable with `FORMAT_BLUEPRINTS_DIR` (see
[change guides](/openwiki/change-guides/common-tasks.md)); note that workshop-backend's `build`
task is `cache: false` precisely because that variable names a path outside the workspace.
