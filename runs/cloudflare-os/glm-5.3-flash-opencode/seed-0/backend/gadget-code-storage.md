---
type: gadget-code-storage
title: "Gadget Code Storage: Git Objects and Code Changes"
description: How gadget code is persisted — a refless content-addressed git object store inside each workspace DO, the shared operational-transform CodeChange format with its two-stage validation, the chat pin/generation model that gates merges, three-way merge semantics, and the legacy Yjs→git migration.
tags: [git, storage, ot, code-change, durable-objects, merge]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
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
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Gadget Code Storage: Git Objects and Code Changes

Gadget code is stored as **real git objects** inside each workspace's Overseer Durable Object, and uncommitted edits travel as **operational-transform changes** composed against commit trees. Two modules own the design: `packages/workshop-backend/src/git-store.ts` (the object store) and `packages/workshop-shared/src/code-change.ts` (the change format both sides of the RPC speak).

## The git object store

`git-store.ts` states the design explicitly (packages/workshop-backend/src/git-store.ts:1-36):

- Each workspace DO holds a real git object database — SHA-1, zlib-deflated **loose objects**, byte-identical to what `git` itself would write — stored one record per object in the `gitObjects` typed-storage collection, keyed by oid (packages/workshop-backend/src/git-store.ts:56-74).
- **There is deliberately no ref layer**: no branches, tags, or HEAD. The "refs" are gadget records (each `GadgetRecord.commitId` is a head — with the invariant that every permanent gadget has one, absent only while the gadget is still pending in a chat), blueprint records, and chats' pinned commits, all managed by the overseer's own workflow. Because the store is content-addressed and refless, unrelated histories coexist freely and related histories dedupe at the blob/tree level (packages/workshop-backend/src/git-store.ts:9-13, packages/workshop-backend/src/overseer.ts:342-357).
- **Real git formats, not a git-shaped encoding**, so gadget code can later be exported to/imported from real repos and agents can mount arbitrary repos. Only isomorphic-git's *plumbing* is used (writeBlob/writeTree/writeCommit/read*/log) against a gitdir containing nothing but `objects/**`; the porcelain is off-limits because `git.commit` requires HEAD/index/config and `git.merge` cannot express the merge behavior wanted (packages/workshop-backend/src/git-store.ts:15-21).
- **No GC.** Dangling objects arise only from accepted merges, imports, and migration — never in-flight chats — and are cheap; if GC is ever needed, the roots are enumerable (gadget records, blueprint records, live chats' pins and compaction checkpoints, and chats' `observedCommit` stamps, which a future GC must either root or tolerate eliding) (packages/workshop-backend/src/git-store.ts:30-36).
- Nothing exceeds ~2 MiB today because records hold single source files, small trees, and commit headers; large blobs would need chunking/R2 spilling, a change local to the fs shim (packages/workshop-backend/src/git-store.ts:23-29).

isomorphic-git's only storage interface is a filesystem, so a **virtual fs shim** maps loose-object paths onto the collection and rejects everything else — `git.commit`/`git.merge` are unusable by construction (packages/workshop-backend/src/git-store.ts:79-80, 116+).

## The CodeChange format

`code-change.ts` is the **single owner** of the change invariants — wire types, application, composition, transformation, diffing, ingestion validation, and the priority convention (packages/workshop-shared/src/code-change.ts:1-24). A chat's uncommitted state is a sequence of `CodeChange`s applied over committed gadget code; each change carries no base content, only "a change relative to revision N", which is what lets it compose with git-backed storage (packages/workshop-shared/src/code-change.ts:2-12).

- The text-OT core is `@codemirror/state`'s ChangeSet (the substrate of `@codemirror/collab`), with change generation via `fast-diff`; both are private to the module so the invariants stay in one place, while the wire carries plain-JSON structural equivalents (`TextChange`, `FileChange`, `CodeChange`) (packages/workshop-shared/src/code-change.ts:9-21, 65-99).
- **Priority convention** (fixed in this module, identical on both wire sides): for concurrent changes against the same revision, the change the server ordered earlier comes first — its inserts precede later ones at equal positions, matching ChangeSet's transform law; only `transformCodeChange` may call the underlying `map` (packages/workshop-shared/src/code-change.ts:14-20, 352+).
- **Size caps** exist first for correctness (composed changes get stored and travel in RPC messages, which have hard size limits of their own), not as a DoS defense: `MAX_FILE_TEXT_LENGTH` 512 KiB, `MAX_FILE_PATH_LENGTH` 1024, `MAX_CODE_CHANGE_SIZE` 2 MiB (packages/workshop-shared/src/code-change.ts:126-144).
- **Two-stage validation, in order**: `validateCodeChangeSchema` runs *before* any transform (transformation must only see well-formed changes); `validateCodeChangeContent` runs *after* transforming to the server's current revision (lengths/boundaries are only meaningful against the content the change will apply to). Neither re-checks the declared shape — that is established by capnweb-validate's generated validator at the RPC edge (packages/workshop-shared/src/code-change.ts:26-63).
- Producers use `applyCodeChange`, `composeCodeChange`, `transformCodeChange`, `diffFiles`, and `changedGadgets`; every producer — human keystrokes, agent tool edits, update-from-mainline merges — expresses changes against some revision and the server serializes them into one revisioned stream per chat (packages/workshop-shared/src/code-change.ts:256-396, 2-7).

