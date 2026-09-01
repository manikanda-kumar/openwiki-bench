---
type: "Reference"
title: "Sharing: collaborators, permission graph, and share links"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Sharing: collaborators, permission graph, and share links

Gadgets are shared two ways: **collaborators** (direct access alongside the owner, this page) and
**blueprints** (code snapshots others instantiate — see
[blueprints](/openwiki/kernel/blueprints.md)).

## Roles and what they allow

Roles are totally ordered: `build` > `use` (`docs/sharing.md:12-17`).

- **`build`** — full access: edit code, use the AI chat, manage bindings, interact with the UI —
  the same as the owner except: cannot delete the gadget; uses their **own AI models** (BYOK bills
  whoever prompted); uses their **own connected accounts** for new bindings
  (`newGatekeeper` calls `clientUser.getGatekeeperClassFor`, not the owner's); and limited
  revocation authority (can only remove users they themselves added).
- **`use`** — may only render and interact with the deployed UI (`getUiBundle`,
  `connectToGadget`, restricted metadata, presence) plus two inert telemetry subscriptions; every
  other `Overseer` method throws `Unauthorized`. Authorization is capability-based: `open()` hands
  `use` sessions a `UseOverseerInterface` that `implements Overseer` and default-denies everything
  outside the allowlist — a new interface method fails to compile until a use-role decision is
  made (`docs/sharing.md:28-30`).

A caller may never grant a role higher than their own effective role — enforced in the sharing
manager for both direct adds and link copies (re-checked at copy time, since the caller's role may
have dropped since the link was created) (`sharing.ts:434-471`).

## The permission graph

Each collaborator record carries **permission edges** explaining how they gained access: a `user`
edge (a specific sharer added them, with timestamp/role/note) or a `shareKey` edge (they redeemed a
key of a specific link; role comes from the link). Multiple edges accumulate; a collaborator keeps
access while at least one valid edge remains. The **owner is the implicit root at `build`** and is
never stored in the table (`docs/sharing.md:54-81`; `sharing.ts:68-108`).

**Effective role** is the maximum role reachable from the owner through valid edges, computed live
by `computeEffectiveRoles()` — never denormalized. Each edge grants `min(edge role, sharer's
effective role)`; a share-link edge's "sharer" is the link's creator, so a link is a first-class
graph node: if its creator loses access, the link is transitively revoked
(`sharing.ts:552-639`). The algorithm is a fixed-point iteration (roles only increase, so it
converges), handling diamonds, cycles, and deep chains; optional hypothetical inputs
(`removedUser`, `removedEdge`, `revokedLinkId`) power the preview methods. It is the **single
source of truth** — `open()`, `hasAnyShares()`, listings, and previews all derive from it, which
is what makes lazy revocation safe: severing an edge is enough to deny access even though
unreachable records linger (`docs/sharing.md:98-100`, `147-152`).

## Share links and key security

Creating a link mints its first key; the link **is** that first key's record (keyed by the key's
HMAC), and each later "copy" stores only an `alias` pointing back — so all of a link's keys
collapse to one grant. The raw key is 128 bits, shown once at mint time, and **never stored**: only
its HMAC-SHA-256 (with a domain-separation constant) is persisted, so a storage leak exposes no
valid keys. Redemption adds a `shareKey` edge toward the link; a revoked link behaves like an
unknown key (`docs/sharing.md:38-44`; `sharing.ts:110-264`, `474-481`).

## Lazy revocation

Revocation **severs edges and lets reachability do the rest** — nothing cascades:

- **Removing a collaborator** deletes the edges granting *them* access (the owner severs all
  incoming edges; a non-owner only their own user edge). Their record is retained even when empty,
  and edges where they are the *sharer* of others are left untouched — dependents simply become
  unreachable and are denied at `open()`.
- **Revoking a link** sets the `revoked` flag (record and edges stay intact; no dangling
  references); its alias copies are deleted outright since no edge references an alias
  (`sharing.ts:509-547`; `docs/sharing.md:85-90`).

Because nothing is destructively pruned, revocation is **reversible**: re-adding someone restores
their reachability and, transitively, everyone below them. Listing RPCs return only currently
active entries (`docs/sharing.md:92-96`).

**keepUsers** is optional re-root sugar: after severing, any listed user who would lose access or
be downgraded gets a fresh `user` edge from the caller at their prior role (bounded by what the
caller can grant) — pure convenience over the lazy model (`sharing.ts:676-706`).

## Preview and confirm, then terminate sessions

Removal/revocation is two-phase in the UI: `previewRemoveCollaborator`/`previewRevokeShareLink`
run the fixed-point computation with the hypothetical change and return the `AffectedCollaborator`s
(old role → new role/null), letting the UI warn "removing Bob will also cut off Carol" before the
confirm call (`sharing.ts:509-518`, `652-674`; `docs/sharing.md:123-128`).

Because authorization is checked only at `open()`, a session that is already open would otherwise
outlive a removal. So when a change actually removed or downgraded someone, the overseer
**restarts the DO via `ctx.abort()`** — after flushing the severed edge with `storage.sync()`
(the abort does not respect the output gate) and delaying ~100 ms so the triggering response
reaches the caller first. Every client reconnects and re-runs `open()`; removed users land on the
terminal access-denied page and downgraded users get their reduced capability
(`docs/sharing.md:153-159`; `overseer.ts:10423-10461`).

`prohibitAllSharing` interacts simply: an observation that would set the flag is *blocked* (not
applied) if the gadget is already shared, so the flag only ever flips on a gadget with no other
sessions to evict (`docs/sharing.md:159`; `overseer.ts:4447-4456`).
