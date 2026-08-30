---
type: integration
title: GitHub Bot and Autofix
description: GitHub App webhook worker for PR auto-review, reviewer requests, @mention sessions, delivery dedupe, default-environment targeting, and Autofix queue ingress into the control plane.
tags: [github, github-bot, webhooks, autofix, pull-requests]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-d6db273a7260c26ff3ad7e5c
    resource: repo://packages/control-plane/src/autofix/handler.ts
  - id: openwiki-source-e19487d3171a83931c8c0e95
    resource: repo://packages/control-plane/src/autofix/queue-consumer.ts
  - id: openwiki-source-863b4e7bfd78176d283f8e01
    resource: repo://packages/control-plane/src/autofix/service.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-820b9ad986724854db571bee
    resource: repo://packages/control-plane/src/queue-routing.ts
  - id: openwiki-source-1918e0c43621ea5fb31a8558
    resource: repo://packages/github-bot/src/autofix-ingress.ts
  - id: openwiki-source-8301461e482bd09c7cd633c8
    resource: repo://packages/github-bot/src/github-auth.ts
  - id: openwiki-source-68614f6564b8885478b709b0
    resource: repo://packages/github-bot/src/handlers.ts
  - id: openwiki-source-1eb6487041d89f0d461c45e0
    resource: repo://packages/github-bot/src/index.ts
  - id: openwiki-source-52283f61d6a9914cafe4c29d
    resource: repo://packages/github-bot/src/internal-auth.ts
  - id: openwiki-source-2cde503eddd330eb00c0e7ab
    resource: repo://packages/github-bot/src/prompts.ts
  - id: openwiki-source-589cd0d798879bdb23c4fe4a
    resource: repo://packages/github-bot/src/session-target.ts
  - id: openwiki-source-f2d138484279d76efedc9274
    resource: repo://packages/github-bot/src/utils/integration-config.ts
  - id: openwiki-source-de3405a42f890effec5c381a
    resource: repo://packages/github-bot/src/verify.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# GitHub Bot and Autofix

The GitHub bot (`packages/github-bot`) is a Cloudflare Worker that verifies GitHub App webhooks and turns a subset of them into control-plane work. It is a **signed HTTP client** of the control plane (`sig1` as service `github-bot` through the `CONTROL_PLANE` binding). It does not host sessions, sandboxes, or Durable Objects. Session create, prompt enqueue, Autofix admission, and GitHub event automations all run in the control plane.

Operator setup is in `docs/integrations/GITHUB.md` and Getting Started. This page is the runtime contract. Related: [Control Plane](/openwiki/architecture/control-plane.md), [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md), [Automations and Inbound Triggers](/openwiki/integrations/automations.md), [Source Control](/openwiki/workflows/source-control.md).

Three independent paths share the same webhook:

| Path | When | Where it runs |
| --- | --- | --- |
| Direct bot sessions | PR opened (auto-review), review requested of the bot, `@mention` in a PR conversation or inline review comment | github-bot `waitUntil` → signed `POST /sessions` + `/sessions/:id/prompt` |
| Autofix | PR conversation comments **without** a bot mention, and submitted PR reviews | github-bot `AUTOFIX_QUEUE.send` → control-plane queue consumer |
| GitHub event automations | Any catalog event `normalizeGitHubEvent` accepts | github-bot signed `POST /internal/github-event` (see [Automations](/openwiki/integrations/automations.md)) |

Built-in dispatch and automation forwarding both run before a dispatch failure is rethrown. Autofix enqueue happens on the request path **before** `waitUntil` handler work.

## Responsibility and ownership

| Piece | Owner |
| --- | --- |
| Webhook HTTP, signature, delivery KV, dispatch | `packages/github-bot/src/index.ts` |
| Auto-review, review-requested, mention handlers | `packages/github-bot/src/handlers.ts` |
| Session target (repo vs default environment) | `packages/github-bot/src/session-target.ts` |
| Review and mention prompt text | `packages/github-bot/src/prompts.ts` |
| Autofix envelope mapping | `packages/github-bot/src/autofix-ingress.ts` |
| Control-plane queue consumer | `packages/control-plane/src/autofix/handler.ts` + `queue-consumer.ts` + `service.ts` |
| Session Autofix admission | Durable Object `SessionInternalPaths.autofix` |

The bot also uses a GitHub App installation token (`generateInstallationToken`) to post 👀 reactions and check collaborator permission. It does not use that token to create sessions.

## Entrypoint and verification

