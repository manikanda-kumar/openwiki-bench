---
type: Reference
title: "Trigger System and Inbound Webhooks"
description: "The shared trigger framework across Open-Inspect: the automationTriggerTypeSchema contract (schedule, github_event, linear_event, sentry, webhook, slack_event), the condition registry and source definitions, the normalized AutomationEvent envelope validated at /internal/*-event endpoints, the public control-plane webhook routes (/webhooks/automation/:id, /webhooks/sentry/:id), and sig1 service-to-service auth."
tags: [triggers, automations, webhooks, conditions, service-auth, sig1, control-plane, scheduler]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-71a37d5d3a20cd1941385eef
    resource: repo://packages/control-plane/src/auth/identity-enforcement.ts
  - id: openwiki-source-a3c621c8706fc9e74c890e6b
    resource: repo://packages/control-plane/src/auth/principal.ts
  - id: openwiki-source-c94f52d0fabcda20e306c93f
    resource: repo://packages/control-plane/src/auth/service/config.ts
  - id: openwiki-source-c720d6ba47bd3b5556146efd
    resource: repo://packages/control-plane/src/auth/service/request-authenticator.ts
  - id: openwiki-source-02d3d70cb0b58626d6823905
    resource: repo://packages/control-plane/src/auth/webhook-key.ts
  - id: openwiki-source-3a7ac9f1def780bcacf7f603
    resource: repo://packages/control-plane/src/db/automation-store.ts
  - id: openwiki-source-56a7eb78cbc2d1ff68c267a7
    resource: repo://packages/control-plane/src/db/slack-channel-store.ts
  - id: openwiki-source-9634c81ea81a2f17d2906353
    resource: repo://packages/control-plane/src/routes/automations.ts
  - id: openwiki-source-c4555138a5e7037195c9f18b
    resource: repo://packages/control-plane/src/scheduler/scheduler.ts
  - id: openwiki-source-e9a74d57d9db77d1b9d2c29c
    resource: repo://packages/control-plane/src/webhooks/automation-event.test.ts
  - id: openwiki-source-cbea7893971cabb5d5ab1e82
    resource: repo://packages/control-plane/src/webhooks/automation-event.ts
  - id: openwiki-source-abe988e8dffbde9a14072128
    resource: repo://packages/control-plane/src/webhooks/automation-webhook.ts
  - id: openwiki-source-30bf9ff94b6bc0d008787863
    resource: repo://packages/control-plane/src/webhooks/github.ts
  - id: openwiki-source-9b5b96173e92f88c6e281865
    resource: repo://packages/control-plane/src/webhooks/sentry.ts
  - id: openwiki-source-98ec39b0bdf44d5bed52d40d
    resource: repo://packages/control-plane/src/webhooks/slack.ts
  - id: openwiki-source-1eb6487041d89f0d461c45e0
    resource: repo://packages/github-bot/src/index.ts
  - id: openwiki-source-5856d6dafe718ec27f678566
    resource: repo://packages/shared/src/service-auth.ts
  - id: openwiki-source-c030b3eb523ffa976f94a870
    resource: repo://packages/shared/src/triggers/conditions.ts
  - id: openwiki-source-1074bb6c718df1c82bf79005
    resource: repo://packages/shared/src/triggers/github/conditions.ts
  - id: openwiki-source-326578daf92b1b76d6f7f24c
    resource: repo://packages/shared/src/triggers/github/context.ts
  - id: openwiki-source-a7cf1f7f47e6836dfe57f54f
    resource: repo://packages/shared/src/triggers/github/index.ts
  - id: openwiki-source-72d05df95c22ad73255d8552
    resource: repo://packages/shared/src/triggers/github/normalizer.ts
  - id: openwiki-source-487c6c43bd8d0dd0fbc7bb61
    resource: repo://packages/shared/src/triggers/github/webhook-types.ts
  - id: openwiki-source-6f34b3b701e5c2fef92a9719
    resource: repo://packages/shared/src/triggers/index.ts
  - id: openwiki-source-c5addfcf2b9a7e31c65d2257
    resource: repo://packages/shared/src/triggers/registry.ts
  - id: openwiki-source-8cca7dae40cf4b4deecdadc9
    resource: repo://packages/shared/src/triggers/sentry/conditions.ts
  - id: openwiki-source-a9ed324699e9d3bbe1dde62c
    resource: repo://packages/shared/src/triggers/sentry/context.ts
  - id: openwiki-source-8b1e0e922982421771c0c187
    resource: repo://packages/shared/src/triggers/sentry/normalizer.ts
  - id: openwiki-source-f61f9abad93e513536af6816
    resource: repo://packages/shared/src/triggers/sentry/signature.ts
  - id: openwiki-source-f367f5ca4f38d64c3281cd21
    resource: repo://packages/shared/src/triggers/slack/conditions.ts
  - id: openwiki-source-648e8f95d78ec9460064c990
    resource: repo://packages/shared/src/triggers/slack/normalizer.ts
  - id: openwiki-source-1634acbc2df602b6e390a92f
    resource: repo://packages/shared/src/triggers/types.ts
  - id: openwiki-source-86d1cdabac09a49828d04bd6
    resource: repo://packages/shared/src/triggers/webhook/conditions.ts
  - id: openwiki-source-0d06cadfd5ef1fb746c22a18
    resource: repo://packages/shared/src/triggers/webhook/context.ts
  - id: openwiki-source-597bfb2202a84fe3820ac184
    resource: repo://packages/shared/src/triggers/webhook/normalizer.ts
  - id: openwiki-source-5d20e9cd6e31ddbb9e0f212d
    resource: repo://packages/shared/test-fixtures/service-auth-vectors.json
  - id: openwiki-source-aefd34cc2c8dee6c14c41b3c
    resource: repo://packages/slack-bot/src/channel-trigger.ts
  - id: openwiki-source-d8c42dc10ad192db78495fdc
    resource: repo://packages/slack-bot/src/classifier/repos.ts
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---

