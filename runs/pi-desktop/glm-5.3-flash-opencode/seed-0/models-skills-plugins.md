---
type: concept
title: Models, Skills, and Plugins
description: How the Agent Host manages model providers and credentials (ModelRuntime, OAuth login, catalog refresh), Skills search/install, and Plugins management, and where each subsystem persists data.
tags: [models, oauth, credentials, skills, plugins, extensions]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-3fce36d83dba68d016d0f921
    resource: repo://src/agent-host/auth-login.ts
  - id: openwiki-source-eb9e0459c8a1f879260874ca
    resource: repo://src/agent-host/credential-sync.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-4314142703a5012e8b7a87d8
    resource: repo://src/agent-host/model-runtime.test.mjs
  - id: openwiki-source-e754dbf111c65da11a25634e
    resource: repo://src/agent-host/model-runtime.ts
  - id: openwiki-source-3a1f27adf23fe48362679aeb
    resource: repo://src/agent-host/npx.test.mjs
  - id: openwiki-source-5298dc7f2807e154f7134bd1
    resource: repo://src/agent-host/npx.ts
  - id: openwiki-source-a1389707d8f24ddcc2cd3222
    resource: repo://src/agent-host/plugin-worker-client.ts
  - id: openwiki-source-bfb43ec6e8519bc6aaeeca26
    resource: repo://src/agent-host/plugins-service.ts
  - id: openwiki-source-5512bd60069393bf8eac652d
    resource: repo://src/agent-host/rpc-manager.ts
  - id: openwiki-source-796e3f09a8332b4389d63b3a
    resource: repo://src/agent-host/skill-frontmatter.ts
  - id: openwiki-source-be7e9ac336186b6f07446574
    resource: repo://src/agent-host/skills-cli.ts
  - id: openwiki-source-a5c3af185114022c93a8494c
    resource: repo://src/agent-host/skills-service.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Models, Skills, and Plugins

All three subsystems run in the Agent Host and build on the pinned `@earendil-works/pi-coding-agent` 0.84.0 runtime. They share the agent directory (`~/.pi/agent/`) for persistence and expose themselves over the typed RPC surface (`models.*`, `auth.*`, `skills.*`, `plugins.*`).

## Models

`models.list` builds cwd-bound session services and projects the locally cached model catalog; the source is reported as `"offline"` when `PI_OFFLINE` is set (src/agent-host/handlers.ts:1510-1520). `models.refresh` performs an explicit remote refresh through `ModelCatalogRefreshCoordinator`, which:

- deduplicates by request id and cwd, aborting superseded refreshes as `"replaced"` (src/agent-host/model-runtime.ts:76-85);
- enforces a 12-second timeout that produces a cache-preserving aborted result with a `MODEL_REFRESH_TIMEOUT` warning ("cached models remain available") (src/agent-host/model-runtime.ts:5, 126-143);
- converts per-provider failures into `PROVIDER_REFRESH_FAILED` warnings that keep cached models available (src/agent-host/model-runtime.ts:39-47);
- supports cancellation via `models.refreshCancel` (src/agent-host/model-runtime.ts:151-156).

So session startup uses the local model directory/cache first; remote refresh is explicit, and offline, timeout, or partial-provider failure always retains the cached catalog (src/agent-host/model-runtime.test.mjs:30-129). Model preferences (`enabledModels`) are validated to keep at least one available model enabled and persisted through the session settings manager (src/agent-host/handlers.ts:1546-1564). Raw `models.json` editing is guarded with an expected-version check so outside edits are not silently overwritten ("models.json changed outside this editor") (src/agent-host/handlers.ts:244).

A shared `ModelRuntime` serves host-level model and credential management; agent sessions keep their own cwd-bound runtimes so project extensions cannot leak provider registrations into unrelated sessions (src/agent-host/model-runtime.ts:173-195).

## OAuth login and credentials

`auth.loginStart` runs the provider's OAuth flow fire-and-forget and streams progress on the `auth.login` topic: `auth` (URL + manual code entry), `device_code`, `progress`, `select_request`, and `prompt_request` events, each carrying a one-time token that the Renderer answers via `auth.loginSubmit` (src/agent-host/auth-login.ts:51-188). One active login per provider; cancellation aborts the flow, rejects pending prompts, and only removes its own controller so a cancelled flow finishing after a replacement cannot corrupt state (src/agent-host/auth-login.ts:28-40, 119-132).