`POST /webhooks/github` is the only webhook surface. `/health` reports the worker.

1. Read the raw body. Verify `X-Hub-Signature-256` as HMAC-SHA256 of that body against `GITHUB_WEBHOOK_SECRET` (`sha256=` prefix, timing-safe compare). Invalid → 401.
2. If `X-GitHub-Delivery` is present, look up `delivery:<id>` in `GITHUB_KV`. A hit returns `{ ok: true, duplicate: true }` without reprocessing. A miss writes `processing` with a 5-minute TTL, then after `waitUntil` work succeeds writes `processed` with a 7-day TTL. Handler failure **deletes** the key so GitHub can retry. Missing delivery id is logged and processing continues without dedupe.
3. Parse JSON. Map Autofix envelopes (best-effort queue send; enqueue failure is logged, not a 5xx).
4. Return `{ ok: true }` immediately. Handler work, automation forward, and dedupe finalize run in `waitUntil`.

The bot never executes agent code. After ack it calls the control plane; the control plane creates a session Durable Object and a sandbox.

## Direct bot workflows

`dispatchHandler` switches on `X-GitHub-Event`:

| Event / action | Handler | Skip unless |
| --- | --- | --- |
| `pull_request` / `opened` | `handlePullRequestOpened` | Non-draft; auto-review enabled; repo in scope; sender allowed |
| `pull_request` / `review_requested` | `handleReviewRequested` | Requested reviewer is `GITHUB_BOT_USERNAME` |
| `issue_comment` / `created` | `handleIssueComment` | Issue is a PR; body mentions the bot; sender is not the bot |
| `pull_request_review_comment` / `created` | `handleReviewComment` | Body mentions the bot; sender is not the bot |

Unsupported events/actions skip. Mentions on ordinary issues skip (`not_a_pr`). Draft PRs skip auto-review (`draft_pr`); converting a draft to ready does not fire `opened` again — mention the bot instead.

GitHub settings (`getGitHubConfig` via signed `GET /integration-settings/github/resolved/:owner/:repo`) fail **closed** on fetch/parse errors: empty `enabledRepos` and `allowedTriggerUsers`, auto-review off. If no settings row exists, defaults are permissive: all App-accessible repos, auto-review on, `allowedTriggerUsers` null.

Caller gating (`resolveCallerGating`):

- Explicit `allowedTriggerUsers` → login must be on the list (case-insensitive).
- Otherwise GitHub collaborator permission must be `write`, `maintain`, or `admin`. A GitHub API error is `permission_check_failed` (skip, not a session).

These gates apply to **direct bot sessions only**. GitHub event automations use their own repository, event type, and conditions.

On accept, the bot posts 👀 (best-effort, concurrent with session create) and:

1. `resolveSessionTarget`
2. Signed `POST /sessions` with SCM identity (`scmLogin`, `scmUserId`, `scmAvatarUrl`) and actor `github:<numeric id>`
3. Signed `POST /sessions/:id/prompt` with `{ content, source: "github" }`

Each accepted webhook starts a **new** session. GitHub comments do not continue an existing session the way Slack thread replies do. Create currently sends repo or `environmentId` without a PR head branch, so comment-triggered sessions check out the repository default branch (or the environment workspace), not the PR head. Use mentions for review discussion; use the cloned PR in auto-review prompts (`gh pr diff`) rather than assuming the sandbox is on the PR branch.

A PR opened by the bot itself is **not** skipped. Auto-review still starts a session but `isSelfReview` restricts the review event to `COMMENT` because GitHub forbids authors approving their own PRs.

## defaultEnvironmentId targeting

`resolveSessionTarget` prefers a repository's `defaultEnvironmentId` from `GET /repos/:owner/:repo/metadata` so the session opens that environment's full workspace instead of a single-repo checkout (design §13.2). It **fails open** to `{ repoOwner, repoName }` when:

- metadata or environment fetch fails
- the environment 404s
- the environment no longer contains the trigger repository
- the sender is not authorized for every environment member

Authorization: if `allowedTriggerUsers` is set, the allowlist already vouched for the sender. Otherwise the sender needs write permission on **every other** environment repository (the trigger repo was already checked). An environment launch must not widen clones or pushes beyond what GitHub grants the sender.

Create-session fields are mutually exclusive: scalar repo **or** `environmentId`. See [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md).

## Prompts

