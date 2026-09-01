---
type: "Reference"
title: "Gatekeeper framework"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---


# Gatekeeper framework

A **gatekeeper** is a Cloudflare Worker that mediates every interaction between a Gadget (or the
agent) and an external service. It provides a clean capability-based API, handles authorization
(OAuth), enforces narrow access, and funnels every action through human-in-the-loop approval and
audit logging. The canonical interface definitions live in
`packages/workshop-shared/src/gatekeeper.ts`; the canonical build guide is the `write-gatekeeper`
skill (`.agents/skills/write-gatekeeper/SKILL.md`), which describes the implementation phases and the
packages that serve as reference implementations.

## The three-tier hierarchy

Each gatekeeper implements three tiers:

- **Vendor** (`GatekeeperVendor`, a `WorkerEntrypoint`) — the top-level entrypoint bound as
  `GATEKEEPER_<NAME>` on the workshop backend. One per service. `describe()`, `connectAccount()`,
  `getSupportedResources()`, `getTypeScriptTypes()`, and optionally `createAccount()` for
  auto-provisioned vendors.
- **User** (`GatekeeperUser`, a `WorkerEntrypoint` with `ctx.props`) — a human user's authenticated
  connection. Carries the user's credentials/identity and can mint per-resource gatekeeper classes
  (`getGatekeeperClassFor`), start resource configurators, revoke/reconnect, and mint observer
  verifiers. Capabilities are passed via `ctx.props` (not constructors) so stubs can be stored and
  restored.
- **Instance** (`Gatekeeper<Session>`, a **DO facet** of the Overseer) — one per resource, per
  Gadget binding. `describe()`, `startSession(approvalQueue)` returns the Session capability, and the
  approval callbacks `applyAction` / `rejectAction` / `revertAction` run here.

The Workshop discovers vendors by scanning `GATEKEEPER_*` service bindings; each install is purely a
binding change.

## Connecting an account and the capability chokepoint

Connecting starts when the Workshop calls `GatekeeperVendor.connectAccount(callback, options)`,
which returns an OAuth URL. The gatekeeper implements the flow in a `UserAccount` Durable Object
(store the callback + a nonce, redirect the user, exchange the code) and calls `callback.complete()`
with a `GatekeeperUser` fetcher; the Workshop persists it as a `ConnectedAccountRecord` in the user's
`UserDurableObject`. Credential health is reported back through `credentialsExpired()` /
`credentialsRestored()`, and `reconnect()` refreshes the grant.

