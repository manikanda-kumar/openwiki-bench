---
type: subsystem
title: Sharing and Observers
description: The collaborator permission graph with lazy revocation, share-key design, the build/use role split, and the observer mechanism that makes sharing read-through — never leaking data a recipient couldn't already see.
tags: [sharing, capabilities, observers, security, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T10:56:53.614Z
sources:
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-39d71db6b235c5a66374b5bc
    resource: repo://packages/workshop-backend/src/server.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T10:56:53.614Z" }
---

# Sharing and Observers

There are two ways to share a gadget: **collaborators** (direct access to the same running gadget — this page) and **blueprints** (a code copy in an independent gadget — see [Code Storage, Git Objects, and Blueprints](code-storage-and-blueprints.md)). The design goal for collaborators is *read-through* sharing: a recipient can only ever see data their **own** connected accounts authorize (docs/sharing.md#L1-L8; docs/observers.md#L1-L20).

## Roles and the permission graph

Each collaborator holds a role from a totally ordered set: `build` (edit code, chat, manage bindings — near-owner) and `use` (render and interact with the deployed UI only) (docs/sharing.md#L9-L19). The `use` surface is an explicit allowlist on `Overseer`: `getUiBundle`/`connectToGadget` (mainline only), a metadata subset (`id`/`title`/`owner`/`role`), presence, and two intentionally-inert telemetry subscriptions so the editor's speculative hooks resolve quietly instead of erroring (docs/sharing.md#L15-L17). Enforcement is the compile-time default-deny `UseOverseerInterface` described in [The Overseer Workspace Object](overseer-workspace.md). `build` collaborators differ from the owner: they cannot delete the gadget, they pay for AI with **their own** models (BYOK bills the prompter), their bindings connect **their own** third-party accounts, and they may only remove users they added; a caller can never grant a role higher than their own effective role (docs/sharing.md#L20-L30).

`SharingManager` (packages/workshop-backend/src/sharing.ts) owns the `collaborators` and `shareKeys` collections with zero RPC — the Overseer passes resolved values or callbacks in (sharing.ts#L1-L14). Each `CollaboratorRecord` keeps a denormalized profile snapshot for display plus *every* `PermissionEdge` by which access was granted (`addedBy` is plural — multiple paths are possible; a link's key-copies collapse to one grant because edges point at the link, not the key) (sharing.ts#L68-L76, #L229-L233).

**Revocation is lazy and reversible.** Access is reachability-from-the-owner in the edge graph, recomputed live at every `open()` (`getEffectiveRole`); removing a collaborator or revoking a link only severs the granting edge — nothing cascades, nothing is deleted — so a user who loses their only path is simply unreachable and denied, while re-adding them transitively restores everyone they had reshared to (sharing.ts#L6-L16, #L203). Records accumulate; GC is a stated future option, not current behavior. The Overseer pairs this with a best-effort push: on revocation it chunk-fans-out `forgetSharedGadget`/`updateSharedGadgetRole` to affected collaborators' user DOs, and failures only log — a stale listing is pruned client-click-side, when `open()` is denied and `AuthenticatedApi` calls `forgetSharedGadget` (overseer.ts#L7828-L7848; packages/workshop-backend/src/server.ts#L256-L264).

## Share links and keys

A share link encodes a secret key in the URL fragment (`#share=<key>`); redeeming it auto-adds the opener as a collaborator. Security shape: the server mints a random 128-bit key and stores **only** its HMAC-SHA-256 hash under a fixed, non-secret domain-separation constant (`SHARE_KEY_HMAC_KEY`), so neither a storage dump nor the server itself can reconstruct valid keys (docs/sharing.md#L44-L46; packages/workshop-backend/src/sharing.ts#L45-L64). A link *is* its first key's row (that hash doubles as the link id); later "copies" add alias rows, and revoking the link invalidates all of them (docs/sharing.md#L47-L49; sharing.ts#L78-L119). Redemption and open are atomic — `openGadget(id, shareKey)` — so the client pipelines onto the returned `Overseer` stub without a separate call (docs/sharing.md#L50-L52; overseer.ts#L8330-L8339). A shared gadget appears on the collaborator's home page only after their first open (`recordSharedGadgetOpen`), and dismissing it there does not revoke access (docs/sharing.md#L54-L62).

## Observers: read-through enforcement

The observer mechanism operationalizes "sharing a gadget shares no secrets" (docs/observers.md#L1-L20). The gatekeeper-side obligations: `Gatekeeper.addObserver(id, userVerifier)` must verify the new observer's own account may directly read everything previously observed through that gatekeeper and *throw* otherwise, remembering them as an observer thereafter; it is re-runnable, and the Overseer re-checks on every open to catch upstream revocation. Future reads that some registered observer couldn't make themselves must be hidden via `ObservationDescription.excludeObservers`, and `authorizeObservation` is called on *every* read before data returns to the gadget (packages/workshop-shared/src/gatekeeper.ts#L752-L786, #L855-L870).

The workshop side is `OverseerImpl.ensureObserver`, run during `open()` for non-owners *after* role confirmation (so denial reveals nothing) (overseer.ts#L7852-L7875, #L8352-L8357). It:

1. Selects in-scope gatekeepers for the role — none requiring accounts means no observer record at all (built-in gatekeepers never name `excludeObservers`) (overseer.ts#L7863-L7867).
2. Auto-pairs **ambient** singleton bindings with the collaborator's own provided account for that vendor (there's no meaningful choice when one exists); everything else is uncovered (overseer.ts#L7899-L7922).
3. For uncovered bindings, drives an interactive `ObserverConfigCallback` asking the user to pick connected accounts — non-interactive opens simply deny, and re-prompts are capped at one to avoid looping against a persistently failing account (overseer.ts#L7889-L7930).
4. Runs `addObserver` verification per binding; on failure it rolls back only registrations made *this call* (a snapshot of pre-existing registrations is kept), keeping prior state intact (overseer.ts#L7876-L7888).

The failure mode is access denial, never silent partial visibility: `ensureObserver` "returns when fully verified; throws to deny access" (overseer.ts#L7856).

## The `prohibitAllSharing` latch

An observation may carry the `prohibitAllSharing` flag (e.g. highly personal data like an inbox read). If any such observation was authorized while the gadget had no shares, a monotonic flag is set in workspace storage; while set, `open()` denies every non-owner outright, new shares are gated, and gatekeeper writes/web fetches are constrained — a lockdown that takes precedence over any role computation (overseer.ts#L1026-L1029, #L8320-L8325). The flag intentionally lives in the Overseer's policy layer, not `SharingManager`, which only exposes `hasAnyShares()` for it (sharing.ts#L18-L24).
