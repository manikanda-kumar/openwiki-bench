---
type: operations
title: Configuration and Admin Settings
description: The full configuration surface of a deployment — what env vars control, what the /admin panel's AdminConfig owns (and why auth is deliberately excluded from it), the three-state ambient-gatekeeper provisioning policy, feature flags, AI Gateway billing enablement, and branding.
tags: [configuration, admin, env-vars, feature-flags, ai-gateway, provisioning]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-03120a7a50ab1a65a98ca3ef
    resource: repo://packages/workshop-backend/src/ai-gateway-billing/config.ts
  - id: openwiki-source-6a95a1b63b54e429109822de
    resource: repo://packages/workshop-backend/src/ai-gateway.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
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
  - id: openwiki-source-7e19b35717925f519c29e2c1
    resource: repo://packages/workshop-shared/src/feature-flags.ts
  - id: openwiki-source-407053357c815308038ae6a5
    resource: repo://packages/workshop-shared/src/limits.ts
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Configuration and Admin Settings

Two mechanisms configure a running instance, and the split is a security design, not a preference. This page maps both.

## The rule: env-var vs admin panel

Auth/authentication configuration is **env-var driven by design** — sign-in providers (`AUTH_GATEKEEPERS`) and password login (`DISABLE_PASSWORD_AUTH`) live in `auth/config.ts`, and the `admin-config.ts` header states the reason: auth config "stays env-var driven so it can't be changed by a compromised admin session" (packages/workshop-backend/src/admin-config.ts:1-9). Everything the admin panel can change is "soft" customization: branding, agent instructions, and which connectors/resources are offered. Conversely, `signupsEnabled` is explicitly *in* AdminConfig with a doc-comment calling out that it's an access toggle, not auth config (admin-config.ts:15-19).

The admin-config comment also records the direction of defaults: **connectors/resources default to enabled and the admin UI opts them out** (root kernel notes; enforced in user.ts paths). `DISABLE_PASSWORD_AUTH` ignores itself when no auth gatekeeper is allowlisted, so an admin can't lock everyone out (packages/workshop-backend/src/auth/config.ts:24-31).

## AdminConfig: one object, one writer, one KV mirror

`AdminConfig` fields (packages/workshop-backend/src/admin-config.ts:12-58): `signupsEnabled`, `siteName`, `siteLogoConfigured`, `instanceInstructions` (appended to the agent system prompt), `announcement`, `banner {text,color}`, `accentColor`, `disabledResources` (vendorId → disabled resource urlPatterns), `disabledGatekeepers`, `ambientGatekeeperModes`, and `formats` (the promoted output-format curation list). Defaults are all-false/empty with everything enabled (`DEFAULT_ADMIN_CONFIG`, :82-95).

Ownership and propagation (see [Backend Kernel](/openwiki/architecture/backend-kernel.md) for the mechanics):

