---
type: architecture
title: Gadgets, Code Storage, and Collaboration
description: How gadget code is stored as a real git object store in the overseer, how uncommitted edits flow as OT code-change streams through the browser OT client, how gadgets run as dynamic workerd facets, and how the sandboxed iframe UI is built.
tags: [gadgets, git, ot, collaboration, sandbox, ui-bundle]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T09:47:13.931Z
sources:
  - id: openwiki-source-b102cef64ac6711a43509a9f
    resource: repo://packages/workshop-backend/src/code-preview.ts
  - id: openwiki-source-67f91299c1003f4ab21542ba
    resource: repo://packages/workshop-backend/src/gadget-export.ts
  - id: openwiki-source-94f667ebe4a7cf333afaa44e
    resource: repo://packages/workshop-backend/src/git-migration.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-621b56f84037e3de99b7a3e2
    resource: repo://packages/workshop-frontend/src/otClient.ts
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
generated: { by: "opencode", at: "2026-09-01T09:47:13.931Z" }
---

# Gadgets, Code Storage, and Collaboration

A gadget is a small app whose entire source lives inside the workspace's Overseer Durable Object.
This page follows the code from storage (git objects), through the change stream (operational
transforms), to execution (workerd facets) and rendering (sandboxed iframe).

## Git object store, no refs

