---
type: "Reference"
title: "Sharing: Permission Graph and Lazy Revocation"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Sharing: Permission Graph and Lazy Revocation

Gadgets can be shared with other users either by direct add (owner or a collaborator enters a username) or via share links (`#share=<key>` fragments). Every collaborator has a role, roles are totally ordered (`build` > `use`), and a caller may never grant a role higher than their own effective role (src/sharing.ts:28-41, 305-308; docs/sharing.md:12-27).

## Ownership boundaries between collaborators

`build` collaborators differ from the owner in specific, deliberate ways: they cannot delete the gadget; they use their *own* AI models (BYOK bills whoever prompted); they add gatekeeper bindings through their *own* connected accounts (`OverseerClientInterface.newGatekeeper()` calls `clientUser.getGatekeeperClassFor()` rather than the owner's); and they can only remove users they themselves added (docs/sharing.md:19-24, 140-145). `use` collaborators get a restricted capability (`UseOverseerInterface`) exposing only the gadget UI, basic metadata, and presence — see [The Workspace Overseer](/openwiki/workshop/workspace-overseer.md).

## The permission graph

`SharingManager` (src/sharing.ts:152+) owns all manipulation of the `collaborators` and `shareKeys` collections and performs no RPC itself — anything needing a User DO stays in the Overseer (src/sharing.ts:1-7).

- **Edges**: each collaborator record carries `addedBy: PermissionEdge[]`. Two edge types: `user` (a specific sharer's profile.id, timestamp, role, optional note) and `shareKey` (the keyId of the share link redeemed — edges point at the *link*, so a link's multiple keys collapse to one grant; redeeming a second key of the same link is a no-op, src/sharing.ts:228-250).
- **Share links**: `ShareLinkRecord` keyed by the HMAC-SHA-256 hex of the raw key (the link id), carrying creator, role, and a soft-revocation flag; `ShareKeyAliasRecord` rows are copies minted when the user re-copies the link, pointing back at the link id (src/sharing.ts:47-119).
- **Key security**: the server generates a random key and stores only its HMAC-SHA-256 hash under a fixed 256-bit domain-separation key ("Not secret — it only provides personalization"); the raw key is never stored, so a storage leak does not expose valid links (src/sharing.ts:47-65). The raw key is shown to the creator only once at mint time (docs/sharing.md:38).
- **Revoked links** behave like unknown keys for redemption, but the record stays so graph edges keep resolving and revocation stays reversible (src/sharing.ts:230-234, 96-103).

## Effective role: fixed-point computation

`computeEffectiveRoles(opts)` is the single source of truth (src/sharing.ts:567-639). It optionally models a hypothetical change (`removedUser`, `removedEdge`, `revokedLinkId`) for the preview methods, then iterates to a fixed point: for each collaborator, each edge grants `min(edge role, sharer's effective role)` — the owner is the implicit root at `build`, share-link edges grant `min(link role, link creator's role)` — and each collaborator's role is raised to the maximum across their valid edges. Roles only increase, so the loop converges. Absence from the returned map means no access; downgrades appear as lower values.

Effective role is **never denormalized into storage** — it is recomputed live at every `open()` (src/sharing.ts:9-11, 203-205), which is what makes lazy revocation safe: severing an edge is enough to deny access at the next open, even though unreachable records linger.

## Lazy revocation, previews, and keepUsers

- **Removal** deletes only the edges granting the *target* access (the owner severs all incoming edges; a non-owner severs only their own `user` edge, and only if one exists). Outgoing edges (where the target is the sharer for others) are untouched — dependents simply become unreachable (src/sharing.ts:1-16; docs/sharing.md:84-90).
- **Link revocation** sets the `revoked` flag rather than deleting; copies (aliases) are deleted outright since no edge ever references an alias (docs/sharing.md:88).
- **Preview/confirm**: the UI calls `previewRemoveCollaborator`/`previewRevokeShareLink`, which run `computeEffectiveRoles` with the hypothetical input and diff against the baseline (`#computeAffected`) to report each `AffectedCollaborator` (old role → new role or null) before the destructive call (src/sharing.ts:354-357, 652-674).
- **`keepUsers`** re-roots spared dependents: after the edge is severed, `#reRootKeptUsers` appends a fresh `user` edge from the caller at each kept user's prior role, bounded by what the caller can grant (src/sharing.ts:676-689).
- **Listing** returns only currently-active collaborators — removed users are omitted and reappear if re-added (src/sharing.ts:269-287).

Because nothing is destructively pruned, revocation is reversible by re-adding the removed party (docs/sharing.md:92-94).

## Authorization and session termination

Authorization happens at `open()`: the caller's effective role is computed from the graph (owner = implicit `build` root); no role means `WORKSPACE_ACCESS_DENIED` (with no workspace metadata leaked), and the role selects which capability is handed back (src/overseer.ts:8320-8360; docs/sharing.md:147-151). A removed collaborator whose session was already open is forcibly disconnected: `removeCollaborator`/`revokeShareLink` call `scheduleRevocationRestart()` whenever the affected set is non-empty — it flushes storage with `ctx.storage.sync()` first (because `ctx.abort()` does not respect the output gate), waits ~100ms so the triggering RPC's response reaches the caller, then aborts the DO (src/overseer.ts:4998-5002). Each client's `notifyClosed` plumbing then kills its WebSocket and forces a reconnect, which re-runs `open()` against the changed graph (docs/sharing.md:153-157; src/server.ts:229-273). Granting access never strands anyone, and pure no-op removals don't restart the DO.

Redemption and opening are one atomic call: `openGadget(id, shareKey)` redeems the key inside `open()` so subsequent calls pipeline on the returned Overseer stub (src/overseer.ts:8330-8338; docs/sharing.md:44).

## Sharing vs. the lockdown flag

`prohibitAllSharing` intentionally does not live in this module: it is a broader "may this gadget communicate with anyone other than the owner?" policy (also gating gatekeeper writes and web fetches), enforced by the Overseer, which only asks this module `hasAnyShares()` — which must reflect *current reachability*, not mere table membership (src/sharing.ts:18-22, 164-179). An observation that would set the flag is blocked rather than applied if the gadget is already shared, so the flag only ever flips on an unshared gadget with no other sessions to evict (docs/sharing.md:159).

## Home page records

A shared gadget appears on a collaborator's home page only after they first open it: the overseer records it in the collaborator's User DO (`recordSharedGadgetOpen`) with cached title and owner profile, updates `lastActive` on each open, and dismissing it removes only the record — access is unaffected and reappears on next open (docs/sharing.md:46-52; src/overseer.ts:8362-8379).
