---
type: gatekeeper-lifecycle
title: "Gatekeeper Connection Lifecycle and Policy"
description: How gatekeeper accounts come to exist — the OAuth connect flow with its nonce and callback bridge, the disabled/optional/enabled provisioning modes for ambient gatekeepers, disconnect/reconnect semantics, credential expiry tracking, and the admin-config chokepoints that gate capability minting.
tags: [gatekeepers, provisioning, oauth, policy, admin]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Gatekeeper Connection Lifecycle and Policy

An account reaches a user's `UserDurableObject` one of three ways: a user-driven **OAuth connect flow**, an **auto-provisioned** account minted with no OAuth flow, or an account **established during sign-in** (Cloudflare only).

## The connect flow

`UserDurableObject.connectAccount(vendorId, resourceUrlPatterns?)` (packages/workshop-backend/src/user.ts:1142-1167):

1. Resolves the `GATEKEEPER_*` vendor binding and refuses if the deployment's admin config has **disabled that gatekeeper entirely**.
2. Allocates the next account id and mints a `GatekeeperConnectCallbackImpl` entrypoint carrying `{userId, accountId, vendorId}` as props.
3. Calls `vendor.connectAccount(callback, {resourceUrlPatterns})` and returns the OAuth popup URL.

When the flow completes, the gatekeeper invokes the callback's `complete(account, expiresAt?)`, which persists the account record — id, account stub, description, vendor id, and expected credential expiry — via `putConnectedAccount`; `credentialsExpired`/`credentialsRestored` flip the record's expiry flags so the UI can prompt a reconnect (packages/workshop-backend/src/user.ts:1734-1760).

Account listing is resilient: iterating records **skips any that fail to deserialize** (e.g. a stub pointing at a gatekeeper no longer bound in the deployment) so one stale account cannot break listing, provisioning, or opt-in for the others (packages/workshop-backend/src/user.ts:1169-1188).

**Disconnect and reconnect** (packages/workshop-backend/src/user.ts:1500-1560):

- Disconnecting calls the account's `revoke()` — the gatekeeper's cleanup hook for its own per-user storage, not just OAuth revocation — then deletes the record. Disconnecting Cloudflare additionally clears the billing state.
- A **forced ("enabled") ambient account cannot be disconnected by the user**; an opt-in ("optional") ambient account can, with `revoke()` best-effort so a throwing gatekeeper never blocks the disconnect.
- `reconnectAccount` delegates to the account's nonce-protected reconnect URL; all bindings created through the account keep working with the new credentials (packages/workshop-shared/src/gatekeeper.ts:609-619).

## Auto-provisioned (ambient) accounts

The policy is a **three-state mode per vendor**, stored in `AdminConfig.ambientGatekeeperModes` and resolved by `provisioning-policy.ts` — the single chokepoint for the decision (packages/workshop-backend/src/provisioning-policy.ts:1-34):

- **`disabled`** — no account is provisioned; existing ones stay dormant (their singleton/UI stops being surfaced but data is preserved, so re-enabling restores it).
- **`optional`** — users opt in from the Connectors page; **the default**, because ambient authority is not imposed on every user unless an admin explicitly turns it on.
- **`enabled`** — auto-provisioned for every user, forced and not user-removable.

`createAccount()` on the vendor mints the account with **no OAuth flow and no user identity argument** — safe to expose publicly because it only *creates* accounts and cannot look up or return an existing one; the Workshop persists the returned account like any connected account and treats it as the authority thereafter (packages/workshop-shared/src/gatekeeper.ts:514-522, packages/workshop-backend/src/user.ts:1255-1267). Provisioning is idempotent, best-effort per vendor, and deduped against concurrent calls (packages/workshop-backend/src/user.ts:1291-1329).

## Sign-in-linked accounts

Only Cloudflare persists a grant during sign-in: the login callback resolves the user by verified email and calls `linkConnectedAccountFromLogin`. A repeated sign-in is a **re-authorization**: the fresh grant replaces the stale one in place — revoking the old gatekeeper-side grant and pointing the existing record (same id, stable UI references) at the fresh one — because keeping the stale record would leave billing broken whenever the old token had expired (packages/workshop-backend/src/user.ts:1552-1600). That grant covers billing only; gadget-facing resources are authorized separately later.

## Admin gating at the capability chokepoint

Two places in the user DO enforce admin policy (packages/workshop-backend/src/user.ts:1147-1149, 1666-1691):

- `connectAccount` refuses to *start* a flow for a fully disabled gatekeeper.
- `getGatekeeperClassFor(accountId, url)` — the single core-side chokepoint where a `resourceUrl` becomes a capability (reached only via user/UI-facing `Overseer.newGatekeeper` and blueprint instantiation, never from gadget or agent code) — blocks **whole disabled gatekeepers** and **individually disabled resources** (`AdminConfig.disabledResources`, keyed by vendor with disabled `urlPattern`s), so a request that bypasses the separately filtered picker/agent listings still cannot mint the capability.

Per-vendor ambient modes gate provisioning and *surfacing* (`listAddableGatekeepers` offers only `optional` vendors the user hasn't added; `listProvidedAccounts` hides disabled singletons), enforced in the user DO via the policy helpers (packages/workshop-backend/src/user.ts:1217-1229, 1330-1347).

## Related pages

- [Gatekeeper Contract](/openwiki/gatekeepers/contract.md) — the interfaces this lifecycle drives.
- [UserDurableObject: Per-User State](/openwiki/backend/user-do.md) — where account records live.
- [Backend Kernel: server.ts and API Implementations](/openwiki/backend/kernel-server.md) — the AdminConfig these gates read.
