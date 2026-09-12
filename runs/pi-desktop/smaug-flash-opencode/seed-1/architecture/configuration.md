---
type: reference
title: Configuration, Models, and Credentials
description: How Pi Agent Desktop stores and refreshes model/provider configuration, enabled-model preferences, credentials (CredentialVault, Pi credential sync), and UI state.
tags: [configuration, models, credentials, auth, ui-state]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-eb9e0459c8a1f879260874ca
    resource: repo://src/agent-host/credential-sync.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-e754dbf111c65da11a25634e
    resource: repo://src/agent-host/model-runtime.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Configuration, Models, and Credentials

This page covers how Pi Agent Desktop stores and loads configuration: the
model/provider catalog and preferences, credential storage and synchronization,
theme / window / UI state, and channel credentials.

## Model configuration persistence

Model provider configuration lives in `models.json` in the Pi agent directory
(`~/.pi/agent/models.json` via `getAgentDir()`), shared with the Pi CLI
(`handlers.ts:210-212`).

Writes are conflict-checked and atomic:

- The Host reads a snapshot of the file together with a content version
  (`sha256` of the raw bytes, or the sentinel `"missing"` when the file is
  absent) (`handlers.ts:214-225`).
- `writeModelsJson` requires the version the Renderer saw to be unchanged
  before committing; otherwise it throws a `CONFLICT` RPC error so the editor's
  pending edits are not silently lost (`handlers.ts:241-247`).
- The new content is written to a `.<pid>.tmp` file then renamed over the
  target; the previous good file is copied to `models.json.bak` and the rename
  happens atomically (`handlers.ts:249-279`).
- A corrupt `models.json` produces a `PARSE_ERROR` RPC error (never a silent
  empty overwrite) (`handlers.ts:227-239`).

## Model catalog refresh

`ModelCatalogRefreshCoordinator` in `src/agent-host/model-runtime.ts` drives
on-demand refreshes of the model catalog. A refresh is keyed by both request id
and cwd; starting a new refresh replaces the previous one for that request id
and cwd, and the shared runtime refresh uses `allowNetwork: true, force: true`
(`model-runtime.ts:59-149`).

Key semantics:

- Each refresh runs under an `AbortController`, and a 12s hard timeout aborts
  it (`MODEL_CATALOG_REFRESH_TIMEOUT_MS`) (`model-runtime.ts:5`, `:87`).
- When `PI_OFFLINE` is set the coordinator skips network refresh and returns an
  `offline` catalog state.
- On timeout or abort, the most recent cached models remain available, and a
  warning is attached (`model-runtime.ts:125-143`). Per-provider failures each
  yield a `PROVIDER_REFRESH_FAILED` warning while the last known snapshot stays
  available (`resolveAvailableModels` in `handlers.ts:604-641`).
- `cancel(requestId)` aborts a specific refresh; `cancelAll()` aborts all.

The host keeps a single shared `ModelRuntime` (`getSharedModelRuntime`), while
each agent session gets its own cwd-bound session service so project
extensions cannot leak provider registrations across sessions
(`model-runtime.ts:173-189`). `reloadSharedModelRuntimeConfig` refreshes local
config (`allowNetwork: false`) once the shared runtime exists.

## Enabled-model preferences

Per-project enabled-model lists are stored via the Pi settings manager
`getEnabledModels` / `setEnabledModels`. `filterByExactEnabledModels` only shows
models whose `provider/id` (or bare `id`) is in the enabled set; a
thinking-level suffix (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`) is
stripped before comparison (`handlers.ts:316-344`). If no enabled model matches,
all available models are shown. Input references are normalized and validated
(at most 2000 entries) in `normalizeEnabledModelsInput`.

The default model/provider is the one from settings when it is visible in the
filtered list.

## Credentials

### Model/provider credentials

Provider API keys, OAuth tokens, and logout are managed through Pi's model
runtime via `auth.*` RPC methods. Credential mutations are verified against the
actual runtime state in `credential-sync.ts`:

- `credentialStateMatches` compares the current runtime credential list to the
  intended target.
- After writing a credential, if the model runtime state does not match and a
  refresh (`allowNetwork: false`) fails, the operation returns a warning
  `MODEL_SYNC_FAILED` rather than presenting success (`credential-sync.ts:26-48`).
- A `CredentialSynchronizationError` triggers an attempted recovery via
  `recoverCommittedCredential` before the mutation is reported
  (`handlers.ts:382-399`).

Credentials themselves are persisted by the Pi agent in `~/.pi/agent/`.
`auth.loginStart` kicks off an OAuth flow whose progress arrives on the
`auth.login` stream.

### Channel credentials (CredentialVault)

Channel (Weixin / Telegram / Feishu) secrets are stored in the Main process by
`CredentialVault` (`src/main/credential-vault.ts`) in
`<userData>/channels.secrets.json`. Values are encrypted with Electron
`safeStorage` and base64-wrapped; the file is written atomically with mode
`0o600` (`credential-vault.ts:34-44`). If `safeStorage.isEncryptionAvailable()`
is false the vault refuses to read or write (`credential-vault.ts:46-50`), so a
machine without OS encryption never silently drops credentials.

Keys are restricted to the pattern
`channel:(weixin|telegram|feishu):<safe-id>` (`credential-vault.ts:10-15`). The
Host accesses it only through the `channelSecrets.*` request handler bridged by
Main (`host-manager.ts` request handler), so tokens never travel over the
Renderer RPC surface.

### Browser secrets

Advanced-browser-mode secrets (proxy credentials, header-rule secrets) are held
in a separate `BrowserSecretVault` (`src/main/browser/browser-secret-vault.ts`)
in `<userData>/browser-secrets.json`, also `safeStorage`-encrypted and
ref-addressed; see the browser service page.

## UI state

`src/main/window-state.ts` persists UI state to `<userData>/ui-state.json`:
window bounds / maximized flag (debounced 400ms while moving/resizing,
immediate on close), sidebar width, theme (`light`/`dark`/`system`), recent
cwds, background mode, and `automaticUpdateChecks` (`window-state.ts:40-70`).
`loadUiState` tolerates a missing/corrupt file by returning `{}`.

The theme is applied by setting `nativeTheme.themeSource` from the persisted
value at startup (`main.ts`), and the renderer can change it through
`desktop:set-theme-source`.

`desktop:set-ui-state` only accepts a validated patch
(`validateDesktopUiStatePatch`) before persisting (`ipc.ts:301-303`). Toolchain
settings (managed-runtime install preferences etc.) are persisted separately by
the toolchain state store under the app-private toolchain directory; see the
developer-toolchains page.

## Channel configuration

Channel accounts/bindings and login state are persisted by the channel config
store and state store in the Host data directory
(`~/.pi/desktop/channels.json`, `channels.state.json`, and staged media under
`channel-media`). Secrets never go in these files — see the messaging-channels
page.

## Verification

Invariants for configuration correctness are exercised by focused unit tests
(for example `credential-sync`, `model-runtime` helpers, `window-state-core`)
plus the contract-coverage gate (`scripts/check-contract-coverage.mjs`).
