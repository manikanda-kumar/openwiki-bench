---
type: "Reference"
title: "UserDurableObject: identity, accounts, and registries"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-1a639d30d379c2d84f60e549
    resource: repo://docs/oauth-signin.md
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# UserDurableObject: identity, accounts, and registries

One `UserDurableObject` per account, addressed by `idFromName(username-or-email)` — which is what
makes identity portable across auth modes (a password account and a gatekeeper sign-in with the
same verified email are the same DO) (`docs/oauth-signin.md:18-22`). All of the user's state lives
in its typed storage (`user.ts:157-226`).

## Storage schema

**Collections**: `aiModels` (per model configs, keyed by profile id), `gadgets` (the user's
workspace registry — `GadgetRecord` with created/lastActive, where a missing `lastActive` marks a
gadget provisional to a chat), `connectedAccounts` (per connected gatekeeper account:
`ConnectedAccountRecord` with the account `Fetcher`, vendorId, description, expiry and a
`credentialsExpired` flag set by async notification from the gatekeeper), `sessions` (token-id →
record), `blueprints` (owned + uploaded), `libraryBlueprints`, and `outputs` (the workspace-outputs
index mirrored in by each Overseer so the Outputs page is one cheap read; entries are meaningful
only while the `gadgets` record exists).

**Singletons**: `created`/`profile`, `quickModel`/`preferredModel`, `onboardingCompleted`,
`cloudflareBilling` (selected billing account + cached credit balance — the OAuth tokens live in
the gatekeeper account, never here), `nextAccountId`, `pinnedBlueprints`, the outputs backfill
cursor, `dailyLlmCount` (the free-tier UTC-day counter — folded in from a former standalone
RateLimitDO), and `passwordHashHash`.

## Auth surface

`authenticate(token)` hashes the secret and looks up the session; `login`/`createAccount` compare
the doubly-hashed password; `loginOrCreateViaGatekeeper(email, allowCreate)` resolves or
first-time-creates the account for gatekeeper sign-in (refusing when signups are closed);
`authenticateFromCfAccess` creates on first use with the Access-verified email
(`user.ts:304-443`).

## Gadget registry

`newGadget(id, title)` registers a workspace DO id the user owns; `deleteGadget` removes it
(delegating deletion to the Overseer); `recordSharedGadgetOpen`/`updateSharedGadgetRole`/
`forgetSharedGadget` maintain the cached listing of workspaces shared *with* the user — a stale
entry survives revocation (deliberately lazy) and is cleaned up when a later open denies
(`user.ts:469-521`, `792-810`; `docs/sharing.md:46-52`).

## Connected accounts

`connectAccount(vendorId)` starts the vendor's OAuth flow with a
`GatekeeperConnectCallbackImpl` keyed by `{userId, accountId, vendorId}` props
(`user.ts:1142-1167`). Records are resilient: iteration skips records that fail to deserialize
(e.g. an account stub pointing at a gatekeeper Worker no longer bound), so one stale account
cannot poison listing, provisioning, or opt-in for the rest (`user.ts:1169-1188`).
`putConnectedAccount` dedupes by vendor + identity: a provider that returns the already-logged-in
identity causes the **new grant to be revoked** and the existing record kept stable for UI
references (`user.ts:1631-1643`).

Ambient (auto-provisioning) vendors follow the three-state policy in
[admin config](/openwiki/operations/admin-config.md): `#ensureAutoProvisionedAccounts` provisions
missing `enabled` accounts (deduped per user-DO input gate), `provisionAmbientAccount` opts a user
into an `optional` vendor (idempotent, per-vendor single-flight), and listing hides `enabled`
accounts from the Connectors UI while `subscribeConnectedAccounts` includes them only when observer
verification explicitly requests them (`user.ts:1229-1376`, `1377-1440`).

The account surface also exposes singleton and UI capabilities:
`getSingletonGatekeeperClass(accountId)` (present only when `description.singleton` is set) and
`startAccountAppUi(accountId, {isAdmin})` with admin status supplied fresh per open
(`user.ts:1352-1370`).

## The chokepoint: `getGatekeeperClassFor`

`UserDurableObject.getGatekeeperClassFor(accountId, url)` is **the single core chokepoint where a
resourceUrl becomes a capability**. It looks up the connected account, asks the account's vendor
class to resolve the URL, and then — before returning — throws if the deployment's admin config
disables the whole gatekeeper or that specific resource URL pattern. It is reached only via the
user-facing `Overseer.newGatekeeper` and blueprint instantiation, never from gadget or agent code
(`user.ts:1666-1691`; `REVIEW.md:29-32`). Any new code path minting a gatekeeper capability must
route through it.

The same DO also mints **observer verifiers**: `getVerifier(accountId, expectedVendorId)` returns
null when the account is gone and **throws** on a vendor mismatch (only reachable by bypassing
client-side filtering) — this server-side check is what guarantees a gatekeeper only ever receives
a verifier minted by its own vendor (`user.ts:1693-1715`).

## Models and usage

`getChatContext(modelId)` resolves the requested model (gateway models first in AI Gateway mode,
then the user's own configs), plus the quick model used for titles — and is documented **DO NOT
MAKE PUBLIC** because it returns API keys; it is a pure read so call sites may replay it across DO
resets (`user.ts:694-727`). The free-tier counter lives here: `consumeDailyLlmCall` atomically
checks and counts one call per UTC day, and a stale `day` implicitly resets the count
(`user.ts:215-218`, `670-692`).

## Outputs index

The `outputs` collection mirrors every workspace's outputs (workpiece id, title, created, output
format) keyed by `workspaceId:workpieceId`, with a `byWorkspace` index; workspaces push updates
(`syncWorkspaceOutputs`) and a lazy per-user backfill sweeps pre-index workspaces a page at a time
using the `outputsBackfillCursor` (`user.ts:178-210`, `812-899`).