The core chokepoint where a resource URL becomes a capability is `GatekeeperUser.getGatekeeperClassFor(url)`
— the overseer calls it (through the user's own account) when a binding is created, and the backend's
`getGatekeeperClassFor` in `user.ts` enforces the deployment's admin-disabled gatekeepers/resources
here, *before* minting the capability. The returned `DurableObjectClass` is imbued (via `ctx.props`)
with the user's credentials and the resource id and instantiated as a facet under the Overseer.

## The ApprovalQueue contract

Every session is handed an `ApprovalQueue` when started. The contract (`gatekeeper.ts`):

- **Observations** — read-only operations must call `authorizeObservation(description)` and await it
  *before returning any data to the caller* (fetching first is fine, so the description can name what
  was actually read). The overseer records these as approved `observation` action records and
  enforces sharing policy on them (`overseer.ts:4445`): a `prohibitAllSharing` observation on a
  shared workspace is blocked and latches the workspace into lockdown, and `excludeObservers`
  blocks the observation if any still-authorized named observer could see it.
- **Actions** — any side-effecting operation must call `submitAction(actionId, description)` and
  must **not actually perform** the action until the overseer calls `applyAction(actionId)`. The
  action is recorded `pending`; a human (or an auto-approval rule) later approves or rejects it, and
  the gatekeeper's own `applyAction`/`rejectAction`/`revertAction` do the work. `rejectAction` may
  return `{restart}` when the session can't roll back cleanly, and `revertAction` returns
  `{message, canRetry, restart}` for the user-facing undo flow.

The overseer's `submitAction` (`overseer.ts:4665`) refuses actions once the workspace has latched
`prohibitAllSharing`, associates the action with the calling chat (so it appears in the action log
and audit trail), and folds `awaitDecision`/auto-approval handling in. Observations and actions are
both stored in the overseer's `actions` collection (with `pendingByGatekeeper` index) and feed the
UI's approval queue, action log, and auto-approval panels.

### Simulation and auto-approval

The design intent (README and the skill) is that a gatekeeper **simulates** not-yet-approved actions:
reads reflect the pending state, so the agent keeps working and the user batch-approves later.
Gatekeepers that can't simulate set `ActionDescription.awaitDecision`, which suspends the agent turn
until the user decides. Auto-approval is a per-user opt-in keyed on the action's `actionKind.tag`:
`submitAction` checks the author's `autoApprovable` verdict against a stored `autoApproveTags` rule
and, if both hold, schedules the `AutoApprovalDrainer` to apply eligible pending actions in order
(see the agent-and-chat page).

## Hooks: push notifications

Services that push events (inbound email, webhooks) expose a **hook**:

1. **Register** — a Session method receives a *persistent* callback stub (created by the Gadget with
   `ctx.restore()`); the gatekeeper builds a `HookController` (a `WorkerEntrypoint` carrying all state
   in its props) and calls `approvalQueue.bindHook(controller, callback, description)`. The overseer
   stores the callback and records the hook **disabled** (`overseer.ts:4711`). The gatekeeper never
   stores the callback itself — it is bound to the session and would be revoked when the session ends.
2. **Enable** — when the user approves, the overseer calls `controller.enable(initiator, target)`;
   the gatekeeper persists the `HookInitiator` and starts delivering.
3. **Deliver** — when an event arrives, the gatekeeper calls `initiator.startHook()`, which returns
   the callback re-bound to a fresh session plus a fresh `ApprovalQueue`; it authorizes the
   observation (or registers actions), then invokes the callback.
4. **Disable** — the overseer calls `controller.disable()`, which permanently cleans up.

`gatekeeper-email` is the canonical hook implementation.

## Observer verification (sharing)

When a gadget is shared, each collaborator becomes an **observer** of every in-scope gatekeeper
binding. The overseer mints a `GatekeeperUserVerifier` from the *collaborator's own* connected account
(`UserDurableObject.getVerifier` validates the vendor matches) and calls `addObserver(observerId,
verifier)` — the gatekeeper must throw if that user could not directly observe everything read
through the binding so far, and is re-verified on every open. Forward restrictions use
`ObservationDescription.excludeObservers`. Each gatekeeper picks a per-resource strategy (see the
sharing-and-observers page): A (private-only), B (single-unit ACL), C (data-set tracking), D
(low-stakes no-ops). The verifier pattern relies on the overseer's guarantee that a verifier is only
ever passed back to the vendor that minted it.

## Agent-facing surfaces

- **Types**: `getTypeScriptTypes()` returns a `.d.ts` the Workshop compiles into a type database the
  agent uses for progressive discovery. Session types are written for the agent, with JSDoc that
  never leaks the approval queue or gatekeeper internals.
- **Slash commands**: a gatekeeper can offer `getSlashCommandProvider()`; invoked commands run
  through an `ObservationAuthorizer` for authorization and audit only.
- **Agent catalog**: `getAgentCatalog()` returns bounded discovery metadata (collections/skills) the
  agent reads to find what a session can reach; access is authorized as an observation.
- **Resource configurators**: `startResourceConfigurator()` returns a self-contained iframe + `ui`
  capability for choosing a specific resource; the Workshop hosts it in a sandboxed iframe.

## Reference implementations

The skill's reference list: `gatekeeper-google` (OAuth, multiple resource types, caching/simulation,
all observer strategies), `gatekeeper-email` (hooks, no actions, strategy D), `gatekeeper-github`
(clean strategy B), `gatekeeper-supabase` (strategy C with per-session context), `gatekeeper-linear`
and `gatekeeper-notion` (strategy C threading an observe hook through sub-sessions). The three
auto-provisioned singletons (context, scheduler, cloudflare billing/observability) are covered on
their own pages.
