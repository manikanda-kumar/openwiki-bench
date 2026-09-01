---
type: subsystem
title: Gatekeeper Framework
description: The protocol every gatekeeper connector implements — vendor/account/session objects, the nonce-guarded OAuth connect flow, the approval queue with action simulation, observation authorization, hooks over persistent stubs, resource URL patterns, provisioning modes, and configurator UIs.
tags: [gatekeeper, protocol, capabilities, oauth, approval-queue]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-b5299fd53e769aa10dc532e0
    resource: repo://packages/configurator-ui/src/index.ts
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Gatekeeper Framework

A gatekeeper ("device driver") is a standalone Worker mediating access to one external service. The Workshop discovers connectors purely by its own `GATEKEEPER_<NAME>` service bindings — the vendor id is the suffix, lowercased — so installing one is a binding change (packages/router/src/index.ts#L26-L36; packages/workshop-backend/src/auth/auth-vendors.ts#L1-L14). The protocol below is defined in `packages/workshop-shared/src/gatekeeper.ts`; the per-vendor implementations are on the connector pages.

## The four RPC objects

- **`GatekeeperVendor`** (WorkerEntrypoint, one per deployment): `describe()` (display metadata plus `providesAuth` / `autoProvisionsAccount` flags at gatekeeper.ts#L70-L78), `connectAccount(callback, options)`, `getSupportedResources({userId})` (an empty list hides the vendor entirely; the userId parameter is a documented temporary hack for RBAC-gated hidden gatekeepers), and `getTypeScriptTypes()` — one `.d.ts` string parsed into a type database for the agent's progressive discovery (gatekeeper.ts#L445-L523).
- **`GatekeeperUser`** (a connected account; WorkerEntrypoint): its own `describe`/`getSupportedResources`, `getGatekeeperClassFor(url)` returning a `DurableObjectClass` imbued via `ctx.props` with credentials + resource id, `startResourceConfigurator`, `revoke`, `reconnect`, `getAuthenticatedEmail` (verified-email-only, or account takeover), `getVerifier()`, and `ensureResources(patterns)` (gatekeeper.ts#L567-L688). Singleton-shaped accounts additionally implement `getSingletonGatekeeperClass()` / `startAppUi(context)` — the Workshop gates on the declaration flags, never by probing the stub, because RPC stubs can't report optional-method presence (gatekeeper.ts#L654-L683, #L513-L523).
- **`Gatekeeper<Session>`** (Durable Object *facet* under the workspace's Overseer): `describe`, `getTypeScriptTypes` (narrowed to this resource), `getAutoApprovableActions`, `startSession(approvalQueue)`, optional `getAgentCatalog`, `addObserver`/`removeObserver`, and the apply/reject/revert callbacks (gatekeeper.ts#L698-L853).
- **`GatekeeperConnectCallback`** (WorkerEntrypoint implemented by the backend): `complete(user, expiresAt?)`, `credentialsExpired()`, `credentialsRestored(expiresAt?)` — the expiry contract distinguishes "refreshable-with-notice" from the internal token-cache expiry the Workshop should never see (gatekeeper.ts#L525-L565).

## Connecting: OAuth with replay defense

`connectAccount` returns a URL the browser opens as a self-closing popup; the canonical shape is a `UserAccount` DO holding the callback in storage with an **alarm to self-delete on abandonment**, and the returned URL *must* carry a cryptographic nonce besides the DO id to prevent replay (gatekeeper.ts#L460-L475; gatekeeper-google is the named reference implementation). Options select access tiers: `scopes: "auth"` (transient, sign-in only) vs `"full"`, and `resourceUrlPatterns` limits the OAuth grant to the resource types actually selected — where **an empty array means "no resource authorization" and is deliberately distinct from omission**, because falling back to "all" would request access the user was never shown a reason for (gatekeeper.ts#L429-L443, #L476-L483). The backend instantiates the callback as a facet with `{userId, vendorId, ...}` props (`GatekeeperConnectCallbackImpl`) and stores the returned account capability in the user DO (packages/workshop-backend/src/user.ts#L1160, #L1734).

`GatekeeperUser.getGatekeeperClassFor()` is reached through one core chokepoint in the User DO, which applies the admin's disabled-vendor/resource policy **before** the class capability is minted — gadget and agent code cannot bypass it (packages/workshop-backend/src/user.ts#L1666-L1690).

## Sessions: the approval queue and simulation

`startSession(approvalQueue)` is the contract: *every* operation the session performs goes through the queue. Reads are **observations** — `authorizeObservation(description)` must be awaited before data returns, and may be called *after* fetching (read-only, still unreturned) so the audit description reflects actual data (gatekeeper.ts#L698-L737, #L855-L870). Writes are **actions** — `submitAction(id, description)` resolves immediately but application waits for human review, potentially hours or days; the session should then *simulate* the outcome locally so the gadget/agent keeps working and can queue dependent actions, with reads returning simulated results (gatekeeper.ts#L722-L737, #L934-L960). Even when policy auto-applies, **the gatekeeper must submit every action — there is no mode where skipping the check is OK** (gatekeeper.ts#L810-L818). The overseer calls back: `applyAction(id)` (throw → user sees failure, can retry/discard), `rejectAction(id)` (may return `{restart: true}` when simulation makes rollback confusing), and optional `revertAction(id)` (message/canRetry/restart semantics; "high-quality gatekeepers should almost always implement this") (gatekeeper.ts#L799-L851). `getAutoApprovableActions()` lets pre-approval UIs list action kinds *before* any action exists, while the per-action `autoApprovable` verdict remains the binding gate at apply time (gatekeeper.ts#L711-L719).

## Hooks: persistent stubs in both directions

A gatekeeper exposing events takes `onSomeEvent(callback)` where `callback` must be a **persistent stub** (built with `ctx.restore({params})` against the gadget's `[restore]` method) — then it calls `ApprovalQueue.bindHook(callback, controller)` (gatekeeper.ts#L953-L1044). Rules the connector author must get right: the gatekeeper must *not* store the callback itself (it is tied to the current session and revoked when the session ends); the `HookController` should capture everything it needs in `ctx.props` so nothing is stored before approval; delivery always starts by calling `HookInitiator.startHook()` — never a stored stub — which returns a fresh callback plus an ApprovalQueue for the delivery's observation, and *may* even yield actions (gatekeeper.ts#L963-L1013, #L1244-L1283). The callback's other half is `GatekeeperHookLoopback`: the overseer hands gatekeepers a Fetcher to this entrypoint, and `startHook()` resolves through to `OverseerDurableObject.startHook(hookId)` (packages/workshop-backend/src/overseer.ts#L8803-L8828). Bound hooks, enablement, and storage live in the Overseer (`boundHooks` collection) — see [The Overseer Workspace Object](../backend/overseer-workspace.md).

Session stubs themselves reach gadgets through a sibling hack, `GatekeeperLoopback`: dynamic-isolate `env` can carry ServiceStubs but not RpcStubs, so each binding is a ServiceStub at this entrypoint, whose constructor resolves the target session per call through the overseer (overseer.ts#L8757-L8800).

## Resources, catalogs, and UIs

A vendor advertises `SupportedResource`s as `URLPattern` strings; matching is deliberately tolerant of trailing slashes, and `resolveRequestedResource()` encodes the one precedence the accept-modal uses (matching pattern → whole-instance catch-all `https://*` → sole resource), returning an instructive `{ok:false, reason}` so the *agent* can fix a bad request — shared by backend and frontend so they can't diverge (gatekeeper.ts#L259-L345). Gatekeepers whose sessions benefit from discovery implement `getAgentCatalog(authorizer)` — itself an observation — and must pre-clamp through `boundAgentCatalog()` against the Workshop's hard caps (1000 entries ≈ 775 KiB of system prompt, field caps, tail-drop keeping caller order), because catalog data is untrusted prompt material (gatekeeper.ts#L94-L145).

Self-contained UIs share one shape — `GatekeeperUiFrame = { iframeHtml, ui capability }` — used for both connect-time resource pickers (`startResourceConfigurator`) and full-page management apps (`startAppUi` at `/gatekeepers/$appId`), hosted by the Workshop in opaque-origin iframes (gatekeeper.ts#L407-L427; [Workshop Frontend](../frontend/workshop-ui.md)). Configurator UIs are built from per-file TSX transpiled standalone at package build time — only `@gadgets/configurator-ui` (a *type-only* component helpers package) and type imports are stripped, so configurators cannot import runtime code and must duplicate local helpers like URL builders (scripts/build-gatekeeper-configurator.ts#L1-L22; packages/configurator-ui/src/index.ts#L1-L30; concrete example in [Cloudflare Gatekeeper](cloudflare-connector.md)).

## Provisioning: ambience is granted, never asserted

For `autoProvisionsAccount` vendors, the deployment admin picks a per-vendor mode — **disabled / optional / enabled**, defaulting to *optional* — resolved only through `provisioning-policy.ts`, the "single chokepoint" the User DO consults when provisioning, listing, and surfacing ambient accounts. `enabled` forces the account for every user (hidden from Connectors, non-removable); `optional` is per-user opt-in; `disabled` parks existing accounts. The policy comment states the principle plainly: *"we don't impose ambient authority on every user unless an admin explicitly turns it on"* (packages/workshop-backend/src/provisioning-policy.ts#L1-L32). A gatekeeper never declares itself ambient; the account capability minted through this path is the authority thereafter, and the overseer only folds provisioned accounts into chats as capsules of `creationSpec.type === "ambient"` (packages/workshop-backend/src/overseer.ts#L6402-L6408).

## Observers and sharing interplay

`addObserver`/`removeObserver` make the gatekeeper enforce read-through sharing (verification + exclusion of future observations) — the workshop-side orchestration is in [Sharing and Observers](../backend/sharing-and-observers.md) (gatekeeper.ts#L752-L795).
