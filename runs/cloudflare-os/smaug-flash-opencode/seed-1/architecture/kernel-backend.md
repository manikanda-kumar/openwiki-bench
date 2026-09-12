---
type: concept
title: The Workshop Backend (Kernel)
description: Deep dive into packages/workshop-backend — the Durable Objects, the customer-facing RPC entrypoint, the admin settings, blueprint/persistence, the code-mode agent, and the capability-security chokepoints.
tags: [backend, kernel, durable-objects, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:56:23.759Z
sources:
  - id: openwiki-source-c5caf6302bd0d2d8c9bc933c
    resource: repo://packages/workshop-backend/src/admin-settings.ts
  - id: openwiki-source-73d324287b2d45b92606324f
    resource: repo://packages/workshop-backend/src/auth/config.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-12T20:56:23.759Z" }
---

# The Workshop Backend (Kernel)

`packages/workshop-backend` is the kernel of the system. In the OS analogy from the README it is the
"kernel," with gatekeepers as device drivers, the workshop-frontend as the shell, and gadgets as
processes. It runs on Cloudflare Workers and owns the architecture; reviewers read every line here
and every API change in `workshop-shared`. This page walks its entrypoints, Durable Objects, security
chokepoints, and the agent/code-mode model.

## The RPC entrypoint

`packages/workshop-backend/src/server.ts` implements `PublicApiImpl` and `AuthenticatedApiImpl`, along
with a small fetcher that exposes the same `PublicApi` over both HTTP batch and WebSocket (see
the [Cap'n Web RPC Contract](capnweb-rpc.md)). It is the top of the control flow:

- Authentication endpoints (`startGatekeeperLogin`, `authenticate`, `authenticateFromCfAccess`,
  `login`, `createAccount`).
- After auth, an `AuthenticatedApiImpl` wraps the user's Durable Object and forwards most calls to it
  (`openGadget`, `newGadget`, `listGatekeeperVendors`, connected-account management, blueprint
  actions, and more).
- A few things are handled in the fetcher itself: serving the site logo and blueprint screenshots,
  the `/api/client-errors` endpoint, the boot-time format-blueprint install trigger, and the session
  abort signal.

`#isAdmin()` reads the `ADMINS` env binding (a JSON array, or the same array as a JSON string) and
checks the user's id name against it. The admin check happens once when `getAdminApi()` mints the
`AdminApi` capability, so the individual methods don't re-check.

## The three Durable Objects

Three DO classes carry the stateful core:

### `UserDurableObject` (`user.ts`)

One per user (keyed by `idFromName(username/normalized email)`). It owns a `typed-storage` layout of
collections and singletons (`makeUserStorage`):

- `aiModels`, `gadgets`, `connectedAccounts`, `sessions`, `blueprints`, `libraryBlueprints`,
  `outputs` collections, plus singleton `cloudflareBilling`, `created`, `profile`.

It is where a user's connected accounts live, where session tokens are validated, where the
outputs index is kept, and where the per-(re)connect capability chokepoints live. It also exposes
`getGatekeeperClassFor()` and `getVerifier()` (see Security chokepoints below).

### `OverseerDurableObject` (`overseer.ts`)

One per workspace, returned by `openGadget`. It is the second biggest surface and the heart of the
agent experience. It owns:

- The gadget registry (workpieces) and committed code (a git object store in the workspace DO, managed
  by `git-store.ts`), per-chat uncommitted changes (a revisioned change stream over commits), chat
  history, actions/hooks, sharing, and blueprint metadata.
- The `ApprovalQueue` implementation (via the gatekeeper session/binding plumbing).
- The **agent**: `agent.ts` implements the code-mode harness. The coding agent is a "Code Mode" agent
  — it writes and immediately executes snippets of code via `executeCode`. The overseer prepares chat
  bindings (`prepareChatBindings`), folds each gatekeeper's read session into the environment as a
  named binding, watches observations/actions, and compacts history (`agent-compaction.ts`).
- A code-mode harness (`CODE_MODE_HARNESS`) is a dynamic worker whose `run()` calls into the agent,
  exposes `env` (the bound gatekeepers/gadgets/models), and grafts a `restore` symbol onto each
  service-binding stub so executed code can forge persistent stubs targeting a gadget's `[restore]()`
  method.

### `AdminSettings` (`admin-settings.ts`)

One deployment-wide (created via `getByName("")`). It owns the authoritative `AdminConfig` as a
singleton and mirrors it to a single reserved BLUEPRINTS KV key (`.adminConfig`, `ADMIN_CONFIG_KEY`)
so hot-path code (`getServerConfig`, connect, agent) reads it with one cheap KV get via
`readAdminConfig(env)`. It is the only writer (`updateAdminConfig(patch)` serializes mutations through
a tail promise). It also installs the bundled format blueprints at boot
(`ensureFormatBlueprintsInstalled`, triggered fire-and-forget on first `/api` request).

## Blueprint persistence

Blueprints span multiple stores:

- **KV** (`BLUEPRINTS`) holds `BlueprintKvRecord` metadata, plus the single `ADMIN_CONFIG_KEY`
  reserved key and the `FEATURED_BLUEPRINTS_KEY`.
- **R2** (`BLUEPRINT_CONTENT`) holds blueprint code snapshots (gzip-compressed Yjs docs) and
  screenshots.
- **User DO** (`blueprints` collection / `libraryBlueprints`) tracks ownership, pinning, featured/own
  flags, and library membership.

Two keys are reserved and can never hold a blueprint (`isReservedBlueprintKey` = the featured key and
`.adminConfig`). A blueprint's `blueprintId` is never edited after deploy, since install and promotion
are keyed on it.

## The agent and code-mode

The agent, implemented in `agent.ts` and driven by the overseer, is a multi-purpose code-mode agent.
It performs tasks by writing small programs and running them via `executeCode` within the workspace's
sandboxed dynamic worker. Bindings (gatekeepers, gadgets, AI models) appear in the executed code's
`env`; each is a named chat binding. Ambient singletons (e.g. the Context Library) are also folded in
as named bindings the agent reads via `getSession`/`getAgentCatalog`. Every read of a singleton is
recorded as an observation through the `ApprovalQueue`. Chat history holds the transcripts and any
proposed code changes; accepted changes advance the gadget's committed code via git commits.

## Security chokepoints

Several invariants concentrate capability enforcement at specific points (documented in `AGENTS.md`
and `REVIEW.md`):

- **`UserDurableObject.getGatekeeperClassFor()`** (`user.ts`) is the single chokepoint where disabled
  gatekeepers and disabled resources are enforced **before a capability is minted**. It checks the
  account, calls the underlying `account.getGatekeeperClassFor(url)`, then reads `readAdminConfig`
  and throws if the gatekeeper or the matched resource type is disabled. Gadget and agent code cannot
  reach it directly.
- **`readAdminConfig(env)`** is the only way hot-path code reads `AdminConfig`; the `AdminSettings`
  DO is the only writer. Connectors/resources default to enabled and the admin UI opts them out;
  auto-provisioning gatekeepers default to *optional* (`provisioning-policy.ts`).
- **Auth config stays env-var driven.** Sign-in providers (`AUTH_GATEKEEPERS`) and password login
  (`DISABLE_PASSWORD_AUTH`) are deliberately *not* in `AdminConfig` (`auth/config.ts`), so a
  compromised admin session cannot change them. `isPasswordAuthEnabled` returns true when
  `DISABLE_PASSWORD_AUTH !== "true"`, or when no auth gatekeeper is allowlisted (avoiding a lockout).
- **`#isAdmin()` in `server.ts`** gates the `AdminApi` capability at mint time.
- **`AdminSettings` only writer**, and `isReservedBlueprintKey` protects the admin-config and
  featured-blueprints KV keys from being clobbered by blueprints.

## Workspace lifecycle

- **Provisional gadgets**: a workspace is "provisional" until it has some activity (a chat message or
  code edit). Provisional gadgets don't appear on the home page and are automatically deleted after
  some time. Notably, `new*Gatekeeper()` does *not* clear the provisional bit (as long as the
  gatekeeper isn't bound into a gadget), so provisional workspaces remain useful for letting the user
  write an initial chat message without explicitly creating a gadget.
- **Opening**: `openGadget(id, shareKey?, configureObservers?)` redeems a share key (adding the caller
  as a collaborator) if given, then opens in one round trip. A non-owner who must choose connected
  accounts for gatekeeper bindings passes a `configureObservers` callback
  (`ObserverConfigCallback.configure`), which the overseer invokes only when needed — the common
  owner case is a single pipelined round trip.
- **Deletion**: `deleteSelf()` removes the workspace from the User's list and deletes all data.