## Pins, generations, and the accept gate

The chat-side model (in the shared API):

- `ChatCodeBase` carries the chat's **pins** (which gadgets' code the chat has modified, and at which commit), the **generation** of its change stream (bumped content-preservingly by a merge's epoch reset, or destructively by a revert/discard/agent-abort), the **epoch** (the message that opened it), and the current **revision** (packages/workshop-shared/src/api.ts:2293-2350).
- A `ChatGadgetPin` fixes, immutably for the pin's life, the commit whose tree the chat's changes for that gadget apply on top of; mainline movement merges in as ordinary changes advancing `ChatGadgetPinState.mergedCommit` — never the base. Accepting the chat's changes requires `mergedCommit` to equal the gadget's current head, or the chat is stale and the UI offers updating from mainline (packages/workshop-shared/src/api.ts:2366-2394).
- **`submitCodeChange()` is the only way to edit code** — committed code cannot be written directly; gadget heads advance only when a chat's changes are accepted via `mergeChanges()`. The server transforms each submission over any changes accepted since, validates it, appends and broadcasts it, and answers retries (`clientId` + `seq`) with the recorded result instead of double-applying — a transport failure must be retried with the *same* seq and identical payload, because OT does not tolerate double-application (packages/workshop-shared/src/api.ts:1690-1723).

## Three-way merge

`threeWayMerge()` merges three file maps (base ancestor, ours, theirs) and **never throws on conflict**: conflicted files get inline diff3-style markers and are listed in `conflictPaths` for the user or agent to clean up. It deliberately replaces both Yjs merging (CRDT merge across divergent bases produces nonsense) and isomorphic-git's `merge`/`mergeTree` (which throw on both-sides-added conflicts and require an index). Per-file: one-side-changed wins; identical-change-both-sides is clean; delete-vs-modify keeps the modified content (reported as a conflict); both-sides-changed merges lines via diff3 (packages/workshop-backend/src/git-store.ts:452-522). The common ancestor is always explicitly known — the chat's last merged commit — so no merge-base discovery is needed. Line splitting is lossless-by-construction: only `\n` ends a line, so exotic terminators (`\r`, U+2028/9) stay inside lines rather than silently corrupting content (packages/workshop-backend/src/git-store.ts:524-545).

## The Yjs → git migration

Workspaces built before git-backed storage kept mainline code as a workspace-wide Yjs doc persisted as an incremental update log. `git-migration.ts` replays that log **once** and synthesizes, per gadget, a chain of real git commits, then rewrites every record that referenced a code-log version to reference a commit instead (gadget heads, historical merge messages' `commits`, blueprint records' codeVersion → commitId) (packages/workshop-backend/src/git-migration.ts:1-14).

Commit points are chosen from what the log can tell (essentially timestamps): every code version a historical `merge` message recorded (deliberate acceptances), versions followed by ≥1-hour gaps (batching old standalone keystroke bursts), the final version, and every persisted pinned version (resolved to the last code version at or below it, so pinned state is exactly some commit's tree). Per-gadget chains skip versions where the gadget's files did not change, and every permanent gadget's chain is **rooted at a version-0 empty-tree commit** so every permanent gadget ends with a head even if the log never gave it content (packages/workshop-backend/src/git-migration.ts:16-31).

Each live pre-git chat is then **converted in place**: its legacy doc is flattened once, and its uncommitted state becomes one synthetic "changes" message whose change is the diff against the anchor commits' trees, carrying a pin per touched permanent gadget. The boundary message is written even when there is nothing to convert, because `ChatCodeBase.epoch` points at it and replay keys the elision of pre-conversion tool reads on it. After conversion the chat is an ordinary new-model chat; the pre-conversion messages keep their retired Yjs update bytes on disk as rollback insurance (packages/workshop-backend/src/git-migration.ts:33-50).

## Related pages

- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md) — owns the store and the accept/merge workflow.
- [AI Agent System](/openwiki/backend/agent-system.md) — the agent's file tools and step barrier that produce change rows.
