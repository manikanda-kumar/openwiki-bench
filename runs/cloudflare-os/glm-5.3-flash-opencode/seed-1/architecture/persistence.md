---
type: "Reference"
title: "Persistence: DO Storage, KV, R2, and the Git Object Store"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-319fb879fb1ef152c7aa3aec
    resource: repo://docs/blueprints.md
  - id: openwiki-source-2ff4e6e9c3b33db64168e2c8
    resource: repo://packages/typed-storage/src/index.ts
  - id: openwiki-source-67b40c82c17fbefe9fbe3b59
    resource: repo://packages/workshop-backend/src/blueprint-archive.ts
  - id: openwiki-source-94f667ebe4a7cf333afaa44e
    resource: repo://packages/workshop-backend/src/git-migration.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-061d94d9447139a15085e284
    resource: repo://packages/workshop-backend/wrangler.jsonc
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Persistence: DO Storage, KV, R2, and the Git Object Store

The system uses four storage layers, each scoped to a different lifetime and access pattern:

1. **Durable Object SQLite storage**, accessed through a typed schema layer, for all per-entity state (users, workspaces, chats, actions, sharing).
2. **A real git object store** living *inside* each workspace DO's storage, for committed gadget code.
3. **Workers KV**, for small global, read-heavy records (blueprint metadata, avatars, the mirrored admin config).
4. **R2**, for larger binary blobs (blueprint content, screenshots).

## typed-storage: schema-first DO storage

