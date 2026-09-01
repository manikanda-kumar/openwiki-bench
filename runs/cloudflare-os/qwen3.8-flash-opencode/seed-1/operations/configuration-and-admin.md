---
type: operations
title: Configuration and Admin Settings
description: The two configuration surfaces — env-var-driven auth/config vs the AdminConfig soft customizations owned by the AdminSettings DO and mirrored to KV — plus connector enable/disable defaults, ambient provisioning modes, branding, feature flags, and the AI Gateway limits flow.
tags: [configuration, admin, kv, feature-flags, branding, limits]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-9b6f6a87a13c3accb0afc329
    resource: repo://docs/ai-gateway-billing.md
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-ca45e791592e9cf3a1e0fbad
    resource: repo://packages/workshop-backend/src/deployment-config.ts
  - id: openwiki-source-d6c5033ffc67d17056377c96
    resource: repo://packages/workshop-backend/src/feature-flags.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Configuration and Admin Settings

Configuration splits in two along a security line: **env vars** (immutable from an admin session)
and **`AdminConfig`** (soft, admin-editable). The split is deliberate and enforced by review
(packages/workshop-backend/src/admin-config.ts#L1-L9, REVIEW.md#L33-L37).

## Env-var configuration

Sign-in providers (`AUTH_GATEKEEPERS` allowlist), `DISABLE_PASSWORD_AUTH`, Cloudflare Access
(`CF_ACCESS_AUD`/`CF_ACCESS_ISS`), `ADMINS`, `DEPLOY_URL`, and `ENABLE_CLOUDFLARE_LIMITS` live in
the environment (`auth/config.ts`, the server `Env` type,
docs/public-server.md#L7-L18) — authentication/authorization config must stay env-var driven "so
it can't be changed by a compromised admin session" (packages/workshop-backend/src/admin-config.ts#L5-L7).
The public boot config, `getServerConfig()` → `ServerConfig`, *aggregates* all three sources
(env-driven auth, AI Gateway billing, admin branding) and "contains no secrets"
(packages/workshop-backend/src/deployment-config.ts#L1-L12). Sign-in vendor buttons are resolved in
parallel with order preserved from the allowlist, skipping non-responders
(packages/workshop-backend/src/deployment-config.ts#L14-L42).

## AdminConfig: one object, one writer, one KV mirror

`AdminConfig` covers signups-enabled, site name/logo, `instanceInstructions` (appended to the
agent system prompt), announcement/banner/accent color, `disabledResources`/`disabledGatekeepers`,
per-vendor `ambientGatekeeperModes`, and the promoted `formats` list — everything **enabled by
default**, with the admin UI opting things *out* (packages/workshop-backend/src/admin-config.ts#L11-L79,
L82-L91).

The `AdminSettings` Durable Object — always addressed `getByName("")` — owns the authoritative
value and is the **only writer**; it publishes to the reserved `BLUEPRINTS` KV key `.adminConfig`
so connect/login/agent hot paths resolve the whole config with one cheap KV get instead of waking
a singleton DO (packages/workshop-backend/src/admin-settings.ts#L51-L58;
`readAdminConfig` at packages/workshop-backend/src/admin-config.ts#L327,
`ADMIN_CONFIG_KEY` at packages/workshop-backend/src/blueprint-archive.ts#L13-L16).
Stored JSON is defensively parsed — malformed entries dropped, duplicate `blueprintId`s and
over-long `agentHint`s clamped (max 400 chars, since every hint lands in every system prompt)
(packages/workshop-backend/src/admin-config.ts#L94-L120).

Admin operations are exposed as an `AdminApi` RPC capability from `getAdminApi()`, which is `null`
for non-admins — the check happens once at minting, not per method
(packages/workshop-shared/src/api.ts#L712, L921-L927).

## Formats and the bundled set

`AdminConfig.formats` decides what the deployment *offers* as standard output formats — a user
blueprint may call itself a "Document", but only this curation list promotes it
(packages/workshop-backend/src/admin-config.ts#L50-L57). Each entry can be disabled without losing
the admin's overrides, and the blueprint itself supplies noun/plural/icon unless overridden
(packages/workshop-backend/src/admin-config.ts#L58-L78). The bundled install/promotion machinery —
fingerprinted reinstall, first-visitor install trigger, per-blueprint one-time promotion — is
covered in [How to Add a Format Blueprint](../guides/adding-a-format-blueprint.md)
(packages/workshop-backend/src/admin-settings.ts#L35-L42, L89-L153).

## Gatekeeper enablement and ambient modes

Disabled vendors/resources are enforced at the one chokepoint when capabilities are minted
(`UserDurableObject.getGatekeeperClassFor()`), even though listings are *also* filtered
(packages/workshop-backend/src/user.ts#L1673-L1690;
`isResourceDisabled`/`filterEnabledResources` at
packages/workshop-backend/src/admin-config.ts#L333-L349). Auto-provisioning gatekeepers add the
three-state mode (disabled/**optional**/enabled), where optional is the default specifically
because ambient authority shouldn't be imposed on every user without an explicit admin choice
(packages/workshop-backend/src/provisioning-policy.ts#L1-L34).

## Feature flags and branding

UI feature flags resolve per user through an optional `FLAGS` (Flagship) binding; `DEV` mode gets
dev defaults and a missing binding falls back to defaults with a warning rather than failing
(packages/workshop-backend/src/feature-flags.ts#L5-L48). Branding specifics: site name capped at
40 chars with a `resolveSiteName()` fallback, logo images capped at 256 KiB / 512 px and stored
separately from the config record (`siteLogoConfigured` flag; bytes in R2), announcement and
instructions bounded at 2,000/8,000 chars (packages/workshop-shared/src/api.ts#L742-L855,
packages/workshop-backend/src/site-logo.ts).

## AI Gateway usage limits

`ENABLE_CLOUDFLARE_LIMITS=true` turns on the public-service billing posture: a free per-user
daily LLM allowance (default 100 calls, counted on the user DO), and once exhausted users may top
up by connecting their own Cloudflare account — a connected user with ≥ $2 balance is routed to
their *own* account even while free calls remain, so the platform is never billed for funded
users; blocked states return connect/add-credits prompts (docs/ai-gateway-billing.md#L3-L25,
packages/workshop-backend/src/ai-gateway-billing/). The knobs are independent: sign-in allowlist,
per-gatekeeper OAuth credentials, limits flag, and password-auth disable compose rather than
replace each other (docs/public-server.md#L5-L14).

## Change guide

To add a new admin setting: extend `AdminConfig` + `DEFAULT_ADMIN_CONFIG` (admin-config.ts), patch
it via `updateAdminConfig` on the DO (the sole writer), surface it in `AdminApi`/
`AdminSettingsView` (admin-settings.ts + api.ts — remember the kernel doc-comment bar), and read
it on hot paths through `readAdminConfig(env)` only.
