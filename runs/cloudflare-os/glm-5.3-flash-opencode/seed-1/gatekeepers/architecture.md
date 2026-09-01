---
type: "Reference"
title: "Gatekeeper Architecture: Vendors, Accounts, Sessions"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Gatekeeper Architecture: Vendors, Accounts, Sessions

Gatekeepers are the "device drivers" of the system: a piece of software specific to each external service that moderates a gadget's connection to it — providing a clean Cap'n Web-style RPC API over the vendor's native API, handling OAuth, narrowing access to the specific resource the user intended, logging every action, and queuing side-effecting actions for human approval (README.md:66-79).

## The three-tier contract (`packages/workshop-shared/src/gatekeeper.ts`)

1. **`GatekeeperVendor`** — the service-binding root entrypoint (gatekeeper.ts:445-525): `describe()` (display info, `providesAuth`, `autoProvisionsAccount`), `connectAccount(callback, options)` (returns the OAuth pop-up URL; the *nonce-requiring* URL is a stated security requirement), `getSupportedResources(options?)` (resource *types* with `urlPattern`s; an empty list hides the vendor from the user), `getTypeScriptTypes()` (a `.d.ts` parsed for the agent's progressive discovery), and optional `createAccount()` for auto-provisioning vendors. `connectAccount`'s `scopes` option selects "full" capability scopes vs. "auth"-only minimal sign-in scopes; `resourceUrlPatterns` must distinguish omitted ("all resource types") from `[]` ("none") — "a vendor must treat `[]` as 'none' rather than falling back to 'all'" (gatekeeper.ts:480-492).
2. **`GatekeeperUser`** — the per-user account entrypoint, minted by a completed connect flow (gatekeeper.ts:567-688): `describe()` (`AccountDescription`, including `singleton`/`providesUi` flags), `getSupportedResources()`, **`getGatekeeperClassFor(url)`** — returns a Durable Object class imbued via `ctx.props` with the user's credentials and the matched resource; the Workshop calls it *before* the user grants permissions, and permissions are requested later via the instantiated gatekeeper — `startResourceConfigurator`, `revoke()`, `reconnect()` (URL must carry a nonce), `getAuthenticatedEmail()` (must be provider-verified, since accounts are keyed by email — an unverified address would allow account takeover), `getVerifier()`, and `ensureResources(resourceUrlPatterns)`. The singleton/UI methods (`getSingletonGatekeeperClass`, `startAppUi`) exist only on auto-provisioned accounts that declare the flags; callers gate on the declaration flags because RPC stubs cannot report optional-method presence (gatekeeper.ts:608-615).
3. **`Gatekeeper<Session>`** — the per-binding Durable Object (gatekeeper.ts:698-855), exposed to the Overseer (not directly to gadgets): `describe()` (resource display info + `suggestedBindingName` + `tsType` + optional `hookTsType`/`hasSlashCommands`), `startSession(approvalQueue)` (the capability handed to the gadget; observations must be authorized and actions submitted before application, with *simulation* of pending actions suggested so gadgets keep working), `getAgentCatalog?()` (bounded discovery metadata, authorized as an observation, clamped via `boundAgentCatalog`), `addObserver`/`removeObserver` (the observer-verification contract; `removeObserver` must be idempotent; re-runs verify revocation), `getSlashCommandProvider?()`, and the action callbacks `applyAction(action)` / `rejectAction(action)` (which may request a gadget restart) / `revertAction(action)`.

## Lifecycle: connect → account → class → facet → session

1. **Connect.** The UI's `connectAccount(vendorId)` on `AuthenticatedApi` goes to the User DO, which calls the vendor's `connectAccount` with a `GatekeeperConnectCallbackImpl` entrypoint (src/user.ts:1734+). The completed flow calls `callback.complete(user, expiresAt?)`, persisting the account as a `ConnectedAccountRecord` in the user's `connectedAccounts` collection; `credentialsExpired()`/`credentialsRestored()` notify subscribers so the UI reflects expiry (gatekeeper.ts:525-565).
2. **Class resolution.** `UserDurableObject.getGatekeeperClassFor(accountId, url)` is the *single core chokepoint*: it resolves the class through the account, then reads `AdminConfig` and throws if the vendor is disabled (`disabledGatekeepers`) or the matched resource is disabled (`isResourceDisabled`) — "Block whole gatekeepers + disabled resources at this single core-side chokepoint where a resourceUrl becomes a capability (reached only via the user/UI-facing Overseer.newGatekeeper and blueprint instantiation — never from gadget or agent code)" (src/user.ts, `getGatekeeperClassFor`).
3. **Facet.** The Overseer stores a `GatekeeperRecord` (id from the shared workpiece counter, denormalized title/url, `class`, `creationSpec` recording how it was created) and instantiates the class as a facet named `gatekeeper${id}` via `ctx.facets.get` (src/overseer.ts:272-292, 4255-4265).
4. **Session.** The gadget or agent reaches the resource only through a session created by `startSession(approvalQueue)`. Binding into a gadget's `env` is a separate, explicit step (`GadgetClient.bind`), and a workspace-level gatekeeper is not bound to any gadget by default (api.ts:1745-1755).

## Ambient (auto-provisioned) gatekeepers

Vendors declaring `autoProvisionsAccount` mint accounts with no OAuth flow via `createAccount()` (gatekeeper.ts:508-521). The deployment admin picks a per-vendor mode — **disabled** (dormant), **optional** (user opt-in from Connectors, the default), **enabled** (forced for every user, hidden from Connectors) — resolved by `provisioning-policy.ts`, "the single chokepoint for that decision" (src/provisioning-policy.ts:1-17). On workspace open, `ensureAmbientCapsules()` provisions the owner's singleton accounts as workspace-level gatekeeper records with `creationSpec.type: "ambient"`, installing each singleton's class as a facet exactly like any other gatekeeper; the account capability stays encapsulated in the DO, and stale records (account disconnected/replaced) are removed. It is idempotent, best-effort per account, and runs on `open()` before any agent turn (src/overseer.ts:6183-6265).

The singleton's session reaches the agent as a **named chat binding**: `prepareChatBindings` freezes each chat's seed binding layer — the default binding list (non-pending gadgets by `bindingName`, then permanent binding edges, gadgets taking precedence) plus ambient records named by each gatekeeper's `suggestedBindingName` — into the chat context (`context.bindings`), with names stamped onto persisted messages at this chokepoint (src/overseer.ts:6264-6470). The agent reads it in `executeCode` (`env.<NAME>`), search/list/read run as observations, and it may wire it into a gadget with `setGadgetBinding` only when the gadget's persistent code needs it (src/overseer.ts:6175-6182).

## Loopback entrypoints (overseer-provided channels)

The overseer exports WorkerEntrypoint loopbacks that sandboxed code reaches through its env, all addressed by `overseerId` props and resolved via `ctx.exports.OverseerDurableObject` (src/overseer.ts:8766-9053):

- **`GatekeeperLoopback`** — wraps `overseer.startGatekeeperSession(target, caller)` in a Proxy: a gadget worker's `env` binding to a gatekeeper resolves through this rather than holding a direct capability.
- **`GatekeeperHookLoopback`** — the `HookInitiator` handed to a gatekeeper when a hook is connected; `startHook()` asks the overseer for the hook's callback stub plus a fresh `ApprovalQueue` for that invocation.
- **`AgentSelfLoopback`** — the `self` magic object of `executeCode`: calling any method delivers an agent callback to the chat and re-activates the agent.
- **`TransientStubLoopback`** — proxies to a transient stub from a stored agent callback's arguments; calls throw once the `deliverAgentCallback` RPC has ended.
- **`GadgetTailLoopback`** — the streaming log tail attached to gadget workers, delivering console logs to the UI in real time.
- **`CodeModeTailLoopback`** — the equivalent tail for code-mode executions.

Each class declares a dummy method solely so the validator registers the class and the loopback binding is created (src/overseer.ts:8790-8792 and analogous).

## Hooks and slash commands

- **Hooks**: a gadget registers a persistent callback stub (created via `ctx.restore(params)`, see [The Gadget Sandbox](/openwiki/workshop/gadget-sandbox.md)) with the gatekeeper's `ApprovalQueue.bindHook(controller, callback, description)`; the callback must be re-bound per session, so the gatekeeper stores it via `bindHook` rather than on its own (gatekeeper.ts:968-1030). The overseer gates delivery on user approval (`controller.enable()`), and each later event delivery goes through `GatekeeperHookLoopback.startHook()` → a fresh `ApprovalQueue` whose `authorizeObservation` runs before the event reaches the gadget.
- **Slash commands**: a gatekeeper may expose `SlashCommandProvider` (`list()` of picker metadata; `invoke(id, args, authorizer)` which must authorize protected reads via the `ObservationAuthorizer`). The frontend surfaces them as `/commands`; the overseer collects and invokes them (src/slash-commands.ts; gatekeeper.ts:875-931).

## Verification and observers

`GatekeeperUser.getVerifier()` mints an opaque `GatekeeperUserVerifier`; the overseer passes it to `Gatekeeper.addObserver(observerId, verifier)` on every open of a non-owner, and the gatekeeper is the authority on its own resource's ACL. Because there is no runtime way to unwrap a `Fetcher` back to its props, the gatekeeper implements a *public but non-standard method on its verifier* that its own `addObserver` may call — safe because the overseer promises to pass a verifier only back to the gatekeeper that created it (gatekeeper.ts:689-697). See [Observers: Read-Through Sharing Permissions](/openwiki/sharing/observers.md) for the workshop-side machinery.

## Approval queue

`ApprovalQueue extends ObservationAuthorizer` (gatekeeper.ts:934+): `authorizeObservation(description)` must be awaited *before returning any data to the gadget* (calling it after fetching, for strictly read-only operations, is acceptable), and `submitAction(action, description)` returns immediately while the action may sit pending for hours — the gatekeeper applies it only when `applyAction()` is called, and may simulate the action meanwhile (see [Actions, Approval Queue, and Auto-Approval](/openwiki/workshop/actions-approvals.md)).
