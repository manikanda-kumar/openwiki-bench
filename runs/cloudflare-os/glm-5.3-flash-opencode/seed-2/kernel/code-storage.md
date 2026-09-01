---
type: "Reference"
title: "Code storage: git object store and operational-transform changes"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-94f667ebe4a7cf333afaa44e
    resource: repo://packages/workshop-backend/src/git-migration.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
  - id: openwiki-source-d1bf44b13eb683a301190bc0
    resource: repo://plans/git-storage.md
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Code storage: git object store and operational-transform changes

Gadget code has two representations with a strict division of labor: **committed code is real git
history**; **uncommitted changes are OT changes** expressed against commits. The design is locked
in `plans/git-storage.md` and implemented in `packages/workshop-backend/src/git-store.ts`,
`packages/workshop-shared/src/code-change.ts`, and the Overseer.

## The git object store

Each workspace's Overseer DO holds a **real git object database** — SHA-1, zlib-deflated loose
objects, byte-identical to what `git` itself writes — in the `gitObjects` typed-storage collection,
via isomorphic-git's plumbing only (`git-store.ts:1-36`):

- **No ref layer**: no branches, tags, or HEAD. The "refs" are gadget records (each
  `GadgetRecord.commitId` points at its head), blueprint records, and chats' pinned commits.
- **One store per workspace**, all gadgets' histories mixed: unrelated DAGs coexist fine in a
  content-addressed store, and related histories (forked gadgets, blueprint siblings) deduplicate
  at the blob/tree level.
- Real git formats were chosen so gadget code can later export to/import from real git servers and
  agents can "mount" arbitrary repos; the porcelain is off-limits (`git.commit` needs
  HEAD/index/config; `git.merge` cannot represent the merge semantics needed — see below).
- No GC; dangling objects arise only from accepted merges, imports, and migration, and are cheap.
- The fs shim maps loose-object paths onto the collection and rejects everything else
  (`git-store.ts:76-116`); it must provide all ten fs methods (isomorphic-git binds them
  unconditionally) and reject missing files with `code: "ENOENT"`
  (`plans/git-storage.md:70-76`).

`GitStore` offers `changedPaths` (tree-diff, memoized per call site in the agent loop),
`readCommitLog`, tree writing with git's canonical ordering, and flattened file-map reads
restricted to `100644`/`100755` modes (`git-store.ts:283-398`).

## The CodeChange OT model

`packages/workshop-shared/src/code-change.ts` is the **single owner** of the code-change
invariants — wire types, application, composition, transformation, diffing, ingestion validation,
and the priority convention (`code-change.ts:1-23`):

