---
type: "Reference"
title: "OverseerDurableObject: the workspace kernel"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-19ad1060397c9ddb8d4e411a
    resource: repo://plans/multi-gadget.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# OverseerDurableObject: the workspace kernel

One `OverseerDurableObject` exists per workspace. It is addressed by the unique id string minted
at creation (`server.ts:283-285`) and reached through `AuthenticatedApi.openGadget()`. Its
implementation splits into `OverseerDurableObject` (the RPC-facing shell, including the
owner/collaborator interfaces and loopback entrypoints) and the `OverseerImpl` worker object that
owns all logic. `plans/multi-gadget.md` records the design decisions: a workspace contains
numbered **workpieces** — gadgets and gatekeepers sharing one sequential ID namespace (allocated
from `nextGatekeeperId`, a documented historical name) — with per-workpiece Y.Doc roots and
binding names living on gadget records as binding-edge records.

## Storage schema

`makeOverseerStorage` (`overseer.ts:959-1290`) declares the singletons and collections. Highlights:

**Singletons**: `ownerId`, schema `version` (see below), workspace `title`,
`ownerRegistrationPending` (external-message workspaces claim ownership before registering),
`codeVersion` (the worker-cache epoch), `totalCost`, `nextGatekeeperId` (the workpiece counter),
`nextActionId`/`nextChatId`/`nextHookId`, and `prohibitAllSharing` (the lockdown flag). The
migrated `defaultGadgetId` is special: it is never changed, even after deletion, because legacy
records interpret against it (its Y.Doc root is `""` and its facet name is plain `"gadget"`).

**Registries**:
- `gadgets` — `GadgetRecord` (title, created, bindingName, output, commitId, bindings edge map,
  pending marker). The collection — **not** the Y.Doc roots — is the enumeration source of truth:
  content lingering in a deleted gadget's root is inert, never listed/loaded/executed. A unique
  `byBindingName` index makes a provisional gadget reserve its name from creation.
- `gatekeepers` — `GatekeeperRecord` (id, denormalized resource title/url/slash flag, the DO
  `class`, optional hook entrypoint name, `creationSpec`).
- `observers` — non-owner collaborators who configured accounts and passed all addObserver checks,
  keyed by profileId with a `byObserverId` index for forward exclusion.

**Chats**: `chats` (messages keyed `chatId.sequence`), `chatMeta` (with an
active-agent-capable `byLastActive` index), `chatContext` (per-chat agent context: frozen ambient
capsule ids, bindings, catalogs), `chatCompactions` (keyed `chatId.compactedTo`; a chat keeps
*every* checkpoint it published — reverting across a boundary needs the one before it),
`activeAgents` (resume records), `chatChanges`/`chatChangeClients`/`chatChangeBoundaries` (the
per-chat code-change stream and its dedupe/boundary records), `chatModelData` (opaque model-facing
snapshots kept out of client delivery), `agentCallbackArgs` (callback storable args), and
`chatAttachmentContent` (attachment bytes, staged-vs-committed).

**Actions and hooks**: `actions` (every observation, action, and hook bind — with the
`pendingByGatekeeper` sparse index powering the auto-approval drain, `byHistoryFilter` making every
`listActions` filter one ranged read, and `byLastChanged` for resume replay), `boundHooks`, and
`autoApproveTags` (keyed `gatekeeperId:tag`).

**Everything else**: `collaborators` + `shareKeys` (the sharing graph), `blueprints`, `gitObjects`
(the git store), external-message records (`gadgetResponseDeliveries` with an
undelivered-per-chat unique index, `externalChats`), and the read-only legacy collections (`code`,
`snapshots`, `chatDraftUpdates`).

## Schema versions

The `version` singleton gates lazy migrations in the constructor
(`overseer.ts:965-986`):

