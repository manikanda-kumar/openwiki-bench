---
type: "Reference"
title: "Gatekeepers: The Capability-Security Model"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---


# Gatekeepers: The Capability-Security Model

Gatekeepers are the external-service integration layer — the "device drivers" of Cloudflare OS
(`README.md`). Each is a separate Cloudflare Worker that bridges the Workshop (and via it, gadgets
and agents) to an external service, providing a clean Cap'n Web API that wraps the service's native
API, handling authorization (normally OAuth), enforcing narrow access to a specific resource,
logging every action, and giving the human the opportunity to approve or deny side-effecting
actions ("human in the loop").

The authoritative contract is `packages/workshop-shared/src/gatekeeper.ts`.

## The account model: the account is the capability

A gatekeeper exposes a hierarchy of RPC capabilities:

- **`GatekeeperVendor`** (`src/gatekeeper.ts:445`) — the root service binding. `describe()`,
  `connectAccount()`, `getSupportedResources()`, `getTypeScriptTypes()`, and for
  auto-provisioning vendors `createAccount()`.
- **`GatekeeperUser`** (`src/gatekeeper.ts:567`) — a connected account on the external service,
  "already specialized for a particular human user." The capability itself represents permission to
  access all of the user's data available through it, so **only the Workshop itself should ever
  have direct access** to an adapter object. It supports `getGatekeeperClassFor()` (mint a
  per-resource gatekeeper), `getVerifier()` (for observer checks), `revoke()`, `reconnect()`, and the
  resource configurator.
- **`Gatekeeper<Session>`** (`src/gatekeeper.ts:698`) — a per-resource binding on a specific
  Gadget, executed as a Durable Object Facet under the Overseer. Exposes `startSession()`,
  `startSession`/describe, `applyAction`/`rejectAction`/`revertAction`, and the observer methods.

The security postures follow from the layer separation:
- **A resource becomes "ambient" only by config.** Auto-provisioned singletons (the Context
  Library, the Scheduler) mint an account with no OAuth flow via `createAccount()`, and the account
  — not an asserted identity — is the authority thereafter. The Workshop folds the singleton's
  session into a chat's env as a **named chat binding** keyed by the gatekeeper's
  `suggestedBindingName` (`AGENTS.md`).
- **Capability-based, not identity-based.** The Workshop holds the `GatekeeperUser` (the account
  capability), and gadgets/agents get strictly narrower per-resource sessions.

## Resource granularity and grants

`SupportedResource` (`src/gatekeeper.ts:236`) describes a kind of resource a vendor can provide
("Jira Issue", "Gmail Mailbox"), with a `urlPattern` for matching. Some resource types are
`grantable` — independently authorizable at connect time via OAuth scopes.

`matchesResourceUrlPattern()` is deliberately tolerant of trivial URL variations (notably a
trailing slash) that strict `URLPattern` matching would reject, because agents and humans routinely
produce them (`src/gatekeeper.ts:266`). `resolveRequestedResource()` is the single source of truth
shared by backend and frontend for which resource an agent connection request would pre-select:
the matching non-catch-all pattern, else a whole-instance catch-all (`https://*`), else the sole
resource — and returns a human-readable `{ ok: false, reason }` rather than opening an
empty pre-selection when none applies (`src/gatekeeper.ts:301`).

`GatekeeperConnectOptions` distinguishes `scopes: "auth"` (minimal email-verification scopes, the
grant is **transient** and discarded after `getAuthenticatedEmail()`) from `"full"` (capability
scopes, persisted as a connected account). `resourceUrlPatterns: []` is meaningful and distinct
from omitting it (it requests no resource authorization at all).

## Approval queue and action simulation

The heart of the human-in-the-loop model is `ApprovalQueue` (`src/gatekeeper.ts:934`), which
extends the observation authorizer. Two asymmetries:

- **Observations** (`authorizeObservation`) are read-only; the gatekeeper must wait for
  authorization before returning data to the gadget, and fetches the data first so the description
  can include concrete details.
- **Actions** (`submitAction`) are asynchronous: the method returns immediately surrendering to the
  queue, and the action "may not actually be carried out until much later" — possibly hours or days
  later, and only when `applyAction(action)` is eventually called. This is what lets the agent keep
  going while the user approves in bulk later.

A gatekeeper is expected to **simulate** unapproved actions: the `Session` interface should reflect
the state of the resource as if all actions had been applied, letting the gadget queue more
dependent actions (`src/gatekeeper.ts:731`). This is optional but strongly suggested, and
`rejectAction` may signal `restart` when an accepted simulation can't be rolled back cleanly.
`getAutoApprovableActions()` lists the `ActionKind`s a gatekeeper may auto-apply without per-action
review, for pre-approval UIs (`src/gatekeeper.ts:721`).

Persistent **hooks** are registered through `bindHook()`: the gatekeeper hands a `HookController`
plus a *persistent* callback stub (created via `ctx.restore()`), which is bound to a particular
gatekeeper session; when an event fires, `HookInitiator.startHook()` initiates a fresh session and
the ingress is authorized as an observation before the callback is invoked
(`src/gatekeeper.ts:961`).

## Observer verification: the anti-data-leak contract

