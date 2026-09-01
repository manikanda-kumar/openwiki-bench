---
type: connector
title: Context Library and Scheduled Tasks
description: The two auto-provisioned singleton gatekeepers — the Context Library (private/public context collections with an agent read session and management UI) and Scheduled Tasks (one account-scoped driver DO firing persistent workspace hooks).
tags: [gatekeeper, singleton, context-library, scheduler, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-b27801aedd153097a7879044
    resource: repo://packages/gatekeeper-context/src/agent-skill.ts
  - id: openwiki-source-c2d80b2a80732f9442157acc
    resource: repo://packages/gatekeeper-context/src/context-api.ts
  - id: openwiki-source-52ab503bbb8e3296d63507cc
    resource: repo://packages/gatekeeper-context/src/context-collection.ts
  - id: openwiki-source-b1629be8a1a0855428b18a7d
    resource: repo://packages/gatekeeper-context/src/context-observers.ts
  - id: openwiki-source-bfaf1bafa47e2a3dc720cbe2
    resource: repo://packages/gatekeeper-context/src/domain.ts
  - id: openwiki-source-43704c896f085937bb7cb56a
    resource: repo://packages/gatekeeper-context/src/library-gatekeeper.ts
  - id: openwiki-source-93a9f96a66238f442bc4688a
    resource: repo://packages/gatekeeper-context/src/library-read.ts
  - id: openwiki-source-bf24a2c39ef776522be209d3
    resource: repo://packages/gatekeeper-context/src/registry-do.ts
  - id: openwiki-source-4f6a059eb6a37b6662f5b07d
    resource: repo://packages/gatekeeper-context/src/user-library.ts
  - id: openwiki-source-3cf1b245c90ed07be18f4946
    resource: repo://packages/gatekeeper-scheduler/src/schedule-driver.ts
  - id: openwiki-source-6e4b904940a56a0c9f48b90b
    resource: repo://packages/gatekeeper-scheduler/src/scheduler.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Context Library and Scheduled Tasks

<!-- openwiki: broken internal link [agent-runtime.md] file "agent-runtime.md" does not exist. Fix the href or restore the target, then delete this comment. -->
Two connectors show the *singleton* shape of the gatekeeper protocol: accounts are minted with no OAuth flow (`autoProvisionsAccount`), and the account declares an agent **singleton** and/or a **management UI**. The Workshop auto-provisions them per user (admin mode disabled/optional/enabled, see [Admin Settings and Configuration](../operations/admin-and-configuration.md)), exposes the singleton as an ambient workspace capsule folded into each chat's env as a named binding (`prepareChatBindings`, [Agent Runtime](agent-runtime.md)), and reads it in `executeCode` with every read recorded as an observation — the account capability, not an asserted identity, is the authority (see [Gatekeeper Framework](framework.md)).

## Context Library (`gatekeeper-context`)

"An agent's context library": collections of documents that agents *read* as observations rather than services to call (packages/gatekeeper-context/src/index.ts#L1-L2).

**Account and vendor.** The vendor sets `autoProvisionsAccount: true` and has *no* connect flow — `connectAccount()` throws (packages/gatekeeper-context/src/library-gatekeeper.ts#L184, #L390). The minted `ContextAccount` declares `singleton: { tsType: "ContextLibrary" }` and `providesUi: { title: "Context & Skills" }`, handing out the singleton gatekeeper class and the management SPA (`startAppUi`, hosted at `/gatekeepers/context`); its suggested binding name is `CONTEXT` (library-gatekeeper.ts#L135-L147, #L260).

**State lives in three Durable Object classes plus a KV namespace** (packages/gatekeeper-context/src/context-collection.ts#L1-L2, user-library.ts#L1, registry-do.ts#L1-L11, collection-kv.ts#L1-L7):

- `ContextCollectionDurableObject` — one collection's metadata and documents; metadata changes propagate to the owning library or the domain registry.
- `UserLibraryDurableObject` — each account's index of *its own private* collections.
- `LibraryRegistryDurableObject` — the per-domain registry of *public* collections, serializing writes to a KV snapshot (`<domain>\0.public`) that user sessions read when building their enabled set; the registry DO is the only KV writer (registry-do.ts#L1-L11; collection-kv.ts#L1-L10).

**Visibility is a hard split.** Private collections are readable/writable only by their owning account; public ones are created/edited only by deployment admins (`#assertAdmin` gates public writes in the management API) but readable by everyone (packages/gatekeeper-context/src/context-api.ts#L99, #L129-L161; index.ts#L1-L2).

**Multi-tenancy via `sharingDomain`.** All DO names and KV keys are namespaced by a domain taken from the binding's props, joined with a NUL separator that can't appear in domains, account UUIDs, or hex collection ids — so several workshops can share one gatekeeper deployment without cross-talk. The code is explicit that this isolates *accidental mixing* between trusted deployment configs, and is *not* a security boundary against a malicious peer configuration (packages/gatekeeper-context/src/domain.ts#L1-L17).

**The agent read path is observation-first.** `library-read.ts` authorizes every returned result through `authorizeObservation`, attributing the read to the collections whose metadata or content it revealed (packages/gatekeeper-context/src/library-read.ts#L1-L3). Observer re-verification uses a non-standard verifier method: the gatekeeper asks its own minted `ContextVerifier` whether a user `hasCollectionAccess(...)` on a collection — safe because the overseer only returns a verifier to the vendor that created it (packages/gatekeeper-context/src/context-observers.ts#L1-L8). The catalog advertises at most 150 skills — skills are the one item class that grows without limit (a git-backed collection can import hundreds) — while collections stay under the shared agent-catalog ceiling because they're the agent's entry points (packages/gatekeeper-context/src/agent-skill.ts#L1-L11; see [Gatekeeper Framework](framework.md) for the catalog caps). Git-backed *artifact sync* (importing repo documents into collections with per-collection git tokens) is a further mechanism in `artifact-sync.ts` (context-collection.ts#L10-L12). The management UI is a single-file React SPA in `app/`, bundled by `build-app.mjs` into `src/generated/app.txt` (see [Toolchain, Tasks, and Build Cache](../development/toolchain-and-builds.md)).

## Scheduled Tasks (`gatekeeper-scheduler`)

Scheduled Tasks is the persistent-callback connector: gadgets/agents register workspace callbacks that fire on a schedule (packages/gatekeeper-scheduler/src/scheduler.ts#L238-L322 — singleton `tsType: "ScheduleSession"`, a `providesUi` management listing page, binding name `SCHEDULER`, `autoProvisionsAccount: true` at #L411).

Its state design is deliberately small: **one account-scoped `ScheduleDriver` Durable Object** stores enabled schedules and delivers them all from a **shared alarm** — the DO's `alarm()` batches due runs, logs failures, and reports them via `reportIssue` rather than letting a broken batch stall delivery; an in-flight run cannot overlap its own next alarm, which is what makes the immediate-write path safe (packages/gatekeeper-scheduler/src/schedule-driver.ts#L82, #L237-L285). Lifecycle state transitions (`admitRun` / `beginDueRun` / `completeRun` / `failRun` / `rejectRun`) are factored into `driver-state.ts` (schedule-driver.ts#L1-L14). Each schedule is registered as an ordinary gatekeeper hook: the session submits `bindHook` with a `HookController` made by a controller factory, so **enablement stays on the Workshop side** — the overseer calls `controller.enable(...)` (carrying the `HookInitiator`) after user approval, and only then does the driver admit the schedule; `disable` releases it, and terminal schedules drop their delivery capability instead of holding it (schedule-driver.ts#L83-L149; scheduler.ts#L167-L176; hook semantics in [Gatekeeper Framework](framework.md)).

Both connectors illustrate the same framework rule from the opposite direction: resources become ambient *only* through user/admin configuration — neither asserts its own ambience, and both are governed by the deployment's provisioning mode and the per-user opt-in on the Connections page.
