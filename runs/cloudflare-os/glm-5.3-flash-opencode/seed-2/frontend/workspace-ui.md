---
type: "Reference"
title: "Workspace UI: editor, chat, and actions"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-fde4086acc4fc940eae0dd2d
    resource: repo://packages/workshop-frontend/src/ChatInterface.tsx
  - id: openwiki-source-82e191e18e0b3dd9436c5ce5
    resource: repo://packages/workshop-frontend/src/CodeEditor.tsx
  - id: openwiki-source-ab95f77aee41e7ee57caa318
    resource: repo://packages/workshop-frontend/src/GadgetEditor.tsx
  - id: openwiki-source-621b56f84037e3de99b7a3e2
    resource: repo://packages/workshop-frontend/src/otClient.ts
  - id: openwiki-source-6cd90fefb7d01e8cda9695d7
    resource: repo://packages/workshop-frontend/src/routes/workspace.%24id.tsx
  - id: openwiki-source-80057548dde8599ce9598f2c
    resource: repo://packages/workshop-frontend/src/ShareModal.tsx
  - id: openwiki-source-f74f84eac93a8762cd13c496
    resource: repo://packages/workshop-frontend/src/useActionHistory.ts
  - id: openwiki-source-a785df1d3a3014d5295dc713
    resource: repo://packages/workshop-frontend/src/useActions.ts
  - id: openwiki-source-64580531bd1032a83531d865
    resource: repo://packages/workshop-frontend/src/useAutoApproval.ts
  - id: openwiki-source-6c0825db60ac847fe18a7bf9
    resource: repo://packages/workshop-frontend/src/useResolveAction.ts
  - id: openwiki-source-911ff8ecac80ecdb084e2b11
    resource: repo://packages/workshop-frontend/src/useWorkspaceOpen.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Workspace UI: editor, chat, and actions

`/workspace/$id` is a thin route wrapper around `GadgetEditor`
(`packages/workshop-frontend/src/routes/workspace.$id.tsx:20-28`): its search params carry the
selected chat (`chat`) and workpiece (`w`; parsing must not treat `0` as absent, since workpiece IDs
start at 0). The editor splits the screen: the chat interface on one side and an
App/Code/Connections tab set on the other (`GadgetEditor.tsx:155-178`, `1658`, `1720`).

## Code editing as operational transform

Editing is collaborative by construction. The chat's uncommitted code is one revisioned change
stream (see [code storage](/openwiki/kernel/code-storage.md)); the client side of that stream is
`ChatOtClient` in `src/otClient.ts`:

- It is the classic **two-buffer OT client**: at most one in-flight `submitCodeChange()` plus one
  pending composition of newer local edits, both transformed against incoming remote rows and
  rebased. The pending buffer *composes*, so submissions land at round-trip granularity —
  everything typed since the last ack rides one submission, not per keystroke
  (`otClient.ts:9-38`).
- State arrives through three independent paths, each safe to deliver redundantly or out of order:
  `setDurableState()` (chat metadata + epoch changes, also how generation bumps are learned —
  a content-preserving bump hands local buffers across the boundary, a destructive one discards
  them), `pushRow()` (a `changeApplied` subscription row, deduped by `(generation, revision)` so
  subscribe-replay after reconnect is harmless), and `applyLocalChange()`
  (`otClient.ts:19-38`).
- Local submissions carry a client-generated `(clientId, seq)` idempotency pair; a transport
  failure **retries the same seq with an identical payload** — never a re-composed change, because
  the server's dedupe digest requires it (`otClient.ts:36-38`, `113-115`).
- Base content is never taken from another client: it always comes from `getCodeAtCommit` (cacheable
  by oid) or, for the first edit to an unpinned gadget, from the head tree already displayed, which
  is byte-identical to the pin declaration the edit mints (`otClient.ts:33-38`).
- `GadgetCodeInterface` owns one `ChatOtClient` per open chat and renders the file sidebar plus
  diff statuses from the client's content (`GadgetCodeInterface.tsx:26-33`, `273-280`).

`CodeEditor` (`src/CodeEditor.tsx`) is CodeMirror with an `EditSession` bound to the client.
Notable details: documents split only on `"\n"` (`EditorState.lineSeparator`) so CR/CRLF sequences
survive the round trip — the OT stream's changes are offsets into the exact stored text, and the
default splitter would silently normalize them away, desynchronizing the first edit
(`CodeEditor.tsx:130-136`). Remote changes are dispatched with a `remoteChange` annotation and
excluded from local undo history (`CodeEditor.tsx:97-105`).

