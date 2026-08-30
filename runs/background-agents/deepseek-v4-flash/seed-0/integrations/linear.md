---
type: integration
title: Linear Integration (linear-bot)
description: How Open-Inspect attaches to Linear as a native Linear Agent — AgentSessionEvent webhooks start coding sessions from issue mentions/assignments, follow-ups continue the same session, stop/cancel kills the sandbox, repo or environment targets resolve through a five-stage cascade, model selection follows a settings-driven priority, and an opt-in best-effort issue transition moves eligible unstarted issues to the team's started state.
tags: [linear, linear-bot, linear-agent, agent-sessions, webhooks, callbacks, issue-to-session, cloudflare-worker, kv, oauth]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-e9cb9c5de04a05145680a15d
    resource: repo://packages/linear-bot/INTEGRATION.md
  - id: openwiki-source-a57892247956bed4ab5d423a
    resource: repo://packages/linear-bot/README.md
  - id: openwiki-source-0794ecd0533cfd10714bfc27
    resource: repo://packages/linear-bot/src/__tests__/pure-functions.test.ts
  - id: openwiki-source-7a5d1ed2452dc82be9391c90
    resource: repo://packages/linear-bot/src/cached-resource.ts
  - id: openwiki-source-d3091c3b26f00cc193b5feff
    resource: repo://packages/linear-bot/src/callbacks.helpers.test.ts
  - id: openwiki-source-e7f8db1ce5474f602c0b7629
    resource: repo://packages/linear-bot/src/callbacks.start.test.ts
  - id: openwiki-source-e40c5cd3a09017a52e9ccdb1
    resource: repo://packages/linear-bot/src/callbacks.ts
  - id: openwiki-source-077e6dd5f75d553d6354f49b
    resource: repo://packages/linear-bot/src/callbacks/reject-invalid-callback.ts
  - id: openwiki-source-35a5f077ac7ea8b495bf2d49
    resource: repo://packages/linear-bot/src/callbacks/start-callback.ts
  - id: openwiki-source-d1eb63b4e342b35987707de5
    resource: repo://packages/linear-bot/src/classifier/index.test.ts
  - id: openwiki-source-26a7f7f11cc65a7fe3b23c18
    resource: repo://packages/linear-bot/src/classifier/index.ts
  - id: openwiki-source-a2c79d30c0c0bdb748fdb947
    resource: repo://packages/linear-bot/src/classifier/repos.ts
  - id: openwiki-source-f229ccaf08ffdde02d718d36
    resource: repo://packages/linear-bot/src/completion/extractor.ts
  - id: openwiki-source-01e4d4cdff7300f2dbb8051d
    resource: repo://packages/linear-bot/src/environments.ts
  - id: openwiki-source-2834692935684d18566f57a4
    resource: repo://packages/linear-bot/src/index.test.ts
  - id: openwiki-source-1d61ec27ac9a40af36f1a940
    resource: repo://packages/linear-bot/src/index.ts
  - id: openwiki-source-193fe889acc44a5c6c3aca48
    resource: repo://packages/linear-bot/src/kv-store.test.ts
  - id: openwiki-source-dd7903ba21c14d48106022f4
    resource: repo://packages/linear-bot/src/kv-store.ts
  - id: openwiki-source-dde48e9ff47182c93bd96535
    resource: repo://packages/linear-bot/src/model-resolution.ts
  - id: openwiki-source-4a4f9e95af61666ff2cceecd
    resource: repo://packages/linear-bot/src/target-resolution.ts
  - id: openwiki-source-f5b46c21d8dfee4486659792
    resource: repo://packages/linear-bot/src/types.ts
  - id: openwiki-source-2a1be41364ff84ef531f991d
    resource: repo://packages/linear-bot/src/utils/integration-config.ts
  - id: openwiki-source-7b499d3e672e48f3ca986ace
    resource: repo://packages/linear-bot/src/utils/issue-start-transition.test.ts
  - id: openwiki-source-f03b2f5358fcd52febab83db
    resource: repo://packages/linear-bot/src/utils/issue-start-transition.ts
  - id: openwiki-source-67ccf8fe95d1c9e6cbaa02fc
    resource: repo://packages/linear-bot/src/utils/linear-client.ts
  - id: openwiki-source-b2d5878db3bde7ab56a6f099
    resource: repo://packages/linear-bot/src/utils/linear-credential-cache.ts
  - id: openwiki-source-a5f2f5af0e740f5cc4ba5f15
    resource: repo://packages/linear-bot/src/utils/linear-credentials.test.ts
  - id: openwiki-source-9a303cd06297ed7ad83cc8f2
    resource: repo://packages/linear-bot/src/utils/linear-credentials.ts
  - id: openwiki-source-f454165ba02206948c61803b
    resource: repo://packages/linear-bot/src/utils/linear-oauth.ts
  - id: openwiki-source-98c0685a2ef47ec76d123cfd
    resource: repo://packages/linear-bot/src/webhook-handler.test.ts
  - id: openwiki-source-00d0b1818cd71403f7d2c2f0
    resource: repo://packages/linear-bot/src/webhook-handler.ts
  - id: openwiki-source-f4e4fcd545161ce5e9f0c5b9
    resource: repo://packages/shared/src/auth.ts
  - id: openwiki-source-2c8a8a06e5ce406af202b725
    resource: repo://packages/shared/src/types/session-api.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Linear Integration (linear-bot)

