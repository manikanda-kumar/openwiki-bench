---
type: concept
title: Gatekeeper Framework
description: The shared Vendor -> User -> Instance contract all connectors implement — connection callbacks and OAuth shape, resource-URL patterns, observation/action descriptions, the approval-queue duties, hooks with persistent restore stubs, configurator UIs, and the backend loopbacks that host gatekeeper facets.
tags: [gatekeeper, rpc, approvals, hooks, oauth]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-a0cd2cc1208ac6e36ff11f37
    resource: repo://scripts/build-gatekeeper-configurator.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Gatekeeper Framework

A gatekeeper is "like a supercharged MCP server": a separate Worker that wraps one external service with a clean Cap'n Web API, handles auth, narrows access to the specific resource the user introduced, logs every action, and human-gates side effects (README.md "Gatekeepers" section). All 14 shipped connectors speak one contract — `packages/workshop-shared/src/gatekeeper.ts` — which this page maps. The walkthrough for writing one is [Change Guide: Adding a Gatekeeper](/openwiki/guides/adding-a-gatekeeper.md); the security consequences are [Capability Security Model](/openwiki/security/capability-model.md).

## The three tiers and who implements what

| Tier | Interface | Kind | Implemented by | Consumed by |
|---|---|---|---|---|
| Service | `GatekeeperVendor` | `WorkerEntrypoint` (one per service) | gatekeeper worker | backend (`GATEKEEPER_*` binding), sign-in flow |
| Connected account | `GatekeeperUser` | `WorkerEntrypoint` with `ctx.props` | gatekeeper worker | `UserDurableObject` (stores it in `connectedAccounts`) |
| Binding instance | `Gatekeeper<Session>` | `DurableObject` **facet of the Overseer** | gatekeeper worker's class, *run inside the backend's DO location* | `Overseer` via `ctx.facets`, never the gadget directly |

The third row is the load-bearing trick: `GatekeeperUser.getGatekeeperClassFor(url)` returns a `DurableObjectClass` created with baked `props` (github parses the resource URL into `{owner, repo, resourceKind, issueNumber}` at packages/gatekeeper-github/src/github.ts:1232-1269), and the Overseer instantiates it as *its own facet* (packages/workshop-backend/src/overseer.ts:4259-4269) — the gatekeeper logic executes in the workspace's DO, while its token handling stays behind the `GatekeeperUser`/`UserAccount` stubs back in the gatekeeper worker.

`GatekeeperUser`'s surface (packages/workshop-shared/src/gatekeeper.ts:567-690): `describe()` (AccountDescription: display metadata plus `grantedResourceUrlPatterns`, and the singleton/UI declarations), `getSupportedResources`, `getGatekeeperClassFor`, `startResourceConfigurator`, `revoke`, `reconnect` (re-auth without losing bindings), `getAuthenticatedEmail` (provider-verified email or null), `getVerifier` (mints the opaque `GatekeeperUserVerifier` for observer checks), and `ensureResources(patterns)` — "do I already have authorization for these? if not return a URL to expand it", which is what makes under-scoped grants recoverable mid-use.

## Connection and OAuth shape

`GatekeeperVendor.connectAccount(callback, {scopes, resourceUrlPatterns})` returns an authorize URL the client opens as a self-closing popup; the standard implementation stores a callback + nonce in a `UserAccount` DO which invokes `GatekeeperConnectCallback.complete(user)` when the code comes back, and sets an alarm to self-delete on abandonment. The doc-mandated details: cryptographic nonce in the URL; `"auth"` scope mode as a transient minimal grant; omitted-vs-`[]` `resourceUrlPatterns` as all-vs-none so a billing-only connection can't silently acquire more, and never records a wider grant than was actually made (packages/workshop-shared/src/gatekeeper.ts:445-565; `GatekeeperConnectCallback` expiry semantics at :525-566). Grantable resource *types* are declared with `SupportedResource.grantable`, letting the Workshop request only the scopes the user enabled (packages/workshop-shared/src/gatekeeper.ts:236-300).

URL matching has a shared helper: `matchesResourceUrlPattern` tries both the URL as given and trailing-slash-toggled, because `URLPattern` distinguishes `/repo` from `/repo/` and both humans and LLMs append slashes — without it an agent's request would match no resource and the accept modal would open empty (packages/workshop-shared/src/gatekeeper.ts:255-299).

## The session's three obligations

The `Session` capability returned by `startSession(approvalQueue)` must (packages/workshop-shared/src/gatekeeper.ts:716-752):

