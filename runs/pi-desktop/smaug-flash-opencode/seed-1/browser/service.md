---
type: reference
title: Built-in Browser Service
description: The Main-owned WebContentsView browser within Pi Agent Desktop — profiles, tabs, agent authorization and permission model, the policy engine, network interception and header rules, downloads, secret vault, and advanced browser mode.
tags: [browser, webcontentsview, policy, profiles, authorization]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-59d3c8d5b7ce842ca5bc7496
    resource: repo://src/contract/browser.ts
  - id: openwiki-source-19fc7473bfc0b4d9fd5a832f
    resource: repo://src/main/browser/browser-authorization-coordinator.ts
  - id: openwiki-source-5187b316f200b41a83832424
    resource: repo://src/main/browser/browser-network-interceptor.ts
  - id: openwiki-source-7bae2eb4b8f21c53df9aad0d
    resource: repo://src/main/browser/browser-policy.ts
  - id: openwiki-source-a9485bab3420888add71e1f7
    resource: repo://src/main/browser/browser-profile-manager.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-237e62042dfac18df827c94f
    resource: repo://src/main/browser/browser-tab-manager.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Built-in Browser Service

Pi Agent Desktop embeds a Chromium browser as a Main-owned `WebContentsView`
surface so the user and the Agent share the same live page. It is implemented
in `src/main/browser/browser-service.ts` and coordinated by a policy engine, an
authorization coordinator, a tab manager, profile manager, network interceptor,
and secret vault.

## Why Main owns it

The browser tabs run in `WebContentsView`s created and owned by the Main
process. They get **no app preload, no Node, and no Renderer bridge**; remote
sites and localhost project pages are sandboxed with their own Chromium
session/partition. Main mediates every operation, so a compromised or hostile
web page cannot reach the desktop UI or the agent runtime directly.

## Settings and policy engine

`BrowserPolicyEngine` (`browser-policy.ts`) holds the effective
`BrowserSettingsV2` (versioned via `BROWSER_SETTINGS_VERSION = 3`) and exposes:

- `getSettings()` — a structured clone of the current settings.
- `getSnapshot()` — a `BrowserCapabilitySnapshot` with a monotonically
  increasing `revision`, browser/automation/advanced enable flags, and the
  per-session permission map.
- `grantSession`, `revokeSession`, `revokeAll` — grant/revoke per-session
  permissions.
- `issueLease` / `getLeaseForSession` / `assertRequest` — short-lived capability
  leases (attached to a revision) that every agent browser call must present.

Any settings change that flips a capability boundary (enabled, automation,
advanced, channel-session allowance) clears grants and leases and bumps the
revision (`browser-policy.ts:85-91`). `assertRequest` rejects a request with a
stale `policyRevision` (`POLICY_REVISION_MISMATCH`), an expired/mismatched
lease, or insufficient permission (`browser-policy.ts:160-191`).

## Permission model

Permissions are hierarchical: `none < read < interact < advanced`.

- `read` — navigate, snapshot, inspect, screenshot.
- `interact` — click, type, press, scroll, back/forward, reload.
- `advanced` — execute JavaScript, CDP, network replay, cookie/header
  overrides, visual comparison — all gated on Advanced Browser Mode.

Coding tool permissions never implicitly grant browser access. The Agent must
first request authorization for a session (`BrowserAuthorizationCoordinator`);
the user can allow once (a runtime session grant, TTL 8h by default) or rely on
a persistent per-session policy (`browser-session-grants.json`).

`BrowserAuthorizationCoordinator` serializes an authorization UI request per
session, applies persistent policy (`deny` short-circuits, or a grant at/above
the requested tier), introduces a deny cooldown, and reports outcomes
(`browser-authorization-coordinator.ts:49-100`, `:71-100`). Advanced-browser
grants come only from a user confirmation flow in Main.

## Tabs and profiles

`BrowserTabManager` (`browser-tab-manager.ts`, ~2900 lines) creates, navigates,
snapshots, screenshots, clicks, types, presses, scrolls, waits, inspects, reads
console/network, executes JS, and drives CDP for each tab. Each tab is bound to
a profile.

`BrowserProfileManager` (`browser-profile-manager.ts`) manages partitions
(`ephemeral`, `persistent`, or `unsafe` for advanced mode) and their Chromium
`Session`s. Persistent profiles share login state and are persisted in
`browser-profiles.json`; the default profile id is `temporary`. Tabs restore
across launches via `browser-tabs.json` (debounced). Unsafe/advanced profiles
are never restored.

User actions (open a tab, navigate) are owned by the user; the same tab can be
taken over by the Agent after authorization summarised in the UI.

## Network interception and header rules

A per-profile `BrowserNetworkInterceptor` (`browser-network-interceptor.ts`)
implements navigation policy, private-network protection, and request/response
header rules. In Advanced Browser Mode it also records request bodies, replay,
and identity (UA/client hints).

- Local header rules are stored per profile/direction in
  `browser-header-rules.json` (`BrowserHeaderRuleStore`).
- Agent-set header rules are scoped to a session (`BrowserAgentHeaderRuleRegistry`
  + `browser-service.ts` `setAgentRules`) and cleared when the session ends.
- Header-rule secrets are `safeStorage`-encrypted in `browser-secrets.json`
  and referenced by opaque ref (`browser-secret-vault.ts`).

Private-network protection is marked best-effort: when a controlled network
sandbox is not deployed, `strict` network isolation refuses private-network
requests directly.

## Downloads and uploads

`BrowserDownloadManager` routes downloads through configurable policy
(`ask`/`deny`/`allow-to-directory`) with an optional save-path flow. Uploads go
through a choose-path flow. Downloads/upload status is surfaced in the
`BrowserRendererState`.

## Advanced Browser Mode

Advanced mode (`advancedBrowserMode.enabled`) is a single opt-in toggle with
`persistence: "this-launch"` only (never persisted, cleared across launches). It
enables a derived runtime policy that removes site-security headers, disables
web security, allows insecure content, and allowlists certificate-bypass
domains (`browser-policy.ts:64-75`). Advanced capabilities include:

- CDP command passthrough (allowlisted methods),
- request/response header overrides,
- cookie access scope (currently gated — see below),
- custom UA / client-hint identity profiles,
- network capture and approved write-request replay,
- a JavaScript "page code" library (`browser-page-snippets.json`).

Advanced tabs run on `unsafe` profiles, use an isolated identity, and are never
restored across launches. Enabling or disabling advanced mode cancels agent
actions and closes unsafe tabs.

## Cookie gate (unresolved)

`browser.getCookies` and `browser.setCookies` deliberately throw
`SENSITIVE_RESULT_UNAVAILABLE`: full cookie values are not returned to the
Agent until Pi's ToolResult persistence has a verified
model-only/full-value secret channel that cannot leak credential values into the
session JSONL (`browser-service.ts:1020-1041`). The README documents cookie
access as currently unavailable for this reason.

## Headless restrictions

The browser surface supports some operations only when an interactive renderer
exists (`BrowserAuthorizationCoordinator` requires a live window). When Host
authorization requests cannot reach the renderer (e.g. renderer unavailable),
capability requests fail with `CAPABILITY_DISABLED`.

## Related pages

- Architecture Overview
- Persistence and State Surface
- Configuration, Models, and Credentials
- Messaging Channels
