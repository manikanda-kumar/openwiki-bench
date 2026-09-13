---
type: "Reference"
title: "Builtin Browser"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-8f5dba62b265d534a7117805
    resource: repo://src/agent-host/browser-agent-runtime.ts
  - id: openwiki-source-443d436bf8959f95e46739f8
    resource: repo://src/agent-host/browser-tools.ts
  - id: openwiki-source-19fc7473bfc0b4d9fd5a832f
    resource: repo://src/main/browser/browser-authorization-coordinator.ts
  - id: openwiki-source-b06181600828a8da06569e55
    resource: repo://src/main/browser/browser-network-policy.ts
  - id: openwiki-source-7bae2eb4b8f21c53df9aad0d
    resource: repo://src/main/browser/browser-policy.ts
  - id: openwiki-source-a9485bab3420888add71e1f7
    resource: repo://src/main/browser/browser-profile-manager.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---


# Builtin Browser

Pi Agent Desktop ships a full browser that the **user and the Agent share**: real Chromium pages run inside Main-owned `WebContentsView` instances, so remote web content never gets the app preload, Node, or the renderer bridge. The Agent can drive the same pages only through a per-session authorization flow, and Main preflights every tool request before any side effect.

## Ownership and layout

- The browser is owned by `BrowserService` (`src/main/browser/browser-service.ts`), which composes the policy engine, authorization coordinator, profile manager, tab manager, settings/restore/header/snippet stores, secret vault, network interceptors, and download managers. It is created in Main during startup and is reachable from the renderer via `piBridge.browser*` and from the Host via `browser.*` host requests (`src/main/main.ts:428-436`).
- Tabs are `WebContentsView` instances created sandboxed with `contextIsolation`, no Node integration, no `webviewTag`, and no preload bridge (`src/main/browser/browser-tab-manager.ts`, enforced by `check-desktop-security.mjs:579-587`). Each tab carries an `ownerSessionId` (null for user-only tabs), a profile, generation, control state, and crash state (`contract/browser.ts:266-285`).
- Browser sessions install permission request/check handlers and deny device permissions by default; a `setDevicePermissionHandler(() => false)` is required (`check-desktop-security.mjs:589-593`).

## Profiles

- `BrowserProfileManager` manages profiles backed by Electron sessions. The default profile `temporary` is ephemeral; users can create persistent profiles (stored in `browser-profiles.json`, capped at 16) and `unsafe` profiles used only by advanced mode (`src/main/browser/browser-profile-manager.ts:13-70`).
- Unsafe/advanced profiles must not be restored on startup (`contract/browser.ts:280-284`, tab-restoration checks).
- Persistent settings and stores live under the user data dir: `browser-settings.json` (settings), `browser-session-grants.json` (persistent grants), `browser-secrets.json` (encrypted secrets), `browser-tabs.json` (restore records), `browser-header-rules.json`, `browser-page-snippets.json` (`src/main/browser/browser-service.ts:97-148`).

## Network policy

`BrowserNetworkPolicy` checks every navigation URL before it is allowed (`src/main/browser/browser-network-policy.ts:63-128`):

- only `https:` and `http:` (plus `about:blank` when allowed); URLs with embedded credentials are blocked; plain HTTP requires `allowHttp` or user approval;
- private-network detection covers literal private hostnames/IPs and resolved addresses from the session resolver; `198.18/15` benchmarking addresses only count when a resolver in the same range exists and a PTR lookup confirms the hostname (virtual-DNS confirmation) (`browser-network-policy.ts:151-205`);
- private/local targets are blocked unless `allowPrivateNetwork` is set or the user approves; `strict` isolation is only honored when an enforcing network sandbox is available, otherwise the request fails with `NETWORK_ISOLATION_UNAVAILABLE` (`browser-network-policy.ts:96-101`). Private-network protection is explicitly **best-effort** without a controlled network sandbox.

## Agent authorization and leases

The Agent gains browser capabilities through a two-layer flow:

