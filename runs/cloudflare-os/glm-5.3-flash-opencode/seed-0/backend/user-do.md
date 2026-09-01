---
type: user-do
title: "UserDurableObject: Per-User State"
description: The per-user Durable Object — its typed-storage schema (sessions, gadgets, connected accounts, blueprints and library, outputs index, AI models), the outputs catch-up sweep, the daily LLM counter, and how auto-provisioned gatekeeper accounts are minted, protected, and gated.
tags: [durable-objects, users, storage, accounts, quotas, outputs]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# UserDurableObject: Per-User State

Every user account is one Durable Object (`UserDurableObject` in packages/workshop-backend/src/user.ts), keyed by `idFromName(username-or-email)` — so the session token's prefix routes authentication straight to it (packages/workshop-backend/src/server.ts:680-694). Its state is a typed-storage schema declared in `makeUserStorage()` (packages/workshop-backend/src/user.ts:157-250).

## Owned records

- **`sessions`** — `LoginSessionRecord`s keyed by the SHA-256 hex digest of each session token; the raw token is never stored (packages/workshop-backend/src/user.ts:80-83, 344-352).
- **`gadgets`** — `GadgetRecord`s (metadata plus `created`/`lastActive`; `lastActive` missing means the gadget is *provisional* and hidden from listings). Shared workspaces appear here with an `owner` profile and a presentation-only cached `role` — refreshed by `recordSharedGadgetOpen`/`updateSharedGadgetRole`, never used for authorization (packages/workshop-backend/src/user.ts:101-110, 455-518).
- **`connectedAccounts`** — `ConnectedAccountRecord`s: numeric id, the account Fetcher (a `GatekeeperUser`), its `AccountDescription`, `vendorId` derived from the `GATEKEEPER_*` binding name, credential-expiry fields, and `autoProvisioned` — set when the Workshop minted the account itself, which **protects it from manual disconnect** because deleting one permanently destroys the user's data in that gatekeeper (packages/workshop-backend/src/user.ts:22-33).
- **`blueprints` / `libraryBlueprints`** — the user's published blueprints and their saved-by-reference/uploaded library entries (packages/workshop-backend/src/user.ts:85-99).
- **`outputs`** — one `OutputRecord` per workspace output (`workspaceId:workpieceId` primary key, indexed by workspace), mirrored here by each workspace's Overseer so the Outputs page is one cheap read of the user's own DO (packages/workshop-backend/src/user.ts:113-130, 178-187, 798-810).
- **Singletons**: profile, `quickModel`/`preferredModel` ids, `onboardingCompleted`, Cloudflare billing state (selected account + cached balance — the OAuth tokens themselves live in the connected Cloudflare *gatekeeper* account), `passwordHashHash`, the daily-LLM counter, outputs-backfill cursor, and `nextAccountId` (packages/workshop-backend/src/user.ts:132-142, 189-250).

## Outputs index and catch-up

The outputs index is a **push mirror**: each workspace's Overseer calls `syncWorkspaceOutputs` whenever its registry changes and whenever it is opened; entries for workspaces the user no longer tracks are dropped, and deleting a gadget drops its outputs (packages/workshop-backend/src/user.ts:798-810, 789-797). `listOutputs()` also drives a one-time **catch-up sweep** for workspaces predating the index (packages/workshop-backend/src/user.ts:815-855):

- The sweep examines one bounded page (`OUTPUTS_BACKFILL_PAGE = 16` workspaces) per call and reports whether more remains — a first Outputs load must not wait on every workspace the user ever created; the client drains the rest while the page is open (packages/workshop-backend/src/user.ts:18-20).
- It asks each target workspace for its snapshot via `getOutputsForOwnerBackfill`, which returns null unless the caller really is the owner (packages/workshop-backend/src/overseer.ts:8239-8247).
- The cursor advances **past failed workspaces rather than retrying** — the index is self-healing (a missed workspace reappears the moment it is touched), whereas holding the cursor would let one unwakeable workspace stall the sweep forever. An all-failed page stops draining so an outage doesn't produce a burst of doomed calls (packages/workshop-backend/src/user.ts:846-855).
- Read-back joins presentation fields (workspace title, lastActive, owner/role) from the `gadgets` collection at read time so they can't go stale, and sorts by lastActive (packages/workshop-backend/src/user.ts:113-121, 857-876).

## Daily LLM counter

The free-tier counter is folded into the user DO (the former standalone `RateLimitDO`): single-threaded DO execution makes the read-modify-write race-free; the window resets at UTC midnight when the stored day no longer matches (packages/workshop-backend/src/user.ts:658-667). `consumeDailyLlmCall` atomically checks and counts — `withinLimits` is the *pre-count* decision, and once exhausted it no-ops, so a blocked request never counts (packages/workshop-backend/src/user.ts:677-692). `checkDailyLlmCount` is the read-only variant for the UI.

## Model resolution

`getChatContext` resolves the chat's model: in AI Gateway mode gateway models resolve first from the gateway config, falling back to the user's own `aiModels` records; the quick model is hardcoded to the gateway's config in gateway mode (packages/workshop-backend/src/user.ts:694-727). The method is marked **"DO NOT MAKE PUBLIC — returns API keys"** and is deliberately a pure read so call sites can replay it across DO resets with `retryOnDoReset` (packages/workshop-backend/src/user.ts:694-695).

## Connected accounts: provisioning and gating

- **Auto-provisioning**: `listProvidedAccounts()` first ensures every bound vendor that declares `autoProvisionedAccount` and is permitted by the provisioning policy has an account (`shouldAutoProvisionAccount` — only "enabled" vendors are forced for everyone; "optional" vendors are added on user demand; "disabled" never), then lists the accounts declaring an agent singleton and/or management UI. Concurrent provisioning is deduped (`#ensureAccountsPromise`) because the loop's cross-worker RPCs release the DO input gate and overlapping calls could otherwise mint duplicate accounts. Provisioning resolves the account's description *before* allocating an id, so a `describe()` failure doesn't burn a slot (packages/workshop-backend/src/user.ts:1268-1347).
- **Disabled-mode dormancy**: a "disabled" ambient gatekeeper's existing account stays in storage (data preserved; re-enabling restores it) but its singleton and UI are not surfaced (packages/workshop-backend/src/user.ts:1330-1337).
- **The capability chokepoint**: `getGatekeeperClassFor(accountId, url)` is the single core-side place where a `resourceUrl` becomes a capability — reached only via user/UI-facing `Overseer.newGatekeeper` and blueprint instantiation, never from gadget or agent code. It blocks whole disabled gatekeepers and disabled resources there, so a request bypassing the (separately filtered) listings still cannot mint the capability (packages/workshop-backend/src/user.ts:1666-1691).
- **Verifiers**: `getVerifier(accountId, expectedVendorId)` mints the observer-verification capability for one of the user's own accounts, throwing on a vendor mismatch (only reachable by bypassing client-side filtering) (packages/workshop-backend/src/user.ts:1694-1710).

## Session model

Session tokens are `<userId>:<secret>`; `authenticate()` hashes the presented secret and looks up the digest in `sessions` (packages/workshop-backend/src/user.ts:304-319). Gatekeeper/Cloudflare-Access-created accounts key on email, seed the display name from the email local-part once, and have no password until one is set (packages/workshop-backend/src/user.ts:402-432 — covered in [Authentication and Sign-In](/openwiki/architecture/authentication.md)).

## Related pages

- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md) — how the DO is reached and wrapped.
- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md) — provisioning modes and connect flows.
- [Sharing and Collaboration](/openwiki/backend/sharing.md) — the shared-gadget records this DO keeps.
