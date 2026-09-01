---
type: subsystem
title: Gadget Runtime — Sandboxes, Code Storage, Editing
description: How a gadget's server runs as a facet-backed Dynamic Worker with bindings-only outbound access, how its client runs in a fully sandboxed iframe over a postMessage RPC channel, and how code changes merge (OT) and persist (git object store, typed-storage).
tags: [gadget, sandbox, durable-objects, yjs, git, operational-transform]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-2ff4e6e9c3b33db64168e2c8
    resource: repo://packages/typed-storage/src/index.ts
  - id: openwiki-source-e50fc090c66f86813abd949a
    resource: repo://packages/workshop-backend/src/git-store.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-f7b4c5d84fc7444eaadafee7
    resource: repo://packages/workshop-frontend/src/GadgetUI.tsx
  - id: openwiki-source-567e8af8974648e0754d5d1f
    resource: repo://packages/workshop-shared/src/code-change.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Gadget Runtime — Sandboxes, Code Storage, Editing

A gadget is a small app: a `server.js` that is really a Durable Object class, and a `client.js` that runs in the browser. Both sides live in sandboxes with no ambient network access; everything crosses the boundary through the Workshop. This page covers the runtime mechanics; workspace/chat state lives in [Overseer: The Workspace Durable Object](/openwiki/architecture/overseer-workspace.md), and the security intent in [Capability Security Model](/openwiki/security/capability-model.md).

## Server side: facet + Dynamic Worker

The gadget's server is a Durable Object *facet* of its workspace's Overseer DO. `getGadgetFacetFetcher` loads it via `this.ctx.facets.get(facetName, ...)` with the class taken from `stub.getDurableObjectClass("Gadget")` — the class the gadget's code exported under the mandatory name `Gadget` (packages/workshop-backend/src/overseer.ts:4029-4082).

The facet is not a normal deployed worker; it is *dynamic*: `loadGadgetWorker` builds a `WorkerLoader` code definition from the gadget's `.js` files (`mainModule: "server.js"`), with **`globalOutbound: null`** — the gadget server cannot `fetch()` the internet at all — a `GadgetTailLoopback` tail for log/exception forwarding, and the `allow_irrevocable_stub_storage` flag so `ctx.restore()` works (packages/workshop-backend/src/overseer.ts:3965-4027). Loads are cached by `LOADER.get(cacheKey, ...)` keyed on `${overseerId}.${codeVersion}[.${chatId}.${sequence}].${gadgetId}`: every merge bumps the overseer-wide `codeVersion` counter, so head movement invalidates the cached load (packages/workshop-backend/src/overseer.ts:3978-3997).

Which code runs depends on context:

- **Mainline**: files read from the gadget's head commit in the git store;
- **A chat's proposed changes**: a per-chat facet is loaded instead — and switching which chat's proposal runs (or switching back to mainline) *aborts* the facet first, tracked in `#runningChatIds`, because the running code is literally changing (packages/workshop-backend/src/overseer.ts:4035-4075).

The facet's `env` is built by `getEnvForLoader`: a `GADGET` self-stub plus each *visible* named binding, where every binding is a `GatekeeperLoopback`/`GadgetLoopback` entrypoint carrying a `GatekeeperCaller {from: "gadget", chatId, gadgetId}` — so gatekeepers know exactly who is calling and can enforce observer rules. Binding edges provisional to *another* chat are invisible (packages/workshop-backend/src/overseer.ts:2719-2745).

## Client side: iframe + postMessage RPC

The Workshop fetches the gadget UI as a `UiBundle { jsCode }` — currently just the raw `client.js` (bundling is a TODO) (packages/workshop-backend/src/overseer.ts:4159-4164; `GadgetClient.getUiBundle` at :10837). The frontend then embeds it in a `srcDoc` iframe whose CSP is `default-src 'none'` with data:-URL scripts only, and `sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"` (packages/workshop-frontend/src/GadgetUI.tsx:105-117, 493-503).

Because the frame is origin-less and network-less, the Cap'n Web library itself is shipped as a **nested data URL** injected ahead of the gadget's code (base64 inner, URL-encoded outer). The injected prefix (packages/workshop-frontend/src/GadgetUI.tsx:16-125):