`buildCodeReviewPrompt` (auto-review and review-requested) tells the agent it is on the PR head branch, to run `gh pr diff`, and to submit a review via `gh api` (`COMMENT|APPROVE|REQUEST_CHANGES`, or `COMMENT` only for self-review). Custom **Code Review Instructions** from GitHub settings are appended.

`buildCommentActionPrompt` (`@mention`) strips the bot mention, wraps the remainder as untrusted `<user_content>`, and for inline review comments includes file path, diff hunk, and a thread-reply `gh api` snippet. **Comment Action Instructions** are appended.

Untrusted wrapping applies to PR title, author, branches, description, and the triggering comment. Review-thread file/diff context is included as-is. Comment guidelines forbid pasting raw logs and leaking infrastructure; public repos get a stronger warning.

GitHub does **not** get a managed completion callback like Slack. After 👀, GitHub-facing output is written by the agent from inside the session (`gh api` / `gh pr`). Watch progress in the web app.

## Autofix queue ingress

Autofix is **not** a new github-bot session. It feeds review feedback into an **existing** Open-Inspect session that already owns the pull request.

`toAutofixEnvelope` returns a version-1 `GitHubAutofixEnvelope` or `null`:

| GitHub event | Envelope | Suppressed |
| --- | --- | --- |
| `issue_comment` / `created` on a PR | `eventType: issue_comment`, `providerObject.kind: pr_comment` | Comment body mentions the bot (that is the mention handler) |
| `pull_request_review` / `submitted` | `eventType: pull_request_review`, `providerObject.kind: review` | Parse failure |

The bot `send`s the envelope on `AUTOFIX_QUEUE`. The control-plane `queue` handler routes names starting with `open-inspect-github-autofix-` to `handleAutofixQueue`; other queues are image-build finalization.

`AutofixQueueConsumer` parses `githubAutofixEnvelopeSchema`. Invalid bodies retry. `AutofixService.process`:

1. `PrAutofixFeedbackStore.receive` — idempotent receipt keyed by the envelope.
2. Resolve the Open-Inspect PR owner (`SessionPullRequestStore.getByIdentity`). Untracked PRs skip (`untracked_pull_request`).
3. Recover an ambiguous prior dispatch by looking up the feedback key on the session.
4. Eligibility: Autofix enabled for the repo; `prCommentsEnabled` / `reviewsEnabled`; PR still open; author rules (human with write permission; allowed review bots; Open-Inspect's own reviews only if `openInspectReviewsEnabled`; explicit `@bot` PR comments skip as `explicit_mention` so they stay on the mention path).
5. Build an `enqueue_feedback` command (untrusted `github_feedback_data` prompt, attempt limit) and `POST` `SessionInternalPaths.autofix` on the owning session.

Permanent GitHub provider errors ack after marking failed. Other errors record, retry, and after `MAX_DELIVERY_ATTEMPTS` (5) mark `delivery_attempts_exhausted`. The minute cron's `checkAutofixQueueHealth` is observability (backlog / DLQ), not a consumer.

## Invariants and failure behavior

- Invalid webhook signature never creates a session or queue message.
- Duplicate `X-GitHub-Delivery` does not re-run direct bot handlers; Autofix idempotency is the feedback store plus session admission (`enqueued` / `duplicate`).
- Settings fetch failure disables direct bot workflows (empty allowlists), it does not open the floodgates.
- Autofix enqueue failure does not fail the webhook HTTP response; the mention/review path still runs in `waitUntil`.
- Automation forwarding is independent of whether the built-in handler skipped or processed.
- The bot is not the session runtime: losing the github-bot worker stops new ingress; in-flight sessions continue in the control plane.

## Extension seams

- New direct workflow: add a `dispatchHandler` case, a payload schema, and a handler that uses `createSession` / `sendPrompt`.
- New Autofix source: extend `toAutofixEnvelope` and `githubAutofixEnvelopeSchema` together.
- New GitHub automation event: extend the shared catalog; the bot already forwards any successful `normalizeGitHubEvent`.

## Focused tests

- Webhook signature, dedupe, handler dispatch, Autofix enqueue, automation forward: `packages/github-bot/test/webhook.test.ts`
- Autofix envelope mapping: `packages/github-bot/src/autofix-ingress.ts` (unit coverage via webhook tests)
- Session target fail-open: `packages/github-bot/src/session-target.ts` and neighboring tests
- Autofix consumer/service: `packages/control-plane/src/autofix/queue-consumer.test.ts`, `service.test.ts`
- Queue name split: `packages/control-plane/src/queue-routing.test.ts`