# Trigger System and Inbound Webhooks

The trigger system is the shared contract that connects external events to
automation runs. **`packages/shared/src/triggers`** owns the boundary: the
`automationTriggerTypeSchema` enum, the per-source `AutomationEvent` envelopes,
the condition schema and registry, and per-source normalizers that translate raw
provider payloads into normalized events. **The control plane owns the routes**
that receive those events, authenticates them, and feeds them to the scheduler
(`Scheduler.event`), which matches automations, evaluates conditions, and opens
sessions. The bot workers (`github-bot`, `slack-bot`, `linear-bot`) pre-normalize
their platform's events and POST them to control-plane internal endpoints over
sig1 service auth.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    P["Provider or client delivery"] --> PUBLIC{"Public webhook surface?"}
    PUBLIC -- yes --> CP["Control-plane route"]
    PUBLIC -- no --> BOT["Bot worker pre-normalizes"]
    BOT --> SIG["sig1 service signature"]
    SIG --> CP
    CP --> AUTH{"Authentication scheme"}
    AUTH -->|"handler-authenticated"| H["Per-route credential check<br>webhook API key or Sentry HMAC"]
    AUTH -->|"user-or-service"| E["requireEventPoster + envelope validation"]
    H --> SCHED["Scheduler.event"]
    E --> SCHED
    SCHED --> MATCH["Candidate selection by source"]
    MATCH --> COND["matchesConditions all-true"]
    COND --> INV["startInvocation: dedup, concurrency, launch"]
