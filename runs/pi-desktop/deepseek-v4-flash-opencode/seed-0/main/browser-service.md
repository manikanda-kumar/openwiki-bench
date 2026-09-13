---
type: concept
title: Built-in Browser Service
description: The Main-owned built-in browser — WebContentsView tabs, profiles and sessions, per-session authorization with persistent vs runtime grants and leases, network policy, downloads, and tab restoration.
tags: [browser, main, tabs, profiles, authorization]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-443d436bf8959f95e46739f8
    resource: repo://src/agent-host/browser-tools.ts
  - id: openwiki-source-19fc7473bfc0b4d9fd5a832f
    resource: repo://src/main/browser/browser-authorization-coordinator.ts
  - id: openwiki-source-c7a61e5c0484dd8635553f85
    resource: repo://src/main/browser/browser-download-manager.ts
  - id: openwiki-source-7bae2eb4b8f21c53df9aad0d
    resource: repo://src/main/browser/browser-policy.ts
  - id: openwiki-source-a9485bab3420888add71e1f7
    resource: repo://src/main/browser/browser-profile-manager.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-237e62042dfac18df827c94f
    resource: repo://src/main/browser/browser-tab-manager.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Built-in Browser Service

The built-in browser is a Main-process subsystem (`src/main/browser/`) that renders real Chromium pages in `WebContentsView`s owned by the Electron Main process — not by the sandboxed React Renderer. `BrowserService` (`browser-service.ts:73`) is the facade; it owns settings, the policy engine, profiles, tabs, downloads, network interception, secrets, and tab restoration, and it dispatches the `browser.*` Host RPC methods.

## Ownership and process boundaries

- Tabs are `WebContentsView` children of the main window (`browser-tab-manager.ts:297`). They do not get the app's preload, Node integration, or the Renderer bridge; they use their own `Session` partitions.
- The Renderer drives the browser only through `piBridge.browser*` IPC and `browser:event` push events; the Agent Host drives it through `browser.*` parent-RPC (dispatched in `BrowserService.handleHostRequest`).
- The browser surface survives Renderer reloads: `handleRendererUnavailable` hides native Views so a reload cannot expose a stale native surface over the new UI (`browser-service.ts:324`, `browser-tab-manager.ts:352`).

## Tabs

`BrowserTabManager` (`browser-tab-manager.ts:140`) manages tab records:

- Tab creation enforces `settings.navigation.maxTabs` and `maxTabsPerSession`, defaults to the configured profile (or the `temporary` ephemeral profile), and commits `about:blank` before attaching CDP domains so the identity/network barrier never races target initialization (`browser-tab-manager.ts:223`).
- Each tab tracks generation, control state (`user`/`agent`/`waiting-for-approval`), crash state, and ownership by an Agent session; owned tabs are only visible to their owning session (`browser-tab-manager.ts:159`).
- Agent actions run through `runAction(record, sessionId, requiredPermission, fn)` which serializes actions per tab (a per-tab promise queue) and aborts on user takeover. `USER_TOOK_CONTROL` aborts a running agent action when the user interacts (`browser-tab-manager.ts:100`).
- Snapshots, inspection, screenshots, clicks, typing, key presses, scrolling, and waiting are implemented with trusted input (CDP `Input.*` for clicks/type) and bounded result sizes (screenshot ≤ 12 MiB, full-page ≤ 16 384 px high, script ≤ 256 KiB) (`browser-tab-manager.ts:60`).
- Sensitive controls (buy/pay/delete/submit/sign-in keywords) and form submission require a confirmation (`approveSensitiveAction`) before the agent can interact (`browser-tab-manager.ts:865`).

## Profiles and sessions

`BrowserProfileManager` (`browser-profile-manager.ts:37`):

- Three modes: `ephemeral` (the default `temporary` profile, no persisted data), `persistent` (up to 16, persisted in `browser-profiles.json`, per-partition `session.fromPartition`), and `unsafe` (advanced mode only, see the Advanced Browser Mode page).
- Each profile is backed by an Electron `Session` partition; `configureSession` installs the network interceptor, download manager, device-permission deny-all, proxy, and (for unsafe profiles) certificate verification (`browser-service.ts:614`).

## Authorization: grants and leases

Agent Browser access is governed by the `BrowserPolicyEngine` (`browser-policy.ts:31`) with four permission levels — `none`, `read`, `interact`, `advanced`:

