---
type: "Reference"
title: "Gatekeepers & the Approval Model"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-de0bdb58fc5a2c05d44c93fe
    resource: repo://packages/gatekeeper-mcp/README.md
  - id: openwiki-source-5833ea4042b8e334d3b18f03
    resource: repo://packages/mcp-shared/README.md
  - id: openwiki-source-1cd7f2c2d4fc486cd3495da5
    resource: repo://packages/mcp-shared/src/sharing-policy.ts
  - id: openwiki-source-899744ea4a395ee6ff25ba0b
    resource: repo://packages/mcp-shared/src/tools.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---


# Gatekeepers & the Approval Model

A **gatekeeper** is a Cloudflare Worker that mediates every access between a Gadget and an external
service. It is what the README calls a "driver." It provides a clean Cap'n Web API to the service,
handles authorization (typically OAuth), enforces narrowly-scoped access to the resource the user
intended, logs every action for review, and gives the human an opportunity to approve or deny
side-effecting actions.

The canonical interfaces and detailed documentation live in
`packages/workshop-shared/src/gatekeeper.ts`; the practical authoring guide is the in-repo
`write-gatekeeper` skill (`packages/…/.agents/skills/write-gatekeeper/SKILL.md`), whose
canonical reference file is `gatekeeper.ts`.

## The three-tier hierarchy

Each gatekeeper implements a fixed three-tier structure:

1. **Vendor** — `GatekeeperVendor`, a `WorkerEntrypoint`, one per service. Entry for the whole
   external service. Bound to the backend as `GATEKEEPER_<NAME>`; the backend auto-discovers vendors
   by scanning its `GATEKEEPER_*` env keys, so installing a gatekeeper is purely a binding change.
2. **User** — `GatekeeperUser`, a `WorkerEntrypoint` carrying credentials/resource id via `ctx.props`.
   A single human user's authenticated connection ("connected account").
3. **Instance** — `Gatekeeper<Session>`, a Durable Object Facet of the Overseer. Per-resource,
   per-Gadget binding that exposes the `Session` API to the Gadget.

The auth model, API design, fine-grained resource granting, action logging/approvals, caching,
simulation, and observer verification are the seven responsibilities a gatekeeper holds (described in
the `write-gatekeeper` skill).

## The connect flow

To connect a user to a service, the backend calls `GatekeeperVendor.connectAccount(callback, options)`,
which returns a URL the user opens in a new tab (an OAuth popup that self-closes). The flow must
return a URL containing a **cryptographic nonce** (in addition to the DO id) to prevent replay
attacks — `gatekeeper-google` is the reference implementation. When it completes, the gatekeeper calls
`callback.complete(user, expiresAt?)`, and the Workshop persists the connected account.

The user gatekeeper (`GatekeeperUser`) supports lifecycle operations: `revoke()` to disconnect,
`reconnect()` to refresh credentials (returning a nonce-bearing URL, notifying
`callback.credentialsRestored()`), and `ensureResources(resourceUrlPatterns[])` to expand a
grantable-resource grant (returning a nonce-bearing URL when more authorization is needed). The
gatekeeper notifies the Workshop of credential expiry via `callback.credentialsExpired()`.

