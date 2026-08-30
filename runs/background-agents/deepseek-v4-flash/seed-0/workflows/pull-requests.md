---
type: workflow
title: Pull Requests, SCM Credentials, and Autofix
description: How Open-Inspect creates and reuses pull requests, brokers short-lived SCM credentials into the sandbox, tracks PR lifecycle across webhooks and read-through refresh, and turns GitHub review feedback into agent work via the Autofix pipeline.
tags: [pull-requests, source-control, github, scm-credentials, autofix, lifecycle-tracking]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-e19487d3171a83931c8c0e95
    resource: repo://packages/control-plane/src/autofix/queue-consumer.ts
  - id: openwiki-source-863b4e7bfd78176d283f8e01
    resource: repo://packages/control-plane/src/autofix/service.ts
  - id: openwiki-source-71346ef8ca1ae158c77d9e3a
    resource: repo://packages/control-plane/src/db/pr-autofix-feedback-store.ts
  - id: openwiki-source-4ff058c6c626ae5805c358fa
    resource: repo://packages/control-plane/src/db/session-pull-request-store.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-820b9ad986724854db571bee
    resource: repo://packages/control-plane/src/queue-routing.ts
  - id: openwiki-source-f49c3ab49317a2ad215805d3
    resource: repo://packages/control-plane/src/routes/shared.ts
  - id: openwiki-source-f69048d2562235a60f688786
    resource: repo://packages/control-plane/src/session/components.ts
  - id: openwiki-source-2a0121defa6bca8c8c414ff1
    resource: repo://packages/control-plane/src/session/http/handlers/pull-request.handler.ts
  - id: openwiki-source-1d490fe5af2ebc3cd9c8300b
    resource: repo://packages/control-plane/src/session/message-queue.ts
  - id: openwiki-source-893ac0a294bbda5cd7dd3bc7
    resource: repo://packages/control-plane/src/session/message-repository.ts
  - id: openwiki-source-19be9138d087c147d650a925
    resource: repo://packages/control-plane/src/session/participant-service.ts
  - id: openwiki-source-9c5c30f5ffebfb22f0bb701c
    resource: repo://packages/control-plane/src/session/pull-request-refresh.ts
  - id: openwiki-source-db0296e5a750bbd78a22edc4
    resource: repo://packages/control-plane/src/session/pull-request-service.per-branch.test.ts
  - id: openwiki-source-9d15c964265e29af445b4964
    resource: repo://packages/control-plane/src/session/pull-request-service.test.ts
  - id: openwiki-source-95708266900b62a9460b893c
    resource: repo://packages/control-plane/src/session/pull-request-service.ts
  - id: openwiki-source-5bab002c84dfc53a5b9d7e4d
    resource: repo://packages/control-plane/src/session/pull-request-snapshot-apply.ts
  - id: openwiki-source-0bc7329f2e3c2bf7579c15df
    resource: repo://packages/control-plane/src/session/pull-request-snapshot.ts
  - id: openwiki-source-cc418ae85071e90eb8d81e29
    resource: repo://packages/control-plane/src/session/scm-credentials-service.ts
  - id: openwiki-source-f42f326f8f3723fecdbd40b7
    resource: repo://packages/control-plane/src/source-control/branch-resolution.ts
  - id: openwiki-source-3f4f485b32cd4a751f5b34f7
    resource: repo://packages/control-plane/src/source-control/github-credential-authority.ts
  - id: openwiki-source-98be2b2c31c1e4ddbe0f097d
    resource: repo://packages/control-plane/src/source-control/providers/github-provider.ts
  - id: openwiki-source-9e1fc673b739990b38eb4626
    resource: repo://packages/control-plane/src/source-control/types.ts
  - id: openwiki-source-30bf9ff94b6bc0d008787863
    resource: repo://packages/control-plane/src/webhooks/github.ts
  - id: openwiki-source-2123ba68f61ce88fa71c15b5
    resource: repo://packages/control-plane/src/webhooks/pull-request-lifecycle.ts
  - id: openwiki-source-24a04db2be6ca4d99bad18ac
    resource: repo://packages/control-plane/test/integration/scm-credentials.test.ts
  - id: openwiki-source-1918e0c43621ea5fb31a8558
    resource: repo://packages/github-bot/src/autofix-ingress.ts
  - id: openwiki-source-1eb6487041d89f0d461c45e0
    resource: repo://packages/github-bot/src/index.ts
  - id: openwiki-source-06d3b072476cfd51c8cb67f3
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py
  - id: openwiki-source-1ea269c17eb60dceac81238c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/git_signing.py
  - id: openwiki-source-11c8139d3e5d8796cce14d68
    resource: repo://packages/shared/src/git.ts
  - id: openwiki-source-4e3916f9d6e86e79ad62fdb3
    resource: repo://packages/shared/src/types/integrations.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Pull Requests, SCM Credentials, and Autofix

