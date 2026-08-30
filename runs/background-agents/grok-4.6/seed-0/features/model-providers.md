---
type: concept
title: Models and Provider Accounts
description: Shared model catalog, enabled-model preferences, OpenAI/xAI provider accounts with device authorization, and session-time credential brokering instead of injecting refresh tokens into sandboxes.
tags: [models, provider-accounts, oauth, openai, xai]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-414d0a78dd85b57e3bed791a
    resource: repo://docs/SECRETS.md
  - id: openwiki-source-e5690b79a03f9b0f2783b057
    resource: repo://packages/control-plane/src/auth/model-provider-account-broker.ts
  - id: openwiki-source-8a624819bbdf013df8d41875
    resource: repo://packages/control-plane/src/db/model-preferences.ts
  - id: openwiki-source-89bebc8acc44d041304ed912
    resource: repo://packages/control-plane/src/model-provider-accounts/device-authorization-service.ts
  - id: openwiki-source-4aa06a831d9e0d5e53fc8c9a
    resource: repo://packages/control-plane/src/model-provider-accounts/selection-policy.ts
  - id: openwiki-source-ce46a61cd656c7c88cdef31c
    resource: repo://packages/control-plane/src/session/provider-account-resolution.ts
  - id: openwiki-source-5691b8c2b7f7ad4c56c661bf
    resource: repo://packages/shared/src/models.ts
  - id: openwiki-source-2f916d6029b0c86cc5dd2609
    resource: repo://packages/shared/src/types/provider-accounts.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Models and Provider Accounts

Model **ids** live in `@open-inspect/shared` (`MODEL_CATALOG`, `VALID_MODELS`, `DEFAULT_MODEL`). Control plane, web UI, and Slack bot all validate against that catalog so a model string cannot mean two things. The catalog must define exactly one `default: true` entry (currently Claude Sonnet 4.6). Reasoning efforts (`none` / `low` / `medium` / `high` / `xhigh` / `max`) are per-model. See [Shared Contracts](/openwiki/architecture/shared-contracts.md) and `docs/AVAILABLE_MODELS.md`.

## Enabled catalog

`ModelPreferencesStore` persists a global `enabled_models` JSON list. `getEffectiveEnabledModels` returns stored ids that still exist in `VALID_MODELS`, or `DEFAULT_ENABLED_MODELS` when nothing usable is stored. Settings → Models can hide xAI, OpenCode Zen, Z.AI, DeepSeek, and similar groups that are in the catalog but not on by default.

Session create and child spawn reject a model that is not in the effective enabled list. Anthropic keys typically come from deployment/global secrets (`ANTHROPIC_API_KEY`). Z.AI and DeepSeek use their own secret keys. OpenAI and xAI can use either an API key **or** a connected subscription account.

## Subscription provider accounts

`SUBSCRIPTION_PROVIDER_IDS` is `openai` and `xai` (ChatGPT and SuperGrok). Accounts are stored in D1 (`model-provider-accounts`, encrypted credentials, authorizations). Status is `active`, `disabled`, or `reconnect_required`.

Users connect an account through **device authorization** (`device-authorization-service.ts`): a transaction id (64 hex chars), poll interval bounded 1–60s, lifetime 10 minutes. Payloads are encrypted at rest. Completing the flow creates or reconnects an account via `ModelProviderAccountService` adapters.

Selection modes (`providerAuthSelectionSchema`):

- `provider_account` + `accountId` (32 hex)
- `api_key`

`resolveSessionProviderAuth` snapshots an immutable auth choice **per provider** onto the session at create:

1. Explicit `providerSelections` from the client
2. Else installation default (`ProviderDefaultStore`)
3. Unattended launches (Slack, GitHub, Linear, unpinned automations) honor `unattendedMode` (`api_key` vs default account)
4. Else `legacy_scoped_oauth` fallback

`ProviderAccountSelectionPolicy` validates that the account exists, belongs to that provider, and is eligible for `active_use`. Invalid id → 400, missing → 404, inactive/no adapter → 409.

Automations can pin an account or resolve defaults on each run. See [Automations](/openwiki/integrations/automations.md).

## Brokering, not injecting refresh tokens

Managed OAuth **refresh tokens stay in D1**. They are not sandbox env vars. `docs/SECRETS.md` states this explicitly.

`ModelProviderAccountBroker.getAccess`:

- Returns a cached access token if it is still outside the adapter’s refresh buffer
- Otherwise single-flights a claimed credential exchange (`ClaimedProviderCredentialExchange`) so two concurrent prompts cannot double-refresh
- `touchLastUsed` is rate-limited (`LAST_USED_WRITE_INTERVAL_MS` = 15 minutes)
- Errors include `reconnect_required`, `exchange_busy`, `credential_invalid`, `upstream_retry_safe`

The sandbox asks the Durable Object (`/internal/openai-token-refresh`, `/internal/xai-token-refresh`) when OpenCode needs a fresh token. `OpenAITokenRefreshService` / `XaiTokenRefreshService` resolve OAuth secret **scope** (global vs repo vs environment) then delegate to the broker. In-sandbox plugins (`codex-auth-plugin.js`, `xai-auth-plugin.js`, `provider-token-broker.js`) are the agent-facing seam.

`PROVIDER_ACCOUNTS_ENCRYPTION_KEY` protects account material (AES-256, fail-closed like other encryption keys). See [Security Model](/openwiki/concepts/security-and-auth.md).

## Session pinning

`initializeSession` stores `providerAuth` on the D1 index and in the Durable Object. Changing installation defaults does not rewrite in-flight sessions. Child sessions copy or re-resolve according to spawn input; spawn still checks `getEffectiveEnabledModels`.

## Failure behavior

- Unknown model id → rejected at create/spawn
- Disabled account selected → 409
- Refresh requiring user interaction → `reconnect_required`; the session cannot silently use a dead subscription
- Missing Anthropic (or other API-key) secret → sandbox/OpenCode fails at runtime; that is a secrets problem, not provider-account policy