- **Persistent permission** comes from settings (`automation.defaultPermission`) or a per-session persistent grant (`browser-session-grants.json`), stored via `setPersistentSessionPermission`.
- **Runtime grants** are session-scoped, issued by the authorization coordinator when a user approves a request, and expire after 8 h (`browser-policy.ts:19`, `browser-service.ts:55`).
- **Authorization requests** (`browser.requestAuthorization`) go through `BrowserAuthorizationCoordinator` (`browser-authorization-coordinator.ts:49`), which queues one dialog per session (60 s timeout), consults persistent policy first, and enforces a 2 s denial cooldown.
- **Leases** are short-lived capability tokens (15 min TTL, `browser-policy.ts:20`) bound to a policy revision; `browser_tools.ts` fetches a lease via `browser.capabilities`, and every agent browser call carries the `capabilityLeaseId` + `policyRevision`, which `assertRequest` re-validates (`browser-policy.ts:160`). A policy change invalidates all leases (`bumpRevision` clears leases) so a stale lease cannot outlive a settings change.
- Channel sessions only get browser access if `automation.allowChannelSessions` is on (`browser-policy.ts:99`).
- The Agent tool → required permission mapping is defined in `src/agent-host/browser-tools.ts:14` (`browser_click` → interact, `browser_execute_javascript`/CDP/network → advanced, navigation/snapshot → read).

## Network policy, downloads, uploads, and external protocols

- **Navigation** is policy-checked by `BrowserNetworkPolicy` per tab: scheme restrictions, private-network detection, and `navigation.allowPrivateNetwork`. Agent navigation to a private network is blocked unless explicitly approved; user-initiated navigation can confirm and approve the origin (`browser-tab-manager.ts:403`). Certificate errors for advanced tabs are allowed only for allowlisted domains (`browser-service.ts:588`).
- **Downloads** are handled by `BrowserDownloadManager` (`browser-download-manager.ts:21`): mode `deny` cancels immediately; `ask` shows a save dialog; `allow-to-directory` saves to the configured directory. Filenames are sanitized and URLs redacted. At most 100 downloads are retained in the UI state.
- **Uploads**: file inputs hand control to the native chooser; `chooseUploadFiles` routes picked paths back into the owned tab's pending upload slot (`browser-tab-manager.ts:919`).
- **External protocols**: `window-open`/navigation handlers open `https:`/`mailto:` through `shell.openExternal`; non-mailto external links from agent clicks raise `UNSUPPORTED_PROTOCOL` (`browser-tab-manager.ts:879`). `BrowserService` serializes external-protocol confirmations and keeps a recent-protocol de-dupe map (`browser-service.ts:91`).
- **Proxy**: profiles apply `system`/`direct`/`custom` proxy settings; custom proxy credentials are stored in the browser secret vault and supplied to Chromium's `login` handler (`browser-service.ts:422`, `main.ts:299`).
- Device permissions are denied at the session level (`browserSession.setDevicePermissionHandler(() => false)`, `browser-service.ts:615`).

## Tab restoration

- Active tab state (url, profile, owner session, order) is persisted debounced (500 ms) to `browser-tabs.json` when `panel.restoreTabs` is enabled (`browser-service.ts:1176`, `browser-tab-restore-store.ts`).
- On startup, `restoreTabs()` recreates tabs for persisted records (excluding unsafe profiles) and activates the first one; restore is skipped if the browser or restore setting is off (`browser-service.ts:528`).

## Browser Host RPC surface

`BrowserService.handleHostRequest` (`browser-service.ts:564`) dispatches the `browser.*` methods declared in `src/contract/browser.ts:750`:

- Capability: `browser.capabilities`, `browser.requestAuthorization`, `browser.sessionEnded`, `browser.requestRouteBypass`.
- Navigation/observation: `browser.open`, `browser.listTabs`, `browser.navigate`, `browser.snapshot`, `browser.inspect`, `browser.screenshot`, `browser.click`, `browser.clickAt`, `browser.type`, `browser.press`, `browser.scroll`, `browser.wait`, `browser.back/forward/reload/close`.
- Advanced: `browser.executeJavaScript`, `browser.getCookies`/`setCookies` (fail-closed), `browser.setRequestHeaderRules`/`setResponseHeaderRules`, `browser.sendCdpCommand`, `browser.networkList/Wait/Body/Replay/Summary`, `browser.consoleList/Wait`, `browser.visualCompare`, `browser.pageCodeList/Get`.

Every host method is validated against `isBrowserHostMethod`, audited (redacted `input` digest, opaque session/tab ids) in `auditHostRequest`, and translated to structured `BrowserError` with recovery metadata (`browser-service.ts:564`).

## Tests

- `browser-policy.test.mjs`, `browser-authorization-coordinator.test.mjs`, `browser-tab-manager` tests, `browser-profile-manager.test.mjs`, `browser-download-manager.test.mjs`, `browser-network-policy.test.mjs`, `browser-permission-grants.test.mjs`, `browser-persistent-grant-store.test.mjs`, `browser-tab-restoration.test.mjs`, `browser-settings.test.mjs`, and `browser-service`-adjacent tests cover the surface; `browser-renderer-contract.test.mjs` covers the renderer seam.
