---
type: workflow
title: Embedded Browser
description: How the Main-owned embedded browser hosts real web pages, how Agent sessions gain scoped browser permission, and how network policy, advanced mode, and tool budgets constrain automation.
tags: [browser, webcontents-view, authorization, network-policy, advanced-mode, agent-tools]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-8f5dba62b265d534a7117805
    resource: repo://src/agent-host/browser-agent-runtime.ts
  - id: openwiki-source-443d436bf8959f95e46739f8
    resource: repo://src/agent-host/browser-tools.ts
  - id: openwiki-source-59d3c8d5b7ce842ca5bc7496
    resource: repo://src/contract/browser.ts
  - id: openwiki-source-19fc7473bfc0b4d9fd5a832f
    resource: repo://src/main/browser/browser-authorization-coordinator.ts
  - id: openwiki-source-5187b316f200b41a83832424
    resource: repo://src/main/browser/browser-network-interceptor.ts
  - id: openwiki-source-b06181600828a8da06569e55
    resource: repo://src/main/browser/browser-network-policy.ts
  - id: openwiki-source-aec28347fd3e6a4dfc4cfaf7
    resource: repo://src/main/browser/browser-network-recorder.ts
  - id: openwiki-source-7bae2eb4b8f21c53df9aad0d
    resource: repo://src/main/browser/browser-policy.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-237e62042dfac18df827c94f
    resource: repo://src/main/browser/browser-tab-manager.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Embedded Browser

Pi Agent Desktop embeds a real Chromium browsing surface that both the user and the Agent can drive. The browser is owned entirely by the Electron Main process: pages live in `WebContentsView` instances created by Main, never in the sandboxed Renderer, and Agent sessions reach it only through a permission-checked Host RPC path.

## Ownership and composition

`BrowserService` (Main) is the single owner of browser state. It composes:

- `BrowserSettingsStore` (`browser-settings.json`) and `BrowserPolicyEngine` for settings and capability state (src/main/browser/browser-service.ts:97-104)
- `BrowserPersistentGrantStore` (`browser-session-grants.json`) for durable per-session permissions (src/main/browser/browser-service.ts:100-102)
- `BrowserAuthorizationCoordinator` for one-at-a-time authorization dialogs (src/main/browser/browser-service.ts:105-134)
- `BrowserSecretVault` (`browser-secrets.json`, OS-encrypted via `safeStorage`) (src/main/browser/browser-service.ts:135-142)
- `BrowserProfileManager`, `BrowserTabManager`, `BrowserTabRestoreStore`, `BrowserHeaderRuleStore`, agent header-rule registry, `BrowserSnippetStore`, per-tab download managers and network interceptors (src/main/browser/browser-service.ts:143-151)

Main constructs the service at startup and forwards Host RPC requests whose method starts with `browser.` to `handleHostRequest` (src/main/main.ts:681-683). The Renderer never talks to the browser directly; it uses trusted `desktop:browser:*` IPC handlers guarded by `requireTrustedBrowser` (src/main/ipc.ts:105-111).

## Tab runtime isolation

Tabs are `WebContentsView` instances created by `createSecureView` with `sandbox: true`, `contextIsolation: true`, and no Node integration (src/main/browser/browser-tab-manager.ts:2312-2336). `webSecurity` is only relaxed when the profile is an advanced-mode `unsafe` profile and the advanced runtime policy is enabled (src/main/browser/browser-tab-manager.ts:2317-2326). Remote pages therefore get no preload, no Node, and no Renderer bridge; programmatic CDP is enabled for screenshots, uploads, and allowlisted Advanced commands, but no remote View receives a DevTools menu or bridge (src/main/browser/browser-tab-manager.ts:2327-2330).

## Agent tools and the permission ladder

Agent browser tools are defined in the Agent Host (src/agent-host/browser-tools.ts). Every tool maps to a `browser.*` host method and a permission level: `read` (open, navigate, snapshot, inspect, screenshot, wait, back/forward/reload/close), `interact` (click, type, press, scroll), and `advanced` (arbitrary JavaScript, cookies, header rules, CDP, network capture/replay, console, page code) (src/agent-host/browser-tools.ts:14-46, 188-223). `browserToolNamesForSnapshot` only exposes tools when the capability snapshot has browser and automation enabled, and hides `advanced` tools unless advanced mode is on (src/agent-host/browser-tools.ts:60-66).

Before every tool call the Host:

1. Calls `browser.capabilities` for the session (src/agent-host/browser-tools.ts:92).
2. If the current lease rank is below the required permission, calls `browser.requestAuthorization` to trigger the Main-side dialog (src/agent-host/browser-tools.ts:93-101).
3. Sends `capabilityLeaseId` and `policyRevision` with the actual call so Main can validate against the lease and the current policy revision (src/agent-host/browser-tools.ts:113-114).

Authorization resolution in Main: a persistent per-session grant from `BrowserPersistentGrantStore` (or the automation default permission) that already covers the required rank grants immediately; `deny` fails with `USER_DENIED`; otherwise a single dialog is shown with a 60-second timeout and a 2-second deny cooldown per session (src/main/browser/browser-authorization-coordinator.ts:62-113). Only one pending dialog exists per session; a higher-tier request is evaluated after the current one resolves instead of stacking (src/main/browser/browser-authorization-coordinator.ts:89-102). Channel-sourced sessions are rejected outright when `automation.allowChannelSessions` is false (src/main/browser/browser-service.ts:742-744).

`BrowserPolicyEngine` issues session grants with an 8-hour TTL and capability leases with a 15-minute TTL, bumps a revision counter on every settings change, clears all grants when browser or automation is disabled, and downgrades advanced grants when advanced mode is turned off (src/main/browser/browser-policy.ts:19-21, 85-91). Runtime grants issued through the coordinator carry the same 8-hour TTL (src/main/browser/browser-service.ts:55, 112-124).