This page covers the pull-request feature area end to end: branch naming and
resolution, PR creation with user-versus-bot attribution, head-branch reuse
(force-push versus new PR), PR snapshot syncing into session artifacts,
webhook-driven lifecycle tracking, the in-sandbox git credential helper, and
the GitHub Autofix review-feedback pipeline.

## Overview

PR functionality lives in the control plane and spans three cooperating
surfaces:

- **Session durable object (DO)** — `SessionPullRequestService` orchestrates
  branch push and PR creation per session; the DO also owns the `pr` artifact
  mirror and exposed internal snapshot/refresh endpoints.
- **D1 authority store** — `session_pull_requests` is the queryable
  authority record per PR (`SessionPullRequestStore`), written by every
  freshness path through one canonical mapping.
- **Webhook / queue ingress** — the github-bot normalizes GitHub events and
  POSTs them to `/internal/github-event`; PR lifecycle tracking piggybacks
  that forward, and Autofix envelopes are enqueued for the control-plane
  worker's queue consumer.

The repository model is GitHub-first: the branch convention, push auth, and
Autofix pipeline are implemented for the GitHub provider, with GitLab sharing
the generic `SourceControlProvider` interface.

## Branch naming and resolution

Session branches follow the convention `open-inspect/{session-id}`
(`BRANCH_PREFIX` in `packages/shared/src/git.ts`). `generateBranchName`
derives a PR head branch from a session id; `extractSessionIdFromBranch`
reverses it (used only for guarded webhook fallback correlation).

`resolveHeadBranchForPr` (in `source-control/branch-resolution.ts`) resolves
the source branch of a PR with deterministic precedence:

1. **request** — an explicitly requested `headBranch` from the tool call
   (derived from the sandbox HEAD);
2. **session** — the target repository's stored working branch
   (`member_row.branch_name`, falling back to the session scalar for the
   primary repo);
3. **generated** — `open-inspect/{sessionId}`.

Candidates are sanitized with `sanitizeBranchName` (rejects `HEAD`, leading
slashes/dots, spaces, `..`, `@{`, and git-ref control characters) and
normalized case-insensitively. A candidate equal to the base branch is skipped
(a PR cannot merge a branch into itself); if all candidates fail, the
generated branch wins.

## PR creation flow

`SessionPullRequestService.createPullRequest` (in
`session/pull-request-service.ts`) orchestrates creation. Preconditions
checked at the HTTP boundary (`PullRequestHandler.createPr`): the session
exists and has a repository context; the target repo is a member of the
session (403 otherwise — the route is reachable with sandbox auth, so
membership is a security boundary); and the call is triggered by a user
prompt, resolved through `ParticipantService.getPromptingParticipantForPR`.

The service re-resolves the repository target itself rather than trusting the
handler (defense in depth at the sandbox-auth boundary), then claims the
target repo with an in-memory `PullRequestCreationClaims` set scoped to the
DO instance. The claim serializes in-flight creation per repo: a concurrent
request for the same repo returns 409 while the first is still awaiting
provider calls; the claim outlives individual requests but dies with the DO
instance, so the persisted-artifact scan also guards against earlier completed
creations.

Steps in order:

1. Resolve SCM policy (`resolveScmSettings` — global defaults merged with
   per-repo overrides; a deployment without D1 keeps built-in defaults and a
   storage failure fails closed) and derive `draft` (the SCM setting
   `alwaysUseDraftMode` overrides the request).
2. Generate a fresh push auth token (GitHub App installation token) via
   `generatePushAuth`. Push runs with app credentials because the sandbox
   must never hold user OAuth tokens.
3. Read repository info (default branch) and resolve base:
   requested `baseBranch` > the repo entry's base branch > repo default.
4. Resolve and sanitize the head branch (above).
5. Scan persisted `pr` artifacts for candidates on the resolved head branch
   (`listPrArtifactsForHead`), then `resolveExistingOpenPullRequest` decides
   reuse versus create.