- opens an RPC session over a `MessageChannel` port handed to the parent via a `"handshake"` postMessage;
- monkey-patches `console.*` to forward logs to the parent (that's what powers the gadget console panel);
- replaces `window.open` with a block ("use a `target=\"_blank\"` link instead") and force-adds `rel=noopener` to such links;
- forwards Escape keypresses and captures uncaught errors/rejections as parent log messages.

Parent-side, the handshake handler accepts a message only when `event.source` is its own iframe and `event.origin === "null"` (paranoia against the frame having browsed away), then calls `GadgetClient.connectToGadget(chatId)` — which returns the *server facet stub*, wrapped in a Proxy that makes it look like an RpcTarget because facet stubs can't yet cross RPC (packages/workshop-frontend/src/GadgetUI.tsx:326-360; packages/workshop-backend/src/overseer.ts:4084-4110, 10841-10850). The gadget's client calls therefore land directly on its server DO methods. If the gadget server is replaced (code reload/reconnect), the redirectable-proxy swaps the underlying stub without reloading the frame.

Exports complete the picture: server-mode formats call the gadget's optional `ExportHandler` entrypoint; browser-mode formats (HTML/PNG/JPEG/PDF) render the same client bundle in the `BROWSER` binding (packages/workshop-backend/src/overseer.ts:4166-4198).

## Uncommitted edits: the code-change OT model

Uncommitted state is a per-chat stream of `CodeChange`s on top of committed code. The shared module `packages/workshop-shared/src/code-change.ts` is the *single owner* of these invariants (packages/workshop-shared/src/code-change.ts:1-55):

- a `TextChange` is `@codemirror/state` ChangeSet's compact JSON form tiling the entire original text (so before/after lengths are by construction); `FileChange` is one of `{edit}` (valid only against matching existing text), `{set}` (create/replace, valid against any state), `{remove}` (idempotent); a `CodeChange` maps gadget ids to per-file lists. `@codemirror/state` and `fast-diff` are deliberately private to this module;
- the **priority convention**: for concurrent changes against the same revision, the server-ordered-earlier change goes first — `A.compose(B.map(A)) == B.compose(A.map(B, true))`, and only `transformCodeChange` may call the underlying `map`;
- two-stage validation: schema first (structural transform must only see well-formed changes), content checks after transforming to the current revision; the RPC edge (`Overseer.submitCodeChange`) is already validated by capnweb-validate, so these stages check what TypeScript can't express (canonical keys, path rules, size caps);
- size caps exist for correctness (composed changes get stored in records and travel in RPC messages): max 512K UTF-16 units per file text, 1KB paths, 2MB serialized per change (packages/workshop-shared/src/code-change.ts:120-160).

User keystrokes flow through `submitCodeChange` -> live rows -> periodic `materializeChatChanges`, which turns accumulated rows into durable "changes" chat messages, preserving per-author attribution and bounding composed-message size (packages/workshop-backend/src/overseer.ts:620-700, 2858-2900, 3068-3210). The agent's tool edits follow the same stream but buffer per step (see [Agent Runtime](/openwiki/architecture/agent-runtime.md)).

## Committed code: a real git object store

`GitStore` (packages/workshop-backend/src/git-store.ts:1-52) stores gadget history as a real git object database — SHA-1, zlib loose objects, byte-identical to `git` — inside a `gitObjects` typed-storage collection, using isomorphic-git's *plumbing only* (porcelain `commit`/`merge` can't express this workflow). Design decisions recorded in the header:

- **No ref layer**: "refs" are the gadget records (`commitId` head), blueprint records, and chats' pinned commits — so unrelated histories coexist and related ones (forks, blueprint siblings) deduplicate at blob/tree level;
- loose objects only; one record per object; GC is deliberately absent, with the enumerated roots (records, pins, checkpoint pin declarations, `observedCommit` stamps) documented for whoever adds it;
- byte-format fidelity exists so gadget code can later round-trip through real git repos and agents can mount repos through gatekeepers (the `git-migration.ts` and `plans/git-storage.md` history backs the transition from Yjs-only storage).

Merging uses `threeWayMerge` over `diff3` with explicit conflict reporting rather than git's merge (packages/workshop-backend/src/git-store.ts:446-535), feeding the merge/"conflictPaths" chat messages the agent replay and the UI both consume.

## typed-storage: the collection layer

All DO state (User, Overseer, gatekeepers, AdminSettings) sits on `@gadgets/typed-storage`: `createTypedStorage` maps a schema of collections (primary key + optional unique/non-unique indexes, prefix/range/limit listing, subscribers) and singleton defaults onto raw `DurableObjectStorage` (packages/typed-storage/src/index.ts:64-180, 668-725). It is the one package that emits real `dist` output (its `exports` resolve to build artifacts) while everything else is bundled from source (root `package.json`; see [Build System and Toolchain](/openwiki/development/build-tooling.md)). A gotcha the API documents: indexes are maintained **only at write time**, so a newly declared index over pre-existing records starts empty and must be `rebuild()`ed by a migration before those records are touched (packages/typed-storage/src/index.ts:84-91).

## Failure behavior

- A failed tool call or mid-step crash leaves the step's buffered edits unmaterialized — replay never sees them (step transactionality; barrier invariant).
- If a chat's proposed facet fails to start, startup errors surface through `verify()`-style checks and tail-loopback exception forwarding to the console panel rather than silently killing the mainline gadget.
- RPC drops to the gadget server settle as connection resets in `GadgetUI`, which reloads the iframe or offers retry (a 20 s load timeout converts a dropped idempotent RPC into a retry button rather than a permanent spinner) (packages/workshop-frontend/src/GadgetUI.tsx:132-133, 280-300).

## Uncertainty

- The per-call latency/caching characteristics of workerd facets and `ctx.facets` are not established by this repo's source beyond the comments cited above.
- `plans/git-storage.md` is a design plan, not an operational contract; current behavior is what `git-store.ts` and `overseer.ts` implement.
