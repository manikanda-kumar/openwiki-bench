---
type: subsystem
title: Sharing and observer enforcement
description: Collaborator sharing and the observer security model — the permission graph with effective-role fixed point, lazy revocation, share keys, the build/use capability split, and observer verification that prevents leaking data a collaborator could not access directly.
tags: [sharing, collaborators, observers, permissions, security]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Sharing and observer enforcement

Gadgets can be shared with other users in two ways: **collaborators** (direct access to a gadget, with
a role) and **share links** (a secret key in the URL that adds the opener as a collaborator). Sharing
is built on a **permission graph** recomputed live at every open, and a second mechanism — **observer
verification** — guarantees that a collaborator never sees data they could not access directly.

## Collaborators and roles

Each collaborator has a **role**, totally ordered `build > use`:

- **`build`** — full access: edit code, use the AI chat, manage bindings, interact with the UI — the
  same as the owner except they cannot delete the gadget, use their own AI models (BYOK billing goes
  to whoever prompted), use their own connected accounts for new bindings, and may only remove users
  they themselves added.
- **`use`** — may only render and interact with the gadget's deployed UI: `getUiBundle()`,
  `connectToGadget()` on mainline, restricted metadata, presence, and two *inert* telemetry
  subscriptions (console logs and action log that never deliver data).

Authorization is capability-based: `open()` computes the caller's effective role and returns the full
`OverseerClientInterface` for `build`/owner, or a `UseOverseerInterface` that `implements Overseer`
but throws `Unauthorized` for everything outside the `use` allowlist (default-deny by construction:
any new interface method fails to compile until someone decides whether `use` callers may invoke it).

## Share keys

A share link encodes a **secret key** in a `#share=<key>` fragment. The server mints a random 128-bit
key and stores only its **HMAC-SHA-256 hash** (domain-separated by a fixed constant), so a database
leak exposes no valid keys and the server cannot reconstruct links. A link is stored as its first key
(the key's hash is the link id); copying a link mints an *alias* key pointing back at it. Redemption
and gadget opening happen atomically in a single `openGadget(id, shareKey)` RPC so the rest of the
session can be pipelined.

## The permission graph

`SharingManager` (`sharing.ts`) owns the `collaborators` and `shareKeys` storage and models how each
collaborator gained access as **permission edges**:

- **user edge** — a specific sharer added this collaborator directly (with role + optional note);
- **share-link edge** — this collaborator redeemed a key for a specific link (role comes from the
  link).

The owner is the implicit root at `build`. **Effective role** is the maximum role reachable from the
owner through valid edges, where each edge grants `min(edge role, sharer's effective role)`; it is
computed live by `computeEffectiveRoles()` — a fixed-point iteration that terminates because roles
only increase — and is never denormalized into storage. Share links are first-class graph nodes
supported by their creator, so revoking a link (or removing its creator) transitively removes anyone
who relied solely on it.

### Lazy revocation and preview/confirm

Revocation is **lazy**: removing a collaborator severs only the edges granting *them* access
(owner severs all, a non-owner severs only their own edge), and revoking a link sets a `revoked` flag
instead of deleting the record. Nothing cascades — dependents who lose their only path simply become
**unreachable** and are denied at `open()` time. Because the graph is never destructively pruned,
revocation is reversible (re-adding a removed user restores them and everyone they had shared with).

The UI is two-phase: `previewRemoveCollaborator` / `previewRevokeShareLink` run the computation with a
hypothetical change and return the `AffectedCollaborator`s whose access would change, then the confirm
call performs the lazy severance and returns the actually-affected set. `keepUsers` re-roots spared
dependents with a fresh edge from the caller at their prior role.

## The observer model

The core security invariant: *if a gadget can read restricted information, any user who cannot read
that information directly must not be able to interact with the gadget.* The observer mechanism
enforces it per user and per gatekeeper:

- **At open**, `ensureObserver` (`overseer.ts:7859`) selects the in-scope gatekeepers for the caller's
  role (`build` = every gatekeeper; `use` = only named bindings). Ambient (auto-provisioned singleton)
  bindings use the collaborator's own matching provided account automatically; other bindings need an
  account choice. If any binding is uncovered, the overseer invokes the client's
  `ObserverConfigCallback.configure(needs)` (never for the common case of an owner or already-configured
  observer). Each choice is validated server-side (`clientUser.getVerifier(accountId, vendorId)` throws
  on vendor mismatch) and the gatekeeper's `addObserver(observerId, verifier)` is called with a verifier
  minted from the *collaborator's own* account. Failures are collected and re-prompted once (bounded
  `MAX_CONFIG_REPROMPTS`) before the open is denied.
- **The observer record** is persisted only after all `addObserver` calls succeed — that is the
  canonical moment the user becomes a configured observer; on failure the newly-added observers are
  best-effort removed and the record is not persisted. Every subsequent open re-verifies all in-scope
  bindings (catching revoked access), without popping the modal for already-configured bindings.
- **Forward restriction**: a gatekeeper names observers who must not see a given observation via
  `ObservationDescription.excludeObservers`. The overseer's `authorizeObservation` blocks the
  observation if any named observer is still authorized in the sharing graph; if they have already lost
  access, it tears down their observer record and lets the observation proceed.
- **Teardown**: when sharing changes remove or downgrade someone, the overseer calls `removeObserver`
  (idempotent) on the gatekeepers and deletes their observer record.

Each gatekeeper picks a per-resource observer strategy (the decision table is recorded in
`docs/observers.md`): **A** private-only (`addObserver` always throws — e.g. Gmail mailbox), **B**
single-unit ACL check (repo/document/page — e.g. GitHub repo, Google Doc), **C** data-set tracking
(track the sub-resources actually observed and re-verify observers against each — e.g. BigQuery
datasets, Notion workspace, the Context Library), **D** low-stakes no-ops (email, Spotify, Home
Assistant). The broad-binding rule of thumb: use C only when the binding spans sub-resources with
distinct ACLs *and* there is a per-observer access oracle.

## Terminating live sessions on revocation

Authorization is checked only at `open()`, so a session already open is not re-checked per message.
To close that gap, `removeCollaborator` / `revokeShareLink` **restart the Overseer DO** via
`scheduleRevocationRestart` (`overseer.ts:4998`) whenever the change actually removed or downgraded
someone. The severed edge is flushed with `ctx.storage.sync()` first (because `ctx.abort()` does not
respect the output gate), the abort is delayed ~100ms so the triggering RPC's response reaches the
caller, and the disconnect reaches the browser through the existing `notifyClosed` plumbing, forcing
each client to reconnect and re-run `open()` against the changed graph. Granting or raising access
never strands anyone, and `prohibitAllSharing` cannot strand a session either (the flag is only ever
flipped by a blocked observation on an unshared gadget).
