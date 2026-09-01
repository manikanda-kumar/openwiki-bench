---
type: subsystem
title: Context Library and Scheduled Tasks
description: The two auto-provisioned singleton gatekeepers — how the Workshop mints their accounts and folds them into every chat as ambient bindings, the Context Library's three-DO domain-namespaced collection store, and the scheduler's single account-scoped alarm driver.
tags: [gatekeeper, ambient, singletons, durable-objects, scheduler, context-library]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-52ab503bbb8e3296d63507cc
    resource: repo://packages/gatekeeper-context/src/context-collection.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-93a9f96a66238f442bc4688a
    resource: repo://packages/gatekeeper-context/src/library-read.ts
  - id: openwiki-source-bf24a2c39ef776522be209d3
    resource: repo://packages/gatekeeper-context/src/registry-do.ts
  - id: openwiki-source-1df43ef8a4f36d744722bc36
    resource: repo://packages/gatekeeper-scheduler/README.md
  - id: openwiki-source-3cf1b245c90ed07be18f4946
    resource: repo://packages/gatekeeper-scheduler/src/schedule-driver.ts
  - id: openwiki-source-6e4b904940a56a0c9f48b90b
    resource: repo://packages/gatekeeper-scheduler/src/scheduler.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-9bc246fb41230b6d8b6b6618
    resource: repo://packages/workshop-backend/src/provisioning-policy.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Context Library and Scheduled Tasks

`gatekeeper-context` and `gatekeeper-scheduler` are the deployment's two auto-provisioning gatekeepers: vendors that can mint a connected account with **no OAuth flow and no user identity** (`VendorDescription.autoProvisionsAccount` + `GatekeeperVendor.createAccount()`; see the contract at [RPC Contract](/openwiki/architecture/rpc-contract.md) and the mode policy in [Configuration and Admin Settings](/openwiki/operations/configuration-and-admin.md)). They are the concrete cases for the ambient-singleton path the Workshop implements generically.

## The ambient path, end to end