Open-Inspect connects to Linear through **linear-bot**, a stateless Hono Cloudflare Worker that
installs as Linear's native **Agent**. Users `@mention` or assign the agent on an issue; Linear
delivers an `AgentSessionEvent` webhook; the worker creates an Open-Inspect coding session targeting
a repository or a saved environment, posts progress as Linear agent activities, and delivers the
terminal result back onto the issue. The integration is one of the three bot workers (with
`slack-bot` and `github-bot`) that translate platform events into control-plane API calls; the
control plane never calls the bots back except through signed callbacks the bots host
(`packages/linear-bot/src/internal-auth.ts`, `INTEGRATION.md`).

## Architecture and role

linear-bot lives in `packages/linear-bot` and depends on `@open-inspect/shared` for the session API
types, model catalog, sig1 service auth, and completion extraction. Its runtime credentials are
OAuth2 **client-credentials app-actor tokens** (30-day) issued from the Linear application's client
ID and secret, verified against the installed viewer identity, and cached in KV — authorization-code
access/refresh tokens are never kept as runtime credentials (`src/utils/linear-credentials.ts`).
All outbound control-plane calls are sig1-signed as service `linear-bot` with
`SERVICE_AUTH_SECRET`; callbacks from the control plane are HMAC-signed with that same per-service
secret (`packages/shared/src/auth.ts`, `src/callbacks/reject-invalid-callback.ts`).

```
@OpenInspect on issue → Linear AgentSessionEvent webhook →
  HMAC verify + Linear-Delivery dedupe → handler →
    Thought "analyzing" → resolve target (5-stage ladder) →
    POST /internal/sessions (signed) → KV issue:issueId mapping →
    POST /internal/sessions/:id/prompt with callbackContext →
    control plane dispatches to sandbox → signed /callbacks/start →
      opt-in issue → team's lowest-position started state →
    signed /callbacks/tool_call → ephemeral Action activities →
    signed /callbacks/complete → terminal Response/Error activity (+ PR link)
```

```
sequenceDiagram
    participant U as Linear user
    participant L as Linear (Agents API)
    participant B as linear-bot worker
    participant CP as Control plane (SessionDO)
    participant S as Sandbox / agent
    U->>L: mention or assign agent on issue
    L-->>B: AgentSessionEvent webhook (created/prompted/stopped/cancelled)
    B->>CP: POST internal/sessions (signed) + prompt with callbackContext
    CP->>S: run agent on prompt
    CP-->>B: signed /callbacks/start (human-initiated prompt live)
    B->>L: issueUpdate to team's lowest-position started state (opt-in, best-effort)
    CP-->>B: signed /callbacks/tool_call (per tool call, if enabled)
    B->>L: ephemeral Action activity (Edit/Read/Run)
    CP-->>B: signed /callbacks/complete
    B->>L: Response activity with PR link / Error activity (terminal)
    L-->>U: agent status visible in Linear
```

