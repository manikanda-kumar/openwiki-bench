---
type: concept
title: Built-in browser
description: The main-process-owned WebContentsView browser that shares pages between the user and the agent, enforcing per-session permission grants, leases, policy revisions, network isolation, advanced-mode capabilities, and a structured error/recovery model.
tags: [browser, webcontents-view, permissions, cdp, network-policy, profiles]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T15:27:00.466Z
---

# Built-in browser

The built-in browser is owned by the Electron main process (`BrowserService` in `src/main/browser/browser-service.ts`). It renders remote pages and localhost project pages in `WebContentsView` tabs that never receive the app preload, Node, or the renderer bridge. The user and the agent operate the same page; the agent can only act under explicit, expiring Browser authorization.

## Component graph

`BrowserService` composes the following managers:

- **`BrowserPolicyEngine`** (`browser-policy.ts`) — the security authority: browser enablement, automation enablement, per-session grants, capability leases, and policy revisions.
- **`BrowserAuthorizationCoordinator`** (`browser-authorization-coordinator.ts`) — turns a required permission into a user prompt; resolves through persistent policy, a single queued dialog, deny cooldowns, and timeouts.
- **`BrowserProfileManager`** (`browser-profile-manager.ts`) — ephemeral vs persistent Electron `Session` partitions (persistent profiles stored in `<userData>/browser-profiles.json`; `temporary` is the built-in ephemeral default, max 16 persistent profiles).
- **`BrowserTabManager`** (`browser-tab-manager.ts`) — tab lifecycle, navigation, snapshots, clicks/input, screenshots, CDP coordination, console buffer, network recording, identity profiles, uploads/downloads.
- **`BrowserNetworkInterceptor`** + **`BrowserNetworkPolicy`** — request/response header rules, secret-backed header values, URL/protocol/private-network checks and DNS-based isolation checks.
- **`BrowserDownloadManager`**, **`BrowserConfirmationManager`**, **`BrowserHeaderRuleStore`**, **`BrowserSnippetStore`**, **`BrowserSecretVault`**, **`BrowserPersistentGrantStore`**, **`BrowserTabRestoreStore`**.

## Permission model and capability snapshot

Permissions are ranked `none < read < interact < advanced` (`src/contract/browser.ts`). Agent tools map to a required level (`src/agent-host/browser-tools.ts` `BROWSER_TOOL_PERMISSIONS`): navigation/snapshot/screenshot are `read`; click/type/press/scroll are `interact`; JavaScript execution, cookies, header overrides, CDP and network inspection are `advanced`.

- `BrowserPolicyEngine.grantSession` creates a per-session grant (default TTL 8h), and `issueLease` issues short-lived capability leases (15 min) pinned to the current policy revision (`src/main/browser/browser-policy.ts:19-20, 93-148`).
- Every Host browser request is checked by `assertRequest` (`browser-policy.ts:160-191`): it validates the requestId, requires the policy revision to match, checks the lease exists/unexpired/belongs to the session, requires the lease permission to dominate the requested level, and refuses `advanced` when advanced mode is off.
- `bumpRevision()` clears all leases and notifies listeners on any grant/settings change; a replacement Agent Host must re-acknowledge the snapshot (`src/main/browser/browser-policy.ts:207-212`).
- The capability snapshot is pushed to the Host via `hostManager.setBrowserCapabilitySnapshot` and applied in `browserCapabilityRuntime` (`src/agent-host/browser-capability-runtime.ts`), which computes a session's effective permission and gates tool activation (`syncBrowserToolsForAllSessions`).

### Authorization coordinator

`BrowserAuthorizationCoordinator.request()` first consults the persistent per-session policy; a persistent permission that dominates the requirement grants immediately (`source: persistent-policy`). Otherwise it enqueues a single dialog per session, with a 60s timeout, a 2s deny cooldown, and per-session pending deduplication (`browser-authorization-coordinator.ts:71-134`). Decisions are `deny` or `allow-session`; the coordinator never produces permanent grants from a prompt — persistent grants are separate and user-managed.

## Advanced browser mode

Advanced mode is a **per-launch** capability governed by settings (`BrowserAdvancedSettingsV1`). When enabled it produces an advanced runtime policy with `removeSiteSecurityHeaders`, `disableWebSecurity`, `allowInsecureContent`, `certificateBypassDomains`, and `unrestrictedRawCdp` (`browser-policy.ts:64-75`). Advanced-mode tabs:

- Use dedicated advanced profiles and identity layers (UA/client-hints), a CDP coordinator, network recording with request-replay after confirmation, and JavaScript execution guardrails (`browser-tab-manager.ts`, `browser-cdp-coordinator.ts`).
- Certificate bypass is applied only for `unsafe` profile mode and only for domains listed in the runtime policy (`browser-service.ts:588-592, 614-625`).
- Agent tools never receive or return cookie *values*; cookie access is scoped by settings and `advanced` permission.

## Network policy and private networks

`BrowserNetworkPolicy.check()` validates URLs before navigation (`browser-network-policy.ts:63-101`): rejects credentials in URLs, blocks plain HTTP unless allowed/approved, refuses unsupported protocols, and — for `strict` network isolation — requires an enforcing network sandbox (throwing `NETWORK_ISOLATION_UNAVAILABLE` when none is deployed). Private-network protection is explicitly **best-effort**: hostnames like `localhost`/metadata endpoints are flagged, DNS resolution and reverse lookups inform the decision, and strict mode refuses requests when a controlled sandbox is not available (README documents this limitation).

## Error and recovery model

All failures are normalized to `BrowserError` (`browser-error.ts`) carrying a `BrowserErrorCode`, `retryable` flag, a `BrowserRecovery` (reason + remediation), and optional details. Recoveries guide remediation: stale inspection → refresh-inspection; missing/crashed tab → list-owned-tabs; transient network/timeouts → wait-and-retry-once; permission problems → request-authorization; private-network blocks → request-local-network-authorization. `BrowserService.handleHostRequest` audits every request and converts unexpected errors via `asBrowserError` (`browser-service.ts:564-575`). The Host surfaces these through `MainProcessRpcError` (`src/agent-host/parent-rpc.ts`).

## Host lifecycle interactions

- `onHostStopped()` revokes agent header rules, cancels pending authorization, revokes all grants/leases, clears runtime grants, revokes agent tab actions, and clears advanced state (`browser-service.ts:577-586`).
- `handleCertificateError` defers to advanced-mode bypass for known domains (`browser-service.ts:588-592`).
- `restoreTabs()` replays persisted tab-restore records after startup when the setting enables it (`browser-service.ts:528-533`).
- `dispose()` persists tab-restore state, clears all confirmations/rules/grants, disposes tabs, downloads, interceptors, and profiles within the shutdown deadline (`browser-service.ts:594-612`).