---
type: "Reference"
title: "Change Guides: Representative Maintenance Tasks"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-09a2095f5d673475622a5a25
    resource: repo://packages/gatekeeper-github/wrangler.jsonc
  - id: openwiki-source-cc7e447558b7fb523bcefa72
    resource: repo://packages/router/src/index.ts
  - id: openwiki-source-2506f0dac5362356f7933f72
    resource: repo://packages/workshop-backend/src/admin-config.ts
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-b96cd41d97342bef9c1acdef
    resource: repo://packages/workshop-backend/src/agent.ts
  - id: openwiki-source-4b063bc36723d0b830f8b473
    resource: repo://packages/workshop-backend/src/auth/auth-vendors.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
  - id: openwiki-source-8963e00a520ba6fd54c2ab71
    resource: repo://REVIEW.md
  - id: openwiki-source-3ca1b8d8f1288879d2ee867c
    resource: repo://scripts/release/manifest-lib.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Change Guides: Representative Maintenance Tasks

These guides trace concrete, source-grounded paths through the codebase. They state the invariants the repository itself establishes (REVIEW.md is the policy source of record for the kernel bar). Where the repository does not establish a fact, this page says so.

## 1. Adding a new gatekeeper

A gatekeeper is a fully independent worker; the workshop discovers it purely by service binding.

1. **Create the package** following an existing one (e.g. `packages/gatekeeper-github`): a `wrangler.jsonc` with SQLite DO migrations (`new_sqlite_classes` for the account DO and the gatekeeper DO), a `capnweb-validate` build (`main` pointing at `.wrangler/validate/src/...`, see gatekeeper-github/wrangler.jsonc:4-12), and entrypoints implementing the `workshop-shared/gatekeeper.ts` contract: `GatekeeperVendor` (the service-binding root: `describe`, `connectAccount`), a `GatekeeperUser` account DO, and a `Gatekeeper` session DO (gatekeeper.ts:445, 567, 698).
2. **Bind it into the workshop.** The binding name convention is `GATEKEEPER_<NAME>`: the backend builds its vendor map by scanning env keys with that prefix and lowercasing the suffix (src/auth/auth-vendors.ts:10-30), and the router routes `/gatekeeper/<name>/*` the same way (packages/router/src/index.ts:24-35). In dev, `run-dev-server.ts` discovers gatekeeper packages and adds the bindings; in release builds, `manifest-lib.ts` reads each package's wrangler.jsonc. If your gatekeeper needs no third-party OAuth app credentials, add it to `NO_DEFAULT_CRED_INPUTS` in manifest-lib.ts:260-267.
3. **Declare resources.** `SupportedResource.urlPattern` strings drive matching; use `matchesResourceUrlPattern`/`resolveRequestedResource` from workshop-shared (gatekeeper.ts:236-330) rather than private copies — the modal and the backend share one precedence rule.
4. **Choose an observer strategy.** Every gatekeeper must implement `addObserver`/`removeObserver`/`getVerifier` semantics; docs/observers.md §9 fixes the strategy per resource type (A private-only, B ACL check, C data-set tracking, D low-stakes). `getVerifier()` must exist even when unused; `removeObserver` must be idempotent.
5. **If it auto-provisions accounts** (`VendorDescription.autoProvisionsAccount`), the admin picks disabled/optional/enabled per vendor (src/provisioning-policy.ts:1-17); declare `AccountDescription.singleton`/`providesUi` if the account provides an agent read session and/or a management UI (gatekeeper.ts:171-181).

Invariants: never assert ambience from gatekeeper code; enforcement of disabled gatekeepers/resources happens only at `getGatekeeperClassFor()` in src/user.ts (REVIEW.md); wire configurator UIs through the shared configurator build (`build-gatekeeper-configurator.ts` transpiles each file, stripping only `@gadgets/configurator-ui` and type-only imports, so configurator files cannot import runtime helpers).

*Uncertain:* whether a new gatekeeper's install wiring requires deploy-service changes beyond the manifest is not established in this repo — the manifest is generated from wrangler.jsonc, but the deploy wizard's package listing lives outside it.

## 2. Changing the shared RPC API safely

1. **Edit the interface in `workshop-shared` first.** Every exported member of the public API needs a doc comment (REVIEW.md); the interfaces carry the semantics (see api.ts:1594+ for the Overseer surface's comment style, including retry/idempotence contracts like `submitCodeChange`'s `clientId`/`seq` dedupe at api.ts:1710-1724).
2. **Annotate implementations with `@validateRpc()`** and never re-implement its checks by hand (see `PublicApiImpl`/`AuthenticatedApiImpl` in src/server.ts:75, 636; overseer client interfaces at src/overseer.ts:9052+).
3. **Prefer promise pipelining.** New flows should let callers pipeline on returned stubs rather than forcing extra round trips — `openGadget(id, shareKey)` exists precisely so redemption and open are one call (docs/sharing.md:44).
4. **Extend coded errors, don't retext them.** `codedErrorFamily` messages double as classification fallbacks for old deployments, so changing a message is a compatibility break (api.ts:298-300); add new codes to the existing families instead.
5. **Never hand-write an interface mirroring an RPC interface plus an `as unknown as` cast** — derive from the real type (REVIEW.md). The existing workaround for facet stubs (Proxy wrapper at src/overseer.ts:4089-4109) is marked as a hack; don't copy it for new surfaces without a TODO.
6. **Watch the client implications:** stubs must not be stored in React state directly, subscriptions must be disposed on cleanup (src/RpcContext.tsx:7-9, src/useActions.ts:190-231), and any new client↔gadget capability flows through the iframe postMessage bridge, not direct sockets.