*Issue-to-session flow: Linear webhooks drive session creation, and control-plane callbacks drive
progress and terminal delivery back into Linear.*

## Webhook ingestion

The bot exposes `GET /health`, `GET /oauth/authorize`, `GET /oauth/callback`, and `POST /webhook`
(`packages/linear-bot/src/index.ts`). Every `/webhook` delivery runs a fixed pipeline:

1. **Signature verify** — the raw body is HMAC-SHA256'd with `LINEAR_WEBHOOK_SECRET` and compared
   timing-safe against the `linear-signature` header; failure closes with `401`
   (`src/utils/linear-client.ts` `verifyLinearWebhook`).
2. **Payload shape check** — non-object payloads and malformed `AgentSessionEvent` shapes are
   rejected with `400` before any KV or handler work.
3. **`Linear-Delivery` dedupe** — the header is a per-delivery UUID v4 and is the dedupe key (the
   body's `webhookId` is the constant registered-webhook config id and must NOT be used); KV
   `event:<deliveryId>` marks it processed with a 1-hour TTL, and a replay answers
   `{ ok: true, skipped: true, reason: "duplicate" }` (`src/kv-store.ts` `isDuplicateEvent`).
4. **Dispatch** — accepted events return `200 { ok: true }` immediately; all handling runs in
   `waitUntil`, so Linear never waits on session creation. Only `AgentSessionEvent` is handled;
   other event types log `webhook.skipped` (`src/index.ts`).

Assigned/mentioned actions React to `agentSession` state: an `agentActivity.signal === "stop"`, or
action `stopped`/`cancelled`, routes to stop handling; action `prompted` on an issue with a stored
session maps is a follow-up; everything else is a new-session attempt
(`src/webhook-handler.ts` `handleAgentSessionEvent`).

## Issue → session lifecycle

`handleAgentSessionEvent` (`src/webhook-handler.ts`) orchestrates three sub-paths — new session,
follow-up, and stop — and each activity-producing step updates the agent session's plan
(`src/plan.ts`: analyze issue → resolve repository → create coding session → code changes → open PR)
and emits `Thought` activities that Linear renders as "thinking".

### New session (mention, assignment, or clarification reply)

1. **Identity** — `getAgentSessionLinearClient` resolves the org's runtime client credentials,
   requiring the cached token's `appUserId` to match the webhook's `appUserId`; auth failure logs
   `agent_session.no_oauth_token` and aborts before Linear is consulted.
2. **Issue context** — fetch full issue details (labels, project, team, assignee, priority, up to 10
   comments) for the prompt.
3. **Target resolution** — the five-stage cascade described below; uncertain classification emits an
   **elicitation** activity asking the user to reply `owner/repo` and returns without creating a
   session.
4. **Integration gate** — the resolved target's Linear settings are fetched from the control plane
   (`/internal/integration-settings/linear/resolved/<owner>/<name>`); if the enabled-repos
   allowlist excludes the target, an Error activity explains that the integration is not enabled
   and nothing starts.
5. **Model resolution** — user preferences (`user_prefs:<userId>`) and `model:*` labels feed the
   settings priority described below.
6. **Session create** — `POST https://internal/sessions` with `repoOwner`/`repoName` or
   `environmentId` (never both), title `"<identifier>: <issue title>"`, model, reasoning effort, and
   actor identity (signed as `linear:<actorUserId>`, never in the body). A failed or malformed
   response emits an Error activity and stops.
7. **Mapping** — KV `issue:<issueId>` stores `{ sessionId, issueId, issueIdentifier, target fields,
   model, agentSessionId, createdAt }` with a **7-day TTL** (`src/kv-store.ts` `storeIssueSession`);
   the agent session's `externalUrls` gains the **View Session** link to the web app.
8. **Prompt** — Linear's top-level `promptContext` is preferred when present
   (`buildPromptContextPrompt`); otherwise `buildPrompt` composes the issue title/description,
   labels, project, assignee, priority, the five most recent comments, the agent instruction
   comment, and any `Repository clarification:` reply, all wrapped in the untrusted-content
   protocol below. Integration "Issue Session Instructions" are appended. The prompt is POSTed to
   `/internal/sessions/<id>/prompt` with `source: "linear"` and the callback context.
9. **Working activity** — on a successful prompt dispatch, `Thought` "Working on `owner/repo` with
   **model**" plus classification reasoning and the View Session link.

### Follow-up prompts continue the same session

A `prompted` event whose issue has a stored mapping is a **follow-up to the existing session** —
never a new session (enforced by ordering: the stored mapping is checked before new-session
handling). The follow-up text comes from the agent activity body if present, else the session
comment, else a placeholder. The worker:

- resolves the stored target's current integration settings (`resolveStoredSessionTarget` +
  `resolveTargetIntegration`, so environment follow-ups re-resolve the live environment),
