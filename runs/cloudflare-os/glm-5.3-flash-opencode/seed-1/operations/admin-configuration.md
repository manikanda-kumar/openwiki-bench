---
type: operations
title: Deployment Administration and Configuration
description: The AdminSettings durable object, the AdminConfig shape and its reserved KV mirror, the AdminApi capability with its minted-once admin check, the enabled-by-default opt-out conventions, feature flags, and the deployment env vars the backend actually reads.
tags: [admin, configuration, feature-flags, env-vars, deployment]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-ca45e791592e9cf3a1e0fbad
    resource: repo://packages/workshop-backend/src/deployment-config.ts
  - id: openwiki-source-353d17783830db4afb56d60a
    resource: repo://packages/workshop-backend/src/env.d.ts
  - id: openwiki-source-d6c5033ffc67d17056377c96
    resource: repo://packages/workshop-backend/src/feature-flags.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---

# Deployment Administration and Configuration

## AdminSettings: the single writer

`AdminSettings` (src/admin-settings.ts:57) is a deployment-wide singleton Durable Object (`getByName("")`, src/server.ts:599). It owns the authoritative `AdminConfig` and mirrors it to one reserved KV key (`.adminConfig`) so hot paths — the per-(re)connect `getServerConfig()` and the agent — resolve it with a single cheap KV get via `readAdminConfig(env)` (src/admin-config.ts:327-329). "Every config setter writes the same authoritative singleton and KV mirror"; the full read/modify/write is serialized on a promise tail so external KV I/O cannot let concurrent setters lose updates, and site-logo changes have their own tail so reset/upload cannot interleave (src/admin-settings.ts:62-66).

Everything in `AdminConfig` is a "soft" deployment customization, enabled by default; the admin UI opts things *out* (src/admin-config.ts:1-6). The shape (src/admin-config.ts:18-58): `signupsEnabled`, `siteName`/`siteLogoConfigured`, `instanceInstructions` (appended to the agent system prompt), `announcement` (top-bar notice), `banner`, `accentColor`, `disabledResources` (vendorId → urlPatterns), `disabledGatekeepers`, `ambientGatekeeperModes`, and `formats` (the promoted blueprints; see [Blueprints and Output Formats](/openwiki/blueprints.md)).

**Authentication/authorization config is deliberately NOT here.** `AUTH_GATEKEEPERS`, `DISABLE_PASSWORD_AUTH`, and `CF_ACCESS_AUD` stay env-var driven in `src/auth/config.ts`/server.ts so a compromised admin session cannot change them (REVIEW.md; src/auth/config.ts:1-44). The same policy applies to `getGatekeeperClassFor()` as the sole capability chokepoint (REVIEW.md, "Capability-based security").

## AdminApi: the capability

`AuthenticatedApi.amIAdmin()` checks the user's DO name against the `ADMINS` env binding (a JSON array or a string that parses as one) (src/server.ts:100-117, 588-590). `getAdminApi()` returns null for non-admins; the `#isAdmin()` check happens once when the `AdminApiImpl` capability is minted, so individual methods don't re-check (src/server.ts:592-600). The admin's user id is forwarded to gatekeepers when listing the resource catalog so RBAC-gated vendors still surface for the admin (src/admin-settings.ts:307-317).

Admin operations (src/admin-settings.ts:564+): `getSettings` (stored config plus the live per-vendor resource catalog annotated with enabled state), `updateAdminConfig(patch)`, format curation, featured-blueprint administration, and site-logo upload/reset. The format-blueprint install is coalesced onto one in-flight run (`ensureFormatBlueprintsInstalled`) and stamped complete only once the whole manifest is live, so a partial install retries (src/admin-settings.ts:77-113). Bundled formats are promoted once ever — "re-deriving the list from the manifest would undo an admin's removal on every startup" (src/admin-settings.ts:118-146).

## Ambient gatekeeper modes

Auto-provisioning vendors (e.g. the Context Library) get a per-vendor mode in `AdminConfig.ambientGatekeeperModes`, defaulting to `optional` (src/provisioning-policy.ts:12-17):

- **`disabled`** — no account is provisioned; existing ones go dormant.
- **`optional`** — users opt in from the Connectors page.
- **`enabled`** — auto-provisioned for every user, forced, and hidden from the Connectors list.

`UserDurableObject` reads AdminConfig and calls these helpers when provisioning, listing, and surfacing ambient accounts (src/provisioning-policy.ts:18-25).

## Feature flags

UI feature flags are resolved per request via `resolveUiFeatureFlags` (src/feature-flags.ts:1-52): in `DEV`, dev defaults win; otherwise a `FLAGS` Flagship binding evaluates each flag with per-user targeting, falling back to the declared default on failure (with a warning log). A missing binding logs and returns `DEFAULT_UI_FEATURE_FLAGS`.

## Env-driven deployment configuration

The backend's env surface is declared in src/env.d.ts (types generated by `pnpm types:generate` from wrangler, extended with the optional vars):

| Var | Purpose | Evidence |
| --- | --- | --- |
| `ADMINS` | Admin username array (string or JSON array binding) | src/env.d.ts:11; src/server.ts:100-117 |
| `CF_ACCESS_AUD` / `CF_ACCESS_ISS` | Cloudflare Access SSO; when set, password/gatekeeper login paths throw and the JWT is verified per request | src/env.d.ts:60-63; src/server.ts:722-748, 842-855 |
| `AUTH_GATEKEEPERS` | Allowlist of vendors permitted to drive sign-in | src/auth/config.ts:12-19 |
| `DISABLE_PASSWORD_AUTH` | Hides username/password; ignored unless at least one auth gatekeeper is allowlisted (to avoid lockout) | src/auth/config.ts:31-36 |
| `ENABLE_CLOUDFLARE_LIMITS` | Enables the free-tier/top-up flow | src/ai-gateway-billing/config.ts:24 |
| `DAILY_LLM_CALL_LIMIT` | Free-tier calls per user per UTC day | src/ai-gateway-billing/limits/config.ts:30 |
| `MINIMUM_CLOUDFLARE_BALANCE` | Minimum connected-account balance for BYOK | src/ai-gateway-billing/config.ts:16 |
| `PUBLIC_BASE_URL` | Public base URL of the deployment; in release manifests the backend carries only this var — the others (`ADMINS`, `DEPLOY_URL`, `CF_ACCESS_*`, `CF_AI_GATEWAY*`) are injected by the deploy service at PUT time, never manifest-templated | src/env.d.ts:78; manifest-lib.ts:416-418 |
| `DEV` | Dev mode switch (also picks dev feature-flag defaults) | src/feature-flags.ts:23 |
| `FLAGS` | Flagship feature-flag binding | src/feature-flags.ts:14-17 |

In local dev, `run-dev-server.ts` forwards a fixed list of these vars (`DISABLE_PASSWORD_AUTH`, `AUTH_GATEKEEPERS`, `ENABLE_CLOUDFLARE_LIMITS`, `PUBLIC_BASE_URL`, ...) from the environment/`.dev.vars` into the workers (run-dev-server.ts:482).

*Uncertain:* the backend source does not itself read `DEPLOY_URL` (no reference found in `packages/workshop-backend/src`); per the manifest generator's comment it is deploy-service-injected instance state, and the consumer is outside this repository — so its exact use is not established here.

## Where the client learns the config

`PublicApi.getServerConfig()` aggregates everything the boot sequence needs — auth vendors (queried from each allowlisted gatekeeper's `describe()` in parallel, order preserved), `passwordAuthEnabled`, `cloudflareLimitsEnabled`, and the admin branding — and "contains no secrets" (src/deployment-config.ts:1-60).
