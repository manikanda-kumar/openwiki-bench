---
type: integration
title: Slack Integration (slack-bot)
description: How the Open-Inspect Slack bot worker ingests @mentions, DMs, and watched-channel triggers, classifies and clarifies the target repo or environment, keeps thread sessions alive, and delivers completions and media through a Cloudflare Queue.
tags: [slack, integration, worker, classifier, queue, app-home]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-a5f7b7e94afb6e66b03f14ce
    resource: repo://packages/control-plane/src/routes/slack-notify.ts
  - id: openwiki-source-b4fcd225b1d428a7ab560a2d
    resource: repo://packages/control-plane/src/sandbox/sandbox-env.ts
  - id: openwiki-source-a284e58575edc3f9f37c0932
    resource: repo://packages/shared/src/types/session-attachments.ts
  - id: openwiki-source-585a1be82969598c3a97988b
    resource: repo://packages/slack-bot/slack-app-manifest.yaml
  - id: openwiki-source-1819858bcd8f56c648fd8cc7
    resource: repo://packages/slack-bot/src/activity-status.ts
  - id: openwiki-source-189e7cb51e3598c97d1515f3
    resource: repo://packages/slack-bot/src/app-home/constants.ts
  - id: openwiki-source-2899740b16222a2f52931c0d
    resource: repo://packages/slack-bot/src/app-home/interactions.ts
  - id: openwiki-source-b775987a8ae25f7651e9812a
    resource: repo://packages/slack-bot/src/app-home/view.ts
  - id: openwiki-source-6967c1960b5a4674f0b98899
    resource: repo://packages/slack-bot/src/app.ts
  - id: openwiki-source-eca30dd1858d6d8d98f2f829
    resource: repo://packages/slack-bot/src/attachments.ts
  - id: openwiki-source-758c12c6ca80894f493cb774
    resource: repo://packages/slack-bot/src/callbacks.ts
  - id: openwiki-source-aefd34cc2c8dee6c14c41b3c
    resource: repo://packages/slack-bot/src/channel-trigger.ts
  - id: openwiki-source-79a964d8ee21f97d94a9ad48
    resource: repo://packages/slack-bot/src/classifier/catalog.ts
  - id: openwiki-source-1e7bddf5da4ab8e5171cc2fc
    resource: repo://packages/slack-bot/src/classifier/control-plane.ts
  - id: openwiki-source-df20d14680d14be53966b34f
    resource: repo://packages/slack-bot/src/classifier/index.ts
  - id: openwiki-source-d8c42dc10ad192db78495fdc
    resource: repo://packages/slack-bot/src/classifier/repos.ts
  - id: openwiki-source-c0e80fdc2a400914997b5eac
    resource: repo://packages/slack-bot/src/classifier/routing.ts
  - id: openwiki-source-6934413ff393652baa2cb090
    resource: repo://packages/slack-bot/src/completion/blocks.ts
  - id: openwiki-source-fa5b77c7bd2aa22cebbce360
    resource: repo://packages/slack-bot/src/completion/consumer.ts
  - id: openwiki-source-5bca3d8e98aefc982076f67d
    resource: repo://packages/slack-bot/src/completion/delivery.ts
  - id: openwiki-source-86632a47b0628670540132f7
    resource: repo://packages/slack-bot/src/completion/media-upload.ts
  - id: openwiki-source-256d21bc53ad36f13990e368
    resource: repo://packages/slack-bot/src/dm-utils.ts
  - id: openwiki-source-a4b060c128054bf222841711
    resource: repo://packages/slack-bot/src/events/dispatcher.ts
  - id: openwiki-source-569acecef185837a6fd89803
    resource: repo://packages/slack-bot/src/events/message-handler.ts
  - id: openwiki-source-956a9f828ee2c2eeb4158f75
    resource: repo://packages/slack-bot/src/forwarded-messages.ts
  - id: openwiki-source-95feac1b61f6183afa0408ab
    resource: repo://packages/slack-bot/src/index.test.ts
  - id: openwiki-source-1a9a5b77602b7449e74381f6
    resource: repo://packages/slack-bot/src/index.ts
  - id: openwiki-source-38957964a279e7fa7c1dd4c3
    resource: repo://packages/slack-bot/src/interactions/dispatcher.ts
  - id: openwiki-source-885e9df642979babfd5f2b59
    resource: repo://packages/slack-bot/src/interactions/target-selection.ts
  - id: openwiki-source-b5b087f7853b3b93760d3f49
    resource: repo://packages/slack-bot/src/internal-auth.ts
  - id: openwiki-source-e58018d061eb93a3cb720b07
    resource: repo://packages/slack-bot/src/messages/blocks.ts
  - id: openwiki-source-4129fbfed747173fec78e9db
    resource: repo://packages/slack-bot/src/pending-requests/pending-request-store.ts
  - id: openwiki-source-e297f5725191cfdb96978cec
    resource: repo://packages/slack-bot/src/request-options.ts
  - id: openwiki-source-5859dda156579909472ad28d
    resource: repo://packages/slack-bot/src/routes/events.ts
  - id: openwiki-source-aa3faacdc9a3504889e28f42
    resource: repo://packages/slack-bot/src/routes/interactions.ts
  - id: openwiki-source-b2fe62bff8650987c39de531
    resource: repo://packages/slack-bot/src/routes/thread-context.ts
  - id: openwiki-source-afa17564be8e22fec0fc9e87
    resource: repo://packages/slack-bot/src/sessions/control-plane-client.ts
  - id: openwiki-source-0f761e32786f757184d56ae2
    resource: repo://packages/slack-bot/src/sessions/prompt-delivery.ts
  - id: openwiki-source-281b05f4aeebb4670c581155
    resource: repo://packages/slack-bot/src/sessions/session-launcher.ts
  - id: openwiki-source-343e9821b3fcb6392cf703fd
    resource: repo://packages/slack-bot/src/sessions/thread-session-store.ts
  - id: openwiki-source-207244593e7f841d5b26c15a
    resource: repo://packages/slack-bot/src/target-clarification.ts
  - id: openwiki-source-7c2598a3a266fed53e591e0a
    resource: repo://packages/slack-bot/src/thread-context.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Slack Integration (slack-bot)

