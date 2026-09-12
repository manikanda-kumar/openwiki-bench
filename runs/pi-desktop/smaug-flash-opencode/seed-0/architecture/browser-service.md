---
type: architecture
title: Built-in Browser Service
description: The in-app Chromium browser shared by user and agent — WebContentsView surface, profiles and tabs, agent authorization and confirmation flows, network policy and interceptor, header rules, secret vault, and downloads.
tags: [architecture, browser, authorization, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-19fc7473bfc0b4d9fd5a832f
    resource: repo://src/main/browser/browser-authorization-coordinator.ts
  - id: openwiki-source-e8f855fbe713662dd27950bc
    resource: repo://src/main/browser/browser-confirmation.ts
  - id: openwiki-source-f4cdbdc0e1108a244c58712b
    resource: repo://src/main/browser/browser-persistent-grant-store.ts
  - id: openwiki-source-7bae2eb4b8f21c53df9aad0d
    resource: repo://src/main/browser/browser-policy.ts
  - id: openwiki-source-a9485bab3420888add71e1f7
    resource: repo://src/main/browser/browser-profile-manager.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-a6b19894c7563906c1c77f1e
    resource: repo://src/main/browser/browser-settings.ts
  - id: openwiki-source-237e62042dfac18df827c94f
    resource: repo://src/main/browser/browser-tab-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Built-in Browser Service

The built-in browser is an Electron `WebContentsView` surface rendered beside
the chat UI. Main owns the browser entirely; a capability snapshot is pushed
to the Agent Host so the agent's browser tools can be enabled per session. The
user and the agent operate the same pages.

## Ownership and entrypoint

`src/main/browser/browser-service.ts` builds `BrowserService`, constructed in
`src/main/main.ts` with the shared `userDataDir`. It wires several collaborators:

- `BrowserPolicyEngine` — permission grants/leases and the capability snapshot;
- `BrowserSettingsStore` — persisted `browser-settings.json`;
- `BrowserPersistentGrantStore` — persisted per-session permissions
  (`browser-session-grants.json`);
- `BrowserConfirmationManager` — expiring, content-bound confirmation proofs;
- `BrowserSecretVault` — safeStorage-backed secret storage
  (`browser-secrets.json`);
- `BrowserHeaderRuleStore` — persisted header rule presets
  (`browser-header-rules.json`);
- `BrowserSnippetStore` — persisted page snippets;
- `BrowserProfileManager` and `BrowserTabManager` — profiles and tabs;
- `BrowserTabRestoreStore` — persisted tab-restore records (`browser-tabs.json`).

The renderer controls the browser exclusively through the `piBridge.browser*`
methods defined in `src/contract/desktop.ts`. `computer`-side events flow to the
renderer over `browser:event`.

## The shared surface, tabs and profiles

`BrowserTabManager` (uses `WebContentsView`) owns the live surface. It is the
only real Chromium runtime in the app and survives a Renderer reload; on Renderer
reload the browser clears agent actions and restores (comment in
`browser-service.ts`). `BrowserProfileManager` manages profiles backed by
Electron `Session` partitions; there is a default temporary profile
(`DEFAULT_BROWSER_PROFILE_ID = "temporary"`), ephemeral profiles, persistent
profiles (max 16), and `unsafe` profiles reserved for the high-risk advanced
mode. Tabs auto-restore from `browser-tabs.json` (debounced restores) when the
service starts.

## Agent authorization model

Coding permissions never imply browser rights — browser access is granted
independently and narrowly. The permission lattice is
`none < read < interact < advanced`.

- **Persistent permissions** (`BrowserPersistentSessionPermission`) are stored
  per session in `BrowserPersistentGrantStore` and consulted at request time
  (`browser-policy.ts`). Values: `inherit | ask | deny | read | interact | advanced`.
- **Runtime session grants** are short-lived (`RUNTIME_GRANT_TTL_MS = 8 h`)
  grants created when an approval is granted, held in `BrowserService.runtimeGrants`.
- **Leases** (`BrowserCapabilityLease`) are the per-call mechanism: each
  browser host request carries a `capabilityLeaseId` and a `policyRevision`.
  `BrowserPolicyEngine.assertRequest` checks the lease is unexpired
  (`leaseTtlMs`, default 15 min), the policy revision matches, the session owns
  the lease, and the lease's permission ranks at or above the required level.
  Any policy change (bump) clears all leases so stale agent calls fail with
  `POLICY_REVISION_MISMATCH`, forcing the agent to refresh capabilities and
  re-request.

`BrowserAuthorizationCoordinator` serializes approvals per session: it checks
the persistent policy, grants `persistent-policy` approvals immediately when the
policy already covers the required permission, and otherwise shows a one-shot
prompt that resolves `deny | allow-session`. Denied sessions enter a short
cooldown, and pending requests carry a 60 s timeout. The `allow-session`
decision grants a runtime session grant (source `user-prompt`) at the requested
permission. Advanced (`advanced`) permission additionally requires the
high-risk advanced mode to be enabled; channel-sourced sessions are gated by
`automation.allowChannelSessions`.

## Confirmation dialogs

`BrowserConfirmationManager` issues single-use, expiring
`BrowserConfirmationProof`s with a content digest and a default 2 minute TTL.
Sensitive or irreversible operations — enabling advanced browser mode,
replaying a recorded request, changing header rules, external-protocol launch,
cross-origin browser routing, and private-network access — require the renderer
to return a matching proof (`issue`/`consume`). The proof binds `kind` and
payload; a mismatched, expired, or already-consumed proof is rejected.

## Network policy and interceptor

`BrowserPolicyEngine` gates host requests. `BrowserService` wires a
`BrowserNetworkInterceptor` per profile to enforce network policy, log requests,
record response bodies (under `browser-network-bodies`), and monitor console
output when advanced mode is enabled. Downloads flow through
`BrowserDownloadManager`, uploads through confirmed file pickers, and external
protocols through an `openExternalWithConfirmation` path.

The **advanced browser mode** (`advancedBrowserMode.enabled` in settings, gated
by the `advanced-browser-mode` confirmation) unlocks higher-risk capabilities:
removing site security headers, disabling web security, allowing insecure
content, a certificate-bypass domain list, and unrestricted raw CDP. This mode
is `this-launch` persistent only. `createDisabledAdvancedRuntimePolicy` returns
a policy that disables all these knobs; `BrowserPolicyEngine.downgradeAdvancedGrants`
downgrades running `advanced` grants to `interact` the moment advanced mode is
turned off. When advanced mode is off, `unsafe` profiles cannot be created.

## Header rules and secret vault

`BrowserHeaderRuleStore` persists request/response header rules per profile
(`browser-header-rules.json`). Rules can be user-defined or agent-enforced via
`BrowserAgentHeaderRuleRegistry`; they are validated by `browser-header-rules.ts`
before being applied through the profile `Session`'s `webRequest` API. Header
secrets are never stored plainly: `BrowserSecretVault` wraps
`safeStorage.encryptString`/`decryptString` and stores encrypted blobs, with
values referenced by opaque `secretRef`s so the renderer and logs never carry
the plaintext.

## Capability snapshot sync to the Agent Host

`BrowserService.onCapabilitySnapshot` is wired in `main.ts` to
`hostManager.setBrowserCapabilitySnapshot`. The `BrowserPolicyEngine`
`getSnapshot()` publishes `{ revision, browserEnabled, automationEnabled,
advancedEnabled, sessionPermissions }`. On Host ready (and on changes) the main
process pushes this snapshot via `browser:init` / `browser:changed`; the Host
applies it in `browserCapabilityRuntime` and then calls `syncBrowserToolsForAllSessions`
(`src/agent-host/index.ts`) so each session's browser tool set matches the
policy. The Host must observe the same `policyRevision` that the snapshot
carried or its calls fail with `POLICY_REVISION_MISMATCH`. On Host stop,
`BrowserService.onHostStopped` revokes all policy/grants and agent tab actions.

## Failure behavior

`BrowserError` code categories (in `src/contract/browser.ts`) cover permission
decisions, leases (`CAPABILITY_LEASE_EXPIRED`, `POLICY_REVISION_MISMATCH`),
navigation failures (`NAVIGATION_BLOCKED`, `PRIVATE_NETWORK_BLOCKED`), retries
(`BROWSER_RETRY_BLOCKED`), call budgets (`BROWSER_CALL_BUDGET_EXCEEDED`),
request-replay, downloads/uploads (`DOWNLOAD_DENIED`, `UPLOAD_DENIED`), and
JavaScript inspection limits. Host methods are validated with
`isBrowserHostMethod`; unknown methods raise `INVALID_BROWSER_REQUEST`. Host
requests are audited (method/params/outcome) except for `browser.capabilities`.
