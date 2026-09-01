---
type: "Reference"
title: "Observers: read-through sharing verification"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# Observers: read-through sharing verification

The security invariant: if a gadget can read restricted information, then anyone who cannot read
that information themselves is prohibited from interacting with the gadget, to prevent data leaks.
The blunt predecessor was the `prohibitAllSharing` lockdown; the observer mechanism refines it into
a per-user, gatekeeper-mediated check (`docs/observers.md:25-40`):

- A non-owner who opens a shared gadget must supply **their own connected account** for each of the
  gadget's gatekeepers.
- Each gatekeeper verifies (`addObserver`) that this person could directly read everything the
  gadget has historically read through it; failing that, the open is denied.
- Going forward, an observation a registered observer lacks privileges for is **blocked** (or
  forward-excluded), throwing before any data crosses.

The core security invariant this implements, from `docs/observers.md:126-130`: for every user
authorized in the sharing graph and every gatekeeper in scope for their role, the gatekeeper has
confirmed at their last open that they may observe everything read so far, **and** no later
observation has been allowed that they may not see.

## The observer record and `ensureObserver`

The overseer keeps an `observers` collection (`profileId` → `{observerId, accountChoices}`,
keyed to gatekeeper ids). `ensureObserver(profileId, clientUser, role, configureCb?)` runs on every
non-owner open, after the role is confirmed and before any capability is handed back — so it never
reveals gatekeeper metadata to an unauthorized caller (`overseer.ts:8352-8360`, `7859-8035`):

1. **Scope**: `build` collaborators are verified against *every* gatekeeper with a vendor;
   `use` collaborators only against gatekeepers reachable through visible (non-provisional)
   binding edges, since that is all the UI can invoke (`overseer.ts:7764-7785`).
2. **Ambient bindings are auto-filled** from the collaborator's matching provided singleton
   account — ambient bindings are the exception to account *selection*, not verification
   (`overseer.ts:7896-7920`).
3. **Uncovered bindings** trigger `configureCb.configure(needs)` — the client's configuration
   modal. A non-interactive open without a callback is denied. The overseer validates that every
   choice covers an uncovered binding and is a safe integer, and that nothing remains uncovered
   (`overseer.ts:7922-7957`).
4. **Re-verification of everything in scope**: for each gatekeeper, resolve the chosen account's
   verifier via `clientUser.getVerifier(accountId, vendorId)` (null when disconnected; vendor
   mismatch throws) and call `getGatekeeperFacet(gk.id).addObserver(observerId, verifier)` —
   concurrently, so Cap'n Web batches the calls. Every failure is collected, not just the first
   (`overseer.ts:7959-7994`).
5. **Repair loop**: failures drop their account choices and one re-prompt is offered (bounded by
   `MAX_CONFIG_REPROMPTS = 1` against a misbehaving client or persistently failing account),
   with the failure reason attached so the client can aim re-authentication at the right account.
   After the budget, a terminal denial names each failed connection and account
   (`overseer.ts:7996-8020`, `8037-8059`).
6. **Persistence is the commitment point**: the observer record is written only after all
   `addObserver` calls succeed; a failure rolls back best-effort by removing only the observers
   registered *this* call (pre-existing registrations stay — removing one would break
   `excludeObservers` while the persisted record still asserts it exists)
   (`overseer.ts:8025-8034`).

Re-verification happens at **every open** by design: it catches revocation of the user's
underlying resource access promptly, and gatekeepers may cache on their side to bound cost
(`docs/observers.md:295-302`).

## Forward exclusion

For observations made *after* a user became an observer, the gatekeeper names observers who must
not see it via `ObservationDescription.excludeObservers` (the opaque `observerId`s it was given).
Since there is no per-thread hiding, an excluded observation proceeds **only if every named
observer has already lost access in the sharing graph** (their record is then torn down); if any is
still authorized, the observation is blocked with a clear error. Erring toward naming an observer
is therefore never a leak — at worst it blocks an observation that could in principle have been
allowed (`overseer.ts:4558-4615`; `docs/observers.md:323-351`;
`.agents/skills/write-gatekeeper/SKILL.md:293-295`).

## Verifiers

The overseer cannot reason about a vendor's identity model, so the observer's *own* connected
account mints an opaque `GatekeeperUserVerifier` (`GatekeeperUser.getVerifier()`), which the
overseer hands back only to the same vendor that minted it. The vendor extends it with
non-standard methods (GitHub: `hasRepoAccess`; Context: `hasCollectionAccess`; Google: per-resource
checks) and casts it back inside `addObserver` — the overseer's same-vendor promise makes the cast
safe (`gatekeeper.ts:674-689`; `github.ts:1342-1371`).

## Teardown on sharing changes

When removal/revocation actually removes or downgrades someone, the overseer tears down their
observer state: best-effort `removeObserver` on all gatekeeper facets, then delete the record —
before the session-restarting DO abort (see
[sharing](/openwiki/security/sharing.md)) (`overseer.ts:10423-10441`, `7809+`).

## Strategies (documented, per resource type)

`docs/observers.md` §9 records the strategy decision per gatekeeper resource — documented
strategy; per-gatekeeper behavior should be verified in each package:

| Strategy | Meaning | Examples (per the doc) |
| --- | --- | --- |
| **A** — private-only | `addObserver` always throws | Gmail Mailbox, ZoomInfo |
| **B** — ACL check (single unit) | the binding is one atomic resource; check the observer against it | GitHub repo, Google Doc/Sheet/Calendar, Notion page, Supabase project, Linear team |
| **C** — data-set tracking | track observed sub-resources; verify each observer against every set; use `excludeObservers` for newly-touched sets | BigQuery datasets, Supabase org, Linear/Notion workspace, Confluence, Context Library |
| **D** — low-stakes | no tracking; any collaborator may observe | Email, Spotify, Home Assistant |
| **N** — N/A | no resources, never in scope | Cloudflare (auth/billing only) |

The broad-binding lens (§9.3): use **C** only when the binding spans sub-resources with distinct
ACLs *and* a per-observer access oracle exists; otherwise **B** (one ACL covers it) or **A/D** (no
oracle).
