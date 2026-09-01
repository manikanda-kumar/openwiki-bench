---
type: "Reference"
title: "Observers: Read-Through Sharing Permissions"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T05:23:12.377Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-8c9bf5a84c0258d85f369973
    resource: repo://packages/integration-tests/README.md
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T05:23:12.377Z" }
---


# Observers: Read-Through Sharing Permissions

Sharing a gadget must not hand a collaborator data they could not read themselves. The security invariant: *if a gadget can read restricted information, a user who cannot read that information is prohibited from interacting with the gadget, to prevent data leaks* (docs/observers.md:1-17). Two mechanisms enforce it, at different scales:

1. **`prohibitAllSharing`** — the blunt stopgap. When a gatekeeper marks an observation `prohibitAllSharing`, and the workspace is already shared, `authorizeObservation` throws; otherwise the flag latches and locks the gadget down (no further sharing, no web fetches, no actions). It cannot express "shareable only with people who also have access" — that is what observers add (src/overseer.ts:4445-4456; docs/observers.md:31-39).
2. **Observers** — per-user, gatekeeper-mediated verification. Every non-owner who can see data the gadget read is an *observer*: each relevant gatekeeper verifies, via `addObserver`, that this specific person may directly observe everything read through it so far; future observations that some observer may not see are excluded via `ObservationDescription.excludeObservers`, or blocked (docs/observers.md:41-57).

## Observer records

The `observers` collection holds one `ObserverRecord` per configured non-owner (src/overseer.ts:425-444):

- `profileId` — the sharing-table key (primary key).
- `observerId` — a random, opaque, stable-for-this-record handle passed to gatekeepers. Deliberately **not** the profile id, "to avoid tempting gatekeeper authors to parse identity out of it — identity is conveyed only via the verifier"; it need not survive removal/re-add (src/overseer.ts:432-438).
- `accountChoices` — the account (a `ConnectedAccountRecord` id in the user's own User DO) chosen for each in-scope gatekeeper.

Opening requires **both** a reachable role in the sharing graph *and* a complete, verified observer record — the sharing table records the owner's *intent*, the observer record records *configured-and-verified* (docs/observers.md:113-116).

## `ensureObserver` at open()

`open()` calls `ensureObserver(profileId, clientUser, role, configureObservers)` only for non-owners, after the sharing-graph role is confirmed — so the flow never reveals gatekeeper metadata to an unauthorized user (src/overseer.ts:8320-8360). The algorithm (src/overseer.ts:7852-8035):

1. **Scope**: `#inScopeGatekeepers(role)` — `build` covers every gatekeeper; `use` covers only gatekeepers bound to non-pending gadgets (provisional gadgets and their edges are invisible to `use` collaborators). Gatekeepers whose `creationSpec` has no vendorId need no verification (src/overseer.ts `#inScopeGatekeepers`).
2. **Auto-fill ambient bindings** from the collaborator's matching provided singleton accounts (`listProvidedAccounts`) — no meaningful account choice exists when one already exists; a *failed* ambient binding stays uncovered so the client can explain the failure instead of silently retrying (src/overseer.ts:7896-7920).
3. **Prompt for uncovered bindings** via the `ObserverConfigCallback.configure(needs)` capability the client supplied to `openGadget` — the common case (owner, or an already-configured observer) never round-trips. Each `ObserverBindingNeed` may carry a `failure` (account id + human-readable reason) when this is a re-prompt after a failed verification (api.ts:222-296). No callback at all means denial for non-interactive opens.
4. **Verify every in-scope binding**: resolve the chosen account's verifier via `clientUser.getVerifier(accountId, vendorId)` — which **throws on a vendor mismatch** ("only reachable by bypassing the UI") and returns null if the account is gone — then call `gatekeeper.addObserver(observerId, verifier)`. All failures are collected, not just the first.
5. **One bounded re-prompt** (`MAX_CONFIG_REPROMPTS = 1`) lets the user repair a failed binding in place (typically re-authenticating an expired account); then terminal denial naming each failed connection and account (src/overseer.ts:7996-8019, 8037-8073).
6. **Rollback on any throw**: best-effort `removeObserver` for gatekeepers registered *this* call (pre-existing registrations are kept — removing them would break `excludeObservers` while the persisted record still asserts them), and the record is **not persisted**. Persistence happens only after all `addObserver` calls succeed — "creating/updating the record is the canonical moment the user becomes a configured observer" (src/overseer.ts:8025-8034).

Re-verification runs on **every open** — that is what catches upstream revocation promptly, and gatekeepers choose their own caching tradeoff (docs/observers.md:295-298). The overseer deliberately treats *every* verification failure as repairable (a settled denial and an expired credential both arrive as thrown errors), which is why the integration-test fixture distinguishes narratives by reason text (packages/integration-tests/README.md:60-64).

## The verifier pattern

The overseer cannot reason about a vendor's identity/ACL model, so the *observer's own chosen account* mints an opaque `GatekeeperUserVerifier` (`GatekeeperUser.getVerifier()`), which the overseer hands back to the same vendor's gatekeeper. Since the runtime cannot unwrap a `Fetcher` back to its props, the gatekeeper implements a *public but non-standard method on its verifier* that its own `addObserver` may call — safe only because the overseer promises to pass a verifier back to the gatekeeper that created it (gatekeeper.ts:689-697). The vendor match is enforced server-side in `getVerifier` (src/user.ts, `getVerifier`).

## Forward exclusion (`excludeObservers`)

When a gatekeeper first reads data some existing observer may not see, it names those observer ids in `ObservationDescription.excludeObservers`. `authorizeObservation` then: any named observer who is **still authorized** in the sharing graph blocks the observation outright ("This observation was blocked because it contains data that a current collaborator is not permitted to see."); named observers who have **already lost access** are torn down (record deleted, `removeObserver` on all gatekeepers) and the observation proceeds; unknown ids are ignored (src/overseer.ts:4590-4616). This is the runtime counterpart of `addObserver`: addObserver covers observers configured *after* data was read; excludeObservers covers data read *after* observers were configured (docs/observers.md:343-351).

## Teardown on sharing changes

When a sharing change removes someone entirely, `tearDownLostObservers` deletes their observer record and best-effort removes them from all gatekeeper facets; downgrades keep the record (over-broad scope errs toward stricter future checks, never a leak — the leak-relevant gate is `authorizeObservation`, keyed off the live sharing graph) (src/overseer.ts:7793-7822). Listing refreshes for affected collaborators are fanned out in batches (`refreshAffectedCollaboratorListings`) but are best-effort; a stale home-page listing is corrected on the next open attempt (src/overseer.ts:7824-7850; src/server.ts:256-264).

## Per-gatekeeper strategies

docs/observers.md §9 fixes the strategy per resource type — A private-only (addObserver always throws), B single-unit ACL check, C data-set tracking (log observed sets; re-verify all observers when a new set is first touched, excluding those who fail), D low-stakes no-ops — with the "broad binding" lens (C only when sub-resources have distinct ACLs *and* a per-observer access oracle exists). The decision table (docs/observers.md:504-529) is historical planning prose; the shipped code (e.g. `confluence-observers.ts`, the Context Library's collection tracking in library-gatekeeper.ts:347) is authoritative where it diverges.

## Testing

The overseer's observer logic is covered by `packages/integration-tests` (`observer-reverification.test.ts` and friends) against the fixture gatekeeper, plus unit suites (`user-verifier.test.ts` in workshop-backend) — see [Testing](/openwiki/development/testing.md).