The observer mechanism enforces that sharing a gadget never grants access to sensitive data the
recipient couldn't read directly (see [Sharing and Observers](/openwiki/concepts/sharing-and-observers.md)):

- `GatekeeperUser.getVerifier()` mints an opaque `GatekeeperUserVerifier` (`src/gatekeeper.ts:675`)
  representing the observer's *own* connected account.
- `Gatekeeper.addObserver(id, verifier)` **must throw if the user is not allowed to observe
  everything read through this gatekeeper so far**; otherwise the gatekeeper remembers the observer
  and future observations set `excludeObservers` to name who must not see them
  (`src/gatekeeper.ts:753`).
- `removeObserver()` must be idempotent (`src/gatekeeper.ts:787`).

Because there is no runtime way to unwrap a `Fetcher` back to its implementer, the verifier pattern
is: the `GatekeeperUserVerifier` implements a public-but-non-standard method the same gatekeeper's
`addObserver()` implementation calls and trusts — valid because the overseer promises to return a
verifier only to the gatekeeper that minted it (`src/gatekeeper.ts:682`).

Resource-specific strategy (private-only / ACL check / data-set tracking / low-stakes) is recorded
per resource type in `docs/observers.md` §9.

## Auto-provisioning and the three-state mode

`GatekeeperVendor.createAccount()` mints a new connected account with no OAuth flow
(`src/gatekeeper.ts:514`). It is safe on the public interface only because it *creates* accounts
and takes no arguments (no user identity). Such vendors declare `VendorDescription.autoProvisionsAccount`.

The **account** (a `GatekeeperUser`) may declare in its `AccountDescription` an agent **singleton**
(`singleton: { tsType }`) and/or a **management UI** (`providesUi`) (`src/gatekeeper.ts:147`).
These are orthogonal — an account can provide either, both, or neither.

Per-vendor provisioning is a deployment admin three-state mode (off by default → **optional**, or
forced **enabled**), resolved in `packages/workshop-backend/src/provisioning-policy.ts`:
- `disabled` — not offered; any existing account is dormant;
- `optional` — users opt in from the Connectors page (the default);
- `enabled` — auto-provisioned for every user, forced, hidden from the Connectors list.

`shouldAutoProvisionAccount()` is the single chokepoint `UserDurableObject` calls. The Workshop
persists the minted account in the user's DO like any connected account, and the account capability
— not an asserted identity — is the authority thereafter.

The singleton is provided to the owner's workspaces as an **ambient gatekeeper record**, folded
into each chat's env as a **named chat binding** (named by the gatekeeper's `suggestedBindingName`,
see `prepareChatBindings` in `overseer.ts`), which the agent reads in `executeCode` (`getSession` /
`getAgentCatalog`), each read recorded as an observation. It is not bound to any gadget by default;
the agent may wire it into a gadget's binding list via `setGadgetBinding` (`AGENTS.md`).

## Management UIs and self-contained UI frames

A management UI is a `GatekeeperUiFrame`: complete self-contained HTML plus the gatekeeper's `ui`
capability, hosted by the Workshop in a `sandbox="allow-scripts"` iframe over a MessagePort RPC
session (`src/gatekeeper.ts:407`). `startAppUi(context)` returns one; `context.isAdmin` is passed
fresh per open so admin-gated features reflect current status (`src/gatekeeper.ts:664`). The same
frame type backs the small resource-configurator form (`startResourceConfigurator`,
`ResourceConfiguratorFrame` legacy alias).

## Agent catalog (bounded discovery metadata)

`getAgentCatalog()` (`src/gatekeeper.ts:741`) returns bounded discovery metadata (`AgentCatalogEntry`
/ `AgentCatalog` in `src/gatekeeper.ts:94`) the agent uses to see *what* is reachable through a
session without paging the full API. Catalog access is an observation — the implementation must
authorize it. Because the catalog is injected into the agent as untrusted data, `boundAgentCatalog`
(`src/gatekeeper.ts:136`) enforces hard caps (1000 entries; id ≤ 256, title ≤ 100, description ≤ 400
chars) and sets `truncated`; the Workshop re-clamps what it receives regardless.

## MCP trust tiers

The MCP connectors (see [MCP Gatekeepers and Trust Tiers](/openwiki/integrations/mcp.md)) extend
this model with a distinction between `byo` (a user pasted a URL — server `readOnlyHint` may
classify reads as observations, but nothing the server says can auto-apply a write) and `vetted`
(endpoint annotations are trusted enough that `destructiveHint: false` + `idempotentHint: true` may
drive auto-approval). A Gadget bound to MCP is owner-only (cannot be shared).

## Observer strategy by resource

`docs/observers.md` §9 fixes how each existing gatekeeper implements `addObserver`/`removeObserver`/
`getVerifier`, per resource type: strategy **A** (private-only, always throw), **B** (ACL check
against the whole resource unit), **C** (track observed data sets and re-verify observers against
each), **D** (low-stakes no-op), or **N** (no resources). The "broad binding" lens in
`docs/observers.md` §9.3 explains when a broad binding uses C (distinct sub-resource ACLs **and** a
per-observer check oracle) vs. B or A.