Coding-side tool permissions never imply browser permission: browser tools are a separate permission ladder, and even a fully-privileged coding session must obtain a browser lease (read/interact/advanced) before its first browser call (src/agent-host/browser-tools.ts:92-101).

## Network policy and private-network protection

`BrowserNetworkPolicy.check` validates every navigation and replay target: only absolute `http:`/`https:` URLs are allowed, URLs with embedded credentials are rejected, plain HTTP is blocked unless `allowHttp` (or a user approval) permits it, and DNS resolution is checked for private/literal-private addresses (src/main/browser/browser-network-policy.ts:87-118). Private-network targets are blocked unless `allowPrivateNetwork` is enabled or the user explicitly approves; when `networkIsolation` is `strict` but no enforcing network sandbox is available, the check fails closed with `NETWORK_ISOLATION_UNAVAILABLE` (src/main/browser/browser-network-policy.ts:96-118). Private-network protection is therefore best-effort, and Strict mode refuses to operate without a real sandbox — the README marks this explicitly as best-effort with Strict refusing requests when no controlled-network sandbox is deployed (README.md, 数据、安全与隐私).

Per-profile `BrowserNetworkInterceptor`s hook `webRequest.onBeforeRequest` / `onBeforeSendHeaders` / `onHeadersReceived` to apply header rules, permission grants, and private-origin approvals (src/main/browser/browser-network-interceptor.ts:111-113, 153-186).

## Advanced Browser Mode

Advanced mode is a single launch-scoped or persistent switch that enables, together: arbitrary JavaScript, network body capture and replay, identity/UA overrides, certificate bypass domains, weakened site security, and unrestricted CDP (src/main/browser/browser-service.ts:1349; src/main/browser/browser-policy.ts:64-75). Safety rails inside advanced mode:

- Write-request replay is sealed-record based: only recorded, replayable methods (GET/HEAD/POST/PUT/PATCH/DELETE) can be replayed, with a mandatory fresh confirmation proof, reason text, protocol and redirect restrictions, and provenance recorded on the replayed entry (src/main/browser/browser-tab-manager.ts:1537-1631; src/main/browser/browser-network-recorder.ts:441-446).
- Secrets are stored encrypted by reference in `BrowserSecretVault`; tools resolve refs, never raw secret values, and invalid or oversized secrets are rejected (src/main/browser/browser-secret-vault.ts:35-40).
- `browser_get_cookies` is advanced-only and subject to the fail-closed sensitive-result persistence gate; cookie values are not returned to tools through the normal result path (src/agent-host/browser-tools.ts:496-504).

## Agent-side budgets and recovery

`BrowserAgentRuntime` (Agent Host) bounds every session turn: at most 60 browser calls per turn with a replan checkpoint at 30 calls, at most 8 screenshots, and at most 4 exploratory plus 2 verification JavaScript executions (src/agent-host/browser-agent-runtime.ts:5-9). Exceeding the budget throws `BROWSER_CALL_BUDGET_EXCEEDED` with remediation `ask-user`; hitting the checkpoint throws `BROWSER_REPLAN_REQUIRED` requiring the agent to summarize evidence and replan (src/main/../agent-host/browser-agent-runtime.ts:135-149). Denied targets are hashed and remembered so policy denials and unsupported routes cannot be retried silently; route bypasses require a Main-side confirmation round trip (src/agent-host/browser-agent-runtime.ts:96-113).

Every browser error is a structured `BrowserError` with a stable `BrowserErrorCode`, retryability, and a `BrowserRecovery` remediation hint (`request-authorization`, `refresh-inspection`, `wait-and-retry-once`, `ask-user`, ...) so the Agent can react deterministically (src/contract/browser.ts:12-90).

## Lifecycle and cleanup

When the Agent Host stops or crashes, Main calls `browserService.onHostStopped()`, which clears agent header rules, cancels pending authorizations, revokes all policy grants and leases, clears runtime grants, and revokes agent actions on tabs (src/main/main.ts:693-700; src/main/browser/browser-service.ts:577-586). `dispose()` additionally persists tab restore state, disposes download managers and network interceptors, and tears down profiles (src/main/browser/browser-service.ts:594-612). Certificate errors are only bypassed for advanced-mode webContents whose hostname is on the configured bypass list (src/main/browser/browser-service.ts:588-592).

## User/Agent shared control

The same tabs serve the user and the Agent. Agent actions run against tabs the session owns (`TAB_NOT_OWNED` otherwise), and `BrowserControlState` models `user` / `agent` / `waiting-for-approval`; user takeover is a settings choice between cancelling the agent action or waiting (`userTakeover`) (src/contract/browser.ts:8, 115-117). Sensitive actions (downloads, uploads, permissions, external protocols) always route through Main-side confirmation callbacks rather than the Renderer (src/main/browser/browser-service.ts:63-69).

## Representative tests

- src/main/browser/browser-policy.test.mjs — grant/lease TTLs, revision bumps, replay confirmation proofs
- src/main/browser/browser-network-policy.test.mjs — private-network blocking, strict-mode fail-closed, virtual-DNS detection
- src/main/browser/browser-authorization-coordinator.test.mjs — persistent-policy fast path, deny cooldown, single-dialog queueing
- src/agent-host/browser-agent-runtime.test.mjs — call budgets, replan checkpoint, denied-target memory
- scripts/test-browser-electron.mjs and scripts/test-browser-agent-e2e.mjs — Electron-level integration and real-agent end-to-end runs