The Slack integration is a Cloudflare Worker (`@open-inspect/slack-bot`) that lets
teams start coding sessions from Slack, continue them in the same thread, set
personal defaults on the App Home tab, and watch channels for automation
triggers. The worker owns every Slack-facing concern — signature verification,
event and interaction routing, target classification and clarification UI,
thread-to-session continuity, App Home preferences, completion delivery, and
agent-initiated Slack notifications — while the control plane owns sessions,
runs, and automation matching.

## Worker shape and entrypoints

The worker exports a single default object with a Hono `fetch` handler and a
Cloudflare Queue consumer:

- `fetch` dispatches to `/health`, `/events`, `/interactions`, `/callbacks`, and `/internal/thread-context` routes.
- `queue` runs `consumeSlackCompletions` over the `SLACK_COMPLETION_QUEUE` binding.

All completion replies are delivered asynchronously through the queue; the
worker never blocks a Slack callback response on the control plane's agent
result.

## Ingress: event and interaction routes

### `/events` — Slack Events API

`POST /events` verifies the Slack signature (5-minute replay window via
`verifySlackSignature`), parses the payload against `slackEventPayloadSchema`,
answers the `url_verification` handshake, dedupes Slack retries for one hour in
KV under `event:<event_id>`, then runs the event handler inside
`waitUntil` for a 200 ack. The dedupe KV write is best-effort: if it fails the
event is processed anyway rather than 500-ing the original delivery. Event
dispatch (`events/dispatcher.ts`) ignores bot-authored events and routes:

- `app_home_opened` on the home tab → republish App Home for that user
- DM-dispatchable messages (direct `message` events in `im` channels, including image-only `file_share`) → `handleDirectMessage`
- `app_mention` → `handleAppMention`, which strips the mention, recovers files/attachments from conversation history when the event omits them, and folds in channel name/description
- any other `message` → `handleChannelTrigger` (watched-channel automations)

