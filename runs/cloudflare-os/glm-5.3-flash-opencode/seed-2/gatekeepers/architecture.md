---
type: architecture
title: Gatekeeper architecture and lifecycle
description: The vendor/user/instance tier model, how a gatekeeper is discovered and installed as an Overseer facet, binding names, AI-model and agent-spawner built-ins, UI frames, the agent catalog, ambient capsules, hooks, and external message gateways.
tags: [architecture, gatekeepers, security, rpc, facets]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-7272ce5de435f7a3954bd25d
    resource: repo://packages/workshop-backend/src/agent-spawner-binding.d.ts
  - id: openwiki-source-25f7582df1105cc629b74df9
    resource: repo://packages/workshop-backend/src/ai-models.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-64b029899e771aec2fb6dfef
    resource: repo://packages/workshop-backend/src/external-message-gateway.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Gatekeeper architecture and lifecycle

A gatekeeper is a separate Workers application that mediates all access between a gadget (or
agent) and an external service. The contract lives in
`packages/workshop-shared/src/gatekeeper.ts`; the in-repo authoring guide is
`.agents/skills/write-gatekeeper/SKILL.md`.

## The three tiers

1. **Vendor** — `GatekeeperVendor`, a `WorkerEntrypoint` bound as `GATEKEEPER_<NAME>` with
   `entrypoint: "GatekeeperVendor"`. It describes the service, starts OAuth flows
   (`connectAccount`), lists supported resource types, publishes the agent-facing TypeScript types
   (`getTypeScriptTypes`), and — for auto-provisioning vendors — mints accounts with no OAuth flow
   via `createAccount()` (`gatekeeper.ts:445-523`).
2. **User (account)** — `GatekeeperUser`, one per connected account, stored in the connecting
   user's User DO. It holds the grant, describes the account, resolves a URL to a resource class
   (`getGatekeeperClassFor`), starts resource configurators, supports reconnect/revoke, mints
   observer verifiers (`getVerifier`), and can provide an agent singleton and/or a management UI
   (`gatekeeper.ts:567-672`).
3. **Instance (binding)** — `Gatekeeper<Session>`, a Durable Object class installed **as a facet of
   the workspace's Overseer DO**, one per resource binding per gadget. It describes the resource,
   slices the vendor's types for the agent, starts sessions guarded by the `ApprovalQueue`, and
   answers observer checks (`gatekeeper.ts:698-853`).

Discovery is purely by binding name: the backend builds its vendor map from every env key starting
with `GATEKEEPER_`, taking the lowercased suffix as the vendor id
(`packages/workshop-backend/src/auth/auth-vendors.ts:3-31`); the router routes
`/gatekeeper/<suffix>/*` from the same keys (`packages/router/src/index.ts:24-35`).

## Installation: from pasted URL to facet

The flow when a user (or an accepted agent request) introduces a resource:

1. `OverseerClientInterface.newGatekeeper(accountId, resourceUrl)` calls
   `clientUser.getGatekeeperClassFor(accountId, url)` — the **collaborator's own** account, not the
   owner's, so collaborators never gain access to each other's services
   (`overseer.ts:9367-9380`; `docs/sharing.md:140-145`).
2. Inside the User DO, `getGatekeeperClassFor` is the **single enforcement chokepoint**: it looks up
   the connected account, asks the account's gatekeeper class for the URL, then throws if the
   deployment's admin config disables that vendor or that resource's URL pattern. This is where a
   resourceUrl becomes a capability, reached only via the UI-facing `newGatekeeper` and blueprint
   instantiation — never from gadget or agent code
   (`packages/workshop-backend/src/user.ts:1666-1691`; `REVIEW.md:29-32`).
3. The account returns a `DurableObjectClass` **imbued via `ctx.props`** with the user's
   credentials and the resolved resource — the class reference is the only thing that crosses;
   the capability stays encapsulated in the account DO (`gatekeeper.ts:579-593`).
4. `OverseerImpl.addGatekeeper(cls, creationSpec)` allocates a workpiece ID, stores the
   `GatekeeperRecord` (class + creation spec + denormalized resource title/url/slash-command flag),
   installs the facet `gatekeeper${id}`, calls `describe()` to fill the denormalized fields, and
   rolls the record back if describe fails (`overseer.ts:4334-4378`).
5. Removing the connection destroys the facet and record; any gadget binding edges pointing at it
   are severed so no gadget `env` keeps a dangling entry. Merely unbinding from one gadget
   (`GadgetClient.unbind()`) leaves the record alive, possibly orphaned
   (`overseer.ts:4359-4378`).

Sessions are opened through `GatekeeperClientImpl.openSession()`, which resolves the facet and
calls `startSession(approvalQueue)`; the approval queue stamps every observation and action into
the overseer's action log (`overseer.ts:4380-4401`, `4445-4486`; see
[the approval-queue page](/openwiki/security/approval-queue.md)).

## Built-in gatekeepers: AI models and agent spawners

Two gatekeeper types are implemented by the core, not external workers:

- **AI model** (`LanguageModelGatekeeper`, `packages/workshop-backend/src/ai-models.ts:657-712`):
  describes itself as `models.local/<provider>/<model>`, exposes a `LanguageModelBinding` session
  (`run(prompt)`), and reports no auto-approvable actions; `addObserver` is a no-op because model
  reads leak nothing about the observer.
- **Agent spawner** (`AgentSpawnerGatekeeper`, entrypoint re-exported in
  `overseer.ts`; binding contract in `packages/workshop-backend/src/agent-spawner-binding.txt`):
  its session offers `spawn(title, prompt)` and `spawnCallable(title, prompt)` (a callable stub the
  gadget can store and re-invoke). The spawner config's `env` is validated at creation: names must
  be valid binding names and targets must exist and not be gadgets still pending in another chat
  (`overseer.ts:9409-9452`). The creating user's DO id rides the props so model resolution at
  trigger time bills the right account.

## UI frames

Both UI shapes are `GatekeeperUiFrame`s — complete HTML plus a gatekeeper-defined capability stub —
hosted in sandboxed iframes over MessagePort RPC (see
[the gadget-iframe page](/openwiki/frontend/gadget-iframe.md)):

- **Resource configurator**: `UserDurableObject.startResourceConfigurator(accountId,
  resourceUrlPattern)` forwards to the account; the workshop hosts it inside the connect modal
  (`user.ts:1547-1553`; `gatekeeper.ts:347-426`).
- **Management app**: `AuthenticatedApi.listGatekeeperApps()` lists connected accounts whose
  `AccountDescription.providesUi` is set (auto-provisioning them first, idempotently, so the nav is
  complete even before any gadget is opened); `getGatekeeperApp(id)` returns the frame via
  `startAccountAppUi(accountId, { isAdmin })`, with `isAdmin` supplied **fresh per open** since a
  user's admin status can change (`server.ts:556-584`; `gatekeeper.ts:85-87`). Apps are hosted at
  `/gatekeepers/$appId` using the vendor id as the slug (`api.ts:718-730`).

## Ambient capsules (auto-provisioned singletons)

Vendors that declare `VendorDescription.autoProvisionsAccount` mint accounts with no OAuth flow;
the deployment admin sets a per-vendor mode — **disabled / optional / enabled**, defaulting to
**optional** — resolved only in `packages/workshop-backend/src/provisioning-policy.ts`
(`provisioning-policy.ts:1-34`). `enabled` forces one account per user (hidden from the Connectors
list); `optional` lets users opt in from the Connectors page; `disabled` puts existing accounts
dormant.

A singleton account (`AccountDescription.singleton`) is installed into the owner's workspaces as an
**ambient gatekeeper record** by `OverseerImpl.ensureAmbientCapsules()`, which runs on every
`open()`: it reconciles existing capsule records against the owner's current singleton accounts
(stale account ids are removed), then provisions missing ones concurrently. The account's
`getSingletonGatekeeperClass()` returns a normal `Gatekeeper` DO class; it installs as a facet like
any other gatekeeper, so its session and catalog run **gadget-side in the gatekeeper's own worker**
with no round-trip through the account DO (`overseer.ts:6164-6236`).

At chat seeding time (`prepareChatBindings`), each chat's frozen ambient set is named by the
gatekeeper's `suggestedBindingName` (deduped into the chat's binding map) and its discovery catalog
is fetched through the facet's `getAgentCatalog(authorizer)` — **authorized as an observation**
through the approval queue, clamped by `boundAgentCatalog`, and cached per chat
(`overseer.ts:6397-6460`, `6590-6660`; `gatekeeper.ts:104-145`). A capsule can also be promoted
into a specific gadget's binding list by the agent via `setGadgetBinding`.

## Hooks (push notifications)

Persistent callbacks are the runtime feature hooks rely on: the gadget creates a persistent stub
via `ctx.restore(params)`, and the gatekeeper must **never store the callback itself** — it is tied
to the current session. Instead it calls `approvalQueue.bindHook(controller, callback,
description)`, where `controller` is a `HookController` WorkerEntrypoint whose `props` carry
everything needed. When the user approves the hook, the overseer calls `controller.enable(
initiator, target)`; on each event the gatekeeper calls `initiator.startHook()` to obtain a fresh
`{callback, approvalQueue}` bound to a new session, authorizes the observation, then delivers the
event (`gatekeeper.ts:944-1047`, `1240-1283`; `SKILL.md:297-321`).

## External message gateways

`ExternalMessageGateway` (`packages/workshop-backend/src/external-message-gateway.ts`) is a
service-bound entrypoint (props carry a `source`) that maps an external channel's keys onto
workspace DOs: gadget/chat/message keys are prefixed with the source (`<source>:<key>`) before use
as DO names, so channels cannot collide with each other or with web-created workspace IDs. The
overseer's `receiveExternalMessage` then enforces the same rules as the UI: caller must have an
account, must own the workspace (or hold a `build` role), must have a configured AI model; a
nonexistent workspace is created on first message and registered in the caller's User DO
(`external-message-gateway.ts:13-38`; `overseer.ts:8402-8516`).
