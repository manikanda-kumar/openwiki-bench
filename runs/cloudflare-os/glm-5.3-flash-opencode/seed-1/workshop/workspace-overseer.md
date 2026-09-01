---
type: "Reference"
title: "The Workspace Overseer: Workpieces, Code, and Chats"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# The Workspace Overseer: Workpieces, Code, and Chats

One `OverseerDurableObject` owns one workspace: the workpiece registry, gadget code, chat logs, the action log, sharing, observers, and blueprints ([Architecture Overview](/openwiki/architecture/overview.md)). Its storage schema and the migration ladder are covered in [Persistence](/openwiki/architecture/persistence.md); this page covers the *model* it enforces.

## Workpieces: one ID namespace, several kinds

Everything a workspace contains is a **workpiece**: gadgets and gatekeepers (plus AI-model and agent-spawner bindings, which are gatekeepers of a special kind) share one sequential ID namespace allocated from the `nextGatekeeperId` singleton, "so a bare number unambiguously identifies a workpiece of any type, and derived names (facet names) can never collide across types" (api.ts:164-171; src/overseer.ts:320-323). Records:

- **`GadgetRecord`** — `id`, `title`, `created`, optional `output` (descriptive only, copied from a blueprint), `bindingName` (its name in chat envs and the default binding list; unique workspace-wide via the `byBindingName` index), `commitId` (its head in the git store), `bindings` (name → `BindingRecord`), and `pending` while provisional (src/overseer.ts:323-374).
- **`GatekeeperRecord`** — `id`, denormalized `resourceTitle`/`resourceUrl`, the DO `class`, an optional hook export name, and the `creationSpec` recording how it was created (gatekeeper / aiModel / agentSpawner / ambient) (src/overseer.ts:272-292).
- **`BindingRecord`** — an edge from a gadget to a target workpiece, carrying the user's blueprint annotation *on the edge* (two gadgets binding the same gatekeeper can annotate differently) and a `pending` marker while provisional (src/overseer.ts:299-318).

**Pending lifecycle**: a gadget or binding created inside a chat is real in the registry — fully functional (bindings, facet, env) before acceptance — but for *reads* everything else (mainline loads, other chats, blueprints, "use"-role sharing) treats it as nonexistent; for *writes* it still occupies its name. `pending` is stamped `{chatId, sequence}` in the same transaction that persists the log message recording it, so "the log and the registry can never disagree"; an unstamped record means the creating step never reached its barrier and is reaped (`reconcilePendingGadgets`) (src/overseer.ts:309-318, 363-374). Accepting a chat's changes promotes pending gadgets/edges (deleting the marker); reverting deletes the gadget outright (src/overseer.ts:3647-3677).

## The code model: commits as mainline, streams as drafts

Committed code lives in the workspace's git object store; each gadget's head is `GadgetRecord.commitId`, advanced only by `mergeChanges()` — "accepts are fast-forward only" (src/overseer.ts:341-357; [Persistence](/openwiki/architecture/persistence.md)). Uncommitted state is per-chat: a sequence of `CodeChange`s (`chatChanges` rows) applied on top of pins, with a `generation`/`revision` numbering that the OT module owns (src/overseer.ts:641-682; packages/workshop-shared/src/code-change.ts:1-20).

- **Pins**: when a chat first edits a committed gadget, a `ChatGadgetPin` anchors its view at a head commit; subsequent reads come from the pinned content. Unpinned gadgets are read live at their head (fixed per turn via `observeHead` in the agent). A submission's pin declarations are validated against the gadget's current head (or a parent, tolerating one concurrent merge) (api.ts:1690-1737).
- **Accept (`mergeChanges`)**: always merges *everything* the chat proposes (a partial accept would be incoherent under the epoch reset). It materializes live rows into a changes message, reaps crash-orphans, flattens the chat content as of `mergeThrough`, writes per-gadget commits (content-addressed, harmless if stale), **revalidates against sequence/generation/revision tokens after every await** (returning `{outcome: "stale"}` rather than half-applying), promotes covered pending gadgets/edges, fast-forwards heads, bumps the loader cache, and records a `"merge"` message with `epochBoundary: true` that closes the chat's change-stream generation (src/overseer.ts:3491-3715). A chat being *actively edited* mid-merge throws "The chat's code is being actively edited; please retry." — accepted-but-uncovered keystrokes must not be silently swept (src/overseer.ts:3626-3645).
- **Revert (`revertChanges`)** drops proposed changes from a sequence onward; destructive generation bumps make old submissions unreplayable (api.ts:1726-1737).
- **Live-editing path (`submitCodeChange`)**: the client submits changes against `(generation, revision)`; the server transforms across anything accepted since, validates, appends, broadcasts, and returns the landing point. Retries are deduped per `(userId, clientId, seq)` with a content digest — "a same-seq retry must match byte-for-byte" — and only the last submission is remembered, so keep at most one in flight (api.ts:1710-1724; src/overseer.ts:648-681).

Which code a gadget *runs* is decided per context: `chatDocOwnsGadget(meta, gadgetId)` — true when the gadget has no commit yet or the chat pins it — routes `loadGadgetWorker` to the chat's content; otherwise the head commit (src/overseer.ts:3950-3956, 3986-3996).

## open(): the authorization path

`OverseerDurableObject.open(userId, profileId, notifyClosed, shareKey?, configureObservers?)` (src/overseer.ts:8253-8420):

1. **First open initializes the workspace**: verifies with the owner's User DO that the gadget exists and isn't a deleted-gadget leftover, then latches `ownerId` and initializes storage — under `blockConcurrencyWhile`.
2. **Ambient capsules**: `ensureAmbientCapsules()` runs best-effort (awaited on first open, background later) so singleton accounts are present before the agent's first turn.
3. **Authorization order**: `prohibitAllSharing` short-circuits any non-owner open (lockdown wins); then the sharing graph — share key redemption happens here (atomic with open); then `getEffectiveRole` (denial = `WORKSPACE_ACCESS_DENIED`, exposing no metadata); then `ensureObserver` (see [Observers](/openwiki/sharing/observers.md)), *after* ambient reconciliation so every capability the collaborator sees has an observer.
4. **Capability selection**: the owner and `build` collaborators get the full `OverseerClientInterface`; `use` collaborators get `UseOverseerInterface` — a class that `implements Overseer` but throws `Unauthorized` for everything outside the use allowlist (two inert telemetry subscriptions excepted), so "any newly-added interface method fails to compile until a developer consciously decides whether use callers may invoke it (default-deny)" (src/overseer.ts:10552-10806; docs/sharing.md:28-30).
5. The open records analytics, marks outputs dirty (owner), and fire-and-forget records the collaborator's home-page entry (src/overseer.ts:8362-8379).

## Chat model

`AiChatMetadata` per chat carries the code base (`ChatCodeBase`: pins, generation/revision, epoch), `activeAgent`, `hasProposedChanges`; the message stream and agent context are described in [The AI Agent](/openwiki/workshop/agent.md). Chats are created per-user ("My Chats" scoped to their author), with slash commands resolved through gatekeeper providers (src/slash-commands.ts; api.ts:1853+).

## Cleanup

`deleteSelf()` removes the workspace from the owner's list and deletes all data; gadget deletion reaps its hooks and bindings and aborts its facet. Deleting a chat removes its stream rows, checkpoints, and client records (src/overseer.ts:1293-1298; api.ts:1620-1628).