```

## The trigger contract

### Trigger types and event sources

`automationTriggerTypeSchema` (`packages/shared/src/triggers/types.ts`) is the
single enum controlling which trigger types the system accepts:
`schedule`, `github_event`, `linear_event`, `sentry`, `webhook`, and
`slack_event`. `TRIGGER_TYPE_TO_SOURCE` maps each type to its normalized event
`source` and is used by control-plane validation and the web UI's condition
builder. `schedule` is the only trigger type with no event source — schedule
firings are produced by the worker's `scheduled()` handler calling
`Scheduler.tick()`, not by an event envelope.

The **normalized event envelope** is the wire contract between event producers
and the scheduler. Every variant (`githubAutomationEventSchema`,
`linearAutomationEventSchema`, `sentryAutomationEventSchema`,
`webhookAutomationEventSchema`, `slackAutomationEventSchema`) shares
`baseAutomationEventSchema` fields:

- `eventType` — dot-delimited type, e.g. `pull_request.opened`, `issue.created`,
  `webhook.received`, `message.posted`.
- `triggerKey` — dedup key, atomically enforced by a unique
  `(automation_id, trigger_key)` invocation index.
- `concurrencyKey` — the scope an event firing blocks on (a PR number, a Sentry
  issue id, a Slack thread); event firings never block unrelated events.
- `contextBlock` — human-readable context prepended to the automation prompt.
- `meta` — raw event metadata for logging only, never used for matching.

`automationEventSchema` is the discriminated union over all five sources; the
internal endpoints validate against it before the scheduler sees anything.

### Source definitions

`triggerSources` (`packages/shared/src/triggers/registry.ts`) lists every
registered trigger source the UI's trigger type selector reads: `sentrySource`,
`webhookSource`, `githubSource`, `slackSource` (Linear is reserved — the enum and
the shared `label`/`actor`/`linear_status` condition handlers exist, but no
linear source registers today). A `TriggerSourceDefinition` declares the source
id, its stored `trigger_type`, display metadata, the supported `eventTypes`, and
`supportedConditions` (keys into `ConditionConfigMap`):

- **GitHub** (`githubSource`): `github_event`; `supportsEventTypes: true`, with
  the full `GITHUB_WEBHOOK_EVENT_CATALOG` and the catalog's per-event condition
  sets.
- **Sentry** (`sentrySource`): `sentry`; event types `issue.created`,
  `issue.regression`, `metric_alert.critical`; conditions `sentry_project`,
  `sentry_level`.
- **Webhook** (`webhookSource`): `webhook`; no event-type selector, the single
  `webhook.received` event; condition `jsonpath`.
- **Slack** (`slackSource`): `slack_event`; single `message.posted` event;
  conditions `text_match`, `slack_channel`, `slack_actor`.

## Conditions: the registry and evaluation

`trigger_config` on the automation row is a JSON blob whose only field is
`conditions` (`triggerConfigSchema`). The condition schema
(`triggerConditionSchema`, a Zod discriminated union) defines 15 condition
shapes: `branch`, `target_branch`, `label`, `path_glob`, `actor`, `conclusion`,
`check_conclusion`, `workflow_name`, `linear_status`, `sentry_project`,
`sentry_level`, `jsonpath`, `text_match`, `slack_channel`, `slack_actor`.

`conditionRegistry` (`packages/shared/src/triggers/registry.ts`) assembles every
handler: the shared `label` / `actor` handlers (which apply to `github` and
`linear`), the reserved `linear_status`, plus `githubConditions`,
`sentryConditions`, `webhookConditions`, `slackConditions`. Each
`ConditionHandler` (`conditions.ts`) declares:

- `appliesTo` — which event sources may use this condition.
- `validate(condition, eventType?)` — run at automation create/update time;
  returns an error string or null.
- `evaluate(condition, event)` — run at event-matching time; returns boolean.

`matchesConditions` requires **every** condition to pass (`conditions.every`).
Handlers are source-guarded at the top (`if (event.source !== "github") return
true`), so cross-source handlers like `label` are safe regardless of candidate
selection. `validateConditions` enforces the same `appliesTo` gate at save time
and, for GitHub, additionally checks the condition against the selected event
type via `isGitHubConditionSupported`.

Two semantic aliases matter: `check_conclusion` evaluates identically to
`conclusion` (both read `event.conclusion ?? event.checkConclusion`), and
`getConditionSemanticKey` maps `check_conclusion → conclusion` so
`dedupeConditionsBySemanticKey` prevents the pair from being stored twice.
GitHub conclusion values come from `getGitHubConclusionOptions(eventType)`, which
returns `CHECK_SUITE_CONCLUSIONS` for `check_suite.completed`,
`WORKFLOW_RUN_CONCLUSIONS` for `workflow_run.completed`, and an empty list
otherwise — so a `conclusion` condition is only valid on those two event types.

### Per-source condition handlers

- **GitHub** (`github/conditions.ts`): `branch` / `target_branch` match an exact
  list or glob patterns (`matchGlob` supports `*` within a segment and `**`
  across segments); `label` any_of/none_of; `actor` include/exclude (shared);
  `conclusion` / `check_conclusion`; `workflow_name` equality on
  `event.workflowName`. `path_glob` exists for parse-compatibility but has
  `appliesTo: []` — no GitHub webhook payload carries a file list, so no
  normalizer sets `changedFiles` and no catalog entry offers it. GitHub events
  gate offered conditions per event type in `GITHUB_WEBHOOK_EVENT_CATALOG`
  (`github/webhook-types.ts`): PR events offer `branch`/`target_branch`/`label`/
  `actor`; `issue_comment.created` offers only `actor`;
  `check_suite.completed` adds `conclusion`; `workflow_run.completed` adds
  `workflow_name`; `issues` events offer `label`/`actor`.
- **Sentry** (`sentry/conditions.ts`): `sentry_project` (any_of project slugs —
  metric alerts carry no project, so the handler requires `sentryProject` to be
  defined, which means a `sentry_project` condition never matches a metric
  alert), `sentry_level` (any_of).
- **Webhook** (`webhook/conditions.ts`): `jsonpath` evaluates **every** filter
  in the list against `event.body`. `evaluateJsonPathFilter` supports
  `eq`/`neq`/`gt`/`gte`/`lt`/`lte`/`contains`/`exists` over `resolveJsonPath`,
  which walks a literal `$.dot.notation` path — no array indexing, no recursive
  descent. Numeric comparisons return false for non-number values; `exists` is
  the only comparison that can pass for an undefined value.
- **Slack** (`slack/conditions.ts`): `text_match` (contains / exact / regex,
  patterns capped at `REGEX_PATTERN_MAX_LENGTH = 200` chars, regex flags
  allowlisted to `i` and `m` and re-verified defensively at evaluation),
  `slack_channel` (any_of channel IDs), `slack_actor` (include/exclude on user
  IDs). `validate` checks the runtime value shape is a non-empty string array
  before persisting — the value arrives as untrusted JSON and a bare string
  would otherwise be iterated character-by-character.
- **Linear** (shared, reserved): `label` / `actor` / `linear_status`
  (`linear_status` matches `event.linearStatus` any_of). No linear source
  registers, so these shape the contract a future linear-bot would fulfill.

### Slack watched-channel index

`slack_channel` conditions are denormalized into an
`automation_slack_channels` index (`SlackChannelStore`) so candidate selection
for a channel message is a single indexed join instead of scanning every
automation's JSON. The create/update route writes the automation row, the
repository/environment rows, and the channel rows in **one `db.batch`**
(`bindChannelStatements`: DELETE + re-INSERT OR IGNORE), so the canonical
`trigger_config` and the index cannot drift on a partial failure. The same store
backs `GET /integration-settings/slack/watched-channels`, which the slack-bot
polls (KV-cached, failing closed to an empty set) to pre-filter channel messages.

### Validation at create/update time

`routes/automations.ts` runs `getTriggerConditionErrors` on every create/update:
each condition goes through `validateConditions` with the trigger's source and
event type, and GitHub conditions that the chosen event type cannot answer are
tagged `event_incompatible`. Slack triggers additionally require at least one
`slack_channel` condition (`validateSlackTriggerConfig` — without it the engine
would otherwise skip condition validation when `conditions` is empty). Event-type
selection itself is validated against the source's `eventTypes` catalog
(`getTriggerEventTypeError`), and `supportsEventTypes` sources require an
`eventType`.

## The scheduler's event path

`Scheduler.event(event)` (`packages/control-plane/src/scheduler/scheduler.ts`)
is the single event-matching entry point shared by all five sources:

1. **Candidate selection by source**:
   - `webhook` / `sentry`: the single automation named by `event.automationId`,
     gated on `enabled` and not deleted; Sentry additionally requires
     `automation.event_type === event.eventType`.
   - `github` / `linear`: `getAutomationsForEvent(owner, name, triggerType,
     eventType)` — a join through `automation_repositories` on lowercased
     `(repo_owner, repo_name)` plus the automation's `trigger_type` and
     `event_type`, `enabled = 1`, not deleted.
   - `slack`: `getSlackAutomationsForChannel(channelId)` through the
     `automation_slack_channels` index.
2. **Slack thread continuity** (slack only): a reply in a thread with a
   steerable run — any run status within `SLACK_THREAD_CONTINUITY_WINDOW_MS`
   (7 days), matched by `getLatestSteerableRunForThread` on the
   `(automation, concurrencyKey)` — is **steered** into the existing session
   before conditions are evaluated; a steer is a follow-up turn, not a new
   trigger. Replies outside the window or with no session fall through and are
   re-evaluated as potential new triggers.
3. **`matchesConditions(config.conditions, event, conditionRegistry)`** gates
   starting a new run — all conditions must pass.
4. **`startInvocation`** with `source: "event"`, the event's `triggerKey` and
   `concurrencyKey`, and the context block prepended to the automation
   instructions. Event firings block per `concurrencyKey` (not per automation),
   so unrelated events like PR #42 and PR #43 never serialize. Dedup is the same
   `(automation_id, trigger_key)` unique index used for schedule double-fires and
   is enforced atomically at the guarded invocation insert.

The return value `{ triggered, skipped, steered }` is reflected in the webhook
responses the bots log. Slack events additionally produce one ephemeral "a run
is already active" notice per event when a candidate is concurrency-skipped
(`notifySlackConcurrencySkip`, via the slack-bot's
`/callbacks/automation-skip` endpoint, HMAC-signed with the bot's service
secret).

## Control-plane webhook routes

All four webhook routes are registered from `packages/control-plane/src/webhooks`
into the router (`...webhookRoutes`), mounted as public routes
(`SCM_AGNOSTIC_HANDLER_AUTHENTICATED_ROUTE`) — the router skips edge
authentication for them and each handler authenticates itself.

### `/webhooks/automation/:id` — generic inbound webhook

`automation-webhook.ts` requires `Content-Type: application/json` (415),
`Authorization: Bearer <api-key>` (401), looks up the automation by id and
requires `trigger_type === "webhook"` (404 otherwise) with a non-empty
`trigger_auth_data` (500), then verifies the key. **The API key is never stored
in plaintext**: `generateWebhookApiKey` produces 32 bytes of
`crypto.getRandomValues` base64url data; `hashApiKey` stores a SHA-256 hex
digest in `trigger_auth_data`; verification re-hashes and compares with
`timingSafeEqual` (`auth/webhook-key.ts`). The raw key is shown once at creation
and returned again only on regeneration, which replaces it with a fresh key.
Payloads are capped at 64 KB — rejected by a `Content-Length` fast-path before
reading, and again after reading. Every accepted delivery is normalized by
`normalizeWebhookEvent` (which always succeeds — no event filtering) into a
`webhook.received` event and passed to the scheduler.

### `/webhooks/sentry/:id` — Sentry Custom Integration

`sentry.ts` verifies the Sentry HMAC before doing any expensive work: it checks
for the `sentry-hook-signature` header (401 if absent) and the 256 KB payload
cap **before** reading the body, then decrypts the automation's stored Sentry
client secret (AES-256-GCM via `REPO_SECRETS_ENCRYPTION_KEY`) and calls
`verifySentrySignature` (HMAC-SHA256 over the raw body, timing-safe). A missing
`REPO_SECRETS_ENCRYPTION_KEY` returns 503; a missing stored secret returns 500.
Only after verification does it parse JSON and call `normalizeSentryEvent` with
the `sentry-hook-resource` header. A `skipped` normalization resolves to `200
{ok: true, skipped: true}` — Sentry has nothing to retry — and is logged
distinctly for `unsupported_action` vs other reasons.

### `/internal/github-event` and `/internal/slack-event` — normalized event endpoints

These are **user-or-service** authenticated routes (the router authenticates
first). `requireEventPoster(ctx, source)` (`auth/identity-enforcement.ts`) is the
poster gate: the principal must be a **service**, and per-source rows declare the
allowed poster — `github → github-bot`, `slack → slack-bot`, with `null` rows for
`linear`/`sentry`/`webhook` (explicit exemptions for sources that arrive on the
control plane's own public webhook surface). A bot trying to post another bot's
source gets 401, logged as `identity.mismatch_rejected`.

`validateAutomationEventEnvelope(body, source)` then validates the full protocol:
the body must be a JSON object, `body.source` must equal the route's expected
source, and the body must parse against `automationEventSchema`. Rejections
return 400 with the offending issue paths joined (`automation_event.ingress_rejected`).
The shared `createAutomationEventRoute` factory (used by slack) authenticates,
validates, and forwards; the GitHub route composes the same steps but also
piggybacks **best-effort PR lifecycle tracking** in the background
(`executionCtx.submit` → `trackPullRequestLifecycle` → `processPullRequestLifecycleEvent`),
whose failures are logged as `pull_request_lifecycle.failed` and swallowed so
they never affect automation matching. Both forward through
`forwardAutomationEventToScheduler`, which maps scheduler reachability failures
to 502.

### Why the bot normalizes first

For github and slack the **bot owns provider ingress** (signature verification
against the provider, delivery dedupe, mention suppression, watched-channel
pre-filter) and normalizes raw payloads using the shared normalizers
(`normalizeGitHubEvent`, `normalizeSlackEvent`); the control plane only
authenticates the bot, validates the envelope, and matches. This keeps provider
secrets and provider API access out of the control plane and lets condition
matching operate on one stable schema. Slack thread history is the one thing the
normalizer cannot include (it has no Slack token) — the slack-bot supplies
channel name/permalink, and the scheduler fetches thread history lazily after
admission only.

## Normalizers and trigger/concurrency keys

Each normalizer lives next to its source in `packages/shared/src/triggers` and
translates raw provider payloads into the envelope, choosing keys that shape
dedup and concurrency semantics:

| Source | Normalizer | `triggerKey` | `concurrencyKey` |
| --- | --- | --- | --- |
| GitHub PR | `normalizeGitHubEvent` | `pr:<n>:<action>:<sha>` (action + head sha make each distinct firing dedup separately) | `pr:<n>` |
| issue comment | same | `issue_comment:<commentId>` | `issue_comment:<commentId>` |
| review comment | same | `pr_review_comment:<commentId>` | `pr:<n>` (scoped with its PR) |
| check suite | same | `check_suite:<id>` | `check_suite:<id>` |
| workflow run | same | `workflow_run:<id>:<attempt>` (each GitHub rerun admitted once) | `workflow_run:<id>` |
| issue | same | `issue:<n>:<action>` | `issue:<n>` |
| Sentry | `normalizeSentryEvent` | `sentry_issue:<id>` / `sentry_regression:<id>:<lastSeen>` / `sentry_metric:<ruleId>:<dateStarted>` | `sentry_issue:<id>` / `sentry_metric:<ruleId>` |
| Webhook | `normalizeWebhookEvent` | `webhook:idem:<key>` when the body has an `idempotencyKey` string, else `webhook:<deliveryId>` random | same as triggerKey |
| Slack | `normalizeSlackEvent` | `slack:msg:<channel>:<ts>` | `slack:<channel>:<thread_ts ?? ts>` |

The Sentry normalizer returns `{status: "skipped"}` with a reason
(`unsupported_action` | `unknown_resource` | `invalid_shape`) rather than an
event: it rejects `sentry-hook-resource` values outside
`issue`/`event_alert`/`metric_alert`; the modern issue webhook only supports
`action === "created"`; the legacy `event_alert` shapes map `action ===
"regression"` or `issue.status === "regressed"` to `issue.regression` (with a
time-qualified trigger key so each regression fires once) and everything else to
`issue.created`; metric alerts only support `action === "critical"`. The issue
webhook path sets no `sentryProject` for metric alerts.

The Webhook normalizer strips `idempotencyKey` from the context block but keeps
it in the stored event body; deliveries without a key get a fresh random key per
delivery so separate deliveries may overlap (they are not deduped against each
other).

The Slack normalizer strips the bot-mention token (`<@U…>` or `<@U…|name>`)
before matching, returns null when nothing but the mention remains (so a pure
mention never fires a channel automation), and caps text at
`SLACK_TEXT_MAX_LENGTH` (8 KB).

## Context blocks

Each normalized event carries a `contextBlock` built by the source's context
renderer — the text prepended to the automation's instructions when a session
starts. GitHub context blocks are wrapped in
`<user_context source="github_event_context" author="github">` with an explicit
"untrusted user input" warning telling the agent never to follow instructions
inside the tags (`github/context.ts`); webhook blocks (`webhook/context.ts`)
similarly warn that the payload is untrusted input data and truncate the JSON at
4096 chars; sentry blocks summarize the issue, stack trace (top 5 frames,
reversed to most-recent-first), and tags; slack blocks state the channel, actor
user id, permalink, and wrap the message text in `<user_content>` tags.

## sig1 service-to-service auth

The bot → control-plane channel is `sig1` (`packages/shared/src/service-auth.ts`),
which replaces the old shared claimless bearer. Each service signs its own
requests with its own secret (`SERVICE_AUTH_SECRET` per bot); the control plane
holds per-service verification keys (`SERVICE_AUTH_SECRET_WEB`,
`SERVICE_AUTH_SECRET_SLACK_BOT`, `SERVICE_AUTH_SECRET_GITHUB_BOT`,
`SERVICE_AUTH_SECRET_LINEAR_BOT` — resolved by `serviceAuthSecret` in
`auth/service/config.ts`).

- **Headers**: `X-OpenInspect-Service` (the service name),
  `X-OpenInspect-Service-Signature` (`sig1.<timestampMs>.<nonce>.<hmac>`), and
  `X-OpenInspect-Actor` when an actor is asserted.
- **Canonical request string** (`buildCanonicalRequestString`): newline-delimited
  `sig1`, service, timestamp, nonce, uppercased method, pathname, canonicalized
  query, SHA-256 body hash (empty string hashes the empty byte string), actor
  (empty when absent). The query canonicalizes by sorting decoded `key=value`
  pairs bytewise (UTF-8) and re-encoding (`canonicalizeQuery`).
- **The exact byte layout is pinned** by the immutable golden vectors in
  `packages/shared/test-fixtures/service-auth-vectors.json` (generated by a
  retired independent Python implementation). Changing the layout or
  canonicalization requires a new format tag (`sig2`), never an in-place edit.
- **Verification order** (`authenticateServiceRequest` in
  `auth/service/request-authenticator.ts`): unknown service → 401; unconfigured
  secret → 500; `parseServiceSignatureHeader` rejects malformed grammar and
  stale timestamps (outside `TOKEN_VALIDITY_MS`, 5 minutes) **before buffering
  the body**; the body is buffered with a 16 MB hard cap (`readBodyCapped`), then
  the HMAC is compared timing-safe against a recomputed signature over the
  actual request. Nonce reuse is detected log-only, in-isolate, with entries
  expiring with the validity window.
- **Actor assertion rights** (`ASSERTION_RIGHTS` in `auth/principal.ts`):
  `github-bot → github`, `slack-bot → slack`, `linear-bot → linear`, web asserts
  none. A service may only assert actors in its own namespace; a forged
  cross-service actor is 401.
- **Outbound** (`signedControlPlaneFetch`): the bots sign exactly the bytes they
  send through the `CONTROL_PLANE` service binding — signing and sending consume
  the same body object by construction. Binary bodies are serialized **before**
  signing. `Content-Type` is attached only when a body exists
  (`application/json` for strings, the body's own type for `OutboundBinaryBody`).

The identity gate for normalized-event endpoints sits on top of sig1:
`requireEventPoster` accepts only service principals (401 otherwise) and only the
source's own bot.

## Extension points

Adding a new trigger source touches five coordinated places, all in
`packages/shared/src/triggers`:

1. `automationTriggerTypeSchema` — the enum member (boundary contract for
   persistence and the API).
2. A new `*AutomationEventSchema` variant and its registration in
   `automationEventSchema`.
3. The condition catalog — the new `TriggerCondition` union member(s) and the
   `ConditionConfigMap` keys they imply.
4. The source module — a `TriggerSourceDefinition`, normalizer, and condition
   handlers — registered in `triggerSources` and `conditionRegistry`.
5. The control-plane surface — an internal endpoint (or a public per-automation
   route when the provider signs/authenticates per automation) and the
   scheduler's candidate-selection branch in `Scheduler.event`.

The scheduler's candidate-selection `switch` over `event.source` is the control
plane's only per-source matching logic; everything after it (concurrency,
dedup, launch) is source-agnostic.

## Focused tests

- `packages/shared/src/triggers/normalizer` tests for each source
  (`github/normalizer.test.ts`, `sentry/normalizer.test.ts`,
  `webhook/normalizer.test.ts`, `slack/normalizer.test.ts`) — per-event
  normalization, fork-head cross-repository detection, skipped normalization
  reasons, idempotency-key handling.
- `packages/shared/src/triggers/conditions.test.ts` and the per-source
  condition tests — the registry's `appliesTo` gating, `matchesConditions`
  all-true semantics, validation errors.
- `packages/shared/src/triggers/types.test.ts` — the discriminated envelope
  union rejects non-protocol values.
- `packages/control-plane/src/webhooks/automation-event.test.ts` — envelope
  validation rejects wrong sources, empty required fields, and non-protocol
  values per field, and strips unknown envelope fields.
- `packages/control-plane/src/webhooks/automation-webhook.test.ts` and
  `auth/webhook-key.test.ts` — idempotency-key parsing and API key
  generate/hash/verify.
- `packages/shared/src/service-auth.test.ts` — **golden vectors** (the
  canonical-string and header fixtures), header building, strict header
  grammar, verification failures, outbound credential resolution.
- `packages/control-plane/src/scheduler/scheduler.test.ts` — the event path:
  candidate selection per source, condition gating, dedup and concurrency
  outcomes, slack steering and skip notification.

## Related pages

- [Automations](/openwiki/concepts/automations.md) — the invocation/run model,
  schedule tick, firing pipeline, dedup and failure accounting.
- [GitHub Integration](/openwiki/integrations/github.md) — the github-bot's
  webhook pipeline and the `/internal/github-event` channel.
- [Slack Integration](/openwiki/integrations/slack.md) — slack-bot ingress,
  watched-channel triggers, thread continuity.
- [Linear Integration](/openwiki/integrations/linear.md) — the linear-bot's
  AgentSessionEvent pipeline (the linear_event trigger type is reserved).