Verification: `pnpm build` type-checks all packages; new behavior gets a test in the owning package's suite (see [Testing](/openwiki/development/testing.md)).

## 3. Extending AdminConfig

1. **Declare the field in `AdminConfig`** (src/admin-config.ts:18-58) with a doc comment, and choose the default the convention demands: everything here is enabled by default and the admin UI opts *out* — connectors/resources default enabled, auto-provisioning gatekeepers default to `optional` (src/provisioning-policy.ts:12-17).
2. **Auth/authorization fields never go here.** `AUTH_GATEKEEPERS`/`DISABLE_PASSWORD_AUTH` stay env-driven in `src/auth/config.ts` so a compromised admin session cannot change them (REVIEW.md).
3. **Write only through the DO.** `AdminSettings` is the only writer; other code reads via `readAdminConfig(env)` (the single KV get on the mirrored `.adminConfig` key). Add the mutation to `AdminSettings.updateAdminConfig(patch)` (src/admin-settings.ts:297) and, if it needs a UI, to `AdminApiImpl` (src/admin-settings.ts:564) — the capability is minted once with the admin check done (src/server.ts:592-600).
4. **Sanitize on read where the value crosses trust boundaries** (the pattern used for blueprint output: `sanitizeBlueprintOutput` drops malformed declarations, src/blueprint-archive.ts:53-60).

## 4. Adding an agent tool

1. **Define the tool in `src/agent.ts`'s tool map** using `defineTool` (src/agent.ts:995) with a pi-ai `Type.Object` schema, a `label`, and a description constant like the existing ones (e.g. `READ_FILE_TOOL_DESCRIPTION` at src/agent.ts:788-790, the tool at src/agent.ts:2303-2350). Tools' results flow through `toolResult`, and failures go through `toolCallNotes`/thrown errors.
2. **Mind the step barrier.** Any side effect that must be durable iff the tool call's transcript record is durable belongs in the step's buffered changes, committed in one transaction at the barrier (see `AgentStepChange` and the budget docs at src/agent.ts:49-82; plans/step-transactionality.md). File edits buffer as one row per tool call; never write directly at tool-execution time.
3. **Route reads through the same split as the existing file tools.** Unpinned gadgets with committed code are read live at the head (stamped via `observeHead` and `markFileRead` so replay can elide stale reads); pinned gadgets and chat-created gadgets read from session content (src/agent.ts:2314-2336).
4. **Consider the replay path.** The chat log is replayed on later turns; synthetic auto-invocations (like `observeUserChanges`) have a defined no-op replay result (src/agent.ts:832-837).
5. **Update the system prompt if the tool changes what the agent should know** (the prompt builder lives in agent.ts around the `SYSTEM_PROMPT`/spawner variants, src/agent.ts:570+).

*Uncertain:* tool-level token/cost accounting specifics beyond what `ai-invoke.ts`/`ai-gateway.ts` expose are not individually documented here; check those modules when adding a tool that invokes models.

## 5. Changing the gadget sandbox environment

1. **The worker definition is built in `loadGadgetWorker`** (src/overseer.ts:3964-4027): compatibility date/flags, `mainModule: "server.js"`, the `.js` files from committed code or the chat's proposed changes, `env` from `getEnvForLoader`, and `globalOutbound: null`. Changing what gadget code can reach means changing `getEnvForLoader` (src/overseer.ts:2734) and its callers' `GatekeeperCaller` provenance, not the worker def alone.
2. **Cache invalidation is keyed by `codeVersion`** — every merge bumps it, and chat-context loads key on `${codeVersion}.${chatId}.${sequence}` (src/overseer.ts:3964-3985). A new reason to rebuild a worker must flow through that key or through `ctx.facets.abort` (the existing restart paths: src/overseer.ts:4046-4073, 2801, 4971).
3. **The client iframe sandbox lives in `GadgetUI.tsx`**: the Cap'n Web bundle is injected as a doubly-nested data URL, the handshake MessageChannel is established first, console is monkey-patched to forward logs, and `window.open` is blocked while `target="_blank"` links stay allowed (src/GadgetUI.tsx:14-60). Any relaxation needs a security rationale; the iframe is otherwise blocked from the internet to the maximum extent browsers allow (README.md:160-162).
4. **executeCode gets capabilities gadget workers never do** — the restore-forger is passed only to `executeCode` runs, as a transient stub argument scoped to the execution, with binding-name resolution done overseer-side (src/overseer.ts:187-211).

Invariants to preserve: no outbound internet from gadget workers (`globalOutbound: null` is the mechanism, corroborated by wrangler.jsonc's SSRF flags for the *platform* worker); bindings validate through `validateBindingName` (api.ts:192-220) at every chokepoint that writes a name.
