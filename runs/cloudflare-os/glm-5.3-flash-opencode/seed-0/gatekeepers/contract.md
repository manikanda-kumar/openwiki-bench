---
type: gatekeeper-contract
title: "Gatekeeper Contract"
description: The workshop-shared interfaces every gatekeeper implements — GatekeeperVendor (connect/nonce/scopes), GatekeeperUser (the privileged per-user adapter), the Gatekeeper session Durable Object with its approval semantics, observations vs actions, hooks, and the auto-approval drain — plus where trust in server claims is placed.
tags: [gatekeepers, capabilities, approvals, hooks, security, rpc]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-669795377fedf4b619e2a53a
    resource: repo://packages/workshop-backend/src/auto-approval.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Gatekeeper Contract

All gatekeeper interfaces live in `packages/workshop-shared/src/gatekeeper.ts`. They form a chain of capabilities: a **vendor** (the Worker) connects **accounts** (per-user adapters), accounts mint **gatekeeper classes** for specific resources, and those classes run as Durable Object facets inside each workspace's overseer, speaking to gadgets only through an **approval queue**.

## GatekeeperVendor — the vendor entrypoint

`GatekeeperVendor` (packages/workshop-shared/src/gatekeeper.ts:445-523) exposes:

- `describe()` — display metadata, including `providesAuth` and `autoProvisionsAccount` flags.
- `connectAccount(callback, options)` — starts the OAuth popup flow, returning the URL the browser opens. The URL **must include a cryptographic nonce** (stored in the flow DO and verified on return) to prevent replay attacks. `options.scopes` selects `"full"` (the usual connected account) or `"auth"` (minimal sign-in scopes, transient grant). `options.resourceUrlPatterns` limits authorization to specific grantable resource types — **omitting it requests all, while `[]` requests none**; a vendor must not treat `[]` as "all" or it would silently over-request access the user was never shown a reason for.
- `getSupportedResources(options?)` — the resource types with URL patterns; an empty list hides the vendor entirely.
- `getTypeScriptTypes()` — a `.d.ts` string the Workshop parses into the agent's type database for progressive discovery.
- `createAccount?()` — present only when `autoProvisionsAccount` is declared. It **only creates** accounts (never looks one up) and takes no user identity, so it is safe on the public interface; callers gate on the declaration flag rather than probing, since RPC stubs cannot report optional-method presence.

## GatekeeperConnectCallback — the connect handshake

The vendor calls `complete(user, expiresAt?)` on success. `expiresAt` means *when credentials stop being refreshable* — not the expiry of a short-lived access token the gatekeeper can refresh transparently; it lets the UI proactively show the account as expired. `credentialsExpired()` (call once; repeats harmless) and `credentialsRestored(expiresAt?)` keep the UI in sync (packages/workshop-shared/src/gatekeeper.ts:525-556).

## GatekeeperUser — the privileged per-user adapter

This capability "represents permission to access all of the user's data available through it" and must be guarded: only the Workshop itself holds it (packages/workshop-shared/src/gatekeeper.ts:558-566). Its methods:

- `getGatekeeperClassFor(url)` — returns a Durable Object class implementing `Gatekeeper` for the matched resource, **imbued via `ctx.props` with the user's credentials and resource id**. The overseer calls this *before* the user has granted permissions; permissions are requested afterwards by instantiating the gatekeeper and calling `setPermissions()` (packages/workshop-shared/src/gatekeeper.ts:578-593).
- `startResourceConfigurator`, `revoke()` (account and all its gatekeepers break), `reconnect()` (nonce-protected re-auth preserving all bindings), `ensureResources(resourceUrlPatterns)` (expand the grant; nonce-protected URL or none).
- `getAuthenticatedEmail()` — for auth-capable vendors; the email **must be provider-verified** (e.g. Google `email_verified`, GitHub primary+verified, Cloudflare account email) because the Workshop keys accounts by email and an unverified address would allow account takeover (packages/workshop-shared/src/gatekeeper.ts:621-628).
- `getVerifier()` — mints the observer-verification capability.
- Optional singleton/management-UI methods (`getSingletonGatekeeperClass`, `startAppUi`) — present only on auto-provisioned accounts whose `describe()` declares them; the Workshop gates on the declaration flags (packages/workshop-shared/src/gatekeeper.ts:644-668).

`GatekeeperUserVerifier` is opaque: it is passed back **only to the gatekeeper that created it**, which may then call a public-but-non-standard method on it to unwrap verification results — there is no runtime way to extract a Fetcher's props yet (packages/workshop-shared/src/gatekeeper.ts:674-689).

## Gatekeeper<Session> — the resource facet

A gatekeeper instance runs as a **Durable Object Facet, a child of the overseer**, exposed to the overseer — not directly to gadgets (packages/workshop-shared/src/gatekeeper.ts:691-698). Its contract:

