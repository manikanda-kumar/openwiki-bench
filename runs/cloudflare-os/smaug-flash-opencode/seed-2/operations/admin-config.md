---
type: operations
title: "Deployment Admin Configuration"
description: The deployment-level AdminConfig — what it covers, the AdminSettings DO and its KV mirror, the one-time-check AdminApi capability, ambient gatekeeper modes, resource toggles, formats promotion, and branding.
tags: [admin, deployment, config, durable-objects, formats]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Deployment Admin Configuration

Deployment admin settings are the "soft" customizations an administrator controls from the `/admin`
panel (`AGENTS.md`): branding, agent instructions, which gatekeeper connectors/resources are offered,
auto-provisioning modes, and which blueprints are promoted as standard formats. The authoritative
type is `AdminConfig` in `packages/workshop-backend/src/admin-config.ts`.

## What AdminConfig covers (and deliberately does not)

`AdminConfig` (`src/admin-config.ts:15`) holds: `signupsEnabled`, `siteName`,
`siteLogoConfigured`, `instanceInstructions`, `announcement`, `banner`, `accentColor`,
`disabledResources`, `disabledGatekeepers`, `ambientGatekeeperModes`, and `formats`. Everything
defaults to enabled/off-as-appropriate via `DEFAULT_ADMIN_CONFIG` (`admin-config.ts:82`).

**Crucially**, authentication/authorization config — sign-in providers via `AUTH_GATEKEEPERS` and
password login via `DISABLE_PASSWORD_AUTH` — is **deliberately NOT here**. It stays env-driven
(`src/auth/config.ts`) so it cannot be changed by a compromised admin session (`AGENTS.md`). An admin
compromise thus cannot turn off a required sign-in provider or enable password login.

## Ownership and mirroring

The **`AdminSettings`** Durable Object (always addressed `getByName("")`) is the **only writer** of
the authoritative config, held as the `adminConfig` singleton in its typed storage. It mirrors a copy
to the **single reserved KV key `.adminConfig`** in the `BLUEPRINTS` namespace
(`ADMIN_CONFIG_KEY`, `src/blueprint-archive.ts:11`), so hot-path code (connect/agent) reads it with
one cheap KV get via `readAdminConfig(env)` rather than waking the singleton DO
(`AGENTS.md`; `src/admin-settings.ts:19`).

The AdminSettings DO also owns `featuredBlueprints` (the publishable mirror of featured records) and
the bundled-format-installed / promo stamps (`installedFormatBlueprints`, `promotedFormatBlueprints`),
with per-setter serialization so concurrent external KV I/O can't lose updates
(`src/admin-settings.ts:60`).

## The AdminApi capability

`AuthenticatedApi.getAdminApi()` returns a `RpcStub<AdminApi>` when the caller is a deployment admin,
else `null`. The `#isAdmin()` check happens **once** when the capability is minted
(`server.ts:100`), so the returned stub's methods need no per-call authorization. The `AdminApi`
surface (`package/workshop-shared/src/api.ts:928`) covers get/count of settings, set signups, site
name/logo, instance instructions, resource enabled toggles, gatekeeper mode, announcement, banner,
accent color, blueprint featured, and format promotion (`promoteFormat`, `removeFormat`,
`updateFormat`, `setFormatOrder`).

## Resource and gatekeeper toggles

- `disabledResources` (vendorId → disabled `urlPattern`s) and `disabledGatekeepers` hide resources/
  gatekeepers from the connect UI, the resource picker, and the agent.
- Enforcement is **soft**: disabling hides the resource; it does not revoke a capability a gadget
  already holds. `getGatekeeperClassFor()` in `user.ts` is the core chokepoint where disabled
  gatekeepers/resources are enforced before a capability is minted.
- For **auto-provisioning** ("ambient") gatekeepers, `ambientGatekeeperModes` holds the three-state
  policy — `disabled` / `optional` / `enabled` — resolved by `provisioning-policy.ts` (`shouldAutoProvisionAccount`
  checks `=== "enabled"`). `disabled` leaves an ambient account's data dormant rather than deleting
  it.

## Formats promotion

A **format** is an ordinary blueprint the deployment has promoted; `AdminConfig.formats` is the
menu-ordered list of `FormatCuration` entries (blueprintId, `enabled`, `agentHint`, and presentation
`overrides`). `AGENTS.md` notes promotion is admin curation; nothing about the blueprint itself
changes)Skipopmote. Key behaviors (`src/admin-config.ts`):

- `deploymentOutputForBlueprint`/`resolveFormatOutput` apply the deployment's presentation overrides on
  **every instantiation path**, so a deployed rename reaches gadgets the agent builds too. Overrides
  apply even when a format is disabled (disabling stops it being *offered*, not deployed naming).
- `reorderFormats` requires the submitted ids be a permutation of what's promoted (guarded against
  [:A, A] dedup loss), so a stale client can't silently drop a format (`admin-config.ts:125`).
- The agent's catalog only needs `agentHint` + binding shape; `listOutputFormats` drops those
  (`admin-config.ts:245`).
- `MAX_AGENT_HINT` (400) bounds what's injected into the system prompt every turn.

Bundled formats are promoted through `AdminSettings.#promoteBundledFormats`, once ever per blueprint:
re-deriving from the manifest would undo an admin's removal each startup; reinstalling an updated
archive refreshes a blueprint without resetting how the deployment chose to offer it
(`src/admin-settings.ts:131`).

## Featured blueprints and the Explore page

`setBlueprintFeatured` sets the authoritative `featured` bit in the **owning user's** Blueprint DO
record; `AdminSettings.#syncFeaturedMirror` reflects that into the publishable `featuredBlueprints`
mirror and refreshes stale metadata snapshots, then `#writeFeaturedSnapshot` writes the `.featured`
KV snapshot served by `listFeaturedBlueprints`. Bundled blueprints (no owning user) are written
straight into the mirror instead. Only gadget-backed published blueprints are featureable.

## Branding

The admin panel manages the site name (`setSiteName`, bounded by `MAX_SITE_NAME_LENGTH`), logo
(`setSiteLogo`, PNG bytes validated for header/size/dimensions), announcement (`setAnnouncement`,
`MAX_ANNOUNCEMENT_LENGTH`), banner (`setBanner`, text + `BANNER_COLORS`), and accent color
(`setAccentColor`, hex validated by `isHexColor` to prevent CSS injection). The `siteLogo` bytes are
served from `site-logo.ts` (`SITE_LOGO_PATH`), and R2/config are separate stores serialized so
reset/upload operations can't interleave (`src/admin-settings.ts:66`).

## Uncertainty

The exact public `avatar`/screenshot URLs and the featured-mirror key are implementation details of
`blueprint-archive.ts`/`site-logo.ts`; treat source as authoritative. Admin visibility of a resource
is also asserted by the gatekeeper's own `getSupportedResources` (which can be hidden from a user
entirely), a separate mechanism from the admin toggle.