- fetches the most recent token event (`/internal/sessions/<id>/events?type=token&limit=20`) as
  best-effort context, truncated to 500 characters, and embeds it as a "Previous agent response
  (summary)" block,
- POSTs `/internal/sessions/<id>/prompt` with `source: "linear"`, a freshly built callback context
  (message-scoped, not inherited), and actor attribution to the reply author,
- emits a Thought "Follow-up sent to existing session" with the session link, or an Error activity
  when the dispatch fails (`agent_session.followup` log).

Callback context is **message-scoped**: a producer that queues a follow-up must attach it again;
otherwise the control plane has no safe callback destination and skips completion delivery — the
diagnostic `prompt.enqueue` with `has_callback_context:false` documented in the troubleshooting
guide.

### Stop / cancel

A stop signal or `stopped`/`cancelled` action looks up `issue:<issueId>` and, when a session
exists, POSTs `/internal/sessions/<id>/stop` and **deletes the mapping** (`handleStop`). If the stop
request fails (non-OK), the mapping is deliberately retained so a later stop can still find the
session (`src/webhook-handler.test.ts` "retains the session mapping when stopping the session
fails").

## Target resolution

`resolveSessionTarget` (`src/target-resolution.ts`) runs a **five-stage cascade**, each stage able
to short-circuit; a target is either a repository (`owner`/`name`) or a saved **environment**
(`environmentId`, the stable `env_…` id). The result is rehydratable from the stored issue session
for follow-ups (`resolveStoredSessionTarget`).

1. **Project → target mapping** (highest priority) — KV `config:project-repos`
   (`{ [projectId]: { owner, name } | { environmentId } }`).
2. **Team → target mapping** — KV `config:team-repos`
   (`{ [teamId]: [ targets… ] }`); the first entry whose optional `label` matches an issue label,
   else the first label-less entry (the default fallback); a mapped environment that was deleted is
   skipped and resolution falls through.
3. **Explicit `owner/repo` mention** — a case-insensitive, boundary-guarded match of a single
   available repo full name inside the trigger comment or the clarification reply
   (`matchExplicitRepo`: `acme/api` does not match inside `acme/api-legacy`, `notacme/api`,
   `not.acme/api`, or `acme/api.docs`, and naming several repositories is still an ambiguity the
   classifier must see).
4. **Linear's built-in `issueRepositorySuggestions` API** — top suggestion with confidence ≥ 0.70
   wins; full names split on the last slash for GitLab nested-group paths.
5. **LLM classifier** — prompt-built from repo descriptions (control-plane `/repos`) plus issue
   title/description/labels/project/team/comment; provider selected by `CLASSIFICATION_MODEL`
   (Anthropic by default, OpenAI supported), raw REST calls (Workers cannot import CJS SDKs). A
   low-confidence result, an absent repo, or a provider failure degrades to an **elicitation**
   activity listing alternatives and asking for `owner/repo` — never a wrong session.

Integration settings (`resolveTargetIntegration`) resolve from the **target's settings
repository**: the repo itself, or the **environment's primary (first member) repository** —
environment-level settings are deferred. The `enabledRepos` allowlist (null = all accessible
repos) decides whether the launch is admitted; if not, Linear shows the "not enabled" error and no
session starts.

The repo and environment lists themselves are cached resources read from the control plane
(fail-open: in-memory 1-min TTL → control plane → KV last-known-good with 5-minute TTL → empty
fallback), so a control-plane read problem never blocks issue handling
(`src/classifier/repos.ts`, `src/environments.ts`, `src/cached-resource.ts`).

## Model and reasoning-effort resolution

`resolveSessionModelSettings` (`src/model-resolution.ts`) applies this priority, highest to lowest:

1. `model:<name>` issue label when `allowLabelModelOverride` is on — a fixed label map
   (`model:haiku` → `anthropic/claude-haiku-4-5`, `model:sonnet`, `model:opus`, `model:opus-5`,
   `model:sonnet-5`, `model:gpt-5.4`, `model:gpt-5.3-codex`, and others).
2. The user's KV preference (`user_prefs:<userId>` → `{ model, reasoningEffort }`) when
   `allowUserPreferenceOverride` is on.
3. The repository override / resolved global Linear default (`model` + `reasoningEffort` from
   `/internal/integration-settings/linear/resolved/…`).
4. The deployment default (`DEFAULT_MODEL`).

The chosen model is normalized against the shared catalog; reasoning effort falls back to the
model's default when user/config effort is absent or invalid for the model. With no settings
configured, defaults allow user preferences, allow model labels, and enable tool progress.

## Control-plane callbacks (status, progress, completion)

The control plane routes callbacks to the bot by the message `source` field ("linear") through the
`LINEAR_BOT` service binding, signing each payload's body HMAC with the bot's `SERVICE_AUTH_SECRET` —
`rejectInvalidCallback` is the shared guard on every `/callbacks/*` route
(`packages/linear-bot/src/callbacks/reject-invalid-callback.ts`, `packages/linear-bot/INTEGRATION.md`).

| Route | Trigger | Behavior |
| --- | --- | --- |
| `POST /callbacks/start` | initial prompt dispatched to a live sandbox | verifies signature, rejects stale callbacks (age > 5 min or more than 1 min in the future), and — **only** when `transitionIssueOnStart === true` in the message context — moves the issue to the team's lowest-position `started` workflow state. Timeouts (20 s Linear budget) surface as 504, auth failure 503, transition failure 502; any failure is non-blocking for the sandbox. |
| `POST /callbacks/tool_call` | per tool call while the agent works | skipped when agent context is missing or `emitToolProgressActivities === false` (default true for pre-field sessions); maps tools to Linear `action`/`parameter` pairs (edit_file/write_file → "Edit file", read_file → "Read file", bash/execute_command → "Run …" truncated to 80 chars) and emits ephemeral `Action` activities. |
| `POST /callbacks/complete` | session completion or failure | extracts the rich agent response from session events, emits the terminal **Response** (formatted: PR link, up to 10 file changes, 500-char summary) or **Error** activity, marks the agent session plan `completed`/`failed`, and attaches the **Pull Request** external URL when a PR artifact exists. Linear leaves "Working" only after this terminal activity is delivered. |

Delivery diagnostics are explicit: `callback.complete` logs `delivery_outcome:success` only when the
Agent API accepted the terminal activity; a missing `agentSessionId`/`organizationId`/`appUserId` in
the context falls back to posting an issue comment via the optional legacy `LINEAR_API_KEY`, and
without that key delivery is skipped entirely — a completion that was skipped cannot repair itself
(`packages/linear-bot/src/callbacks.ts`).

## Issue state transition (opt-in, best-effort)

The initial message carries `transitionIssueOnStart: true` only when Linear identifies a
**human** creator (`action === "created"` with a non-empty `creatorId`,
`src/webhook-handler.ts` `shouldTransitionIssueOnStart`). Automation-created sessions, already
running (mapped `prompted`) sessions, and follow-ups get `false` or omit it. On the start callback,
`transitionIssueToStarted` (`src/utils/issue-start-transition.ts`):

- reads the issue's current workflow state type and the team's `started` states,
- no-ops (`already_started`, `terminal_completed`, `terminal_canceled`, `no_started_state`,
  `issue_not_found`) without mutating anything,
- otherwise sorts the team's started states by `position` and moves the issue there with a single
  `issueUpdate` mutation.

Every non-transition outcome is a deliberate no-op, and a skipped, rejected, timed-out, or failed
transition never blocks agent execution — the callback still acknowledges and the sandbox keeps
working. Linear activities, not this transition, are the source of truth for status; follow-ups do
not change issue status at all.

## Untrusted content protocol

Every piece of user- or issue-derived text that reaches the agent prompt is wrapped in
`<user_content source="…" author="…">` blocks by `buildUntrustedUserContentBlock`
(`src/webhook-handler.ts`), with the framing instruction that the content is untrusted context, not
instructions. Escaping runs in a specific order (`&`, `<`, `>`, `"`) and closes off the
`<user_content>` / `</user_content>` tag shapes (including already-escaped variants) so issue text
cannot break out of the block or inject instructions (`src/webhook-handler.test.ts` "wraps
untrusted issue content in user_content blocks"). HTML in the OAuth success page and the classifier
prompt are escaped/neutralized the same way.

## KV keys (operator-managed and runtime)

All state lives in the `LINEAR_KV` namespace (`packages/linear-bot/src/kv-store.ts`):

| Key | Owner | Purpose |
| --- | --- | --- |
| `config:team-repos` | operator (`wrangler kv key put`) | team → target array, optional `label` filters, first label-less entry is the default |
| `config:project-repos` | operator | project → single target; highest-resolution priority |
| `user_prefs:<userId>` | admin/API (not self-service) | per-user `{ model, reasoningEffort }` overrides |
| `oauth:client-credentials:<orgId>` | runtime | verified 30-day app-actor token + identity, TTL = token lifetime (do not edit manually) |
| `oauth:token:<orgId>` | legacy | pre-upgrade refresh-token record, deleted after the first client-credentials mint succeeds |
| `issue:<issueId>` | runtime | issue → session mapping, 7-day TTL; deleted on stop/cancel |
| `event:<deliveryId>` | runtime | webhook delivery dedupe, 1-hour TTL |
| `repos:cache`, `environments:cache` | runtime | last-known-good control-plane reads, 5-minute TTL |

Config records are validated **key by key** on read (`parseConfigEntries`): one malformed team or
project entry is dropped and logged without invalidating the sibling mappings, because a dropped
valid mapping would silently fall through to the classification heuristics and could route issues at
an unintended repository. Config keys are not exposed as HTTP endpoints in the worker source; the
README documents editing them with `wrangler kv key put`.

## Setup, secrets, and operations

Setup is a Linear OAuth application (callback + webhook URLs, **Agent session events**, **Issues**,
and **Comments** webhook events, and **Client credentials tokens** enabled, `actor=app`
installation requiring Linear workspace admin), Terraform deployment with
`enable_linear_bot`, `linear_client_id`, `linear_client_secret`, `linear_webhook_secret`
(`packages/linear-bot/README.md` §Setup), and `wrangler secret put` for
`SERVICE_AUTH_SECRET` plus exactly one classifier key (`ANTHROPIC_API_KEY` by default or
`OPENAI_API_KEY` per `CLASSIFICATION_MODEL`). The full deploy is in `terraform/`.

- **Client-credentials eligibility**: enabling **Client credentials tokens** in Linear Settings →
  API → Applications is a Linear-side setting Terraform cannot change. The client-credentials
  token's viewer organization must match the webhook organization, and its `appUserId` must match
  the webhook's `appUserId` — any mismatch is rejected and fails the request (no legacy fallback).
- **Token rotation**: runtime tokens expire with the provider lease (cache miss, near-expiry, or
  HTTP 401 triggers a single renewal + replay of the rejected GraphQL request); rotating
  `LINEAR_CLIENT_SECRET` invalidates cached tokens, which are then replaced on the next cache miss
  or 401 — a reinstall is not normally required (`src/utils/linear-credentials.ts`, 401 replay in
  `src/utils/linear-client.ts` `linearGraphQL`).
- **Concurrent issuance**: one in-flight issuance per (org, app-user) identity is shared; a failed
  renewal is released so a later invocation can retry.
- **No Git credentials**: Linear provides none; repository access comes from the deployment's
  configured source-control integration (GitHub App installation), and repository scope in the
  Linear integration settings controls which resolved repos can receive Linear-started sessions.

## Configuration surface

The web UI (**Settings → Integrations → Linear**) configures, per repo or globally: default model
and reasoning effort, `enabledRepos` allowlist (Repository Scope), Issue Session Instructions,
`allowUserPreferenceOverride`, `allowLabelModelOverride`, `emitToolProgressActivities`, and
repository overrides. When no settings are configured the worker defaults to all accessible repos,
user preferences and model labels allowed, tool progress enabled (`src/utils/integration-config.ts`
`DEFAULT_CONFIG`). Settings changes apply to new Linear-started sessions; the model label map and
classifier model are static.

## Invariants and failure semantics

- **Follow-ups never create sessions** — an existing `issue:<issueId>` mapping plus a `prompted`
  event always routes to the existing session (page instruction; `handleAgentSessionEvent` ordering,
  `src/webhook-handler.ts`).
- **Issue transitions never block execution** — the start callback is acknowledged whether or not
  the transition succeeds, and every skipped outcome is deliberate (`/callbacks/start`,
  `src/utils/issue-start-transition.ts`).
- **Terminal delivery is the completion signal** — Linear leaves "Working" only after a delivered
  Response/Error activity; a completion without linear callback context is skipped and cannot
  repair itself, so follow up through the same session (or start a new one if the mapping expired).
- **Fail open on control-plane reads, fail closed on auth** — repo/environment/config read
  problems degrade to last-known-good or defaults; webhook signature failures, callback signature
  failures, credential mismatches, and scope deviations all reject before any session work.
- **Ambiguity is never guessed** — repo classifier uncertainty and multi-repo comments produce an
  elicitation instead of a session.
- **Identity is signed, not carried in bodies** — actors ride the sig1 request as `linear:<userId>`
  and the callback signature covers the original JSON key order, so parity-checked payloads are
  verified against the raw object.

## Tests that matter

- `src/webhook-handler.test.ts` — prompt building and untrusted-content escaping; environment
  sessions from project/team mappings (settings resolved from the environment's primary repo);
  fall-through when a mapped environment is deleted; clarification-reply resolution preserving the
  original instruction and attributing the session to the replier; follow-up context summary
  truncation; stop clears the mapping, failed stop retains it; automation-created and unmapped
  `prompted` events never opt into the issue transition; callback context shape on follow-ups.
- `src/index.test.ts` — webhook signature rejection, `Linear-Delivery` dedupe (and the
  constant-`webhookId` non-dedupe case), missing-header rejection before any KV or handler work.
- `src/callbacks.start.test.ts` and `src/utils/issue-start-transition.test.ts` — signed start
  callback transitions an eligible issue before acknowledging; already-started/terminal/no-started-
  state/missing-issue outcomes never mutate; stale callbacks are skipped.
- `src/utils/linear-credentials.test.ts` and `src/utils/linear-client.test.ts` — mint/verify/cache
  lifecycle, workspace and app-user mismatch rejection, malformed-token rejection, single 401
  renewal + identical replay, no second renewal after double-401, shared concurrent issuance.
- `src/classifier/index.test.ts` and `src/target-resolution`/`pure-functions.test.ts` — provider
  selection (Anthropic default, OpenAI structured output), timeout degradation to clarification,
  explicit-repo boundary matching.
