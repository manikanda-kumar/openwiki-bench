---
type: sharing
title: "Sharing and Collaboration"
description: How workspaces are shared — collaborator roles (build/use), share links and their HMAC-hashed keys, the permission graph with lazy revocation, preview/confirm removals, live-session termination on revocation, and per-collaborator resource isolation.
tags: [sharing, permissions, collaboration, share-keys, revocation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T04:46:04.795Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
generated: { by: "opencode", at: "2026-09-01T04:46:04.795Z" }
---

# Sharing and Collaboration

Gadgets are private by default and shared two ways: **collaborators** (direct access to a workspace) and **blueprints** (code snapshots others instantiate independently — see [Blueprints](/openwiki/backend/blueprints.md)). `packages/workshop-backend/src/sharing.ts` owns all manipulation of the `collaborators` and `shareKeys` collections and the permission graph; it deliberately performs **no RPC** — anything needing a user DO stays in the overseer, which passes resolved values or callbacks in (packages/workshop-backend/src/sharing.ts:1-9).

## Roles

Roles are totally ordered, `build > use` (packages/workshop-backend/src/sharing.ts:29-33):

- **`build`** — full access: edit code, use AI chat, manage bindings, interact with the UI — the same as the owner except that a build collaborator cannot delete the gadget, uses **their own AI models** (BYOK billing goes to whoever prompted the agent), connects bindings through **their own** third-party accounts, and can only revoke users they themselves added (docs/sharing.md:12-38).
- **`use`** — render and interact with the deployed UI only: `getUiBundle()`/`connectToGadget()` against mainline, restricted metadata, presence; everything else on the `Overseer` interface throws `Unauthorized`, with two deliberately inert exceptions (`subscribeToConsoleLogs`, `subscribeToActions` return never-delivering subscriptions so speculative editor hooks don't error) (docs/sharing.md:14-23).

Authorization is **capability-based**: `open()` computes the effective role and hands back a different object — full `OverseerClientInterface` for build/owner, restricted `UseOverseerInterface` for use. Because the use class `implements Overseer`, any newly added interface method fails to compile until a developer consciously decides whether use callers may invoke it — default-deny by type system (docs/sharing.md:40-46, packages/workshop-backend/src/overseer.ts:8382-8391).

## Granting access

Two paths (docs/sharing.md:50-67):

- **Direct add**: the sharer enters a username; the user DO is looked up and a collaborator record created. No in-product notification — sharing is out-of-band.
- **Share link**: a link encodes a secret key in the URL as `#share=<key>`. A link owns one or more keys (creating mints the first; "copying" mints an alias key for the same link). The raw key is shown once at mint and **never stored server-side** — the server keeps only an HMAC-SHA-256 of the key (with a fixed domain-separation constant, `SHARE_KEY_HMAC_KEY`), so a database leak cannot expose valid keys. Redemption adds a `shareKey` edge pointing at the *link* (all of a link's keys collapse to one grant); a revoked link behaves like an unknown key (packages/workshop-backend/src/sharing.ts:41-67, 219-250).

Redemption and opening happen atomically in one RPC (`openGadget(id, shareKey)`), letting further calls pipeline on the returned `Overseer` stub (docs/sharing.md:73-75, packages/workshop-shared/src/api.ts:461-479).

## The permission graph

Every collaborator carries **permission edges** recording how they got access — a `user` edge (sharer, timestamp, granted role) or a `shareKey` edge (the link's id; role from the link). The **effective role** is the maximum role reachable from the owner through valid edges, where each edge grants `min(edge role, sharer's effective role)`; the owner is the implicit `build` root and is never stored in the collaborators table. Effective role is computed **live, never denormalized** — recomputed from scratch at every `open()` (docs/sharing.md:81-105, packages/workshop-backend/src/sharing.ts:199-206).

## Lazy revocation

Revocation severs edges; nothing cascades (packages/workshop-backend/src/sharing.ts:5-19, docs/sharing.md:107-131):

- Removing a collaborator deletes the edges granting *them* access (owner severs all incoming edges; a non-owner only their own `user` edge, and only if one exists). Their record is retained even when empty; edges where they are the *sharer* of others' access are untouched.
- Revoking a share link sets its `revoked` flag rather than deleting it, so graph edges stay intact (no dangling references) and access is restorable; alias copies are deleted outright since nothing references them.

Users who lose their only path simply become **unreachable and are denied at open()** — no separate cleanup. Because the graph is never destructively pruned, revocation is reversible: re-adding a removed collaborator restores them and transitively everyone they had shared with. Dead records accumulate; listing RPCs return only currently-active entries (docs/sharing.md:107-131).

## Preview, confirm, and re-rooting

The core of revocation is `computeEffectiveRoles()` — a fixed-point role-propagation computation that accepts hypothetical inputs (`removedUser`, `removedEdge`, `revokedLinkId`, `overrides`) so the same algorithm powers **preview** (`previewRemoveCollaborator` / `previewRevokeShareLink` return the `AffectedCollaborator`s whose access would change) and **confirm** (`removeCollaborator` / `revokeShareLink` return the actually-affected set, each carrying `oldRole`/`newRole` with `newRole === null` meaning full removal) (docs/sharing.md:112-152, packages/workshop-backend/src/overseer.ts:10422-10427). `keepUsers` optionally re-roots specific dependents by appending a fresh `user` edge from the caller at their prior role (docs/sharing.md:130-138).

## Terminating live sessions

Authorization is only checked at `open()`, so a removal that actually removed or downgraded someone **restarts the overseer DO via `ctx.abort()`** — every client reconnects, re-runs `open()`, and removed users land on the terminal access-denied page. Two precautions: the severed edge is flushed with `ctx.storage.sync()` first (because `ctx.abort()` does not respect the output gate), and the abort is delayed ~100 ms so the triggering RPC's response reaches the caller before their own connection drops. The disconnect reaches browsers through the `notifyClosed` plumbing (docs/sharing.md:166-181).

Listing reconciliation is fanned out to affected collaborators' user DOs in batches — `forgetSharedGadget` for full removals, `updateSharedGadgetRole` for downgrades — with per-batch failures logged but not fatal (packages/workshop-backend/src/overseer.ts:7827-7847).

## Home-page records and isolation

A shared gadget appears on a collaborator's home page only after their first open, via `recordSharedGadgetOpen` (cached title + owner profile; `lastActive` updates per open). Dismissing the entry removes the record but not access; a revoked collaborator's stale entry stays until they dismiss it or hit the access-denied open (docs/sharing.md:77-88, packages/workshop-backend/src/user.ts:469-514).

Resource isolation prevents implicit cross-access: AI-model bindings resolve from the **creator's** account (full `AiModelConfig` including API key baked into binding props), agent spawners store the creator's user id for trigger-time model resolution, and gatekeeper bindings connect through the creating collaborator's third-party accounts (`newGatekeeper()` calls `clientUser.getGatekeeperClassFor()`, not the owner's) (docs/sharing.md:146-155).

## The prohibitAllSharing policy

`prohibitAllSharing` is deliberately **not** part of the sharing module: it is a broader "may this gadget communicate with anyone but the owner?" policy that also gates gatekeeper writes and web fetches, enforced by the overseer. The sharing module only exposes `hasAnyShares()`, which reports *current reachability* (live edges or un-revoked links), not mere table membership (packages/workshop-backend/src/sharing.ts:21-25, 162-177).

## Related pages

- [OverseerDurableObject: Workspaces and Chats](/openwiki/backend/overseer.md) — the open() handshake and session restart.
- [Gatekeeper Connection Lifecycle and Policy](/openwiki/gatekeepers/lifecycle.md) — the per-user account chokepoint behind binding isolation.