`isDmDispatchable` accepts `file_share` subtypes with no text when files or
attachments are present, and `isChannelTriggerCandidate` suppresses messages
that mention the bot so a mention is never double-handled by both paths.

### `/interactions` — Slack interactivity payloads

`POST /interactions` verifies the signature, parses the form-encoded
`payload` JSON, and handles three shapes:

- **App Home interactions** (`app-home/interactions.ts`) — model/reasoning-effort selectors, branch modals, `select_repo_branch_override` suggestions, and `clear_repo_branch_override` run through `handleAppHomeInteractionRoute`; most are awaited inline, others scheduled via `waitUntil`.
- **`block_suggestion`** — the target clarification picker (`select_repo`) is answered synchronously with `getTargetClarificationOptions`; the App Home repo-branch picker is answered through the App Home route. Suggestion responses are the only synchronous Slack interaction replies.
- **Other `block_actions`** — dispatched to `handleSlackInteraction`, where `select_repo` and `select_repo_quick_pick` route into `handleTargetSelection` and `view_session` is a no-op. The route acks with `{ ok: true }` after scheduling the background work.

Repos for both pickers come from `loadTargetCatalog` and are filtered by
`filterReposByQuery` (case-insensitive full-name substring; empty query returns
all). The clarification picker returns the full list up to
`MAX_REPO_SUGGESTION_OPTIONS` (100, Slack's per-response ceiling) grouped as
Environments then Repositories when environments exist. The old 5-option cap
was replaced by the 100-option full list.

## Target classification

`RepoClassifier.classify` decides which repository or environment a message
refers to, working over a `TargetCatalog` (repos + environments) loaded once
per classification. Stages run in strict order:

1. **Active thread** — handled before classification: if the thread already maps to a session, the message is a follow-up prompt and no classification occurs.
2. **Routing rules** — deterministic keyword → repo/environment rules fetched from the control plane (`/integration-settings/slack`), evaluated by `matchRoutingRules`. One match → high-confidence result; several distinct matches → clarification with the matched targets as alternatives; rules whose target is not in the catalog are skipped.
3. **Channel associations** — a channel associated with exactly one target resolves deterministically; several associated targets including an environment ask for clarification (channel associations are not part of the LLM prompt, so a multi-target set with an environment is resolved deterministically rather than risked on the model).
4. **Single-repo shortcut** — with exactly one repo and zero environments, that repo wins without an LLM call. The shortcut is suppressed when any environment exists.
5. **LLM classification** — structured output via the `classify_target` tool (`targetId`, `confidence`, `reasoning`, `alternatives`). Anthropic uses the Messages API with forced tool use and a timeout (`CLASSIFICATION_REQUEST_TIMEOUT_MS`); OpenAI uses strict JSON-schema chat completions driven from the same tool schema. The result target, alternatives, deduped and excluding the match, are resolved against the catalog by `matchTargetId`.

`needsClarification` is true when the LLM produced no target, confidence is
low, or confidence is medium with alternatives. Any provider failure, timeout,
unbound provider key, or unrecognized model prefix degrades to the picker with
a "could not classify" message. An empty catalog (no repos, no environments)
short-circuits to clarification with the "no repositories or environments are
currently available" message.

The classification prompt includes the repo catalog
(`buildRepoDescriptions`: id, fullName, aliases, keywords, default branch,
private flag), saved environments with their repository lists, and a context
section (channel name/description, whether in a thread, and the previous
thread messages since the last prompt). All reasoning rendered into Slack
passes through `escapeMrkdwnText` — environment names are arbitrary user text
and must never become live mentions.

## Clarification UI and selection

`target-clarification.ts` owns the picker UI shown when the classifier cannot
decide. The message posts the classifier's reasoning, up to
`MAX_TARGET_QUICK_PICKS` (5) one-click quick-pick buttons for the ranked
alternatives (disambiguated when two targets share a display name), and a
picker over every available target — `static_select` when the total fits under
100 options, `external_select` with `min_query_length: 0` otherwise. Button
values and picker option values use `targetValue`: a bare repo id
(`owner/name`) or `env:<id>` for an environment, decoded by `parseTargetValue`.

When a clarifying message is posted, the original request is persisted in KV
(`pending:<channel>:<threadKey>`, 1-hour TTL) with only the source-message
locator (`{ ts, threadTs }`) for images — never the file objects or
URL-bearing Slack payloads. On selection (`handleTargetSelection`), the target
is re-resolved against the live list (a deleted environment or revoked repo
repo is reported "no longer available"), images are re-fetched from Slack, the
pending request is deleted after a successful launch, and the ack message
becomes the new `lastPromptTs` checkpoint. If the pending request expired, the
bot posts "couldn't find your original request" and the user resends.

## Message flow and thread continuity

`handleIncomingMessage` (events/message-handler.ts) routes each interactive
message:

- **No runnable content** — posts "Hi! Please include a message with your request."
- **Existing thread session** — fetches the last 10 relevant thread messages (`selectThreadWindow` capped at `THREAD_HISTORY_MESSAGE_LIMIT`, excluding the current message and, when `lastPromptTs` exists, only messages strictly after it; `conversations.replies` paginates the full window so the newest messages survive the cap), renders them as `[speaker]: text` lines with resolved display names, and sends the follow-up prompt via `deliverPrompt`. On success the thread mapping's `lastPromptTs` advances to the triggering message ts; on a stale 404 the mapping is cleared and the message is treated as a new request (the classifier re-runs against full thread history); on a transient failure the mapping is preserved and the user is asked to retry.
- **New request** — classifies, posts "Working on `*label*`..." with a View Session button once the session exists, sets the `Starting...` assistant-thread status before session creation, and launches through `startSessionAndSendPrompt`.

```mermaid
sequenceDiagram
    participant U as Slack user
    participant S as Slack API
    participant B as slack-bot worker
    participant CP as control plane
    U->>S: @mention or DM or thread reply
    S->>B: POST /events (signed)
    B->>B: verify signature, dedupe, waitUntil handler
    alt thread has a session mapping
        B->>S: fetch thread history since lastPromptTs
        B->>CP: POST /sessions/:id/prompt (sig1, actor header)
    else new request
        B->>CP: GET /repos + /environments (catalog)
        B->>CP: classify (LLM or deterministic)
        alt needsClarification
            B->>S: post clarification picker; store pending:key
            U->>S: pick target
            S->>B: POST /interactions (signed)
            B->>CP: POST /sessions (create the session)
        end
        B->>CP: POST /sessions (create then prompt)
    end
    CP-->>B: POST /callbacks/complete (HMAC signed)
    B->>B: enqueue SLACK_COMPLETION_QUEUE
    B->>S: post completion blocks in thread, clear eyes reaction
```

### Session launch and prompt delivery

`startSessionAndSendPrompt` downloads attached images before creating a
session (an image-only request that lost every image never creates a session),
resolves user preferences (model, reasoning effort, branch) with per-repo
branch override taking priority over the global branch, creates the session
through the control plane, and appends workspace `sessionInstructions` to the
first prompt. `deliverPrompt` is the single sequencing point for attachments:
upload prepared images, send the prompt with `{ attachmentId, name }`
references, and notify about dropped images only once the prompt result is
known — uploads against a stale session fail spuriously and are retried
against the replacement session. An image-only prompt whose uploads all fail
with 404 surfaces "stale" so the caller relaunches on a fresh session rather
than reporting drops.

The create-session and prompt bodies never carry identity fields
(`actorDisplayName` and `actorEmail` are the only actor data in the body;
`actorUserId`, `spawnSource`, and `slackUserId` are omitted). Identity rides
the signed `X-OpenInspect-Actor` assertion (`slack:<userId>`), which the
control plane enforces — the body is ignored for identity from verified
callers.

### Thread session store

The thread-to-session mapping lives in KV under `thread:<channel>:<threadTs>`
with a 7-day TTL (`THREAD_SESSION_TTL_MS`), holding `sessionId`, `repoId`,
`repoFullName`, `model`, `reasoningEffort`, `createdAt`, and `lastPromptTs`.
`advanceLastPromptTs` re-reads the mapping and only writes when the new ts is
strictly newer, so concurrent follow-ups completing out of order never move
the checkpoint backwards; a lost KV race only re-includes a few
already-forwarded messages. A stale mapping (prompt 404) is cleared so a dead
session is never resurrected.

### Attachments (inbound images)

Images are normalized once at ingress into `SlackImageAttachment`
(`toImageAttachments`): only supported MIME types (PNG, JPEG, WebP, GIF) on
Slack-hosted URLs are kept — remote (`mode: "external"`) and non-Slack-hosted
files are skipped so the bot token never leaves Slack's domains. Downloads use
`Authorization: Bearer` with `redirect: "manual"` so a redirect off
`*.slack.com` cannot carry the token, capped at
`SESSION_ATTACHMENT_IMAGE_MAX_BYTES` (10 MiB) and
`MAX_SESSION_ATTACHMENTS_PER_MESSAGE` (6) per message. This path requires the
`files:read` bot scope. Forwarded (shared) messages recover their body,
source permalink/channel/ts, and image files up to 10 forwards, 4,000
characters of body each.

## Completion delivery through the queue

### Callbacks → queue

The control plane posts completion and tool-call notifications to
`/callbacks/complete`, `/callbacks/tool_call`, `/callbacks/automation-complete`,
and `/callbacks/automation-skip`. Every route validates the payload shape,
requires `SERVICE_AUTH_SECRET`, and verifies the in-body HMAC signature
(`verifyCallbackFromControlPlane` — the control plane signs callbacks with the
bot's own per-service secret). Completions are stamped to `deliveryId`
(uuid) and enqueued to `SLACK_COMPLETION_QUEUE` with `contentType: "json"`;
an enqueue failure returns 503. A `/callbacks/complete` whose context carries
`automationId` is marked `source: "automation"` so a thread follow-up on an
automation stays eligible to decline a reply. Tool-call callbacks update the
assistant-thread status ("Working..." with a rendered tool summary) inside
`waitUntil`.

### Queue consumer → Slack

`consumeSlackCompletions` parses each message against
`slackCompletionJobSchema` (invalid jobs are acked and logged), runs
`processSlackCompletion`, and always acks — processing may already have
produced Slack side effects, so retrying can duplicate a completion.

Delivery extracts the aggregated `AgentResponse` from the control plane via
the shared extractor (signed with the same sig1 service auth), then:

- **Empty failure** — posts a ":x: Agent failed" message with a View Session button.
- **Declined reply** — automation-sourced, successful, no artifacts/media, and the final text is empty or exactly `NO_REPLY` (tolerating a trailing period) → nothing is posted, only the 👀 reaction clears. Interactive sessions never decline; work that produced artifacts always posts.
- **Normal completion** — posts Block Kit sections (response text split into Slack-sized sections, created artifacts with links, up to 5 key tool calls from Edit/Write/Bash, status footer with model/repo/reasoning-effort, View Session, and Create PR when a manual-PR branch exists without a PR artifact) via `postBlocks` without top-level text.
- **Media** — `deliverMediaArtifacts` fetches bytes from the control plane, stages via `files.getUploadURLExternal` + `uploadToExternalUrl`, and completes with `files.completeUploadExternal` into the thread. Media delivery is bounded to 5 files, 10 MiB per file, and 25 MiB total per completion; anything beyond is omitted and reported ("N media artifacts are available in the session but could not be attached here"), never failed. Requires the `files:write` bot scope.
- Always clears the 👀 `reactionMessageTs` in a `finally` block.

## Channel message triggers

`handleChannelTrigger` ingests ambient (non-mention) messages in watched
channels and forwards them to the control plane, which owns candidate
selection, condition evaluation, and dedup — all ingress filtering lives in
the bot so the Slack event ack stays cheap. The pipeline: bot identity
(auth.test, cached; fail closed when unknown), structural candidacy +
mention suppression (`isChannelTriggerCandidate`), watched-channel pre-filter
(`getWatchedChannels`, cached in KV, fails closed to an empty set so an
outage pauses triggers instead of forwarding every message), normalization
with best-effort channel name/permalink, then a signed forward to
`/internal/slack-event`. When the control plane reports a new run or a
steered follow-up, the bot adds a 👀 reaction to the triggering message.

After a run is admitted, the scheduler calls `/internal/thread-context`
(HMAC-signed with the same in-body signature scheme) to render the triggering
message's thread. `buildThreadContextForTrigger` returns up to 20 earlier
messages (thread root preserved on long threads), each truncated to 1,024
characters, serialized as JSON records with a discriminated speaker identity
(name, app, bot, unknown) and every `<` escaped so no Slack user can forge a
speaker line or close the block. The context is labelled untrusted data in
the prompt. Failures answer 200 with an empty context — thread history is an
enhancement, and a run must still start without it. `/callbacks/automation-complete` posts the agent's final response into the triggering thread (or declines via `NO_REPLY`) and clears the reaction; `/callbacks/automation-skip` posts a best-effort ephemeral "A run is already active for this thread" notice. Every reply in the thread continues the same session (re-spawned from a snapshot if idle) via the same thread-session store, for up to 7 days after the first trigger.

## App Home preferences

`app_home_opened` republishes the user's Home tab (`publishAppHome` →
`views.publish`). The Home view lets each Slack user set, per new Slack session:

- **Model** — from the control plane's enabled-models list (`/model-preferences`), falling back to default enabled models when the list cannot be loaded.
- **Reasoning effort** — validated against the selected model's supported efforts.
- **Global branch override** — via a modal; cleared with `clear_branch_preference`.
- **Repo-specific branch overrides** — an `external_select` repo picker (suggestions capped at `MAX_REPO_SUGGESTION_OPTIONS` = 100, rendered with the override branch appended to the label), a per-repo modal, and `clear_repo_branch_override` delete buttons. At most `MAX_RENDERED_REPO_OVERRIDES` (50) override rows render so the view stays under Slack's 100-block limit, with a "…and N more" note. Repo branch overrides persist in KV under `user_repo_branch:<userId>:<repoId>`; the global branch under `user_prefs:<userId>`.

Branch priority at launch: repo-specific override → global override → repo
default branch. Environment-launched sessions have no branch preference (the
environment defines its own branches). All preference state is per Slack
user and affects only new Slack sessions.

## Agent-initiated Slack notifications

Interactive sessions always get thread replies; separately, an agent may post
an extra message to a Slack channel on explicit request. The `slack-notify`
tool lives in the sandbox runtime, and `POST /sessions/:id/slack-notify` on
the control plane performs the post with `SLACK_BOT_TOKEN`. The control plane
rejects the call when notifications are disabled for the repo or globally,
sanitizes the text (mentions policy — allow/escape/strip — with broadcast
tokens always stripped, 12,000-character raw cap, sections split to fit Slack
limits), and posts with the session's spawn/source context for audit. The
sandbox only installs the tool when `AGENT_SLACK_NOTIFY_ENABLED` is set in
the sandbox environment (resolved at spawn from integration settings, fixed
for the sandbox lifetime). This path requires `SLACK_BOT_TOKEN` and
`chat:write`; channel membership of the bot is the access boundary.

## Authentication and security invariants

- **Slack → bot**: every `/events` and `/interactions` request is verified by HMAC against `SLACK_SIGNING_SECRET` with a 5-minute replay window; invalid signatures return 401 and are never processed.
- **Control plane → bot**: every `/callbacks/*` and `/internal/thread-context` request is verified by in-body HMAC (`verifyCallbackFromControlPlane`, signed with the destination bot's `SERVICE_AUTH_SECRET`). Missing `SERVICE_AUTH_SECRET` returns 500 "not configured", never silent acceptance.
- **Bot → control plane**: every outbound call is sig1-signed as `slack-bot` with the bot's own `SERVICE_AUTH_SECRET` (`signedControlPlaneFetch`) through the `CONTROL_PLANE` service binding. Session and prompt requests carry the asserted actor in the signed `X-OpenInspect-Actor` header, never the body.
- Identity resolution (`resolveSlackActorIdentity`) is best-effort via `users.info` and is not used to approve repository access; Slack-created sessions use deployment-level GitHub App installation access.
- Bot-authored messages are ignored; the bot never responds to itself.

## Configuration and operations

Bindings: `SLACK_KV` (KVNamespace), `SLACK_COMPLETION_QUEUE` (Queue),
`CONTROL_PLANE` (service binding). Variables: `DEPLOYMENT_NAME`,
`CONTROL_PLANE_URL`, `WEB_APP_URL`, `DEFAULT_MODEL`, `CLASSIFICATION_MODEL`,
`APP_NAME`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, plus the classifier
credential matching `CLASSIFICATION_MODEL` (`ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`), `SERVICE_AUTH_SECRET` (per-service sig1 secret that also
verifies control-plane callbacks), and `LOG_LEVEL`. The Slack app
(`slack-app-manifest.yaml`) enables App Home, the agent view, bot events
(`app_home_opened`, `app_mention`, `message.channels`, `message.groups`,
`message.im`), interactivity, and bot scopes including `assistant:write`,
`chat:write`, `files:read`, `files:write`, `channels:history`,
`groups:history`, `im:history`, `reactions:write`, `users:read`,
`users:read.email`. Adding `files:read` or `files:write` to an existing app
requires reinstalling the app per workspace. Queue delivery requires the
Terraform operator's Cloudflare token to have Queues: Edit.

Repos, routing rules, environments, and watched channels are cached
resources: in-memory (60-second TTL) → control plane → KV last-known-good
(300-second TTL). Repo fetches on the classification path are bounded to
`REPOS_FETCH_TIMEOUT_MS` (5 s) so a cold control-plane cache cannot consume
the whole `waitUntil` budget after the "Working on..." ack. Cache failure
semantics differ by role: repos degrade to KV/empty, environments fail open
to an empty list (classification degrades to repository-only), routing rules
fail open to no rules, watched channels fail **closed** to an empty set.

## Focused tests

- `index.test.ts` (81 KB of end-to-end worker tests with mocked Slack fetch, KV, control plane, and `waitUntil` flushing) covers event ack/dedupe, Starting-status ordering before session creation, DM and follow-up flows, interim thread context scoping via `oldest=lastPromptTs`, stale-session relaunch, image attachment upload/reference ordering, identity staying out of the session body, App Home branch-override clear and repo suggestions beyond 100 repos, quick-pick routing into the repo-selection handler, and clarification-picker suggestions returning the full list (100 options) and filtering by typed query.
- `classifier/index.test.ts` covers deterministic routing-rule and channel-association stages (precedence, single-repo suppression when environments exist, stale-target skipping, mrkdwn escaping), LLM structured-output parsing (invalid/missing output → picker), alternative dedup, OpenAI strict-schema contract, provider-key and timeout degradation, and catalog-loading-once behavior.
- `completion/delivery.test.ts` and `completion/consumer.test.ts` cover failure posting, `NO_REPLY` decline rules (automation-only, artifact-driven override), reaction clearing, media upload/omission accounting, and queue ack semantics.
- `sessions/control-plane-client.test.ts` and `sessions/thread-session-store.test.ts` cover sig1 signing with actor assertions, 404-only staleness classification, timeout aborts, and `advanceLastPromptTs` forward-only checkpoint semantics.
- `target-clarification.test.ts`, `channel-trigger.test.ts`, `routes/thread-context.test.ts`, `app-home/*.test.ts`, and `activity-status.test.ts` cover picker grouping/shape, trigger candidacy pre-filters, thread-context JSON rendering and trust framing, modals/preferences, and assistant-status normalization and length caps.