6. Build a force-push spec (`buildGitPushSpec` uses a GitHub-specific remote
   URL embedding the app token) and push `HEAD` to
   `refs/heads/{headBranch}` with `force: true`. Push failure returns 500.
7. Sync the session branch: the member row and the primary session scalar
   `branch_name` are updated to the sanitized head branch, and a
   `session_branch` broadcast converges connected clients.
8. If an open PR was reused, return it with `updated: true`. Otherwise create
   the PR with `input.promptingAuth ?? appAuth` (see attribution below) and
   optional configured labels.
9. Write the one lifecycle snapshot (see next section): create the DO `pr`
   artifact and upsert the D1 record from the same snapshot, then broadcast
   `artifact_created`.

### Attribution: user OAuth versus GitHub App bot

PR creation prefers the prompting user's OAuth token so the PR is attributed
to the user. `ParticipantService.resolveAuthForPR` decrypts the prompting
participant's `scm_access_token_encrypted`, refreshing it server-side when
near expiry (centralized D1 token store with CAS, falling back to the local
per-DO store). Users without a usable OAuth token — or sessions triggered
from integrations such as Linear that have no user GitHub OAuth — yield
`auth: null`, and the service falls back to the shared GitHub App token.
The PR body always carries a "Created with [app]" footer.

### One open PR per head branch

`resolveExistingOpenPullRequest` implements the one-PR-per-head policy. Every
stored-open candidate (plus state-less legacy metadata) on the resolved head
branch is walked — sorted newest-updated first but resolved against the
provider's **live** state, because artifact metadata only learns about merges
via webhooks or read-through refresh. Walk semantics:

- A merged/closed live state heals the stale-open artifact mirror via
  `applyLiveSnapshot` and continues walking — an older PR may still hold the
  branch. Stored-merged/closed artifacts are not viable candidates at all;
  they released the head.
- **Force-push safety**: reusing (or replacing) a PR means force-pushing the
  sandbox checkout over that head, which is only safe when the head IS the
  checkout: an explicitly requested branch, or the generated session branch.
  A stored custom branch reached via fallback (e.g. the top of a stack
  recorded as last-pushed) holds content the request never saw — pushing over
  it would destroy the PR, so creation fails with 409 directing the user to
  check the branch out.
- An explicitly different requested base means a separate PR from the same
  head (providers allow one open PR per head/base pair), so that candidate is
  skipped but a later candidate may carry the pairing. Without an explicit
  base the candidate's base stands — a stacked PR's base is not the session
  default, and a follow-up call must not be read as a retarget.
- When the provider read fails, reuse falls back to stored facts: reusing a
  PR that turns out closed is recoverable; opening a duplicate is not.
- Legacy pre-lifecycle metadata without a PR number/URL cannot be referenced
  or verified, so it keeps the head claimed unless a verifiable PR was reused.

Consequently: creating for an existing open head force-pushes and reuses the
PR (response `updated: true`); merged/closed PRs release the head branch and
a later call creates a fresh PR (the follow-up-after-merge flow); a different
explicit base creates a parallel PR.

## PR lifecycle snapshots and the D1 authority record

`session/pull-request-snapshot.ts` is the canonical snapshot mapping. Every
writer — creation, the webhook path, and read-through refresh — maps a
provider snapshot through it, so field mapping between the snapshot, the DO
artifact metadata, the D1 record, and the `artifact_updated` broadcast has
exactly one home. Rules:

- `snapshotToRecord` produces the D1 authority record; outcome timestamps are
  state-scoped (`mergedAt` only while merged, `closedAt` cleared on reopen).
- `mergeSnapshotMetadata` preserves unknown legacy keys and keeps the legacy
  `state` display key current for older clients.
- `preparePullRequestArtifactUpdate` rejects stale snapshots by the same
  monotonic `providerUpdatedAt` rule as the D1 store (only a strictly older
  timestamp is rejected; a missing timestamp on either side is
  authoritative) and no-ops when nothing materially changed.

`SessionPullRequestStore` (D1) implements the single **identity boundary**:
`getByIdentity` matches `(repository_external_id, pr_number)` first — the
canonical, rename/transfer-proof identity — and falls back to
case-insensitive `(repo_owner, repo_name, pr_number)` only for legacy rows
that predate external-id capture (the next upsert upgrades them in place).
The upsert is guarded in SQL: a write whose `providerUpdatedAt` is strictly
older than the stored one is rejected (`applied: false`), so an out-of-order
webhook cannot regress state; a conflicting row for the same PR identity
under a different artifact id violates the unique identity index and throws
(one record per PR).

