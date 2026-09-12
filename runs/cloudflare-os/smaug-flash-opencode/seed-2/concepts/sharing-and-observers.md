---
type: concept
title: "Sharing and Observers"
description: Collaborator roles, the permission-graph model with lazy revocation, share links, the observer enforcement mechanism that gates data leaks on shared gadgets, and the terminate-session-on-revoke path.
tags: [sharing, collaboration, permission-graph, observers, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Sharing and Observers

Sharing lets a user collaborate on a gadget with others. Two mechanisms exist: **collaborators**
(granting access so others can work on the same gadget) and **blueprints** (sharing source so others
stamp out independent gadgets). This page covers the collaborator/observer system; blueprints live
on a separate page.

`docs/sharing.md` is the narrative source; `src/sharing.ts` is the authoritative implementation of
the permission graph; `docs/observers.md` + `overseer.ts` cover the observer mechanism
(including the per-gatekeeper strategy table).

## Collaborator roles

A collaborator is a user who has direct access to a gadget they do not own. Each has a **role**,
totally ordered (`build` > `use`):

- **`build`** — full access: edit code, use AI chat, manage bindings, interact with the gadget UI.
  Differs from the owner by: cannot delete the gadget; uses **their own** AI models (BYOK billing
  to whoever prompted); uses **their own** connected accounts for bindings they add (preventing them
  from reaching the owner's accounts); and has limited revocation authority (can only remove users
  they themselves added).
- **`use`** — may only render and interact with the gadget's deployed UI: `getUiBundle()` and
  `connectToGadget()` (no chatId), restricted `getMetadata`/`subscribeToMetadata` (id/title/owner/
  role), and `subscribeToPresence`. Every other Overseer method throws `Unauthorized`, except two
  inert subscriptions (`subscribeToConsoleLogs`, `subscribeToActions`) that never deliver data.

Authorization is capability-based: `open()` computes the caller's effective role and returns either
the full `OverseerClientInterface` or a restricted `UseOverseerInterface` that `implements Overseer`
and throws for everything outside the allowlist (default-deny, so a newly-added interface method
fails to compile until a developer decides).

A caller may never grant a role higher than their own effective role Health\implementation (`docs/sharing.md` §Auth
limitation: only `build` and owner can share).

## The permission graph

The system tracks **how** each collaborator gained access — a directed graph of edges from the owner:

- **User edge**: a specific sharer (identified by `profile.id`) directly added this collaborator,
  with a timestamp and the granted role.
- **Share-link edge**: this collaborator redeemed a key for a specific share link; the granted role
  comes from the link.

Each edge grants `min(edge role, sharer's effective role)` (owner is the implicit `build` root).
Effective role is the **maximum** across a collaborator's valid edges, computed **live** by
`SharingManager.computeEffectiveRoles()` — a fixed-point loop that raises roles by iterating until
convergence (roles only ever increase), handling diamonds, cycles, and deep chains. It is the single
source of truth used by `open()`, `hasAnyShares()`, and the preview methods
(`docs/sharing.md` §"Effective-role algorithm").

## Share links

A share key is a 128-bit random value in the URL as a `#share=<key>` fragment. The server stores
only its **HMAC-SHA-256 hash** (fixed domain-separation constant `SHARE_KEY_HMAC_KEY`), so a
database leak doesn't expose valid keys and the server can't reconstruct links. A link is its first
key; the `shareKeys` table holds one row per key, the link's row carrying the metadata and serving
as the link id, and each later "copy" storing only an alias back to it. All of a link's keys resolve
to the same link node so redemption yields one edge. Redemption + gadget opening are atomic in a
single RPC call (`openGadget(id, shareKey)`) for pipelining.

## Lazy revocation

Access is determined by **reachability from the owner**, recomputed live at every `open()`. Revocation
is **lazy**: removing a collaborator only severs the edges granting *them* access (owner severs all
incoming edges; non-owner only their own user edge); revoking a share link sets a `revoked` flag
instead of deleting it. Nothing cascades — a dependent who loses their only path simply becomes
unreachable and is denied at open timechers. Because the graph is never destructively pruned,
revocation is **reversible** (re-adding restores everyone transitively). `keepUsers` lets a caller
spare specific dependents. `removeCollaborator`/`revokeShareLink` return the affected set via a
before/after diff of `computeEffectiveRoles` (`AffectedCollaborator` with `oldRole`/`newRole`,
`null` = full removal), and the UI uses a two-phase **preview/confirm**.

## Terminating live sessions on revocation

Because authorization is only checked at `open()`, a session already open is not re-checked per
message. To close the gap, `removeCollaborator`/`revokeShareLink` proactively **restart the Overseer
DO** via `ctx.abort()` whenever the change actually removed or downgraded someone (`scheduleRevocationRestart`).
Precautions: the severed edge is flushed with `ctx.storage.sync()` first (abort doesn't respect the
output gate), and the abort is delayed ~100 ms so the triggering RPC's response reaches the caller
first. Each reconnecting client re-runs `open()` against the now-changed graph — removed users hit
the terminal access-denied page, downgraded users get the reduced capability.

## Observer enforcement (anti data-leak)

The observer mechanism enforces the core invariant: *if a gadget can read restricted data, any user
who can't read it is prohibited from interacting with the gadget* (`docs/observers.md` §1).

- **Observers** — every non-owner who can see data the gadget read. When a user becomes an observer,
  each relevant gatekeeper is asked, via `Gatekeeper.addObserver()`, to verify that this person can
  directly observe *everything the gadget has already read through that gatekeeper*. The gatekeeper
  is the authority on its own resource's ACL.
- **Verifiers** — the prospective observer's *own* connected account mints an opaque
  `GatekeeperUserVerifier` (`getVerifier`), which the overseer hands back to the gatekeeper; the
  gatekeeper "unwraps" it via a semi-private method it defined (`docs/observers.md` §3).
- **Forward exclusion** — for observations made *after* a user becomes an observer, the gatekeeper
  names who must not see them via `ObservationDescription.excludeObservers`; the overseer blocks any
  observation naming a still-authorized observer.

`ensureObserver` runs at `open()` for non-owners after the effective role is confirmed. Scope:
`build` collaborators must be verified against **every** gatekeeper; `use` collaborators only
against **named bindings** (what the UI can invoke). It is **re-verified on every open**
(catches revocation lazily); re-verification of already-covered bindings silently reuses stored
account choices without popping the modal. On failure, best-effort `removeObserver` is called and the
open is denied. Persisting the observer record is the canonical moment of becoming configured.

**Teardown on sharing changes**: when sharing changes remove/downgrade a user, or on
`authorizeObservation` exclusion, the overseer best-effort `removeObserver`s the affected gates and
deletes the observer record. Because `addObserver` re-runs every open and `removeObserver` is
idempotent, failure mid-teardown self-heals (`docs/observers.md` Step 5–6).

An opaque, random **observer ID** is generated per observer record and passed to gatekeepers as the
stable handle — deliberately NOT the user's email, to keep gatekeeper authors from parsing identity
out of it (identity is conveyed only via the verifier).