- A chat's uncommitted state is a sequence of `CodeChange`s applied on top of committed code. A
  change carries **no base content**, only "a change relative to revision N", which is what lets it
  compose with git-backed storage (the base is always some commit's tree plus earlier changes).
- A `TextChange` is ChangeSet's compact JSON form: sections tiling the entire original text, so the
  change carries its exact before/after lengths by construction. A `FileChange` is one of `edit`
  (transform existing text), `set` (create/wholesale-replace), or `remove` (composable even against
  an absent file) (`code-change.ts:55-77`).
- Per-gadget entries are deliberately a **list** of `[path, change]` pairs, not a path-keyed
  object: paths may legitimately be `__proto__` or `constructor`, and Cap'n Web deletes
  prototype-shadowing keys from every object it deserializes — a path-keyed map would silently
  lose those files in transit (`code-change.ts:79-99`).
- **Priority convention (fixed invariant)**: for two concurrent changes against the same revision,
  *the change the server ordered earlier comes first* — its inserts precede the later change's at
  equal positions. `transformCodeChange(a, b)` bakes the pairing in; nothing else may call the
  underlying `map` (`code-change.ts:18-23`).

### Two-stage validation, in a required order

`validateCodeChangeSchema` runs **before** any transform (transformation is structural and must
only see well-formed changes); `validateCodeChangeContent` runs **after** transforming to the
server's current revision, because lengths and boundaries are only meaningful against the content
the change will apply to. The declared shape is established upstream by capnweb-validate at the
RPC edge and by the compiler for the one in-process producer, so these stages check the invariants
a TypeScript type cannot express (`code-change.ts:25-38`). Size caps exist first for correctness —
composed changes are stored and travel in RPC messages with hard size limits of their own
(`code-change.ts:40-47`).

## Chat code bases: pins, generations, epochs

`ChatCodeBase` (`api.ts:2293-2323`) describes a chat's stream identity:

- **Pins**: every permanent gadget whose code has been modified in the current epoch; a pin names
  the base commit whose tree the chat edits against (and the chat's last merged commit). Unpinned
  gadgets track mainline head live.
- **Generation**: bumped by operations that invalidate what clients are rooted in. A
  **content-preserving** bump (a merge's epoch reset) transforms in-flight submissions onto the new
  generation; a **destructive** bump (revert, draft discard, turn abort) forces clients to discard
  local state and rebuild. Pin additions and update-from-mainline do *not* bump.
- **Epoch**: the sequence of the message that opened the current epoch (`epochBoundary` merge or a
  migrated chat's conversion boundary); only `changes` messages after it contribute.
- **Revision**: `(generation, revision)` identifies a point in the stream.

`submitCodeChange` validates against `ChatCodeBase`, transforms the change over anything accepted
since the submitter's revision (server-side), and dedupes by `(clientId, seq)` — the client
retries with an identical payload, so idempotency requires byte-identical submissions
(`api.ts:2400-2430`, `1697`).

## Merge-into-chat

Accepting a chat is **only ever a fast-forward**: `mergeChanges` requires that the chat has already
merged the gadget's head commit, then creates a plain commit on head. If mainline moved, the user
must first **update from mainline**: a diff3-based `threeWayMerge` of merged-head/head/chat trees,
delivered *into the chat* as an ordinary change, advancing the chat's merged commit
(`plans/git-storage.md:33-45`; `api.ts:1994-2057`).

`threeWayMerge` never throws on conflict: conflicted files get inline diff3-style markers
(`<<<<<<<`/`|||||||`/`=======`/`>>>>>>>`) and are listed in `conflictPaths` for the user or their
agent to clean up (`git-store.ts:452-510`). This replaces both Yjs CRDT merging ("CRDT merge
across divergent bases produces nonsense") and isomorphic-git's merge (throws on
both-sides-added conflicts before any merge driver runs) — the common ancestor is always known
explicitly (the chat's last merged commit), so no merge-base discovery is needed.

Yjs **is** used where bases are guaranteed identical: seeding a chat's Y.Doc from a commit is
deterministic because the only Yjs randomness is the `clientID`, which the seed fixes alongside
sorted file iteration in one transaction, making `encodeStateAsUpdateV2` a pure function of the
file map (`plans/git-storage.md:90-109`).

## The git migration

`git-migration.ts` converted pre-git workspaces in the Overseer constructor (triggered by the
`version` singleton): it replayed the legacy Yjs update log once, synthesizing per-gadget commit
chains with commit points at every historical merge, at ≥1-hour log gaps, at the final version,
and at every persisted pinned version; every permanent gadget's chain was rooted at a version-0
empty-tree commit so every permanent gadget left the migration with a head. Each live chat was then
**converted in place**: its uncommitted state became one synthetic `"changes"` message (a
`conversionBoundary`) whose change is the diff of the flattened legacy doc against the anchor
commits' trees, carrying a pin per touched gadget (`{baseCommit: anchor, mergedCommit: anchor}`).
The boundary is written even when there is nothing to convert, because `ChatCodeBase.epoch` points
at it and replay elides pre-conversion tool reads by it. Legacy `code`/`snapshots` collections and
the retired Yjs update bytes on `"changes"` messages remain on disk as rollback insurance — read
by nothing except the migration, and stripped from client delivery
(`git-migration.ts:1-40`; `overseer.ts:4496-4504`, `1034-1050`).