### Authority-then-mirror ordering

All refresh paths follow the same sequence (`applyPullRequestSnapshot` in
`pull-request-snapshot-apply.ts`): upsert the D1 authority record first — a
snapshot the monotonic guard rejects must never reach the mirror — then
re-read the artifact at apply time (a webhook push can land between awaits)
and perform the guarded mirror write, returning the `artifact_updated` payload
for the caller to broadcast. A **thrown** upsert is different from a rejected
one: D1 is best-effort on every freshness path, so the mirror still updates
and the caller reports the record failure; redelivery or read-through repairs
D1.

### Freshness paths

- **Webhook** (`webhooks/pull-request-lifecycle.ts`): on
  `/internal/github-event`, `processPullRequestLifecycleEvent` correlates
  `(repository_external_id, pr_number)` via the store; the hit path updates
  the matched record (refreshing stored owner/name after rename/transfer) and
  mirrors the snapshot into the owning session DO through the
  snapshot-push endpoint. The miss path derives the session from the branch
  convention as a **guarded fallback** (Superset cross-fork lesson): the
  derived session must exist AND already be associated with the event's
  repository, the session must hold a matching DO `pr` artifact (preferring
  the one carrying the webhook's PR number), and cross-repository fork heads
  are dropped as not-ours. This repairs records whose best-effort creation
  write failed.
- **Read-through refresh** (`session/pull-request-refresh.ts`): on session
  open and on the manual sync action, each PR artifact is re-read from the
  provider (app-authed; the only freshness path that reads the provider
  directly, and the only one required when the bot is off), then
  authority-then-mirror applies. The endpoint returns 202 and runs in the
  background.
- **Creation-time repair**: `applyLiveSnapshot` in `SessionPullRequestService`
  is the same sequence used when creation walks a candidate whose live state
  is no longer open.

Webhook lifecycle tracking is **additive and best-effort**: it runs in
`waitUntil` off the request path and every failure is logged and swallowed,
so a failure never affects automation matching.

## SCM credentials in the sandbox

The in-sandbox git credential helper
(`sandbox_runtime/credentials/git_credential_helper.py`) implements git's
credential protocol so every git operation inside the sandbox — fetch, push,
ls-remote, submodule update — fetches a fresh short-lived SCM credential on
demand instead of a token captured at sandbox-creation time.

- On each `get`, the helper POSTs to
  `{CONTROL_PLANE_URL}/sessions/{session_id}/scm-credentials`, authenticated
  with the sandbox's `SANDBOX_AUTH_TOKEN`. The control-plane route
  (`SCM_CREDENTIALS_ROUTE`) enforces sandbox authentication bound to the
  session — user and service credentials are rejected; a token bound to
  another session is rejected.
- `ScmCredentialsService` mints the credential through
  `SourceControlProvider.generateCredentialHelperAuth`, which for GitHub
  returns `x-access-token` plus a freshly minted installation token with its
  expiry (`getCachedInstallationTokenWithExpiry`). Permanent provider errors
  map to 500, transient to 502; the password is never logged.
- The helper persists a successful response to `/run/oi/scm-creds.json`
  (mode 0600) and returns cached credentials until they are within
  `CACHE_REFRESH_BUFFER_SECONDS` (5 minutes) of expiry; concurrent git
  commands serialize on an advisory lock. The cache is **never** used as a
  fallback for a failed refresh — stale tokens silently authenticating are
  worse than visible failures, so a rejected control-plane call exits
  non-zero.
- Scope protection: the helper only serves credentials when `protocol` is
  `https` and `host` equals `VCS_HOST` (default `github.com`), so a malicious
  submodule URL or `git ls-remote` against an attacker host cannot exfiltrate
  the installation token. It deliberately does not scope to the session repo:
  setup/start hooks may clone sibling private repositories the installation
  can access.
- Image-build sandboxes have no control plane to refresh against: the manager
  injects `VCS_CLONE_TOKEN` directly and the helper treats it as good for one
  hour, refusing the env fallback whenever a control-plane context is present
  but incomplete.

`resolveGitHubCredentialAuthority` (`source-control/github-credential-authority.ts`)
governs which store serves a user's GitHub identity for SCM workflows: a
browser user must never silently fall back to the legacy token store when
authentication provenance is missing. Linked GitHub accounts are enumerated
from the verified principal's account client (never part of browser-session
authentication), and service actors are the only transitional callers that
retain the legacy authority.