Mainline gadget code is a **real git object database** — SHA-1, zlib-deflated loose objects,
byte-identical to what `git` writes — held in the overseer's `gitObjects` typed-storage collection
(packages/workshop-backend/src/git-store.ts#L1-L28). There is deliberately no ref layer (no
branches/tags/HEAD): the "refs" are gadget records, blueprint records, and chats' pinned commits,
managed by overseer workflow; content addressing lets related histories deduplicate at the
blob/tree level, and the store uses only isomorphic-git's plumbing, never porcelain
(packages/workshop-backend/src/git-store.ts#L9-L22). Real git formats were chosen so gadget code
can later be exported to and imported from real repositories. There is no GC; the roots are
enumerable from gadget/blueprint records and chat pins (packages/workshop-backend/src/git-store.ts#L29-L38).
Accepted merges produce dangling objects by design, and `threeWayMerge()` is the store's own merge
implementation (packages/workshop-backend/src/git-store.ts#L484). Pre-git workspaces (Yjs code-log
documents) were migrated by synthesizing commit chains from the log (packages/workshop-backend/src/git-migration.ts#L1-L11).

## The code-change stream

Uncommitted work — human keystrokes, agent tool edits, merges from mainline — is expressed as a
sequence of `CodeChange`s against a revision, owned entirely by
`@gadgets/workshop-shared/code-change` (packages/workshop-shared/src/code-change.ts#L1-L21).
The text-OT substrate is `@codemirror/state`'s `ChangeSet` (compact-JSON wire form) with `fast-diff`
for change generation, both private to that module (packages/workshop-shared/src/code-change.ts#L12-L16,
types at L65-L126). The fixed priority convention: for concurrent changes against the same
revision, the change the **server ordered earlier comes first**, which is exactly ChangeSet's
transform law; only `transformCodeChange` may call the underlying `map`
(packages/workshop-shared/src/code-change.ts#L18-L24). Client changes pass two-stage validation in
a required order — `validateCodeChangeSchema` before any transform, `validateCodeChangeContent`
after transforming to the server's current revision — on top of capnweb-validate's wire-level
check (packages/workshop-shared/src/code-change.ts#L26-L38). Size caps: 512 KiB per file text,
1 KiB paths, 2 MiB per change record (packages/workshop-shared/src/code-change.ts#L126-L144).

## Chat content: pins, epochs, generations

A chat sees gadget code through one rule, `chatDocOwnsGadget`: the gadget is pinned in the chat or
has no committed code (so it lives only in that chat's stream); otherwise the chat reads mainline
head live (packages/workshop-backend/src/overseer.ts#L3946-L3958). The same split governs previews,
UI bundles, and the agent's file tools (`readGadgetFiles`, overseer.ts#L4146-L4157).

## The browser OT client

`otClient.ts` is the classic two-buffer client behind the code view: it derives chat content from
per-pin base trees plus the epoch's materialized changes plus accepted rows, holds at most one
in-flight `submitCodeChange()` plus one pending composition of newer local edits, and transforms
them over incoming remote rows. The pending buffer composes, so submissions land at ~RTT
granularity rather than per keystroke (packages/workshop-frontend/src/otClient.ts#L9-L18).
State arrives through three redundant, order-tolerant paths (`setDurableState`, `pushRow`,
`applyLocalChange`); rows dedupe by `(generation, revision)` and submits by a client-generated
`(clientId, seq)` idempotency scheme, and base content is never taken from another client — it
comes from `getCodeAtCommit` or the head tree already displayed
(packages/workshop-frontend/src/otClient.ts#L20-L40).

## Running a gadget: dynamic workerd facets

A gadget's `server.js` (and any other `.js` files) are loaded as a dynamic Worker through the
`LOADER` binding in `loadGadgetWorker()`: modules from the gadget's files, `globalOutbound: null`
(no network), `allow_irrevocable_stub_storage` for `ctx.restore()`, a `GadgetTailLoopback` tail
for logs, cached by a key including overseer id, code version, and gadget id (chat variants add
chat id + sequence) (packages/workshop-backend/src/overseer.ts#L3964-L4031). The gadget's Durable
Object facet is obtained via `ctx.facets` and **aborted and reloaded whenever the chat context
changes the code being run** — running "proposed changes" vs mainline is a live code swap
(packages/workshop-backend/src/overseer.ts#L4038-L4080).

## Rendering the UI: fully sandboxed iframe

`getUiBundle()` currently returns the gadget's `client.js` verbatim as `jsCode`
(packages/workshop-backend/src/overseer.ts#L4159-L4164; `UiBundle` type at
packages/workshop-shared/src/api.ts#L1418-L1440). The frontend renders it in a `srcDoc` iframe
with `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"`
(packages/workshop-frontend/src/GadgetUI.tsx#L494-L506). Because the iframe is origin-less,
Cap'n Web (dependency-free) is embedded as a *doubly-nested data URL* and prefixed to the gadget
code; the gadget gets an RPC stub to its server-side object through a `MessageChannel` handshake
posted to the parent, console methods are monkey-patched to forward logs upward, `window.open` is
blocked for programmatic popups (target=`_blank` links still work), and Escape presses are
forwarded to exit fullscreen mode (packages/workshop-frontend/src/GadgetUI.tsx#L12-L72).

## Live previews are display-only

While the agent streams `writeFile`/`editFile`/`executeCode` tool-call input, the streaming JSON
parser decodes target fields and emits provisional `AiChatStreamEvent`s; nothing here is durable —
the record of an edit is the change row appended when the tool call executes
(packages/workshop-backend/src/code-preview.ts#L1-L5).

## Export

Export is per-format and can be customized by the gadget itself: an optional `ExportHandler`
Worker entrypoint lists formats and produces server-mode exports, receiving only a capability stub
of the gadget DO (packages/workshop-backend/src/gadget-export.ts#L7-L20). Without a handler, a
gadget with `client.js` gets default formats; browser-mode formats (`text/html`, PDF, PNG, JPEG)
render through `env.BROWSER` (puppeteer) with bounded streams and deadlines
(packages/workshop-backend/src/overseer.ts#L4172-L4190,
packages/workshop-backend/src/browser-export.ts#L1-L20,
packages/workshop-backend/src/export-limits.ts).

## See also

- Persistence infrastructure behind all of this: [Persistence and Blueprints](../data/persistence-and-blueprints.md)
- How the agent edits code through the same stream: [Agent Runtime and Chat](./agent-runtime.md)