1. **Capability snapshot** — `BrowserPolicyEngine` publishes a revisioned `BrowserCapabilitySnapshot` (`browserEnabled`, `automationEnabled`, `advancedEnabled`, per-session permissions) to the Host, which mirrors it in `browserCapabilityRuntime` (`src/main/browser/browser-policy.ts:193-212`, `src/agent-host/browser-capability-runtime.ts:17-45`). Tool availability and session permission rank are evaluated against this snapshot.
2. **Authorization coordinator** — when a tool needs more than the current permission, `BrowserAuthorizationCoordinator.request` either grants from the persistent policy, or queues a dialog (`BrowserAgentAuthorizationRequest`) that the user resolves with `allow-session`/`deny`; denials impose a 2 s cooldown and requests time out after 60 s (`src/main/browser/browser-authorization-coordinator.ts:71-134`). Grants become session grants (8 h TTL) plus short-lived capability leases (15 min TTL) (`src/main/browser/browser-policy.ts:19-20`, `browser-policy.ts:93-149`).
3. **Main-side preflight** — every Host browser request carries `requestId`, `capabilityLeaseId`, and `policyRevision`; `BrowserPolicyEngine.assertRequest` validates them against the current revision and the lease, and enforces the required permission rank, before the action executes (`src/main/browser/browser-policy.ts:160-191`).

The Agent-side `browserCall` helper requests authorization via `browser.requestAuthorization` (70 s timeout), then re-reads capabilities before invoking the target method exactly once (`src/agent-host/browser-tools.ts:79-143`).

Tool-to-permission mapping is explicit: `browser_open`/`browser_snapshot`/`browser_inspect`/`browser_screenshot`/`browser_wait` are `read`; clicks/types/presses/scroll are `interact`; `browser_execute_javascript`, `browser_get_cookies`, CDP commands, network capture/replay, and page-code tools are `advanced` (`src/agent-host/browser-tools.ts:14-46`).

## Advanced browser mode

- Advanced mode is a single switch (`advancedBrowserMode.enabled`, default off) guarded by a one-time confirmation proof (`BrowserConfirmationManager`; settings updates consume the proof via `authorizeBrowserSettingsUpdate`) (`src/main/browser/browser-settings-confirmation.ts`, `browser-service.ts:230-259`).
- When enabled, the runtime policy removes site-security headers, disables web security, allows insecure content, permits the configured `certificateBypassDomains`, and allows unrestricted raw CDP; when disabled it returns a fully inert policy (`src/main/browser/browser-policy.ts:64-75`, `browser-policy.ts:231-240`).
- Advanced grants are downgraded to `interact` when advanced mode is disabled, and capability-boundary changes cancel pending authorizations and revoke all grants (`src/main/browser/browser-policy.ts:88`, `browser-service.ts:243-250`).

## Agent budgets and working memory

`BrowserAgentRuntime` (Host side) tracks per-session budgets and hashed working memory: 30 replan calls, 60 total calls, 8 screenshots, 4 exploratory and 2 verification JavaScript executions per turn; denied targets are stored as key/origin hashes, never plaintext (`src/agent-host/browser-agent-runtime.ts:5-60`). Browser tools expose canonical efficiency guidelines and label the workflow guard as "obvious-workflow-bypass-only" — it is lifecycle control, not an OS sandbox (`check-desktop-security.mjs:708-715`).

## Network capture, replay, and CDP

- `BrowserNetworkInterceptor`/`BrowserNetworkRecorder` capture bounded request/response bodies for `network_list`/`network_wait`/`network_body`/`network_summary` and **replay** confirmed write requests; replay data is sealed in Main memory with a 10-minute TTL (`src/main/browser/browser-network-recorder.ts`, `check-desktop-security.mjs:717-724`).
- `BrowserCdpCoordinator` brokers raw CDP for advanced mode; agent tools cannot accept cookie values and cookie mutation is unavailable until tool-result persistence isolation is proven (`check-desktop-security.mjs:648-653`).
- Inspection and Console output share redaction and bounded budgets (text ≤ 8 000 chars default, ≤ 100 nodes, screenshots ≤ 1.5 MB) (`check-desktop-security.mjs:682-694`).

## Downloads, uploads, and confirmation

- Downloads are managed per-tab by `BrowserDownloadManager` under the configured `downloads.mode` (`ask` / `deny` / `allow-to-directory`) (`contract/browser.ts:120-124`).
- Sensitive actions (cookies, form submission, external protocols, private-network access, route bypass) require a Main-side confirmation before proceeding; external protocols go through `openExternalWithConfirmation` (`src/main/browser/browser-service.ts:154-171`).

## Tab restore

- Tab restore records are persisted in `browser-tabs.json` and restored after startup (debounced 500 ms) unless the restore feature is disabled; unsafe/advanced-profile tabs are excluded from restoration (`src/main/browser/browser-service.ts:143`, `src/main/browser/browser-tab-restoration.ts`, `contract/browser.ts:92-98`).

## Related pages

- [Security Model](../architecture/security-model.md)
- [RPC and Contract Layer](../architecture/rpc-and-contracts.md)
- [Three-Process Architecture](../architecture/three-process-architecture.md)
- [Managed Background Processes](./managed-processes.md)