- The **`AdminSettings` DO is the only writer** (`updateAdminConfig(patch)`), serializing read-modify-write cycles; it mirrors the authoritative object to the single reserved key `.adminConfig` in the `BLUEPRINTS` KV namespace (packages/workshop-backend/src/blueprint-archive.ts:13-17; packages/workshop-backend/src/admin-settings.ts:26-58).
- **Hot paths read the mirror with one KV get** — `readAdminConfig(env)` (packages/workshop-backend/src/admin-config.ts:326-330) — used by connect, agent prompt build, `getServerConfig`, and the disable-chokepoint in `UserDurableObject.getGatekeeperClassFor`.
- Stored config is *re-parsed defensively*: malformed entries are dropped on read (`parseFormats` skips non-objects and duplicate blueprintIds; agentHints are trimmed to `MAX_AGENT_HINT = 400` chars because every enabled format's hint lands in the system prompt every turn) (packages/workshop-backend/src/admin-config.ts:97-127).
- Admin capabilities are minted via `AuthenticatedApi.getAdminApi()` → `AdminApiImpl` bound to the singleton DO, with the admin check done once (packages/workshop-backend/src/server.ts:592-601). Format reordering throws unless the submitted order is a *permutation* of the promoted set — a stale client can't silently drop a format (admin-config.ts:129-137).
- Output-format curation is separate from a blueprint's own `output` declaration: "any user can publish a blueprint calling itself a Document, but only this list decides what the deployment offers"; per-entry `overrides` let a deployment rename ("Briefings") without editing the blueprint (packages/workshop-backend/src/admin-config.ts:48-77).

## Ambient-gatekeeper provisioning (three states)

For gatekeepers advertising `autoProvisionsAccount`, the admin picks a per-vendor mode in the Gatekeepers panel, resolved **only** through `provisioning-policy.ts`: `disabled` (nobody, existing accounts dormant), `optional` (**default** — each user opts in from Connectors; "we don't impose ambient authority on every user unless an admin explicitly turns it on"), `enabled` (forced for every user, hidden from the Connectors list) (packages/workshop-backend/src/provisioning-policy.ts:1-26; `ambientGatekeeperModes` doc at packages/workshop-backend/src/admin-config.ts:41-46). Tolerant of pre-field stored configs (`?.[...] ?? "optional"`). Consumer of the decision: the user DO provisioning path and the Overseer's ambient-capsule install (see [Context Library and Scheduler](/openwiki/integrations/context-library-scheduler.md)).

## The env-var surface (backend)

Declared optionals at the RPC root (`CF_ACCESS_AUD`, `CF_ACCESS_ISS`, `DEV`, `FLAGS`) (packages/workshop-backend/src/server.ts:64-69); `wrangler.jsonc` supplies the rest by convention. The main ones:

| Variable | Effect | Evidence |
|---|---|---|
| `AUTH_GATEKEEPERS` | Comma list of vendors offering sign-in; order = button order | packages/workshop-backend/src/auth/config.ts:8-20 |
| `DISABLE_PASSWORD_AUTH=true` | OAuth-only (no-op unless allowlist non-empty) | auth/config.ts:24-31 |
| `CF_ACCESS_AUD` / `CF_ACCESS_ISS` | Cloudflare Access mode; JWT verified at the fetch root | server.ts:838-856 |
| `ADMINS` | Admin usernames (JSON array string or array binding) | server.ts:100-118 |
| `PUBLIC_BASE_URL` | The instance's public origin (router URL); manifests template it, OAuth redirects depend on it | scripts/release/manifest-lib.ts:410-419 |
| `ENABLE_CLOUDFLARE_LIMITS=true` | Enables the free-tier/BYOK billing flow; off = unlimited, self-hosted posture | packages/workshop-backend/src/ai-gateway-billing/config.ts:18-25 |
| `DAILY_LLM_CALL_LIMIT` / `MINIMUM_CLOUDFLARE_BALANCE` | Free-tier daily calls (default 100) / BYOK balance floor (default $2.00) | packages/workshop-backend/src/ai-gateway-billing/limits/config.ts:31-41; ai-gateway-billing/config.ts:8-16; packages/workshop-shared/src/limits.ts:11-16 |
| `CF_AI_GATEWAY`, `CF_AI_GATEWAY_ACCOUNT_ID`, `CF_AI_GATEWAY_API_TOKEN`, `CF_AI_GATEWAY_PROVIDERS`, `CF_AI_GATEWAY_USE_BINDING` | Platform AI Gateway (free-tier transport) | docs/ai-gateway-billing.md:26-47; packages/workshop-backend/src/ai-gateway.ts:48-60 |
| `FORMAT_BLUEPRINTS_DIR` | Build-time swap of the shipped format-blueprint set | scripts/build-format-blueprints.mjs:16-22 |

Gatekeeper Workers get their *own* env (`CLIENT_ID`/`CLIENT_SECRET` etc. live on the gatekeeper, never the backend; the backend's other vars are injected by the deploy service — see [Router, Release Pipeline](/openwiki/operations/router-and-release-pipeline.md)).

### Gateway transport subtleties

`getAiGatewayConfig` throws without `CF_AI_GATEWAY_ACCOUNT_ID`, and defaults to the `WORKERS_AI` **binding** transport when present — binding calls are pre-authenticated, so no API token — *unless* `CF_AI_GATEWAY_USE_BINDING=false` (normalized: a stray `" False "` opts out rather than silently choosing the other transport). The opt-out exists because binding requests only reach gateways in the Worker's own account and the Worker cannot verify that itself; the flag is used instead of unbinding because `WORKERS_AI` also powers webFetch's `toMarkdown` (packages/workshop-backend/src/ai-gateway.ts:36-50). The `google` provider is HTTPS-token-only because pi's adapter refuses a custom fetch (ai-gateway.ts:11-25).

## Feature flags

UI flags are a registered list in `workshop-shared/feature-flags.ts` (key + dev + default; currently just a placeholder) resolved per user by the backend: `DEV` mode uses dev values; no `FLAGS` (Flagship) binding means defaults with a warn log; per-flag evaluation failures fall back individually (packages/workshop-shared/src/feature-flags.ts:1-29; packages/workshop-backend/src/feature-flags.ts:18-50). The frontend consumes them through `FeatureFlagsContext`.

## Branding and boot config

`getServerConfig` composes both worlds at connect time — env-driven auth facts (`passwordAuthEnabled`, resolved sign-in vendor list via parallel `describe()` RPCs) plus admin-config branding (`siteName`, `siteLogo` presence, `announcement`, `banner`, `accentColor`) — explicitly containing no secrets and running the KV read concurrently with the vendor queries so reconnects don't serialize (packages/workshop-backend/src/deployment-config.ts:1-62). Site name falls back to `"Cloudflare OS"` via `resolveSiteName`; logo bytes live in R2 (`site-logo.ts`, served at a fixed path).

## Failure and consistency behavior

- A stale KV mirror (a DO write succeeded, the KV put failed) is self-healing: subsequent config setters re-mirror, and the format installer re-stamps rather than skipping (packages/workshop-backend/src/admin-settings.ts:145-160, 350-367).
- The featured-blueprint and admin-config mirrors both live in the *same* KV namespace with reserved keys, so `PublicApi.getBlueprint` can't be coerced into reading them (packages/workshop-backend/src/blueprint-archive.ts:10-38).
- Gatekeeper/resource disabling is enforced only at the capability-minting chokepoint, so admin changes take effect from the next `newGatekeeper`/connect — already-minted capabilities are not retroactively revoked by a config flip (packages/workshop-backend/src/user.ts:1670-1690).
