---
type: "Reference"
title: "OAuth connectors: GitHub, Google, and friends"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-2a78e794fed7e2cb57efb043
    resource: repo://.agents/skills/write-gatekeeper/SKILL.md
  - id: openwiki-source-94be4934a936052cc3dc4682
    resource: repo://packages/gatekeeper-github/README.md
  - id: openwiki-source-75a310a364b83088c1a17598
    resource: repo://packages/gatekeeper-github/src/github.ts
  - id: openwiki-source-d9ed8abd3e3bd5860f4e78bf
    resource: repo://packages/gatekeeper-google/README.md
  - id: openwiki-source-bdf02048d65c73424f38d840
    resource: repo://packages/gatekeeper-google/src/resources.ts
  - id: openwiki-source-29bdf5bed467114e30c6fccf
    resource: repo://packages/workshop-shared/src/gatekeeper.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---


# OAuth connectors: GitHub, Google, and friends

Most gatekeepers wrap an OAuth-protected service. They share one lifecycle shape (defined by
`GatekeeperVendor`/`GatekeeperUser`/`GatekeeperConnectCallback` in
`packages/workshop-shared/src/gatekeeper.ts`) and differ in their resource models, scopes, and
caching. The repo's per-package READMEs carry the vendor-specific setup; this page covers the
shared contract and the two largest connectors.

## The shared connect lifecycle

`connectAccount(callback, options)` starts the flow and returns a URL the user opens in a new tab.
The URL must embed a cryptographic nonce against replay attacks; a typical implementation creates a
`UserAccount` Durable Object, stores the callback in its storage, and directs the user to a URL
addressing that DO plus the nonce (`gatekeeper.ts:449-480`). The contract says the DO should set an
alarm to delete itself if the flow is never completed — GitHub implements exactly that: a
1-hour alarm is set when the callback is stored, and `alarm()` drops the account if no access token
ever arrived (`packages/gatekeeper-github/src/github.ts:1045-1062`, `1165-1169`).

GitHub's implementation shows the canonical two-stage nonce:

1. `setCallback(callback, initiationNonce, requestedScopes, ephemeral)` stores the callback, the
   requested scopes, and a stage-`initiation` nonce with a 10-minute lifetime.
2. The user's visit to `<do-id>/<initiationNonce>` passes `beginOAuthFlow`, which verifies the
   nonce with a **constant-time comparison**, mints a fresh *oauth-stage* nonce, and returns the
   provider authorize URL parameters (`github.ts:1074-1088`).
3. The provider's redirect lands on the gatekeeper's own `/oauth` route; `acceptAuthCode` verifies
   the oauth-stage nonce, deletes it (single use), exchanges the code with the client
   credentials, and stores `accessToken` + `scopes` (`github.ts:1090-1113`).
4. Completion branches on mode:
   - **Connect** (default): `callback.complete(GatekeeperUserImpl)` — the Workshop persists the
     returned account. If `complete()` throws, the freshly stored token is deleted so no grant
     outlives a failed registration (`github.ts:1119-1127`).
   - **Reconnect**: `callback.credentialsRestored()` — the existing account record keeps working
     with the new credentials (`github.ts:1115-1118`).
   - **Sign-in (`ephemeral`)**: the grant is transient; after the caller reads the verified email
     through `complete()`, an alarm self-destructs the account **without** calling the provider's
     revoke endpoint (revoking could invalidate the user's other grants for the same OAuth app)
     (`github.ts:1128-1134`).

`GatekeeperConnectCallback.complete(user, expiresAt?)` also carries an optional `expiresAt` for
proactive "credentials expired" UI; otherwise the system relies on the gatekeeper calling
`credentialsExpired()` when a refresh fails — which GitHub does exactly once (guarded by an
`expiredNotified` flag) whenever an API call hits an auth error, and the failing call surfaces as
"Please reconnect the account" (`gatekeeper.ts:525-556`; `github.ts:1153-1163`, `1391-1403`).

`reconnect()` restarts the flow against the *same* account DO (`prepareReconnect` sets a fresh
nonce and the reconnecting flag) so the existing account Fetcher and every gatekeeper binding
created through it keep working with the new grant (`gatekeeper.ts:609-619`; `github.ts:1064-1072`).

## Sign-in scopes vs. connect scopes

`GatekeeperConnectOptions.scopes` selects the tier (`gatekeeper.ts:440-443`):

- `"auth"` — only the minimal scopes needed to verify the user's email. The grant is transient.
  Per vendor: GitHub `read:user user:email` (`packages/gatekeeper-github/README.md:5-8`); Google
  `openid userinfo.email userinfo.profile` (`packages/gatekeeper-google/README.md:5-9`).
- `"full"` (default) — the provider's capability scopes, persisted as a usable connected account.
  GitHub `repo read:user user:email`; Google requests the scopes of the *selected resources*
  (see below).

`resourceUrlPatterns`, when given, limits the connection to the authorization needed for those
grantable resource types; **omitted means all types, an empty array means none** (see
[the Cloudflare page](/openwiki/gatekeepers/cloudflare-gatekeeper.md) for the concrete case).

## Per-vendor resource models

**GitHub** (`packages/gatekeeper-github/src/github.ts:285-303`) offers three granularities with
distinct URL patterns: a repository (`https://github.com/:owner/:repo`), a single issue
(`.../issues/:number`), and a single pull request (`.../pull/:number`). Issues and PRs inherit the
repo's ACL, which is why the observer strategy is a single-unit repo check (see
[observers](/openwiki/security/observers.md)).