- `describe()` — info shown **before** the user grants access; `getTypeScriptTypes()` returns only the subset relevant to this resource.
- `getAutoApprovableActions()` — the *potential* set of action kinds the gatekeeper may auto-apply; the per-action `autoApprovable` verdict remains the binding gate at apply time (packages/workshop-shared/src/gatekeeper.ts:714-721).
- `startSession(approvalQueue)` — the session handed to the gadget. **Every operation must go through the approval queue: observations must be authorized before data returns; side-effecting actions must not execute until approved.** Gatekeepers are *suggested* to simulate unapproved actions so dependent work can queue, but simulation is the author's choice (packages/workshop-shared/src/gatekeeper.ts:723-738).
- `getAgentCatalog?` — optional bounded discovery index (e.g. for ambient singletons); catalog access is itself an observation that must be authorized (packages/workshop-shared/src/gatekeeper.ts:740-751).
- `addObserver(id, verifier)` — when a new user could see everything read through this gatekeeper, the gatekeeper must verify they may observe the past observations, throwing otherwise; repeat calls re-run verification (catching upstream revocation). For most gatekeepers checking general read access suffices; broad singletons may log and match actual observations (e.g. mailing-list membership). Future observations that must hide from someone carry `excludeObservers` in their `ObservationDescription` (packages/workshop-shared/src/gatekeeper.ts:753-785). `removeObserver` is idempotent.
- `applyAction` / `rejectAction` / `revertAction` — the overseer's callbacks for queued actions, each identified by the sequential action id. **There is no mode in which a gatekeeper may skip submitting actions for approval.** `rejectAction` may demand a gadget restart (simulation states can be hard to roll back); `revertAction` is optional but expected of high-quality gatekeepers, with `message`/`canRetry`/`restart` semantics (packages/workshop-shared/src/gatekeeper.ts:800-853).

## Observations vs actions

- `ObservationAuthorizer.authorizeObservation(description)` — the gatekeeper calls it on **every read** and must wait for the response before returning data; it may be called *after* fetching (as long as nothing was returned yet) so the description can describe the actual data (packages/workshop-shared/src/gatekeeper.ts:855-869).
- `ApprovalQueue extends ObservationAuthorizer` — `submitAction(actionId, description)` is **fully asynchronous**: it resolves quickly, and the action may be applied much later (hours or days). The action id travels back to `applyAction`/`rejectAction` (packages/workshop-shared/src/gatekeeper.ts:928-957).
- `ActionDescription` carries the display title/description, `implementsRevert`, the **`awaitDecision` hint** (set when effects are not simulated, so the agent harness suspends the turn rather than working against a world where the action "didn't happen"), and the per-action **`autoApprovable` author verdict** — absent means never auto-approvable even if a rule exists (packages/workshop-shared/src/gatekeeper.ts:1104-1160).
- `ActionKind` pairs a stable machine-readable `tag` with a display `label`; policy decisions key on the tag (auto-approval rules group on it today) (packages/workshop-shared/src/gatekeeper.ts:1112-1124).

## Auto-approval

The workshop-side drain (`packages/workshop-backend/src/auto-approval.ts`) applies eligible pending actions in id order with a per-gatekeeper **single-flight guard**. Eligibility requires **both** signals: the gatekeeper author's `autoApprovable: true` verdict on the action *and* a user-enabled rule for the action's `tag` on that gatekeeper — and the auto-approval is attributed to the user who enabled the rule, running under their authority. The drain **stops at the first manual gate or applying failure and never skips ahead**, preserving in-order application so nothing is silently applied past a human gate (packages/workshop-backend/src/auto-approval.ts:1-10, 60-110).

## Hooks

`ApprovalQueue.bindHook(controller, callback, description)` registers a persistent callback (packages/workshop-shared/src/gatekeeper.ts:959-1047):

- The gatekeeper must **not store the callback itself** — it must pass it to `bindHook`, because the callback is tied to the session backing the queue, which ends; later `HookInitiator.startHook()` opens a *new* session and returns a fresh callback plus a fresh `ApprovalQueue`.
- Hooks are created disabled; the overseer calls `HookController.enable(initiator, target)` only after user approval, so a gatekeeper should avoid storing state until enabled and should capture everything it needs in the controller's `props` (packages/workshop-shared/src/gatekeeper.ts:976-981, 1240-1266).
<!-- openwiki: broken internal link [params] file "params" does not exist. Fix the href or restore the target, then delete this comment. -->
- Persistent stubs are built via the `[restore](params)` + `ctx.restore(params)` pattern — the stub can be stored in DO storage and re-created deterministically (packages/workshop-shared/src/gatekeeper.ts:1001-1043).
- On delivery: `startHook()` first (returning callback + queue), then `authorizeObservation` (a hook invocation is almost always an observation), then invoke the callback (packages/workshop-shared/src/gatekeeper.ts:995-999, 1273-1282).

## Related pages

- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md)
- [Shipped Gatekeeper Connectors](/openwiki/gatekeepers/connectors.md)
- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md) — the loopbacks that route gatekeeper calls.
