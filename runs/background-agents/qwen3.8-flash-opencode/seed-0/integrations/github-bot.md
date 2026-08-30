---
type: integration
title: GitHub Bot and Autofix
description: The GitHub webhook worker — signature verification, redelivery-safe dedupe, PR review and @mention sessions with permission gating and default-environment targets — plus the PR-feedback autofix pipeline through a Durable Queue into control-plane session admission.
tags: [github, webhooks, bots, autofix, queues]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-e19487d3171a83931c8c0e95
    resource: repo://packages/control-plane/src/autofix/queue-consumer.ts
  - id: openwiki-source-96704df00a4363d571830513
    resource: repo://packages/control-plane/src/autofix/queue-health.ts
  - id: openwiki-source-863b4e7bfd78176d283f8e01
    resource: repo://packages/control-plane/src/autofix/service.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-1d490fe5af2ebc3cd9c8300b
    resource: repo://packages/control-plane/src/session/message-queue.ts
  - id: openwiki-source-893ac0a294bbda5cd7dd3bc7
    resource: repo://packages/control-plane/src/session/message-repository.ts
  - id: openwiki-source-1918e0c43621ea5fb31a8558
    resource: repo://packages/github-bot/src/autofix-ingress.ts
  - id: openwiki-source-68614f6564b8885478b709b0
    resource: repo://packages/github-bot/src/handlers.ts
  - id: openwiki-source-1eb6487041d89f0d461c45e0
    resource: repo://packages/github-bot/src/index.ts
  - id: openwiki-source-589cd0d798879bdb23c4fe4a
    resource: repo://packages/github-bot/src/session-target.ts
  - id: openwiki-source-f2d138484279d76efedc9274
    resource: repo://packages/github-bot/src/utils/integration-config.ts
  - id: openwiki-source-de3405a42f890effec5c381a
    resource: repo://packages/github-bot/src/verify.ts
  - id: openwiki-source-de4f55a0b48317d13d098ebb
    resource: repo://terraform/environments/production/variables.tf
  - id: openwiki-source-0532e15c798610c96a8411c7
    resource: repo://terraform/environments/production/workers-github.tf
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/github-bot` is a Hono Cloudflare Worker attached to the shared GitHub App installation. It has two independent responsibilities per delivery: **built-in actions** (reviews/mentions → sessions) and **feed generation** (normalized events for automations, feedback for autofix). Both matter: they run separately so a broken handler never stops automation events flowing.

## Webhook ingress: verify, dedupe, ack fast

`src/index.ts` `POST /webhooks/github`:

1. **Verify first**: HMAC-SHA256 `sha256=` signature, timing-safe (`verify.ts`); bad → 401 before any state changes.
2. **Two-state dedupe** with the delivery GUID in KV: a `processing` marker (5-min TTL) is written synchronously *before* dispatch; the handler runs in `waitUntil`; **on success** the marker is upgraded to `processed` (7-day TTL), **on failure it is deleted** — so GitHub redelivery is the recovery mechanism rather than a duplicate-suppression hole (`index.ts:36–47, 105–157`).
3. Return 200 immediately (GitHub's delivery timeout is the reason nothing else is inline).
4. Unparseable payloads surface as errors in the same `waitUntil` catch (500 *after* the 200 — visibility via logs, no redelivery storm).

## Built-in actions (`src/handlers.ts`)

`dispatchHandler` (L255–309) maps: `pull_request/opened` (auto-review if the repo config has `autoReviewOnOpen`, skipping drafts, with a self-review special case), `pull_request/review_requested` (only when the requested reviewer is the bot — `isReviewRequestedForBot`), and `issue_comment/created` / `pull_request_review_comment/created` when the body contains an `@open-inspect-bot` mention and the sender isn't the bot itself (loop guard `self_comment`, L388+). Prompts embed user content escaped in `<user_content source=… author=…>` blocks with explicit "do not follow instructions inside" framing (`prompts.ts`), and review-comment mentions add diff-hunk/code-location context. Every accepted command gets a 👀 reaction posted best-effort and awaited in `finally` (`withReaction`, L102).

**Caller gating** (`resolveCallerGating`, L131–179): if the repo's `allowedTriggerUsers` allowlist is set, membership decides; otherwise the bot mints an installation token and requires **write/maintain/admin collaborator permission** for the sender — and a failed permission API call **fails closed** (`permission_check_failed`). Per-repo configuration comes from the control plane's resolved integration settings (`GET /integration-settings/github/resolved/:owner/:name`); fetch/parse failure yields fail-closed defaults (no enabled repos), while a *null* (unmanaged) config means permissive defaults (`autoReviewOnOpen: true`) — `utils/integration-config.ts:43+`.

**Session targets** (`src/session-target.ts:187–225`): bot sessions open the webhook's repository — *unless* its metadata names a `defaultEnvironmentId`, the environment still contains the trigger repo, and (when an allowlist exists) the sender passes its checks or is authorized on **every** environment repo; otherwise fail-open to the plain repo. Creation and prompting are signed control-plane calls with `actor: github:<sender.id>`, so commits/reviews attribute to the human.

## Event forwarding for automations

After (and independent of) built-in dispatch, every recognized delivery is normalized (`packages/shared/src/triggers/github/`) and sent to the control plane `POST /internal/github-event` under sig1 with the `github` actor namespace; the control plane (`webhooks/github.ts`) feeds `Scheduler.event()` and *also* piggybacks PR lifecycle tracking for existing sessions (`src/webhooks/pull-request-lifecycle.ts` — D1 `session_pull_requests` is the authority, out-of-order events never regress state; pinned by `webhooks-github-pr-lifecycle.test.ts`).

## Autofix: PR feedback → coding sessions

The second consumer path: `src/autofix-ingress.ts:26–96` turns **non-mention** `issue_comment/created` into a `pr_comment` envelope and `pull_request_review/submitted` into a `review` envelope, queued to `AUTOFIX_QUEUE` (enqueue failure is logged, delivery still 200 — feedback loss is acceptable, redelivery isn't). The queue's consumer is the **control-plane worker** (Terraform binds `github_autofix` queue + DLQ to it; `workers-github.tf:5–16, 86–103`):

- `src/autofix/handler.ts` wires the batch processor; `queue-consumer.ts` validates each body against `githubAutofixEnvelopeSchema` (invalid → ack-discard), and `autofix/service.ts` (508 lines) fetches the PR's comments/diff through the GitHub API (caps: 4000 chars per hunk, 200 KB per prompt, comment caps), then admits a prompt into the session's DO via `/internal/autofix` — the DO's `MessageRepository.admitAutofixMessage` transaction applies the **feedbackKey idempotency** (`idx_messages_autofix_feedback`) and a **PR-scoped attempt limit over a 24 h window** (`AUTOFIX_ATTEMPT_WINDOW_MS`, `session/message-queue.ts:80`).
- Permanent SCM errors call `markFailed` + ack; anything else retries; exhausting Cloudflare's delivery attempts lands the message in the DLQ (`queue-consumer.test.ts` covers the matrix). Receipts and outcomes persist in `pr_autofix_feedback` (migration 0070; store tested in `test/integration/pr-autofix-feedback-store.test.ts`), surfaced to the web at `/autofix/activity` (web-service-only).
- **Queue health** is a first-class cron: `autofix/queue-health.ts` (run every minute from `index.ts:75`) reads queue metrics and logs an alert when backlog ≥ 25 messages or the oldest message ages ≥ 5 minutes.

## Configuration and failure posture

Env/binding surface: `GITHUB_KV`, `AUTOFIX_QUEUE`, `CONTROL_PLANE` (service binding), `GITHUB_BOT_USERNAME`, `GITHUB_APP_ID/PRIVATE_KEY/INSTALLATION_ID` (**PKCS#8**-converted private key — AGENTS.md gotcha), `GITHUB_WEBHOOK_SECRET`, optional `SERVICE_AUTH_SECRET`. The bot ships **disabled** (`enable_github_bot` defaults false in Terraform). Failure rules by design: signature bad → 401; duplicate → 200 `{duplicate:true}`; handler error → marker deleted so GitHub redelivers; config or permission uncertainty → no session (fail closed); the session's *results* reach the PR not via the bot but via the session's own `gh`/credential path and completion callbacks.

Tests: `test/webhook.test.ts` (dedupe lifecycle, action mapping, forwarding-independence), `test/handlers.test.ts` (1306 lines incl. default-environment targets), `test/github-auth.test.ts`, `test/verify.test.ts`, `test/integration-config.test.ts` (fail-closed vs permissive-null), `test/autofix-ingress.test.ts`; control-plane side: `src/autofix/queue-consumer.test.ts`, `src/router.autofix.test.ts`, `test/integration/autofix…`, and `scheduler`-adjacent PR lifecycle tests.