**Google** (`packages/gatekeeper-google/src/resources.ts`) offers eight: Gmail mailbox, Google
Doc, Google Spreadsheet, Google Calendar, BigQuery project, and three Drive shapes (whole account,
one shared drive, one file). Each resource maps to explicit OAuth scopes in `RESOURCE_SCOPES`,
plus `IDENTITY_SCOPES` requested on every connection (`resources.ts:16-24`, `131-166`). Two
frozen lists guard backwards compatibility:

- `LEGACY_GRANTED_RESOURCE_URL_PATTERNS` — what accounts connected *before* per-resource scope
  tracking implicitly received. **Frozen**: adding an entry would make `ensureResources`
  short-circuit and report a legacy account as already holding a grant it never made
  (`resources.ts:100-110`).
- `SCOPE_DERIVED_RESOURCE_URL_PATTERNS` — the resources whose grant may be *inferred* from held
  scopes, for accounts that never recorded a grant. Also frozen, for a sharper reason: inference
  cannot tell a resource the user chose from one that merely shares a scope (`drive.metadata.readonly`
  is requested by the Docs/Sheets pickers, so inferring from it would report a whole-account Drive
  grant nobody made) (`resources.ts:112-129`).

`getGatekeeperClassFor(url)` resolves each URL pattern to a distinct Gatekeeper DO class with
per-resource props (GitHub: repo/issue/pull kinds; Google: one session class per resource type —
Docs, Sheets, Calendar, BigQuery, Drive sessions each have their own `startSession`
(`google.ts:713`, `1637`, `1987`, `2343`, `2661`, `3029`, `3162`).

## Action simulation (GitHub as the worked example)

GitHub's gatekeeper simulates unapproved writes so the agent can keep working: actions are staged
with **provisional resource ids** (`~<n>`), and created resources get provisional ids that are
resolved to real GitHub ids at apply time. Dependent actions reference provisional targets; when a
pending action is rejected, any pending action depending on its provisional resource is rejected
too. Markdown bodies written before approval are rewritten at apply time so `#~12` references
become real issue numbers (`github.ts:144`, `1908-1975`, `2012-2056`, `3254-3331`). This is the
pattern the write-gatekeeper skill calls "mutate the cache" vs "overlay at read time"
(`SKILL.md:183-193`).

## Observer verifiers

`GatekeeperUser.getVerifier()` mints an opaque `GatekeeperUserVerifier` the overseer passes back
only to the same vendor. Each vendor extends it with non-standard methods (documented in
`gatekeeper.ts:674-689`): GitHub's `GitHubVerifier.hasRepoAccess(owner, repo)` queries GitHub with
**the observer's own token** — a `GET /repos/{owner}/{repo}` 404 means no access, since GitHub
returns 404 (not 403) for invisible repos (`github.ts:1342-1371`). The same pattern extends to
Context's `hasCollectionAccess` and Google's drive/doc/dataset checks (per-strategy detail in
[observers](/openwiki/security/observers.md)).

## What varies, and what doesn't

Common to every OAuth connector: the nonce-protected connect URL, the callback DO with
self-destruct alarm, the complete/credentialsExpired/credentialsRestored callback triple, token
storage in the account DO, and the verifier pattern. Vendor-specific: scope sets, resource URL
patterns and their parsers, per-resource session classes, caching strategy (GitHub caches with
ETags and a cache generation that invalidates on rejects; Google caches transformed content),
simulation depth, and the observer strategy per resource type.
