---
type: concept
title: Advanced Browser Mode
description: The opt-in Advanced Browser Mode — CDP command surface, network capture and replay, request/response header rules with a secret vault, saved JavaScript experiences, and the fail-closed cookie gate.
tags: [browser, advanced-mode, cdp, network, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-443d436bf8959f95e46739f8
    resource: repo://src/agent-host/browser-tools.ts
  - id: openwiki-source-e7947e5c20d08bf5749506ba
    resource: repo://src/main/browser/browser-cdp-coordinator.ts
  - id: openwiki-source-cc0cc9720e762cafd8ddbb8d
    resource: repo://src/main/browser/browser-header-rules.ts
  - id: openwiki-source-aec28347fd3e6a4dfc4cfaf7
    resource: repo://src/main/browser/browser-network-recorder.ts
  - id: openwiki-source-a31b8bcf238a57b1de36bf0f
    resource: repo://src/main/browser/browser-secret-vault.ts
  - id: openwiki-source-6b66a2ace518781fc446e87e
    resource: repo://src/main/browser/browser-service.ts
  - id: openwiki-source-da171c6d2aa7fc5962a1cfac
    resource: repo://src/main/browser/browser-settings-confirmation.ts
  - id: openwiki-source-74ce49d0df461b3c5f06bf25
    resource: repo://src/main/browser/browser-snippet-store.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Advanced Browser Mode

Advanced Browser Mode is an opt-in, capability-gated extension of the built-in Browser Service. It unlocks the CDP (Chrome DevTools Protocol) command surface, network capture/replay, header rules, saved JavaScript experiences, custom identity (UA/Client Hints) layering, and certificate bypass domains — all through a separate `unsafe` profile mode and a policy engine that stays fail-closed.

## Enabling Advanced Browser Mode

Advanced Browser Mode is not enabled by default and cannot be enabled without a user-facing confirmation:

- `browserRequestConfirmation` (kind `advanced-browser-mode`) prepares the settings patch with `prepareBrowserSettingsUpdate`, which returns `requiresAdvancedConfirmation` only when the mode transitions from disabled to enabled (`src/main/browser/browser-settings-confirmation.ts:9`).
- The confirmation dialog issues a one-time `BrowserConfirmationProof`; `browserUpdateSettings` consumes that proof in `authorizeBrowserSettingsUpdate` before the patch is applied (`src/main/browser/browser-settings-confirmation.ts:22`).
- `BrowserService.requestConfirmation` only accepts the two kinds `advanced-browser-mode` and `sensitive-cookies`, and normalizes the UI language to `en-US`/`zh-CN` (`src/main/browser/browser-service.ts:212`).

Once enabled, `browser.createProfile` with `mode: "unsafe"` is allowed; creating an `unsafe` profile while the mode is off raises `ADVANCED_BROWSER_MODE_REQUIRED` (`src/main/browser/browser-service.ts:381`). Turning the mode off closes unsafe tabs, clears advanced rules, and disables the advanced runtime policy (`src/main/browser/browser-service.ts:671`).

## CDP command surface

`BrowserCdpCoordinator` (`src/main/browser/browser-cdp-coordinator.ts:21`) manages the per-tab Chrome DevTools debugger:

- `acquire`/`keepAttached`/`enableDomain`/`subscribe`/`sendCommand` reference-count debugger attachment and CDP domain enabling, and auto-detach when idle (`detachIfIdle`). Each domain enable/disable is ref-counted.
- Only the agent-facing method `browser.sendCdpCommand` is exposed as a tool; it passes through `assertCdpMethod` which validates the method name shape (`/^[A-Za-z]+\.[A-Za-z][A-Za-z0-9]*$/`) and requires Advanced Browser Mode (`src/main/browser/browser-service.ts:1119`).
- The network recorder, console buffer, and advanced tab features rely on the coordinator, so the attach lifecycle is shared and bounded (`countAttached`).

## Network capture and replay

`BrowserNetworkRecorder` (`src/main/browser/browser-network-recorder.ts:63`) captures request metadata through the CDP `Network` domain:

- Requests are opaque-id mapped (CDP request id → random UUID) and redacted: sensitive headers (`authorization`, `cookie`, `set-cookie`, `proxy-*`) and URLs are sanitized before exposure (`sanitizeHeaders`/`sanitizeUrl`, `browser-network-recorder.ts:727`).
- Response bodies are captured only while body capture is active (an idle window defaulting to 2 minutes), stored on disk under `browser-network-bodies` with `0o600` permissions, LRU-bounded, and **cleared** when capture stops (`stopBodyCapture`/`clearCapturedPayloads`, `browser-network-recorder.ts:584`). Automatic capture applies only to text mime types ≤ 512 KiB.
- The `browser.networkReplay` tool replays a captured request: GET/HEAD replay immediately; POST/PUT/PATCH/DELETE require local confirmation and never retry automatically (`src/agent-host/browser-tools.ts:565`). Replay requests are recorded back into the recorder as `resourceType: "Replay"` entries (`recordReplay`).
- `browser.networkList`, `networkWait`, `networkBody`, and `networkSummary` expose the redacted capture; all network content is marked `untrustedWebContent: true`.

## Header rules and the secret vault

- `validateHeaderRules` (`src/main/browser/browser-header-rules.ts:21`) enforces a hard-coded blocklist of request headers that cannot be overridden (`connection`, `cookie`, `host`, `origin`, `proxy-*`, `sec-fetch-*`, `transfer-encoding`), and site-security response headers that are blocked unless Advanced Browser Mode explicitly allows removing them (`removeSiteSecurityHeaders`).
- Rules are URL-matched, scoped per profile, and split between user-editable local rules (`browser-header-rule-store.ts`) and per-session agent rules (`browser-agent-header-rule-registry.ts`), combined at interceptor apply time (`browser-service.ts:1083`).
- Header values that must not be plaintext are stored as secret references: `BrowserSecretVault` (`src/main/browser/browser-secret-vault.ts:20`) encrypts values with the OS keychain (`safeStorage`) into `browser-secrets.json` (max 2 MiB, `0o600`, atomic write), returns opaque `browser-secret-<uuid>` refs, and refuses operation when encryption is unavailable. Rules whose secret ref is removed are dropped.

## JavaScript experience store

`browser.executeJavaScript` with `remember: true` saves a per-site code snippet to `BrowserSnippetStore` (`src/main/browser/browser-snippet-store.ts:22`):

- Stored snippets are bounded (≤ 256 KiB code, ≤ 2000 snippets, ≤ 16 MiB store, per-host cap), sanitized, and identified by code hash.
- `browser.pageCodeList` returns only metadata (never source); `browser.pageCodeGet` returns a bounded source chunk. The store is scoped to the owning tab's URL.

## The fail-closed cookie gate

`browser.getCookies` and `browser.setCookies` do **not** return or mutate cookie values. Both throw `SENSITIVE_RESULT_UNAVAILABLE` with an explicit rationale (`src/main/browser/browser-service.ts:1020`): Pi's current ToolResult persistence path does not provide a verified model-only/full-value channel, so full cookie values would be written into session JSONL and visible to the model tool-call input. Until a verified secret persistence invariant exists (covered by reload/compaction tests), both reads and writes of cookie values are disabled — the model never receives cookie values even as advanced capabilities.

## Identity management

Advanced `unsafe` profiles layer a custom user agent and Client Hints identity (`browser-identity-manager.ts`) that survives page reloads, keeping the agent's authenticated session coherent while the profile remains advanced. The profile is separate from normal user profiles so identity tampering is scoped to the opt-in advanced surface.

## Certificate and private-network behavior

- Advanced tabs can bypass certificate errors only for explicitly allowlisted domains in the advanced runtime policy; `handleCertificateError` is consulted from Electron's global `certificate-error` handler (`src/main/browser/browser-service.ts:588`).
- Private-network protection is explicitly best-effort; Strict network isolation rejects private-network requests when no controlled network sandbox is deployed (per README and `browser-network-policy.ts`).

## Tests

- `browser-cdp-coordinator.test.mjs`, `browser-network-recorder.test.mjs`, `browser-header-rules.test.mjs`, `browser-secret-vault.test.mjs`, `browser-snippet-store.test.mjs`, `browser-identity-manager.test.mjs`, and `browser-network-policy.test.mjs` cover the advanced surface; `browser-policy.test.mjs` covers the capability gates.