- **0** — pre-multi-gadget workspace: at most one gadget, which becomes `defaultGadgetId`.
- **1** — multi-gadget: the `gadgets` registry is the source of truth; binding names and blueprint
  annotations moved onto binding edges; spawner configs rewritten to the structured
  `env: Record<name, WorkpieceId>` form.
- **2** — git-backed code: mainline lives in `gitObjects` as commits synthesized from the legacy
  log (see [code storage](/openwiki/kernel/code-storage.md)); gadget records carry `commitId`,
  blueprints reference commits, and every live chat is converted to the commit-pinned change
  stream. `code`/`snapshots` are dead stored data from here on.
- **3** — the actions collection's indexes exist and are backfilled.

## open(): the authorization pipeline

`OverseerDurableObject.open(userId, profileId, notifyClosed, shareKey?, configureObservers?)`
(`overseer.ts:8253-8391`) is the only way a client obtains an `Overseer` capability:

1. **First open** initializes the workspace inside `blockConcurrencyWhile`: it verifies the *owner's
   User DO* believes the workspace exists (a stale/deleted workspace is `WORKSPACE_NOT_FOUND`,
   which also prevents re-creating a deleted gadget's id for a different owner), sets `ownerId`,
   and initializes storage.
2. **Ambient capsules** are reconciled (`ensureAmbientCapsules`) — blocking on the very first open
   so the agent's first turn sees them, background on later opens (a library hiccup is logged, not
   fatal).
3. **The owner** always gets role `build` and refreshes their outputs index on open.
4. **Non-owners**: `prohibitAllSharing` short-circuits to `WORKSPACE_ACCESS_DENIED` (lockdown wins
   and no non-owner can even be denied *informatively*); a share key is redeemed atomically; the
   **effective role is computed live** from the permission graph (`sharing.getEffectiveRole`) — a
   caller with no role gets a bare denial that reveals no workspace metadata; ambient
   reconciliation finishes before the observer snapshot; and `ensureObserver` verifies the caller
   may observe everything the gadget has read through its in-scope gatekeepers (see
   [observers](/openwiki/security/observers.md)).
5. **Role selects the capability**: `use` collaborators get `UseOverseerInterface` (implements the
   full `Overseer` interface but throws `Unauthorized` outside the use allowlist — any new
   interface method fails to compile until a use-role decision is made); owner/build get
   `OverseerClientInterface` (`overseer.ts:8382-8391`; `docs/sharing.md:28-30`).

The `notifyClosed` stub is the lost-connection detector (see the RPC page). A collaborator's first
open also fire-and-forgets a `recordSharedGadgetOpen` to their User DO so the workspace appears on
their home page, followed by an outputs catch-up.

## Loopbacks and hook delivery

The Overseer exposes several `WorkerEntrypoint` loopbacks used as props-carrying facets/stubs:
`GatekeeperLoopback` (binding loopbacks), `AgentSelfLoopback` (the `self` object in executeCode),
`TransientStubLoopback`, `CodeModeTailLoopback`, `GadgetTailLoopback`, `AgentSpawnerGatekeeper`,
and `GatekeeperHookLoopback` (hook delivery). `startHook(hookId)` validates the hook is enabled,
re-checks the admin config (a disabled gatekeeper or ambient vendor cannot deliver), and returns
the stored persistent callback plus a fresh `ApprovalQueueImpl` with caller `{from: "hook"}`
(`overseer.ts:8591-8611`). Hook delivery resumes the chat: the action/observation records land in
the chat log and the agent is resumed (`overseer.ts:8204-8226`).

## Outputs index and lifecycle

Every registry change and every owner open pushes a `WorkspaceOutputEntry` snapshot to the
owner's User DO (`syncWorkspaceOutputs`); `getOutputsForOwnerBackfill` exists to catch up
workspaces that predate the index, gated to the real owner. Deleting a workspace (`deleteSelf`)
removes it from the User DO and destroys the DO; chat deletion scrubs compaction checkpoints,
callback args, model data, and resume records before destroying live state
(`overseer.ts:10196-10233`).