`connectAccount` options support `scopes: "auth"` (minimal, transient — for sign-in email
verification) vs `"full"` (the connected account's capability scopes), and an
`resourceUrlPatterns` list that limits which grantable resource types are requested. An empty array is
meaningful and distinct from omitting it: `[]` requests no resource authorization.

## The approval and observation model

Every operation a Gadget (or agent) performs through a session must go through the `ApprovalQueue`,
which is implemented by the overseer and bound into the session via
`Gatekeeper.startSession(approvalQueue)`:

- **Observations** (strictly read-only) call `authorizeObservation(description)`, which must be
  **awaited before any data is returned** to the caller. It may be called *after* fetching data (so
  the description can include what was actually fetched) but must resolve before the data is revealed.
- **Actions** (side effects) call `submitAction(actionId, description)` **asynchronously** — it
  returns quickly, but the action may not actually be performed until much later, at the user's
  convenience. The action is identified by a sequential integer id the gatekeeper assigned. The
  gatekeeper must **not** apply the action until the overseer calls `applyAction(id)`; the user may
  instead `rejectAction(id)` (which returns an optional `restart` flag) or later `revertAction(id)`
  to attempt to reverse an applied action.

The Workshop's overseer surfaces this to the user via `Overseer.listActions`,
`approveAction`, `rejectAction`, `listHooks`, `enableHook`/`disableHook`/`deleteHook`, and the
auto-approval rule API.

### Auto-approval

An action's `ActionDescription` may carry an `actionKind` (a stable `tag` + display `label`) and the
author's `autoApprovable: true` verdict. Auto-approval rules are workspace-wide per gatekeeper: the
user (or pre-approval UI) enables a rule via `Overseer.setAutoApprovedActionKind`, and subsequent
actions of that kind whose author marked them `autoApprovable` are applied automatically.
`Gatekeeper.getAutoApprovableActions()` lists the *potential* set for pre-approval UIs. A per-action
`awaitDecision` hint requests that the harness suspend rather than continue against un-simulated state.

### Simulation

Because approvals can happen much later, gatekeepers are strongly encouraged to **simulate** queued
actions — so reads reflect pending actions as if already applied. This lets the agent keep working and
queue dependent actions, and lets the user batch-approve later. `gatekeeper-google` is the reference
for caching/simulation (its BigQuery dry-run scope enforcement is a good example).

### Observer verification (sharing)

When a Gadget is shared, each collaborator becomes an observer of every gatekeeper bound to it, and
may see data the Gadget previously read. The gatekeeper must refuse — or forward-restrict — observers
who couldn't access that data themselves. This uses three methods on the gatekeeper
(`addObserver`/`removeObserver`) plus `GatekeeperUser.getVerifier()`, which mints a
`GatekeeperUserVerifier` token the overseer promises to pass only back to a gatekeeper of the same
vendor. The `write-gatekeeper` skill defines four strategies (A private-only, B ACL-check, C
data-set tracking, D low-stakes) chosen per binding.

## Auto-provisioned singletons and management UIs

A gatekeeper may declare `VendorDescription.autoProvisionsAccount`. It can then mint a connected
account with no OAuth flow via `GatekeeperVendor.createAccount()` (which takes no user identity and
only *creates* accounts). The produced account (`GatekeeperUser`) declares in `AccountDescription`
whether it provides an **agent singleton** (`singleton: { tsType }`) and/or a **management UI**
(`providesUi`). The Workshop persists the account like any connected account and auto-provides the
singleton to the owner's workspaces as an ambient gatekeeper record; the UI is hosted at
`/gatekeepers/$id` via `startAppUi({ isAdmin })`.

There are three per-vendor provisioning modes, chosen by the deployment admin and resolved in
`packages/workshop-backend/src/provisioning-policy.ts`:
`disabled` / `optional` (default) / `enabled`. `enabled` auto-provisions for every user (forced and
hidden from the Connectors list), `optional` lets each user opt in, and `disabled` offers it to no
one (existing accounts go dormant). The account capability — not an asserted identity — is the
authority thereafter.

## The MCP family

`packages/mcp-shared` is a shared library (not a Worker) behind the two MCP-speaking gatekeepers:
`gatekeeper-mcp` (the user pastes an endpoint URL) and `gatekeeper-mcp-portal` (one admin-configured
portal URL). Code lives there when two copies would eventually disagree and the disagreement would be
a security bug: tool classification, the scope grammar, the OAuth lifecycle, and the approval-queue
wiring.

### The trust boundary and trust tiers

`mcp-shared/src/tools.ts` is the **trust boundary**: nothing outside it reads a tool's `annotations`.
A tool the server declares `readOnlyHint: true` runs as an observation; everything else is queued for
approval; and auto-*applying* a write additionally requires a `vetted` endpoint (only the portal can
produce one, via `MCP_PORTAL_TRUST_ANNOTATIONS`).

Two trust tiers govern how much a server's self-description is believed:

- **`byo`** — a user typed the URL in. `readOnlyHint` classifies reads (a knowing, documented
  departure from treating annotations as wholly untrusted); nothing else the server says can auto-apply
  a write.
- **`vetted`** — a deployment has asserted the endpoint's annotations are reliable, so
  `destructiveHint: false` plus `idempotentHint: true` may drive auto-approval. `gatekeeper-mcp-portal`
  defaults to `byo` because the admin never saw the upstream servers' annotations.

Neither tier can be shared (see `mcp-shared/src/sharing-policy.ts`). Tier is deployment configuration,
read afresh at each point of use so withdrawing it takes effect immediately.

### Scope grammar and safety

The **resource-URL scope grammar** lives in `mcp-shared/src/scope.ts`, and every call passes through
it. `gatekeeper-mcp` grants by endpoint host or named tools
(`#tool=a&tool=b`); `gatekeeper-mcp-portal` scopes a grant to one upstream server behind the portal
(`#server=...`), and a `#server=` fragment is refused by the direct connector. Every path rejects
names outside the binding's scope before loading the catalog or contacting the endpoint.

OAuth uses the official `@modelcontextprotocol/client`, and SDK OAuth operations must always be given
`sdkFetch(...)` so every request and redirect retains endpoint and SSRF checks. `mcp-shared/src/fetch.ts`
is the single outbound-request path, following redirects by hand and re-checking each hop.