Commit signing (`sandbox_runtime/git_signing.py`) is a sibling in-sandbox
flow: `GitSigningRuntime` fetches the session's commit-signing configuration
over `GET /sessions/{id}/commit-signing`, translating an enabled
configuration into per-repo `git config` (SSH-signing format, committer
identity, `commit.gpgsign true`) or unsetting signing keys when disabled,
falling back to an unsigned author identity.

## GitHub Autofix pipeline

Autofix turns review feedback into agent work. The github-bot ingresses
`issue_comment` (created, non-bot-mention) and `pull_request_review`
(submitted) hooks into `GitHubAutofixEnvelope`s
(`github-bot/src/autofix-ingress.ts`) and sends them to `AUTOFIX_QUEUE`
(queue names prefixed `open-inspect-github-autofix-`). The control-plane
worker's `queue` handler runs `handleAutofixQueue`, which wires
`AutofixService` with the D1 feedback store, integration settings, the GitHub
provider, and a session runtime client.

`AutofixQueueConsumer` parses each envelope, calls `AutofixService.process`,
acks on success, and retries on transient failures up to
`MAX_DELIVERY_ATTEMPTS` (5); permanent provider errors are marked failed and
acked immediately. A per-minute cron checks primary and dead-letter backlog
health.

### Processing pipeline

`AutofixService.process` follows an idempotent, terminal-transition state
machine persisted per feedback in `pr_autofix_feedback` (keyed
`github:{kind}:{providerObjectId}`):

1. **Receive** — insert-or-update the receipt (incrementing delivery count);
   an earlier terminal decision (queued/skipped/failed) short-circuits.
2. **Correlate** — look up the owning session via `SessionPullRequestStore`
   identity `(repository_external_id, pr_number)`; untracked PRs are skipped.
3. **Recover ambiguous dispatch** — if a previous run attempted dispatch but
   never confirmed, `lookup_feedback` finds the session message and marks it
   queued with `recovered_after_ambiguous_dispatch`.
4. **Eligibility** — resolve integration settings for the repo (`enabled`,
   per-repo allowlist, `prCommentsEnabled`, `reviewsEnabled`), verify the PR
   is open, fetch the feedback object (app-authed), attach author context,
   and apply ineligibility rules: own bot's reviews only if
   `openInspectReviewsEnabled`; explicit `@bot` mentions on PR comments are
   skipped (`explicit_mention`); human authors must have write permission on
   the repo (`hasPullRequestWritePermission`); other bots must be in
   `allowedReviewBots`; non-actionable review states and empty feedback are
   skipped.
5. **Dispatch** — build the `enqueue_feedback` session command (prompt with
   the feedback body/comments, author, origin, per-PR attempt limit) and POST
   it to the owning session DO's `/internal/autofix` endpoint. `enqueued` and
   `duplicate` mark the receipt queued with the message id; `rejected`
   (session_closed / queue_full / attempt_limit) marks skipped. On an
   ambiguous failure, recovery lookup runs before propagating the error.

`buildPrompt` wraps the feedback payload in `<github_feedback_data>` and
explicitly instructs the agent to treat it as untrusted review data, not
instructions; it rejects reviews over `MAX_GITHUB_AUTOFIX_REVIEW_COMMENTS`
(100) comments or prompts over `MAX_GITHUB_AUTOFIX_PROMPT_BYTES`
(200,000 bytes), truncating each diff hunk to 4,000 chars.

### Session-side admission

`SessionMessageQueue.enqueueAutofix` (via `AutofixHandler` at
`/internal/autofix`) admits the feedback as a message: it creates/updates a
participant for the GitHub author, and `MessageRepository.admitAutofixMessage`
runs a transaction that rejects duplicates (same feedback key already has a
message), closed sessions, a full queue, and — when
`maxAttemptsPerPrPer24Hours` is set — an attempt count for that PR key within
the rolling 24-hour window; the default cap is 30 (`GITHUB_AUTOFIX_DEFAULTS`,
null disables). Enqueued feedback redrives the pending queue so the session
wakes to process it.

## Related pages

- `/openwiki/architecture/sandbox-runtime.md`
- `/openwiki/concepts/sessions.md`
- `/openwiki/integrations/github.md`
- `/openwiki/workflows/session-lifecycle.md`
