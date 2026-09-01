---
type: operations
title: Admin Settings and Configuration
description: The two configuration planes of a deployment — env-var-driven auth/hard config vs the AdminSettings-DO-owned soft AdminConfig mirrored to KV — how hot paths read it, and what the admin panel can govern (connectors, provisioning modes, branding, formats, flags).
tags: [configuration, admin, durable-objects, feature-flags, deployment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-ca45e791592e9cf3a1e0fbad
    resource: repo://packages/workshop-backend/src/deployment-config.ts
  - id: openwiki-source-d6c5033ffc67d17056377c96
    resource: repo://packages/workshop-backend/src/feature-flags.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Admin Settings and Configuration

A running deployment is configured from two planes that are deliberately kept apart.

## The split, and why

**Env-var (hard) config** covers everything authentication/authorization-shaped — sign-in providers (`AUTH_GATEKEEPERS`), password login (`DISABLE_PASSWORD_AUTH`), Access (`CF_ACCESS_AUD`/`CF_ACCESS_ISS`), inference routing (`CF_AI_GATEWAY*`), limits (`ENABLE_CLOUDFLARE_LIMITS`), admins (`ADMINS`) — and *must not* move into soft config, "so a compromised admin session cannot change it"; reviewer guidance is to reject relocation outright (packages/workshop-backend/src/auth/config.ts#L1-L33; REVIEW.md#L31-L33). Boot-time *view* of both planes goes to the client in one cheap call: `getServerConfig()` merges env-derived auth availability with KV-derived branding, running the KV get and the per-vendor `describe()` RPCs concurrently so a cache-cold AdminSettings read never serializes ahead of N cross-worker calls on every reconnect (packages/workshop-backend/src/deployment-config.ts#L42-L61).

**AdminConfig (soft) config** covers site name/logo, announcement/banner/accent theme, agent instance instructions, `signupsEnabled`, which connectors/resources are offered, ambient provisioning modes, and format curation (packages/workshop-backend/src/admin-config.ts#L15-L60).

## Ownership and the hot path

The `AdminSettings` Durable Object — always addressed as `getByName("")` — holds the authoritative config and is **the only writer** (`updateAdminConfig(patch)`, serialized read-modify-write so concurrent setters can't lose updates across the KV await); every mutation mirrors the whole object to a single reserved key in the `BLUEPRINTS` KV namespace (`.adminConfig`, protected by `isReservedBlueprintKey()`) so user-facing hot paths — connect, login, agent turns — take *one KV get* and never touch the singleton DO (packages/workshop-backend/src/admin-settings.ts#L29-L65; packages/workshop-backend/src/admin-config.ts#L327-L329; blueprint-archive.ts#L9-L22). `parseAdminConfig` is tolerant (wrong-typed fields fall back to defaults) because a KV read can predate any field (packages/workshop-backend/src/admin-config.ts#L280-L315). The DO also keeps its own state: the *mirror* of featured blueprints (the owner User DO holds the authoritative bit), the installed-format fingerprint stamp, and a separate `promotedFormatBlueprints` list so a bundled format is auto-promoted exactly once per blueprint — an admin who deletes a promotion keeps it deleted (admin-settings.ts#L20-L50).

Admin operations surface as an `AdminApi` capability returned by `AuthenticatedApi.getAdminApi()` — `null` for non-admins, with the `ADMINS` check happening **once at mint** so individual methods (`setSignupsEnabled`, `setInstanceInstructions` with a length cap, `setResourceEnabled`, `setGatekeeperMode`, banner/logo setters…) don't re-check (packages/workshop-shared/src/api.ts#L928-L1000; packages/workshop-backend/src/server.ts#L588-L600; UI: packages/workshop-frontend/src/AdminPage.tsx).

## Connector and resource governance

Defaults are permissive: connectors and their resource types are offered unless the admin opts *out* (`disabledGatekeepers`, `disabledResources: vendorId → urlPatterns`) (packages/workshop-backend/src/admin-config.ts#L36-L40, #L83-L93). Enforcement does not depend on UI filtering: `isResourceDisabled`/`filterEnabledResources` shape listings, and the single chokepoint `UserDurableObject.getGatekeeperClassFor()` re-checks policy **before minting any gatekeeper capability**, so gadget/agent code cannot reach a disabled resource (packages/workshop-backend/src/admin-config.ts#L330-L345; packages/workshop-backend/src/user.ts#L1123, #L1447, #L1666-L1690; REVIEW.md#L26-L30).

Auto-provisioning ("ambient") gatekeepers invert the default: the admin's per-vendor mode is resolved exclusively through `provisioning-policy.ts` — `disabled` / `optional` (**default**: per-user opt-in from Connectors) / `enabled` (forced, hidden, non-removable) — and the existing-account consequences (dormant on disable, forced on enable) are documented at the source (packages/workshop-backend/src/provisioning-policy.ts#L1-L32; see [Gatekeeper Framework](../gatekeepers/framework.md)). A gatekeeper can never assert its own ambience; provisioning flows through the User DO with the account capability as the resulting authority.

## Formats curation

`AdminConfig.formats` is the deployment's list of promoted output-format blueprints — `{blueprintId, enabled, agentHint?, overrides?}`, order is menu order. Crucially, "any user can publish a blueprint calling itself a Document, but only this list decides what the deployment offers" (packages/workshop-backend/src/admin-config.ts#L42-L57). Resolution (`listPromotedFormats`/`listFormatOffers`) joins entries with current blueprint metadata, applies admin `overrides` over the blueprint's declared `output`, silently skips unresolvable/deleted entries in user-facing lists while the admin panel offers to remove them, and strips agent-only fields (`agentHint`, `bindings`) from the user-facing `listOutputFormats` (packages/workshop-backend/src/admin-config.ts#L215-L260; packages/workshop-backend/src/server.ts#L307-L311). Promotion keys on `blueprintId`, hence the never-rename-after-deploy rule ([How to Add a Format Blueprint](../guides/adding-a-format-blueprint.md)).

## Feature flags

UI flags resolve server-side per user through `resolveUiFeatureFlags`: `DEV=true` yields the dev flag set; otherwise the Cloudflare **Flagship** binding (`FLAGS`) is queried; a *missing* binding logs `feature-flags.binding.missing` and falls back to defaults rather than failing (packages/workshop-backend/src/feature-flags.ts#L15-L40; flag names/capabilities declared in packages/workshop-shared/src/feature-flags.ts). The frontend consumes them through `FeatureFlagsContext`.

## Gotchas for changers of this area

- New AdminConfig fields need a `parseAdminConfig` fallback, because already-deployed KV mirrors won't have the key (admin-config.ts#L280-L315).
- Any *new writer* of AdminConfig violates the single-writer rule — extend `AdminSettings`, don't mirror its write (REVIEW.md#L36-L37).
- The DO never wakes on deploy alone: anything install-time must hang off request traffic (the format-blueprint first-request trigger is the pattern) (packages/workshop-backend/src/server.ts#L816-L838).
- Auth-plane changes belong in `auth/config.ts` env parsing, not here — by design (REVIEW.md#L31-L33).