1. **Author every read.** `ObservationAuthorizer.authorizeObservation(description)` before data returns; fetching first is allowed for strictly read-only ops as long as nothing leaks on denial. An `ObservationDescription` carries a title/description for display, plus the sharing controls `prohibitAllSharing` (the blunt lockdown flag) and `excludeObservers` (named observers this data must never reach) (packages/workshop-shared/src/gatekeeper.ts:855-880, 1049-1115).
2. **Queue every write.** `ApprovalQueue.submitAction(action, description)` returns immediately; the side effect happens only when `applyAction(action)` is called (possibly hours later), `rejectAction` undoes queued state, and `revertAction` backs out *applied* actions — only if the gatekeeper declares `implementsRevert` (packages/workshop-shared/src/gatekeeper.ts:934-960, 1129-1215). `ActionDescription` fields drive UI and policy: `actionKind: {tag, label}` (the tag is what auto-approval rules and `getAutoApprovableActions()` match on), `awaitDecision` (the agent loop stops and waits), `autoApprovable` (per-action verdict that auto-*applying* still gates behind vetted endpoints — see [MCP Connectors](/openwiki/integrations/mcp-connectors.md)). Simulation of pending actions is the framework's answer to sync-approval fatigue: the session reflects the world as if queued writes had landed ([Capability Security Model](/openwiki/security/capability-model.md); contract guidance at gatekeeper.ts:725-740).
<!-- openwiki: broken internal link [params] file "params" does not exist. Fix the href or restore the target, then delete this comment. -->
3. **Bind hooks carefully.** `bindHook(controller, callback, description)` registers a persistent callback; the contract insists the gatekeeper *not* store the callback itself — it is tied to the current session and revoked when the session ends; delivery later goes through `HookInitiator.startHook()`, which starts a *new* session, returning a fresh callback+queue, and the hook invocation must still `authorizeObservation` first. Controllers should carry all state in `props` (no storage pre-approval, since enablement may never come) — and enablement itself is an action the overseer gates (packages/workshop-shared/src/gatekeeper.ts:962-1035; overseer side at packages/workshop-backend/src/overseer.ts:4711-4760). Persistent stubs are Workers-runtime `ctx.restore(params)`/`[restore](params)` round-trips.

## Optional surfaces

- **Slash commands**: `hasSlashCommands` on the ResourceDescription + `getSlashCommandProvider()`; `list()` is non-sensitive picker metadata, `invoke()` must authorize any read-derived expansion text (packages/workshop-shared/src/gatekeeper.ts:875-933).
- **Agent catalog**: optional `getAgentCatalog(authorizer)` for bounded discovery, clamped by `boundAgentCatalog` (packages/workshop-shared/src/gatekeeper.ts:737-752).
- **Account singleton / management UI**: `AccountDescription.singleton` / `.providesUi` drive `getSingletonGatekeeperClass()` and `startAppUi(context)` — the Workshop hosts UI-providing accounts at `/gatekeepers/<vendorId>` in an **opaque-origin `srcDoc` frame** (packages/workshop-shared/src/gatekeeper.ts:148-184; [Context Library and Scheduler](/openwiki/integrations/context-library-scheduler.md) for the worked cases).
- **Observer checks**: `Gatekeeper.addObserver(id, user)`/`removeObserver` receive the verifier Fetcher and "unwrap" it via methods the gatekeeper itself defined on its verifier type — the check runs inside the vendor's trust domain (packages/workshop-shared/src/gatekeeper.ts:744-760; [Sharing and Observers](/openwiki/security/sharing-observers.md)).

## Configurator UIs (the `@gadgets/configurator-ui` seam)

`startResourceConfigurator(urlPattern)` returns a `ResourceConfiguratorFrame { iframeHtml, ui }` — the iframe gets its own `ResourceConfiguratorIframe`/`ResourceConfiguratorHost` RPC pair for form data (autocomplete results, `clearFields`, `setValues`) (packages/workshop-shared/src/gatekeeper.ts:348-430). `packages/configurator-ui` supplies **type-only** Kumo component helpers; `scripts/build-gatekeeper-configurator.ts` transpiles each `src/configurator/*-ui.tsx` standalone, stripping only `@gadgets/configurator-ui` and type imports, emitting `src/generated/*-configurator-ui.txt` — hence the duplication constraint (configurators can't import package runtime code; a `__tests__/configurator-url.test.ts` pattern keeps duplicated URL grammar honest; see [Gatekeeper Implementations Catalog](/openwiki/integrations/gatekeeper-catalog.md) and gatekeeper-cloudflare's documented pitfall that `clearFields` alone doesn't null dependent fields).

## How the backend reaches all this (loopbacks)

Gadget/agent code never holds a gatekeeper DO stub; it holds a `GatekeeperLoopback` `Fetcher` whose construction re-enters the Overseer DO with `{target, caller}` props and `startGatekeeperSession` resolves/loads the facet, tracks observations, and wires the session's `ApprovalQueue` (packages/workshop-backend/src/overseer.ts:8766-8795). Hook delivery uses `GatekeeperHookLoopback` (the `HookInitiator` the gatekeeper stores); tail logs use `GadgetTailLoopback`/`CodeModeTailLoopback`. Every entrypoint family member is exported from `server.ts` so `ctx.exports` can reach it without bindings (packages/workshop-backend/src/server.ts:51-62).