`packages/typed-storage` is the only package that emits a built `dist` (everything else bundles from source, since nothing imports the others' outputs). It layers typed collections over raw `DurableObjectStorage` (packages/typed-storage/src/index.ts:668-677). A schema declares `singletons` (single-key values) and `collections`, each with a `primaryKey` (a field name or a function) plus optional `uniqueIndexes` and `nonUniqueIndexes` (packages/typed-storage/src/index.ts:173-184).

Each backend DO builds its schema in a `makeXStorage(storage)` factory:

- **User DO** (`makeUserStorage`, src/user.ts:157-226): collections `aiModels`, `gadgets` (the user's workspace list), `connectedAccounts`, `sessions` (login sessions keyed by the SHA-256 hex of the token), `blueprints`, `libraryBlueprints`, and `outputs` (a mirror of each workspace's outputs, so the Outputs page is one cheap read of the user's own DO). Singletons cover the profile, `passwordHashHash`, AI Gateway billing state, and the per-user daily LLM-call counter.
- **Overseer DO** (`makeOverseerStorage`, src/overseer.ts:959-1293): the largest schema in the repo — see below.

Unique indexes enforce invariants at write time: for example the `gadgets` collection's `byBindingName` unique index makes workspace-wide gadget binding names unique, including for gadgets still pending in a chat (src/overseer.ts:1070-1078).

## The Overseer's storage schema and migration ladder

`makeOverseerStorage` declares a `version` singleton (currently 3 for new workspaces, set by `#initializeNewWorkspace`, src/overseer.ts:8231-8237) that gates lazy migrations run at construction (src/overseer.ts:962-986):

- **0** — pre-multi-gadget: the workspace had at most one gadget, later promoted to `defaultGadgetId`.
- **1** — multi-gadget: the `gadgets` registry becomes the source of truth; binding names and blueprint annotations move onto binding edges (`GadgetRecord.bindings`).
- **2** — git-backed code: mainline code migrates from the legacy Yjs `code` log into `gitObjects` as synthesized commits (src/overseer.ts:978-983).
- **3** — the actions collection's indexes (`pendingByGatekeeper`, `byHistoryFilter`, `byLastChanged`) exist and are backfilled (src/overseer.ts:984-985).

Key collections (src/overseer.ts:959-1293):

| Collection | Contents |
| --- | --- |
| `gitObjects` | Real git loose objects keyed by 40-hex SHA-1 oid (see below) |
| `gadgets` / `gatekeepers` | The workpiece registries (`GatekeeperRecord` retains an obsolete `bindingName` only for migration) |
| `actions`, `autoApproveTags` | The approval queue and audit log, with sparse indexes over pending records |
| `boundHooks` | Hooks registered by gadget code, awaiting/permitted delivery |
| `chats`, `chatMeta`, `chatContext`, `chatModelData`, `agentCallbackArgs` | The chat log and its agent-side companions (model-facing step snapshots are kept out of client-visible messages) |
| `chatChanges`, `chatChangeClients`, `chatChangeBoundaries`, `chatCompactions` | Per-chat code-change streams, submission dedupe, generation boundaries, compaction checkpoints |
| `collaborators`, `shareKeys` | The sharing permission graph and share links |
| `observers` | Non-owner observers who passed all gatekeeper verification, indexed by `profileId` and by opaque `observerId` |
| `blueprints` | `BlueprintGadgetRecord`s, the authoritative blueprint store |
| `chatAttachmentContent` | Attachment bytes, staged or committed |
| `code`, `snapshots`, `chatDraftUpdates` | **Read-only legacy** collections, retained only as migration input |

The legacy collections are explicitly read-only after the git migration: nothing writes `code`/`snapshots` anymore, and `chatDraftUpdates` exists only so the migration can fold outstanding drafts into a chat's conversion change (src/overseer.ts:1033-1051, 1223-1231).

## The git object store

`src/git-store.ts` holds a real git object database inside each workspace: SHA-1, zlib-deflated loose objects, byte-identical to what `git` would write, one collection record per object in `gitObjects` (src/git-store.ts:1-29). isomorphic-git is used for its plumbing only (`writeBlob`/`writeTree`/`writeCommit`/`read*`/`log`) — the porcelain is off-limits because `git.commit` requires HEAD/index/config and `git.merge` cannot represent the merge behavior the workspace wants (the custom `threeWayMerge` at src/git-store.ts:484 does).

There is deliberately **no ref layer**: no branches, tags, or HEAD. The refs are the `GadgetRecord.commitId` heads, blueprint records, and chats' pinned commits, all managed by the Overseer (src/git-store.ts:9-12). Because the store is content-addressed and refless, unrelated histories coexist freely and related histories (forks, blueprint instances) deduplicate at the blob/tree level. Real git formats were chosen so gadget code can later be exported to and imported from real git repositories. There is no GC; the doc comment enumerates the roots (gadget records, blueprint records, live chats' pinned commits, compaction checkpoints, `observedCommit` stamps) if GC is ever needed (src/git-store.ts:22-29).

The migration from the legacy Yjs log (src/git-migration.ts:1-44) synthesizes per-gadget commit chains — commit points at historical `merge` messages, ≥1-hour log gaps, the final version, and every pinned version — roots every permanent gadget at an empty-tree version-0 commit, converts each live chat in place to the commit-pinned change-stream representation, and is re-runnable (object writes are content-addressed; all record writes happen in one synchronous tail, so a crashed run is simply redone).

## KV namespaces

wrangler.jsonc binds two KV namespaces plus an R2 bucket (packages/workshop-backend/wrangler.jsonc, `kv_namespaces`/`r2_buckets` stanzas):

- **`BLUEPRINTS`** — public-facing blueprint records (`BlueprintKvRecord`: metadata + ownerId), what `PublicApi.getBlueprint()` reads (src/server.ts:773-778). It also hosts reserved keys: `.adminConfig` (the AdminConfig mirror; `ADMIN_CONFIG_KEY` in src/blueprint-archive.ts:15) and the featured-blueprints key, both excluded from the blueprint id namespace by `isReservedBlueprintKey` (src/blueprint-archive.ts:37-38). The AdminSettings DO is the only writer of the admin mirror; hot paths read it with a single `readAdminConfig(env)` KV get.
- **`AVATARS`** — avatar image bytes keyed by user id, written directly by the API layer (not via the user DO) so reads/writes don't route through the DO's location (src/server.ts:173-198).

## R2: blueprint content

**`BLUEPRINT_CONTENT`** stores blueprint code snapshots as `<blueprintId>/<version>` keys (a gzip-compressed Yjs snapshot), plus blueprint screenshots under `BLUEPRINT_SCREENSHOT_R2_PREFIX` (src/server.ts:603-618). Old versions are retained when a blueprint is updated to avoid races with concurrent instantiation (docs/blueprints.md:61). Import/export streams bytes directly to and from R2 with `pipeTo()` rather than buffering whole archives in memory (docs/blueprints.md:99). Blueprint state overall propagates one way: Gadget DO (authoritative) → User DO (denormalized listing) → KV (public lookup), with a `dirty` flag marking failed propagation for UI retry (docs/blueprints.md:51-63; see [Blueprints and Output Formats](/openwiki/blueprints.md)).

## Supporting bindings

- The `BROWSER` binding (Puppeteer/Browser Rendering) backs gadget PDF exports (wrangler.jsonc `browser` stanza).
- `LOADER` (a `worker_loaders` binding) is the dynamic-worker loader for gadget and code-mode execution — storage-adjacent because it is how stored code is *run* (see [The Gadget Sandbox](/openwiki/workshop/gadget-sandbox.md)).
- Workers observability (logs + traces with head sampling) is configured in wrangler.jsonc's `observability` stanza.

## Failure semantics worth knowing

- Storage schema migrations run in the Overseer constructor under `blockConcurrencyWhile`, gated by the `version` singleton; the git migration is idempotent by construction (src/git-migration.ts:38-44).
- The User DO performs small inline migrations in its constructor (the `minions:` → `gadgets:` key rename) and at account creation (backfilling missing `created`/`lastActive` timestamps) (src/user.ts:290-296, 375-387).
- Pure-read delegations to the User DO retry once across a user-DO reset via `retryOnDoReset`; writes never retry (src/server.ts:119-122).