On `CredentialSynchronizationError` after a successful login, the service calls `recoverCommittedCredential`: it checks the credential state (authoritative), retries a local-only refresh, and reports success with a `MODEL_SYNC_FAILED` warning if the model cache could not be refreshed — credentials are never rolled back because of a cache problem (src/agent-host/credential-sync.ts:26-48; src/agent-host/auth-login.ts:200-210). `auth.setApiKey` / `auth.deleteApiKey` / `auth.logout` go through the same credential state + local refresh recovery path (src/agent-host/handlers.ts:1745-1822).

## Skills

Skills search uses the skills.sh API first and falls back to a pinned skills CLI via npx (60-second timeout) when the API fails (src/agent-host/skills-service.ts:11-38). The CLI package is pinned so a failed unversioned npx install cannot poison later invocations under the same shared cache key (src/agent-host/skills-cli.ts:4-5). Installation runs `skills add` through `runNpx` with a 180-second timeout and validates the output for a success marker (src/agent-host/skills-service.ts:40-68).

`runNpx` never scans PATH or treats Electron as Node — it uses the Main-resolved Node + npx pair from the toolchain runtime (src/agent-host/npx.ts:73-99). On network-class failures (lock compromised, fetch/socket errors, DNS failures), it retries exactly once with an isolated temporary npm cache and a single registry socket, then removes the temp cache (src/agent-host/npx.ts:47, 101-115; src/agent-host/npx.test.mjs:74-104). Skill frontmatter (e.g. model invocation settings) is edited with a YAML round-trip that preserves formatting (src/agent-host/skill-frontmatter.ts:39-56).

## Plugins

Plugins continue to use Pi's package manager (`DefaultPackageManager`) with sources classified by `plugins-policy` (npm vs git needs) (src/agent-host/plugins-service.ts:6-26). Install/update/remove run in an **isolated plugin worker process** (`plugin-worker.mjs`, spawned detached with a 64 KiB request limit and timeout) so a broken package cannot take down the Host; the selected npm command and revision are passed in (src/agent-host/plugins-service.ts:296-315; src/agent-host/plugin-worker-client.ts:80-149; src/agent-host/plugin-worker-client.test.mjs:35). Disable/enable happen in-process by writing settings, with the original source backed up to `<agentDir>/pi-desktop-plugin-filters.json` so re-enabling restores it (src/agent-host/plugins-service.ts:40-67, 346-353).

`readPlugins` reports per-package status (`loaded`/`installed`/`missing`/`disabled`), resource counts (extensions, skills, prompts, themes), and diagnostics (src/agent-host/plugins-service.ts:280-293). Extension compatibility with the desktop Renderer is surfaced rather than hidden: TUI-only extension APIs (raw terminal input, custom TUI footer/header, autocomplete providers, custom editor components) are recorded as unsupported features and reported to the user with an explicit "terminal-specific and not available in the desktop renderer" message (src/agent-host/rpc-manager.ts:947-953, 1186, 1232-1263).

## Ownership and persistence summary

| Subsystem | Owning process | Persistence |
| --- | --- | --- |
| Model catalog/preferences | Agent Host (shared + per-cwd runtimes) | `~/.pi/agent/models.json` and settings via pi-coding-agent |
| OAuth/API credentials | Agent Host runtime, backed by pi's credential store | pi agent credential storage |
| Skills | Agent Host via npx + skills CLI | pi agent skills directories |
| Plugins | Agent Host, actions in isolated worker | pi package manager config + `<agentDir>/pi-desktop-plugin-filters.json` |

## Representative tests

- src/agent-host/model-runtime.test.mjs — offline refresh without network, timeout with cached result
- src/agent-host/auth-login.test.mjs — event flow, cancellation, credential recovery warnings
- src/agent-host/npx.test.mjs and skills-service.test.mjs — isolated-cache retry and CLI pinning
- src/agent-host/plugin-worker-client.test.mjs — isolated worker execution
