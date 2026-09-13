---
type: concept
title: Models, Auth, and Credentials
description: Model provider configuration in models.json, model catalog refresh and preferences, OAuth/API-key authentication, credential synchronization, and the OS-backed channel credential vault.
tags: [agent-host, models, auth, credentials, secrets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-3fce36d83dba68d016d0f921
    resource: repo://src/agent-host/auth-login.ts
  - id: openwiki-source-eb9e0459c8a1f879260874ca
    resource: repo://src/agent-host/credential-sync.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-e754dbf111c65da11a25634e
    resource: repo://src/agent-host/model-runtime.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Models, Auth, and Credentials

Model configuration and authentication live in the Agent Host. The Host wraps Pi's `ModelRuntime` and `SettingsManager` to expose the `models.*`, `modelsConfig.*`, and `auth.*` RPC methods defined in `src/contract/api.ts` and implemented in `src/agent-host/handlers.ts`. Channel credentials are handled separately by the Main-process `CredentialVault` backed by Electron's `safeStorage`.

## Model configuration file: `models.json`

Provider/model configuration is persisted as `models.json` in the Pi agent directory (`getAgentDir()`), read and written through `readModelsJsonSnapshot`/`writeModelsJson` in `handlers.ts`.

- The file is parsed strictly: a corrupt file raises `PARSE_ERROR` instead of being silently treated as empty (`src/agent-host/handlers.ts:227`), so a later write cannot overwrite a corrupted file with an empty config.
- Writes are optimistic-concurrency controlled: `modelsConfig.set` must supply the `expectedVersion` (a `sha256:` content hash) that matched the last read. If the file changed between read and write, `writeModelsJson` throws `CONFLICT` (`"models.json changed outside this editor"`) and nothing is saved (`src/agent-host/handlers.ts:241`).
- The write is atomic: content goes to a temp file, the previous good file is backed up to `models.json.bak`, and a rename commits it. The version returned is the hash of the newly written content (`src/agent-host/handlers.ts:249`).
- After a successful write, `reloadSharedModelRuntimeConfig()` refreshes the shared runtime with `allowNetwork: false` so the new local config is picked up without a network refresh (`src/agent-host/handlers.ts:1578`, `src/agent-host/model-runtime.ts:192`).

`modelsConfig.test` validates a proposed provider/model without touching the real config: it builds a throwaway `models.json` in a temp directory, creates an isolated `ModelRuntime` with `allowModelNetwork: false`, loads the model, and issues a `Reply with OK only.` completion bounded by a 20 s timeout and `maxTokens: 16` (`src/agent-host/handlers.ts:1581`).

## Model listing, refresh, and preferences

- `models.list` builds a per-`cwd` model list from the provider's available snapshot (`src/agent-host/handlers.ts:1510`). `projectModelsList` maps the snapshot into `{ id, name, provider }` plus supported thinking levels and the default model from `SettingsManager` (`src/agent-host/handlers.ts:643`).
- `models.refresh` is coordinated by `ModelCatalogRefreshCoordinator`, which deduplicates by `cwd` and `requestId`, enforces a 12 s timeout, and can be replaced or cancelled. On timeout/abort or provider failure the cached model list remains available with a `ModelCatalogWarning` (`src/agent-host/model-runtime.ts:49`). When `PI_OFFLINE` is set, refresh skips the network and reports `source: "offline"`.
- `models.preferences.get/set` manage the enabled-model list per project. `set` normalizes model references (strips thinking-level suffixes such as `:high`), rejects input that disables every available model, and persists through `settingsManager.setEnabledModels` (`src/agent-host/handlers.ts:1553`).

The shared runtime is a process-wide singleton (`getSharedModelRuntime`) used for host-level credential/model management; per-session runtimes are cwd-bound so project extensions cannot leak provider registrations across sessions (`src/agent-host/model-runtime.ts:175`).

## OAuth and API-key authentication

`auth-login.ts` implements the OAuth interaction bridge (`Streams["auth.login"]`).

- `auth.loginStart` calls `modelRuntime.login(provider, "oauth", ...)`. The Pi runtime emits `auth_url` / `device_code` / `progress` events that are forwarded to the Renderer as `auth.login` stream events (`src/agent-host/auth-login.ts:134`).
- Interactive prompts (`select`, `manual_code`, `secret`) create a pending token registered in `loginCallbacks`; the Renderer answers through `auth.loginSubmit` which resolves the token's promise via `resolveLoginCode` (`src/agent-host/auth-login.ts:20`). Each login flow is tracked by an `AbortController` in `activeLogins`, and `auth.loginCancel` aborts it (`src/agent-host/auth-login.ts:28`).
- `auth.providers` lists OAuth-capable providers (excluding `anthropic`) with their stored authentication state; `auth.allProviders` lists API-key providers (excluding OAuth ids and providers configured directly via `models_json_key`) (`src/agent-host/handlers.ts:1689`).
- `auth.setApiKey` / `auth.deleteApiKey` / `auth.logout` call the runtime then **verify** the mutation with `credentialStateMatches` — the credential must be readable back as present (or absent) or the operation is reported as failed (`src/agent-host/handlers.ts:1745`).

## Credential synchronization and recovery

`credential-sync.ts` verifies that a credential mutation took effect:

- `credentialStateMatches` lists the runtime credentials and checks the provider/type/presence expectation.
- `recoverCommittedCredential` is used when a `CredentialSynchronizationError` occurs: if the credential state shows the mutation actually committed, it returns `ok: true` (attempting a local refresh) with a `MODEL_SYNC_FAILED` warning if the refresh fails, instead of failing the whole operation (`src/agent-host/credential-sync.ts:26`). This means a committed credential is never reported as a hard failure just because the in-memory model state could not refresh.

## Channel credential vault (Main process)

Channel secrets (WeChat, Telegram, Feishu/Lark) are stored by the Main process in a `CredentialVault` backed by Electron `safeStorage` (OS-keychain encryption), NOT in the Agent Host.

- The vault file lives at `<userData>/channels.secrets.json`, entries are encrypted strings keyed by `channel:<channel>:<accountId>` (`src/main/credential-vault.ts:10`).
- Key format is strictly validated: `/^channel:(weixin|telegram|feishu):[a-z0-9._-]{1,160}$/i` (`src/main/credential-vault.ts:10`).
- Every read/write checks `safeStorage.isEncryptionAvailable()`; if OS encryption is unavailable, channel credentials are refused rather than stored in plaintext (`src/main/credential-vault.ts:46`).
- Writes are atomic (temp + rename, mode `0o600`). The Host never sees the secret values; it calls Main through `channelSecrets.*` parent-RPC (`src/agent-host/channels/channel-manager.ts:158`), and `createCredentialRequestHandler` in Main enforces the vault (`src/main/credential-vault.ts:78`). The UI sees only a credential fingerprint (`fingerprintSecret`) in channel snapshots.

## RPC surface

| Method group | Purpose |
| --- | --- |
| `models.list` / `models.refresh` / `models.refreshCancel` | List and refresh per-project model catalogs |
| `models.preferences.get/set` | Enabled-model list per project |
| `modelsConfig.get/set/test` | Read/write/validate `models.json` with optimistic concurrency |
| `auth.providers` / `auth.allProviders` | OAuth vs API-key provider inventory |
| `auth.setApiKey` / `auth.deleteApiKey` / `auth.logout` | API-key and session management with read-back verification |
| `auth.loginStart` / `auth.loginSubmit` / `auth.loginCancel` | Interactive OAuth / device-code flow bridge |

## Tests

- `src/agent-host/auth-login.test.mjs` covers OAuth prompt/event bridging.
- `src/agent-host/model-runtime.test.mjs` covers catalog refresh abort/timeout/offline behavior.
- `src/agent-host/credential-sync.test.mjs` covers `credentialStateMatches` and `recoverCommittedCredential`.
- `src/agent-host/handlers.test.mjs` covers `models.json` concurrency conflicts and atomic writes.