## Merge and revert

Accepting a chat's proposed changes is `overseer.mergeChanges(chatId)`; accepting is only ever a
fast-forward, so a stale result (mainline moved again) sends the client into the update-from-
mainline flow before a retry can succeed (`ChatInterface.tsx:6080-6087`;
`packages/workshop-shared/src/api.ts:1994-2057`). Reverting is
`overseer.revertChanges(chatId, revertFrom)`, including the whole-draft case
(`revertChanges(0)`) (`ChatInterface.tsx:6164-6166`, `6274`).

## The chat interface

`ChatInterface.tsx` (the largest frontend module) implements the `AiChatSubscriber` contract:

- `subscribeToChat()` is called without awaiting — the subscription stub resolves when the client
  disconnects — and subscribe-replay redelivers every retained row, which the client dedupes
  (`ChatInterface.tsx:5360-5468`, `5706-5709`).
- Provisional `AiChatStreamEvent`s (text deltas, tool-call previews, edit previews) are displayed
  and discarded once the durable message/row lands or the agent stops (`api.ts:3243-3367` defines
  the contract; the compaction events surface the "compacting" state).
- The composer integrates slash commands (a picker backed by `collectSlashCommands`, with per-
  command input widgets in `components/chat/SlashCommandPicker.tsx`) and the CapsuleOverlay URL
  picker for granting resources (see [the iframe page](/openwiki/frontend/gadget-iframe.md)).

## The action log and approvals

`useActions` (`src/useActions.ts`) is a ref-counted store per `Overseer` stub, shared by all
consumers of the same stub:

- On first acquire it **registers the live subscription first, then pages pending records** via
  `listActions({filter: 'pending'})`. This ordering relies on Cap'n Web's e-order guarantee: the
  subscriber is registered server-side before the first page read, so pages (which snapshot
  call-time state) and live updates cover every record with live-wins fold semantics
  (`useActions.ts:5-16`, `181-217`).
- Settledness means *pages drained AND the subscribe call resolved* — a store whose live stream
  died must never present as ready (`useActions.ts:171-180`, `213-217`).
- `linkActionLog(overseer, key)` parks a **resume watermark**: a settled store records its last
  change time per workspace key, and the next store with the same key subscribes with
  `startAfter` so the server replays the gap (inclusive, as upserts) — per-record consumers are
  patched without refetching. A failed session never parks a watermark, so the next swap replays
  its whole gap (`useActions.ts:56-77`, `220-233`).
- `useActionHistory` demand-loads resolved history one page at a time (newest first by id) and
  merges live subscription updates for records inside the loaded window; it never treats
  `startAfter` as an enumeration API (`useActionHistory.ts:14-47`).

Approvals: `useResolveAction` maps a decision to `overseer.approveAction(id)` /
`rejectAction(id)` (`useResolveAction.ts:6-22`); reverting an applied action is offered by the
server via `revertAction` semantics (see
[the approval-queue page](/openwiki/security/approval-queue.md)).

Auto-approval settings (`useAutoApproval`) merge the gatekeepers' declared `PreApprovableAction`
catalog with the workspace's enabled rules; orphaned rules (their gatekeeper gone) stay visible so
a standing grant can always be revoked. Toggling is optimistic, with a toast on failure and a
refresh afterwards (`useAutoApproval.ts:7-19`, `73-128`).

## Sharing

`ShareModal.tsx` drives the sharing RPCs: creating a link returns `{key, linkId}` and the UI builds
`${origin}/workspace/<id>#share=<key>` — the key is shown once and lives only in the URL fragment
(`ShareModal.tsx:592-622`). Removal/revocation is two-phase: `previewRemoveCollaborator` /
`previewRevokeShareLink` return the dependents who would lose access, then the confirm call passes
`keepUsers` chosen by the user (`ShareModal.tsx:649-663`, `719-733`). On the open side,
`useWorkspaceOpen` reads `#share=` from the hash and passes it to `openGadget(id, shareKey,
configureObservers)`, so redemption and opening are one round trip and subsequent calls pipeline on
the returned stub (`useWorkspaceOpen.ts:93-119`).
