---
type: integration
title: Slack Bot
description: Slack Events API worker that maps threads to coding sessions, classifies repository or environment targets, forwards attachments, and posts completion replies through a queue.
tags: [slack, slack-bot, threads, classifier, attachments]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-df20d14680d14be53966b34f
    resource: repo://packages/slack-bot/src/classifier/index.ts
  - id: openwiki-source-c0e80fdc2a400914997b5eac
    resource: repo://packages/slack-bot/src/classifier/routing.ts
  - id: openwiki-source-fa5b77c7bd2aa22cebbce360
    resource: repo://packages/slack-bot/src/completion/consumer.ts
  - id: openwiki-source-5bca3d8e98aefc982076f67d
    resource: repo://packages/slack-bot/src/completion/delivery.ts
  - id: openwiki-source-a4b060c128054bf222841711
    resource: repo://packages/slack-bot/src/events/dispatcher.ts
  - id: openwiki-source-569acecef185837a6fd89803
    resource: repo://packages/slack-bot/src/events/message-handler.ts
  - id: openwiki-source-1a9a5b77602b7449e74381f6
    resource: repo://packages/slack-bot/src/index.ts
  - id: openwiki-source-b5b087f7853b3b93760d3f49
    resource: repo://packages/slack-bot/src/internal-auth.ts
  - id: openwiki-source-5859dda156579909472ad28d
    resource: repo://packages/slack-bot/src/routes/events.ts
  - id: openwiki-source-281b05f4aeebb4670c581155
    resource: repo://packages/slack-bot/src/sessions/session-launcher.ts
  - id: openwiki-source-343e9821b3fcb6392cf703fd
    resource: repo://packages/slack-bot/src/sessions/thread-session-store.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Slack Bot

The Slack bot (`packages/slack-bot`) is a Cloudflare Worker that turns Slack DMs and `@mention`s into Open-Inspect coding sessions and posts results back into the same thread. It is a **signed HTTP client** of the control plane (`sig1` as service `slack-bot` through `CONTROL_PLANE`). It does not host sessions.

Operator setup is in `docs/integrations/SLACK.md`. **Channel-message automations** (ambient watched-channel triggers, 👀, `NO_REPLY`, 7-day thread steering) are documented in [Automations and Inbound Triggers](/openwiki/integrations/automations.md). This page is the interactive bot: mention/DM → classify → session → thread mapping → completion. Related: [Control Plane](/openwiki/architecture/control-plane.md), [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md), [Session Lifecycle](/openwiki/workflows/session-lifecycle.md).

## Responsibility and ownership

| Piece | Owner |
| --- | --- |
| Worker `fetch` + `queue` | `packages/slack-bot/src/index.ts` |
| HTTP routes | `app.ts`: `/events`, `/interactions`, `/callbacks`, `/health`, thread-context |
| Event dispatch | `events/dispatcher.ts` |
| Mention / DM / thread follow-up | `events/message-handler.ts` |
| Target classifier | `classifier/` |
| Session create + first prompt | `sessions/session-launcher.ts` |
| Thread→session KV | `sessions/thread-session-store.ts` |
| Completion queue consumer | `completion/consumer.ts` + `delivery.ts` |

There are no Slack slash commands. In channels, interactive work requires `@mention`. DMs do not.

## Ingress

`POST /events` verifies `x-slack-signature` + `x-slack-request-timestamp` against `SLACK_SIGNING_SECRET`. Invalid → 401. `url_verification` returns the challenge. `event_id` is stored in `SLACK_KV` as `event:<id>` for one hour; duplicates ack `{ ok: true }`. KV failure is **degraded**: the event is still processed so Slack retries do not drop work.

`handleSlackEvent` ignores `bot_id`. Then:

| Event | Path |
| --- | --- |
| `app_home_opened` tab `home` | Publish App Home (personal model / reasoning / branch defaults) |
| DM (`isDmDispatchable`) | `handleDirectMessage` — mention not required |
| `app_mention` | `handleAppMention` |
| other `message` | `handleChannelTrigger` → automations (see [Automations](/openwiki/integrations/automations.md)) |

Work runs in `waitUntil` after a 200 ack.

## Thread-session mapping

Interactive sessions are keyed `thread:{channel}:{threadTs}` in `SLACK_KV` with a 7-day TTL (`THREAD_SESSION_TTL_MS`). The mapping stores `sessionId`, target label, model, optional `lastPromptTs`.

`handleIncomingMessage`:

1. Empty text **and** no images **and** no forwarded body → ask the user to include a request.
2. If `threadTs` has a mapping, treat the message as a **follow-up**: `POST /sessions/:id/prompt` with `source: slack`, interim thread context since `lastPromptTs` (human messages only), attachments, and `callbackContext` including `reactionMessageTs`. 👀 on the follow-up. Stale session (non-transient prompt failure) **clears** the mapping and falls through to a new launch.
3. Otherwise classify a target and `startSessionAndSendPrompt`. The thread key is `threadTs || ts` (a top-level message becomes its own thread).

A new top-level DM is a new request. Replies in the thread created for that DM continue the session. Image-only requests that lose every image never create a session.

## Target classification

`RepoClassifier.classify` loads a catalog of repositories and environments (environment fetch fails open to `[]`). Thread mapping is already handled; classify never overrides an active thread.

| Stage | Result |
| --- | --- |
| Routing rules (`matchRoutingRules` on the message) | Exactly one catalog-backed target → launch; several distinct targets → clarification; zero → next stage. Rules whose repo/environment is gone are skipped. |
| Channel associations | Exactly one associated target (environments listed first) → launch. Several associations **including an environment** → clarification. Several repos only → fall through so the LLM can weigh channel context. |
| Single-repo shortcut | One repo and **no** environments → that repo. Routing rules and channel associations run **before** this so an environment-targeted rule still works in a one-repo workspace. |
| LLM | Anthropic tool-use or OpenAI structured output (`CLASSIFICATION_MODEL`) over the catalog plus channel/thread context. `env_…` ids match environments; otherwise repos by id/fullName then environments by name. |

Uncertain classification stores a **pending request** (text, forwarded bodies, image source ts) and posts a Slack dropdown (`buildTargetClarificationBlocks`). Interactions resolve the pending request and launch with the original images re-fetched from Slack.

Empty catalog → tell the user no repositories/environments are available.

## Session launch

`startSessionAndSendPrompt`:

1. Download image bytes **before** create. Image-only with zero surviving files returns null.
2. Resolve user prefs (App Home) against enabled models; optional per-repo branch preference.
3. Signed `POST /sessions` with mutually exclusive repo or `environmentId`, actor `slack:<userId>`.
4. `deliverPrompt` with channel/thread context, optional Slack `sessionInstructions`, attachments as `{ attachmentId, name }`.
5. `storeThreadSession` for 7 days.

Inbound images: PNG/JPEG/WebP/GIF, at most `MAX_SESSION_ATTACHMENTS_PER_MESSAGE`, 10 MiB each, Slack-hosted `url_private` + `files:read`. Forwarded/shared Slack messages quote text (and their images) into the prompt. Remote files and non-image attachments are not forwarded.

## Completion posting

Control plane POSTs signed `/callbacks/complete` (and `/tool_call`, plus automation-complete/skip used by the scheduler). Interactive completion is enqueued on a Cloudflare Queue; `consumeSlackCompletions` always **acks** after `processSlackCompletion` so a retry cannot double-post Slack side effects.

`processSlackCompletion` extracts the agent response, posts blocks into the thread (session link, PRs), optionally uploads up to five generated media files (10 MiB each, 25 MiB total), and clears 👀.

`NO_REPLY` (or empty text) **declines** posting **only** when `job.source === "automation"` and there are no artifacts. Interactive `@mention`/DM sessions always post; empty agent text becomes a completion fallback. See [Automations](/openwiki/integrations/automations.md) for why automations need the sentinel.

Internal `/internal/thread-context` serves the scheduler's post-admission Slack thread history fetch (HMAC from control plane).

## Invariants and failure behavior

- Invalid Slack signatures never start sessions.
- Event-id KV is best-effort; processing continues if KV is down.
- Thread mapping TTL is 7 days and does not slide on follow-up (follow-up advances `lastPromptTs` only).
- Classification never guesses when several routing rules or mixed channel associations match.
- Image-only with zero downloaded images does not create a session or enqueue an empty follow-up.
- The bot is not the session runtime.

## Extension seams

- New event type: `handleSlackEvent` in `events/dispatcher.ts`.
- New deterministic routing stage: insert in `RepoClassifier.classify` before the LLM.
- New completion artifact type: `completion/delivery.ts` + `media-upload.ts`.

## Focused tests

- Events signature, dedupe, url_verification: `packages/slack-bot/src/routes/events.test.ts`
- Dispatch / mention / DM: `packages/slack-bot/src/events/` plus `dm-utils.test.ts`
- Classifier stages: `packages/slack-bot/src/classifier/index.test.ts`
- Session launcher / thread store: `packages/slack-bot/src/sessions/*.test.ts`
- Attachments and forwards: `attachments.test.ts`, `forwarded-messages.test.ts`
- Completion / `NO_REPLY`: `completion/delivery.test.ts`, `consumer.test.ts`
- Channel triggers (automations ingress only): `channel-trigger.test.ts`
