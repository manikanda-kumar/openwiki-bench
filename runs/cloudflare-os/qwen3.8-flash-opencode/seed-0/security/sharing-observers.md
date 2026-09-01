---
type: security
title: Sharing and Observer Enforcement
description: How a gadget is shared (collaborators with build/use roles, HMAC'd share links, the permission graph with transitive revocation) and how the observer mechanism guarantees a new collaborator could already read everything the gadget read through its gatekeepers.
tags: [sharing, observers, capabilities, verification, revocation]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T07:33:35.778Z
sources:
  - id: openwiki-source-880f05e2a5a1262ed02eb6fe
    resource: repo://docs/observers.md
  - id: openwiki-source-5ecf2f1811f0fb34fe52eddb
    resource: repo://docs/sharing.md
  - id: openwiki-source-fc70743079da2d3d1e2de35e
    resource: repo://packages/integration-tests/__tests__/observer-reverification.test.ts
  - id: openwiki-source-4547a257000fe72af6ab8a5c
    resource: repo://packages/workshop-backend/src/overseer.ts
  - id: openwiki-source-4dccea6881609b78ae77e72b
    resource: repo://packages/workshop-backend/src/sharing.ts
  - id: openwiki-source-2cbd936fac8ed023e94c65a8
    resource: repo://packages/workshop-backend/src/user.ts
  - id: openwiki-source-8e17ebb59be662b3fc61a18f
    resource: repo://packages/workshop-shared/src/api.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T07:33:35.778Z" }
---

# Sharing and Observer Enforcement

Sharing must not become a leak channel: the core invariant is "if a Gadget can read restricted data, anyone who cannot read that data directly is prohibited from interacting with the Gadget" (`docs/observers.md` §1, quoting the security model). `docs/sharing.md` is the current design doc for the collaborator system; `docs/observers.md` is the *historical plan* for the enforcement — this page reflects what `sharing.ts` and `overseer.ts` actually implement. The read-time half (forward exclusion, lockdown) is on [Capability Security Model](/openwiki/security/capability-model.md); blueprint (code-snapshot) sharing is separate — see [Blueprints](/openwiki/architecture/blueprints.md).

## Collaborators, roles, and the capability handed back

Two roles, totally ordered `build > use` (packages/workshop-backend/src/sharing.ts:29-45):

- **`build`** — everything the owner can, except: cannot delete the gadget, resolves AI models and binding accounts from *their own* account (BYOK bills the prompter; bindings connect through the collaborator's own third-party accounts, so sharing never extends the owner's connections), and may only remove users they added (docs/sharing.md "Collaborators").
- **`use`** — mainline UI only: `getUiBundle`/`connectToGadget` (no `chatId`), restricted metadata, presence; everything else throws `Unauthorized`, with two deliberately *inert* subscriptions (`subscribeToConsoleLogs`/`subscribeToActions` return never-delivering stubs so the editor's speculative hooks don't error while revealing nothing) (docs/sharing.md "Restricted capability").

Enforcement is at capability mint: `open()` computes the caller's *effective role* from the permission graph and returns either the full `OverseerClientInterface` or the `UseOverseerInterface` default-deny class — an unauthorized caller (including a removed collaborator) gets `OPEN_GADGET_ERROR_CODES.workspaceAccessDenied` *without* any workspace metadata (packages/workshop-backend/src/overseer.ts:8340-8350, 10548-10552). Callers can never grant a role above their own effective role (packages/workshop-backend/src/sharing.ts:290-316).

## Share links

Two grant paths: direct add by username/email, or a share link whose secret rides in the URL as a `#share=<key>` **fragment** (never sent to servers — also why frontend error reports strip fragments). Key design (docs/sharing.md; packages/workshop-backend/src/sharing.ts:81-125):

- 128-bit random keys; the server stores only an HMAC-SHA-256 (domain-separated with a fixed constant), so a storage leak exposes no live links and the raw key is shown exactly once ("copying" mints a *new* key under the same link id);
- a link is its first key's row; copies are `alias` rows pointing back — and the Overseer's `shareKeys` collection groups them by that index (packages/workshop-backend/src/overseer.ts:1252-1258);
- redemption and opening are **atomic in one RPC** (`openGadget(id, shareKey)`), so the client can pipeline on the returned stub (docs/sharing.md; packages/workshop-shared/src/api.ts:474-484).

The permission graph records *how* each collaborator got access (edges with roles); revocation is transitive — removing an edge removes everyone who became reachable only through it — while re-adding restores that subtree (docs/sharing.md "Permission graph"; packages/workshop-backend/src/sharing.ts:13-16, 369). Effective roles are recomputed from the graph, and removed collaborators linger as unreachable records rather than being deleted. Enforcement of removal: `scheduleRevocationRestart` syncs, waits ~100 ms so the *revoker's* own successful RPC can settle, then `ctx.abort`s the workspace DO — which is also what destroys the in-memory outputs-fanout session table (packages/workshop-backend/src/overseer.ts:4988-5002, 9310, 10439-10460).

## The observer flow at open()

The security spine (packages/workshop-backend/src/overseer.ts:8321-8360; ensureObserver at :7859-8045). On every non-owner `open()`:

1. **Lockdown first:** a workspace flagged `prohibitAllSharing` is handled by its own short-circuit ("lockdown takes precedence").
2. **Role check:** effective role or coded denial — and critically, `ensureObserver` runs *only after* a valid role, "so it never reveals gatekeeper or resource metadata to an unauthorized user."
3. **Ambient reconciliation completes first**, so every capability this session can reach has an observer registration path.
4. **In-scope gatekeepers by role** (`#inScopeGatekeepers`, :7763-7785): `build` must be verified against **every** account-requiring gatekeeper; `use` only against those actually *bound by a gadget* (provisional gadgets/edges excluded — all the UI can invoke is what's bound). Gatekeepers with no vendor (the in-core model/spawner singletons) and pure-ambient singletons of the scheduler kind are filtered by `observerVendorId`.
5. **Account selection via the `ObserverConfigCallback` capability:** the overseer calls `configure(needs)` **only** when uncovered bindings exist; the client returns its own-account choices (`ObserverAccountChoice` = gatekeeperId → accountId in *the opener's* User DO). Ambient bindings auto-match the collaborator's own provided singleton account where one exists. A non-interactive open with uncovered bindings is denied outright. `configure()` may be called again for the failed subset — bounded re-prompts (`MAX_CONFIG_REPROMPTS = 1`) so a persistently failing account yields a denial, not a loop (packages/workshop-shared/src/api.ts:294-313; overseer.ts:7890-7990).
6. **Verification is the gatekeeper's job:** for each binding, the opener's User DO mints an opaque `GatekeeperUserVerifier` (`getVerifier(accountId, expectedVendorId)` — wrong-vendor or gone-account handled distinctly, packages/workshop-backend/src/user.ts:1694-1712) and the overseer hands it to the *gatekeeper facet's* `addObserver(observerId, verifier)` — the gatekeeper unwraps it via methods only it defined, because only it understands its own resource's ACL (packages/workshop-shared/src/gatekeeper.ts:744-760). All bindings are verified in parallel; failures are **collected, not short-circuited**, so one re-prompt can present everything.
7. **Everything treats thrown failures as repairable** (expired credential vs settled denial are indistinguishable — which is why the integration fixture gatekeeper encodes reasons in strings), rollback removes *only* observers registered this call, and the observer record persists **after** all `addObserver` calls succeed (overseer.ts:7980-8045). The `observers` collection is what `excludeObservers` forward-exclusion later resolves against (:1276-1292).

**Re-verification happens on every open**, not just the first: an already-configured binding's stored account choice still goes through `addObserver`, which is what catches a credential that expired or a remote ACL that tightened since (behavior covered by `packages/integration-tests/__tests__/observer-reverification.test.ts` on the real RPC path).

## The `use` role's deliberate asymmetry

`use` collaborators see presence (names/profile ids/roles are intentionally allowlisted) but no console logs and an empty action log; they cannot chat, edit code, or enumerate bindings — their gatekeeper scope shrinks accordingly, since data they can never see cannot leak through them (docs/sharing.md; overseer.ts:7763-7785).

## Known limits

- **v1 is all-or-nothing per observer**: no per-chat-thread hiding (docs/observers.md "v1 scope decisions"; confirmed by `#enforceExcludeObservers` blocking rather than hiding).
- Revoked collaborators' home-page entries are not proactively cleaned; they discover loss of access at open time as a metadata-free denial (docs/sharing.md "Home page behavior").
- `removeObserver` failures are best-effort log-and-continue: orphaned observer records cause superfluous checks, never leaks, because the leak-relevant gate is `authorizeObservation` keyed off the *live* sharing graph (overseer.ts:7747-7758).
