---
type: integration
title: Slack Bot Integration
description: The Slack worker — signature-verified event ingress with best-effort KV dedupe, the deterministic-first classifier ladder targeting repos or environments, image and forwarded-message attachment handling, thread-session continuity, and HMAC completion callbacks delivered through a Durable Queue with a NO_REPLY decline policy.
tags: [slack, bots, classifier, queues, attachments]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-eca30dd1858d6d8d98f2f829
    resource: repo://packages/slack-bot/src/attachments.ts
  - id: openwiki-source-758c12c6ca80894f493cb774
    resource: repo://packages/slack-bot/src/callbacks.ts
  - id: openwiki-source-aefd34cc2c8dee6c14c41b3c
    resource: repo://packages/slack-bot/src/channel-trigger.ts
  - id: openwiki-source-538a90b2cd89e04b6e9e2146
    resource: repo://packages/slack-bot/src/classifier/cached-resource.ts
  - id: openwiki-source-df20d14680d14be53966b34f
    resource: repo://packages/slack-bot/src/classifier/index.ts
  - id: openwiki-source-d8c42dc10ad192db78495fdc
    resource: repo://packages/slack-bot/src/classifier/repos.ts
  - id: openwiki-source-fa5b77c7bd2aa22cebbce360
    resource: repo://packages/slack-bot/src/completion/consumer.ts
  - id: openwiki-source-5bca3d8e98aefc982076f67d
    resource: repo://packages/slack-bot/src/completion/delivery.ts
  - id: openwiki-source-86632a47b0628670540132f7
    resource: repo://packages/slack-bot/src/completion/media-upload.ts
  - id: openwiki-source-569acecef185837a6fd89803
    resource: repo://packages/slack-bot/src/events/message-handler.ts
  - id: openwiki-source-e297f5725191cfdb96978cec
    resource: repo://packages/slack-bot/src/request-options.ts
  - id: openwiki-source-5859dda156579909472ad28d
    resource: repo://packages/slack-bot/src/routes/events.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/slack-bot` turns Slack traffic into Open-Inspect sessions: @mentions and DMs (and optionally ambient channel messages for automations) start or continue sessions, and results return as thread replies. All control-plane access is sig1-signed service traffic as `slack-bot`, with actors asserted in the `slack` namespace.

## Event ingress (`src/routes/events.ts`)

`POST /events` runs in strict order: verify the Slack signing secret (`verifySlackSignature`; 401 otherwise) → echo `url_verification` challenges → **dedupe on `event:<event_id>` in `SLACK_KV` (1 h TTL)** → dispatch in `waitUntil`. The dedupe cache is deliberately **best-effort**: a KV outage logs `slack.event.dedupe_unavailable` and processes anyway, because returning 500 would drop the original work and guarantee a retry storm (`routes/events.ts:46–72`). The dispatcher (`events/dispatcher.ts:15–67`) routes `app_mention` and DMs into the session pipeline, suppresses bot-authored events via cached `auth.test` identity (`bot-identity.ts`), feeds ambient `message` events only to the automation channel-trigger path, and publishes App Home on `app_home_opened`.

## The session pipeline (`src/events/message-handler.ts`)

`handleIncomingMessage` assembles prompt text — image-only messages get a stand-in prompt; **forwarded/shared Slack messages** are quoted ahead of the user's text (`forwarded-messages.ts` caps 10 messages × 4000 chars and merges their images) — then:

1. **Thread continuity first.** If the channel/thread maps to a session (`thread:<channel>:<threadTs>` in KV), this is a follow-up: the `lastPromptTs` watermark advances so only *interim* thread discussion is forwarded, attachments are re-prepped, and `deliverPrompt` posts into the existing session with the original `callbackContext` (channel, threadTs, reaction message ts). A stale/terminated session clears the mapping and falls through; transient delivery failures early-return with a user-visible note (`message-handler.ts:176–259`).
2. **Classification.** Otherwise `RepoClassifier.classify` runs the ladder (`classifier/index.ts:339–430`), in this precedence:
   - **Routing rules** — operator keyword→target rules (`Settings › Integrations › Slack`, whole-token/phrase match via shared `matchRoutingRules`, max 100 rules). Runs *before* the single-repo shortcut on purpose: otherwise environment-targeted rules would be unreachable in one-repo workspaces (comment L361–368).
   - **Channel associations** — repos/environments declaring `channelAssociations` for this channel (deterministic stage 2, same rationale).
   - **Single-repo shortcut** — exactly one repo and zero environments ⇒ no choice to make.
   - **LLM classification** — `CLASSIFICATION_MODEL` via Anthropic tool-call (`classify_target`) or OpenAI structured output (shared's `resolveClassificationProvider`), fed a catalog of repo+environment names/descriptions and last-≤10 thread messages; low/medium-with-alternatives confidence sets `needsClarification`.
   Targets are `{kind:"repository"|"environment"}`; catalog load fetches repos (5 s bound; failure → `FALLBACK_REPOS` + alert) and environments (fail-open to `[]`) through the cached-resource ladder memory→loader→KV last-known-good (`classifier/cached-resource.ts`).
3. **Clarification.** Needs-clarification results store the pending request (with image file ids) in KV (1 h) and post a picker block; selection restores the pending request and re-fetches images (`interactions/target-selection.ts`, `target-clarification.ts`).
4. **Launch.** A "Working on *repo*…" ack + starting-status, then `startSessionAndPrompt`: signed `POST /sessions` (target fields incl. `environmentId`; branch/user preferences resolved — `branch-preferences.ts`, `user-preferences.ts`) and `POST /sessions/:id/prompt` carrying `{attachmentId, name}` references and the thread callback context; the thread→session mapping is stored, an 👀 reaction added, and the ack updated with a View Session button.

## Attachments (`src/attachments.ts`)

Slack `files` are normalized at ingress, **skipping any URL that isn't a trusted `*.slack.com` host** (`attachments.ts:99`; redirects off `*.slack.com` also fail rather than carry the token, L157 — the bot token must never be sent to arbitrary hosts); `prepareImageAttachments` enforces `SESSION_ATTACHMENT_IMAGE_MAX_BYTES` per file and `MAX_SESSION_ATTACHMENTS_PER_MESSAGE` per message, returning explicit `dropped` reasons that `notifyDroppedAttachments` tells the user about (silently losing an image is treated as a bug), and `uploadPreparedAttachments` pushes survivors to control-plane session attachments before the prompt references them.

## Completion path (`/callbacks` + Durable Queue)

Control-plane session callbacks arrive **HMAC-signed with the bot's own secret** (`verifyCallbackFromControlPlane` + signed-payload check over the raw bytes), then: `complete` and `automation-complete` do *not* deliver inline — they build a versioned job (`completion/job.ts:9–34`: `deliveryId`, source `session|automation`, channel/threadTs/reactionTs, repo/model context) and `SLACK_COMPLETION_QUEUE.send` it, answering **503 on enqueue failure** so the control plane's retry policy redelivers (`callbacks.ts:149–160, 188, 290`); `tool_call` updates the thread's "Working…" status best-effort; `automation-skip` posts the ephemeral "already active" notice.

The queue consumer (`completion/consumer.ts`) validates against `slackCompletionJobSchema` and **acks even on handler error** — Slack side effects (posting) may already have happened, and at-least-once would duplicate thread replies. `completion/delivery.ts` then: `extractAgentResponse` (paginated signed fetches of session events/artifacts) → blocks build (truncated error card on failure) → media upload (`media-upload.ts`: ≤5 files, 10 MiB each, 25 MiB total) → post → `finally` clear the 👀 reaction. The **NO_REPLY policy** (`shouldDeclineReply`, L38–49): for *automation-sourced* runs with success and no artifacts/media, an empty or case-insensitively `NO_REPLY` assistant text is **not posted** — unattended automations stay silent unless they produced something; interactive sessions always reply.

## Configuration and failure posture

Bindings (`types/index.ts:15–47`): `SLACK_KV`, `CONTROL_PLANE` (service binding), `SLACK_COMPLETION_QUEUE` (+ DLQ), `DEPLOYMENT_NAME`, `WEB_APP_URL`, `DEFAULT_MODEL`, `CLASSIFICATION_MODEL`; secrets `SLACK_BOT_TOKEN/SIGNING_SECRET/APP_TOKEN?`, `ANTHROPIC_API_KEY?`/`OPENAI_API_KEY?`, `SERVICE_AUTH_SECRET`. Outbound calls carry a 10 s deadline (`request-options.ts`). Fail-open everywhere on reads (settings `{}`, environments `[]`, routing rules cached) but **watched-channel sets fail closed**, and the `message`-event automation path normalizes + forwards to `/internal/slack-event` rather than launching sessions itself (the control-plane Scheduler owns that decision — see [Automation Engine](/openwiki/control-plane/automation-engine.md)).

Tests: `src/index.test.ts` (events/interactions suites), `classifier/index.test.ts` (ladder order incl. rules-beating-shortcut), `classifier/repos.test.ts`, `callbacks.test.ts` (HMAC, enqueue-503), `completion/delivery.test.ts` (NO_REPLY matrix), `completion/media-upload.test.ts`, `events/message-handler` coverage via prompt-delivery and session-launcher suites, `routes/events.test.ts:72` (dedupe degrade).