1. **Mode resolution.** `provisioning-policy.ts` is the *single chokepoint* for the three-state admin decision — `disabled` / `optional` (default: "we don't impose ambient authority on every user unless an admin explicitly turns it on") / `enabled` (forced for every user, hidden from the Connectors list) (packages/workshop-backend/src/provisioning-policy.ts:1-26).
2. **Account minting.** `UserDurableObject.#provisionAmbientAccount` refuses disabled vendors, checks the vendor actually advertises `autoProvisionsAccount`, and dedups per vendor; `#createAutoProvisionedAccount` calls `vendor.createAccount()` (no identity argument), resolves the `AccountDescription` *before* allocating the account id (so a `describe()` failure doesn't burn a slot), and stores it as an ordinary `connectedAccounts` record flagged `autoProvisioned: true` — the account capability, not an asserted identity, is the authority thereafter (packages/workshop-backend/src/user.ts:1249-1283). The ensure loop is best-effort and idempotent: one failing vendor never blocks the others, and an in-flight promise dedup prevents duplicate accounts across the DO-input-gate race (packages/workshop-backend/src/user.ts:1295-1341).
3. **Workspace installation.** On `open()`, `ensureAmbientCapsules` asks the owner DO for each provided singleton's `getSingletonGatekeeperClass()` and records the returned `DurableObjectClass` (with baked props) as a `GatekeeperRecord` whose `creationSpec.type === "ambient"`; one singleton's failure (e.g. a `getSingletonGatekeeperClass` throw) doesn't block the rest of the open (packages/workshop-backend/src/overseer.ts:6200-6232).
4. **Chat bindings.** `prepareChatBindings` freezes the ambient set per chat, ordered by immutable gatekeeper id, and folds each in as a **named chat binding** using the resource's `suggestedBindingName` — which is what the agent reads in `executeCode` (e.g. `env.CONTEXT_LIBRARY`, `env.SCHEDULER`) — and each read records an observation (packages/workshop-backend/src/overseer.ts:6397-6460; [Agent Runtime](/openwiki/architecture/agent-runtime.md)). It is *not* bound to any gadget by default; gadgets that want it wire it via `setGadgetBinding`.
5. **Management UI.** An account declaring `providesUi` gets a top-nav app at `/gatekeepers/<vendorId>`: `AuthenticatedApi.getGatekeeperApp` finds the UI-providing account (auto-provisioning first, idempotently, so a direct URL load doesn't race the nav) and returns the `startAppUi({ isAdmin })` frame (packages/workshop-backend/src/server.ts:543-584).

## gatekeeper-context: the Context Library

The Context Library stores collections of context documents agents consult. Its vendor describes itself as "always available — no connection needed" and *throws* on `connectAccount`/`getGatekeeperClassFor`/`startResourceConfigurator` — there are no URL-addressed resources (packages/gatekeeper-context/src/library-gatekeeper.ts:379-421).

**Three Durable Object classes plus KV, all namespaced by a `sharingDomain`** taken from the vendor binding's props (default `"default"`; NUL-joined DO names via `domainName`) so multiple workshops sharing one gatekeeper instance never mix data — the header is honest that this "is not a boundary against malicious peer configs" (packages/gatekeeper-context/src/domain.ts:1-13):

- `ContextCollectionDurableObject` — one per collection: documents, content, artifact sync (packages/gatekeeper-context/src/context-collection.ts:132-144);
- `UserLibraryDurableObject` — one per account's *private* collections, addressed by `domainName(domain, accountId)` (packages/gatekeeper-context/src/library-gatekeeper.ts:172-176);
- `LibraryRegistryDurableObject` — one per sharing domain, the authoritative public set, which also mirrors `publicCollections` into the `CONTEXT_COLLECTIONS` KV namespace as a read snapshot (packages/gatekeeper-context/src/registry-do.ts:20-40).

Collections have exactly two visibilities: **private** (owned/readable/writable by one account) and **public** (created/edited by deployment admins, readable by everyone — hence `hasCollectionAccess` checks both the owner library and the domain registry) (packages/gatekeeper-context/src/library-gatekeeper.ts:204-211). The account's `ContextAccount` declares `singleton: { tsType: "ContextLibrary" }` and `providesUi: { title: "Context & Skills" }`; its UI is a bundled single-file React SPA (built by `build-app.mjs` into `src/generated/app.txt`) served in an opaque-origin frame with a per-user `ContextApiImpl` capability and a *fresh* `isAdmin` per open (packages/gatekeeper-context/src/library-gatekeeper.ts:122-160).

The agent read path (`LibraryReadSession`) funnels every result through observation authorization — reads are attributed to the collections whose metadata or content they reveal, whole-library search fans out to at most 8 collections, and sharing-relevant observations go through the per-binding `ContextObserverTracker` so observer exclusion is enforced at collection granularity (packages/gatekeeper-context/src/library-read.ts:1-31; packages/gatekeeper-context/src/library-gatekeeper.ts:219-230, 318-360). `getAgentCatalog` gives the agent bounded collection discovery without paging the session API, and catalog access is itself an observation (packages/gatekeeper-context/src/library-gatekeeper.ts:318).

## gatekeeper-scheduler: Scheduled Tasks

Scheduled Tasks registers persistent workspace callbacks on recurring/one-shot schedules. Same posture: the vendor auto-provisions, the account declares `singleton: { tsType: "ScheduleSession" }` and a management UI, and the ambient facet `SchedulerGatekeeper` describes itself as `scheduler://tasks` with `suggestedBindingName: "SCHEDULER"` and `hookTsType: "ScheduledTaskHook"` (packages/gatekeeper-scheduler/src/scheduler.ts:228-247, 303-342, 402-420).

Distinctive mechanics:

- **One account-scoped `ScheduleDriver` DO** stores every enabled schedule (`workspaceId.scheduleId` keys) and delivers them from a single shared alarm: `enable` writes under `transactionSync` after asserting a per-workspace quota, arms a *recovery* alarm ahead of live work, and the `alarm()` handler runs a batch, then plans the next target — with an explicit note that an alarm cannot overlap its own live handler, so an immediate re-arm wouldn't bypass a hung handler (packages/gatekeeper-scheduler/src/schedule-driver.ts:82-130, 237-322, 658-720).
- **The facet IS the workspace scope**: `SchedulerGatekeeper.startSession` takes the workspace id from `this.ctx.id` — the inherited facet id — and smoke-checks it can't equal the account id; a workerd parent/facet inheritance test verifies the id really is the parent workspace (packages/gatekeeper-scheduler/src/scheduler.ts:254-262).
- **Read-only gatekeeper with hook semantics**: it submits no actions (`applyAction`/`rejectAction` reject; no auto-approvable kinds; discovery is via `list()`, `getAgentCatalog` returns null), while *delivery* is a hook: registering a schedule pairs a `ScheduleHookController` with the driver, and hook **enablement stays a Workshop Connections UI decision**, not something the gatekeeper self-grants — the app is intentionally read-only (packages/gatekeeper-scheduler/src/scheduler.ts:208-226, 249-303; packages/gatekeeper-scheduler/README.md:14-18).

## Shared failure semantics

A denied observation and a broken singleton both surface to the core as a thrown error — the overseer deliberately treats every failure as repairable (the integration fixture gatekeeper reproduces exactly this shape; see [Testing Strategy](/openwiki/development/testing.md)). Both vendors therefore encode the *reason* in thrown message text the UI can show, and both make provisioning/listing best-effort so one vendor's hiccup never blocks gadget opening or the Connectors list.

## Uncertainty

- Whether `sharingDomain` is ever set to a non-default value in this repo's own deployments is not established by the checked-in configs; the mechanism exists for multi-workshop installs (domain.ts header).
- The scheduler's cron/interval normalization rules live in `scheduler-core.ts` and `schedule-types.ts` and are not enumerated here.
