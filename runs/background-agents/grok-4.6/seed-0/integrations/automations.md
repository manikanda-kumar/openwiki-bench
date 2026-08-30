---
type: integration
title: Automations and Inbound Triggers
description: Scheduled and event-driven automations that spawn coding sessions from D1-backed cron ticks, inbound webhooks, Sentry, Slack, and GitHub events, including fan-out, recovery, and auto-pause.
tags: [automations, scheduler, webhooks, cron, triggers, sentry, slack, github]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-71a37d5d3a20cd1941385eef
    resource: repo://packages/control-plane/src/auth/identity-enforcement.ts
  - id: openwiki-source-4f6315a3e425368382f195c9
    resource: repo://packages/control-plane/src/automation/repository.ts
  - id: openwiki-source-3a7ac9f1def780bcacf7f603
    resource: repo://packages/control-plane/src/db/automation-store.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-9634c81ea81a2f17d2906353
    resource: repo://packages/control-plane/src/routes/automations.ts
  - id: openwiki-source-c4555138a5e7037195c9f18b
    resource: repo://packages/control-plane/src/scheduler/scheduler.ts
  - id: openwiki-source-f69048d2562235a60f688786
    resource: repo://packages/control-plane/src/session/components.ts
  - id: openwiki-source-abe988e8dffbde9a14072128
    resource: repo://packages/control-plane/src/webhooks/automation-webhook.ts
  - id: openwiki-source-30bf9ff94b6bc0d008787863
    resource: repo://packages/control-plane/src/webhooks/github.ts
  - id: openwiki-source-8632b1c61cb7a28c9f861ec5
    resource: repo://packages/control-plane/src/webhooks/index.ts
  - id: openwiki-source-9b5b96173e92f88c6e281865
    resource: repo://packages/control-plane/src/webhooks/sentry.ts
  - id: openwiki-source-98ec39b0bdf44d5bed52d40d
    resource: repo://packages/control-plane/src/webhooks/slack.ts
  - id: openwiki-source-1eb6487041d89f0d461c45e0
    resource: repo://packages/github-bot/src/index.ts
  - id: openwiki-source-c030b3eb523ffa976f94a870
    resource: repo://packages/shared/src/triggers/conditions.ts
  - id: openwiki-source-72d05df95c22ad73255d8552
    resource: repo://packages/shared/src/triggers/github/normalizer.ts
  - id: openwiki-source-c5addfcf2b9a7e31c65d2257
    resource: repo://packages/shared/src/triggers/registry.ts
  - id: openwiki-source-f61f9abad93e513536af6816
    resource: repo://packages/shared/src/triggers/sentry/signature.ts
  - id: openwiki-source-1634acbc2df602b6e390a92f
    resource: repo://packages/shared/src/triggers/types.ts
  - id: openwiki-source-0d06cadfd5ef1fb746c22a18
    resource: repo://packages/shared/src/triggers/webhook/context.ts
  - id: openwiki-source-597bfb2202a84fe3820ac184
    resource: repo://packages/shared/src/triggers/webhook/normalizer.ts
  - id: openwiki-source-e88b0fb51c375bcdb3f9857e
    resource: repo://packages/shared/src/types/automations.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
  - id: openwiki-source-aefd34cc2c8dee6c14c41b3c
    resource: repo://packages/slack-bot/src/channel-trigger.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Automations and Inbound Triggers

Automations are a control-plane feature: a saved prompt, model, and target set that starts one or more ordinary coding sessions whenever a trigger fires. The Worker never runs the agent. It records the firing in D1, creates sessions through the same `initializeSession` path as interactive create, and later accounts for completion from the session Durable Object.

Operator-facing setup lives in `docs/AUTOMATIONS.md`. Design decisions for multi-target fan-out live in `docs/MULTI_REPO_AUTOMATIONS.md`. This page is the runtime contract: trigger types, scheduler ticks, webhook ingress, recovery, and session spawn. See [Control Plane](/openwiki/architecture/control-plane.md) for the Worker composition root, [Models and Provider Accounts](/openwiki/features/model-providers.md) for unattended provider pins, [GitHub Integration](/openwiki/integrations/github.md) and [Slack Integration](/openwiki/integrations/slack.md) for bot ingress, and [Session Lifecycle](/openwiki/workflows/session-lifecycle.md) for what happens after a session exists.

## Responsibility and ownership

| Piece | Owner | Role |
| --- | --- | --- |
| CRUD, pause/resume, Trigger Now | `packages/control-plane/src/routes/automations.ts` | Authenticated HTTP API on `/automations` |
| D1 rows | `packages/control-plane/src/db/automation-store.ts` | Automations, repositories, environments, invocations, child runs |
| Firing pipeline | `packages/control-plane/src/scheduler/scheduler.ts` | Tick, event, manual trigger, run-complete, recovery |
| Trigger types, conditions, normalizers | `packages/shared/src/triggers` | Shared Zod events and `conditionRegistry` |
| Public inbound HTTP | `packages/control-plane/src/webhooks` | Per-automation Sentry and generic webhook POSTs |
| Bot-normalized events | github-bot / slack-bot → `/internal/github-event`, `/internal/slack-event` | Shared normalizers, then signed control-plane POST |
| Session spawn | `Scheduler.createSessionForAutomationRun` → `initializeSession` | Same Worker init path as the web UI |
| Run accounting | Session Durable Object callback → `Scheduler.runComplete` | Terminal status, auto-pause, Slack completion fan-out |

The UI in `packages/web` is a client of the automations API. It does not tick the scheduler.

## Trigger types

`AutomationTriggerType` in shared is `schedule`, `github_event`, `linear_event`, `sentry`, `webhook`, and `slack_event`. The UI selector reads `triggerSources` in `packages/shared/src/triggers/registry.ts`, which currently registers **Sentry, inbound webhook, GitHub, and Slack**. Linear is typed and accepted by the create/update API, and the scheduler can match a `linear` event, but there is no registered Linear trigger source and no bot forwarder (`EVENT_SOURCE_SERVICE.linear` is `null`). Linear automations remain planned product surface.

| Trigger | How it fires | Fan-out | Auth at ingress |
| --- | --- | --- | --- |
| **Schedule** | Worker minute cron → `Scheduler.tick()` | Repositories and environments, combined cap `MAX_AUTOMATION_REPOSITORIES` (10) | N/A (internal cron) |
| **Inbound webhook** | `POST /webhooks/automation/:id` | Zero or one target | Bearer API key hashed in `trigger_auth_data` |
| **Sentry** | `POST /webhooks/sentry/:id` | Zero or one target | HMAC-SHA256 `sentry-hook-signature` against encrypted client secret |
| **GitHub event** | github-bot normalizes, `POST /internal/github-event` | Exactly one repository, no environments | Service principal `github-bot` via `requireEventPoster` |
| **Slack message** | slack-bot normalizes, `POST /internal/slack-event` | Zero or one target | Service principal `slack-bot` |
| **Linear event** | Typed only; no registered source or forwarder | Exactly one repository if created | Planned |
| **Trigger Now** | `POST /automations/:id/trigger` | Same as a schedule firing: full live selection | Authenticated user/service |

**Only schedule firings (and Trigger Now, which uses `source: "manual"` on the same pipeline) may target more than one repository or environment.** `validateTargetCounts` rejects a combined repository+environment count greater than one unless `triggerType === "schedule"`. GitHub and Linear additionally require exactly one repository and forbid environment targets. Event-driven fan-out is a product-scope cut, not a pipeline limit: the invocation model can already hold N children, but an event arrives scoped to one repository or channel and fanning it to unrelated targets has no defined semantics.

Webhook and Slack automations may run with **no repository** (and no environment). The agent still starts a session; repo workspace actions such as opening a pull request need repository context. See [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md).

## Configuration

Create/update is `POST/PUT /automations`. Shared request schemas cap repositories at `MAX_TARGET_REPOSITORIES` (10). Route-level rules add:

- Name ≤ 200 characters; instructions ≤ 15,000 characters.
- Schedule: valid 5-field cron, IANA timezone, minimum interval 15 minutes. Six-field (seconds) expressions are not supported. Non-schedule types must not send `scheduleCron` / `scheduleTz`.
- GitHub and Sentry require an `eventType` from the source catalog.
- Conditions are validated with `validateConditions` against `conditionRegistry`. **Every** stored condition must match for an event to fire (`matchesConditions` is AND).
- Slack automations must include a `slack_channel` condition. `text_match` and `slack_actor` are optional.
- Webhook automations generate an API key at create (shown once) and store only its hash. Sentry encrypts the client secret with `REPO_SECRETS_ENCRYPTION_KEY`.
- Attribution is fail-closed: `applyIdentityEnforcement` plus `resolveCanonicalUserId` persist `created_by` and `user_id` that the scheduler later replays as session identity.

Pause sets `enabled = 0` and clears `next_run_at`. Resume sets `enabled = 1`, resets `consecutive_failures`, and for schedule triggers recomputes `next_run_at` from **now** via `nextCronOccurrence`. Event-driven resume leaves `next_run_at` null. Delete is soft (`deleted_at`); run history and sessions stay.

Trigger Now uses `Scheduler.trigger`. Overlap is a 409 (`AutomationTriggerBlockedError`) with **no** skipped invocation row. It works while paused, so a fix can be verified before resume. It does not move the next scheduled slot.

## Persistence: invocation plus children

```text
automation ── automation_repositories (0..10)
           ── automation_environments (0..10, combined cap with repos)
           └── automation_invocations     one per firing
                 └── automation_runs      one per target (or one repo-less child)
                       └── session        ordinary sandbox session
```

The live selection is the **next** firing's input. Each child run **snapshots** `repo_owner` / `repo_name` / `repo_id` / `base_branch` or `environment_id` at admission. History and session create read that snapshot, never the current automation row. Editing repositories or environments while a run is in flight is allowed: in-flight children keep their snapshots.

An invocation stores `source` (`schedule` | `manual` | `event`), optional `scheduled_at`, `trigger_key`, `concurrency_key`, Slack `trigger_metadata`, and `skip_reason`. It does **not** store a status. Status is derived from children:

| Children | Derived status |
| --- | --- |
| None | `skipped` |
| Any `starting` / `running` | `starting` until a child leaves `starting`, then `running` |
| All skipped | `skipped` |
| All terminal, none failed | `completed` |
| All terminal, none completed | `failed` |
| Mix of completed and failed | `partial_failed` |

SQL (`DERIVED_INVOCATION_STATUS_SQL`) and `deriveInvocationStatus` are twins; integration tests assert they agree.

Unique indexes enforce schedule slot idempotency (`automation_id` + `scheduled_at` where `source = 'schedule'`) and event dedup (`automation_id` + `trigger_key` when the key is present).

## Scheduler pipeline

`startInvocation` is the single firing path for tick, Trigger Now, and events.

1. **Overlap pre-check**, then a guarded insert. Schedule/manual overlap is automation-wide (any active child blocks). Event overlap is per `concurrencyKey` so unrelated events (PR 42 vs PR 43) can run together.
2. Resolve repositories concurrently (`resolveAutomationRepositories`). One inaccessible repo pre-fails that child and does not block siblings. Environment children snapshot the environment id and resolve the workspace at launch.
3. Zero targets → one repo-less child. Provider auth is snapshotted **before** admission (`resolveAutomationProviderAuth`, `selectionSource: "automation_pin"` for pins) so a later edit cannot change the account an admitted child uses.
4. `insertInvocationGuarded` inserts the invocation and children only if the overlap predicate still holds. For schedule, the same batch advances `next_run_at` from the claimed slot to the next cron occurrence (compare-and-set on `fromSlot`).
5. After admission, optional lazy instruction overrides run (Slack thread history). Launch workers (concurrency 4) claim a session id on the run row, call `initializeSession`, then enqueue the prompt. A launch failure marks that child failed and applies invocation accounting.

Overlap outcomes:

- **Schedule / event**: childless skipped invocation with `skip_reason = concurrent_run_active`. A skip **does not** store `trigger_key`, so it cannot consume the dedup slot of a firing that never ran. Schedule skips advance the slot in the same write as the skip record.
- **Manual**: nothing recorded; the route returns 409.
- **Dedup UNIQUE violation**: treated as `deduplicated`. For schedule, `advanceNextRunAt` is monotonic (never rewinds a newer tick's slot).

## Cron tick and recovery

The Worker's `scheduled` handler in `packages/control-plane/src/index.ts` dispatches on cron string. The automation tick is the catch-all `* * * * *`:

1. `waitUntil(checkAutofixQueueHealth)` (observability, not automations).
2. `new Scheduler(...).tick()`.

`tick()`:

1. **Recovery sweep** (always, even when nothing is overdue).
2. Load up to `MAX_PER_TICK` (25) overdue enabled automations.
3. Batch-fetch their repository and environment selections.
4. For each, compute the next cron occurrence and call `startInvocation` with `source: "schedule"` and the claimed `next_run_at` as `scheduledAt`.
5. Stop when `TICK_CHILD_LAUNCH_BUDGET` (50 children) would be exceeded, always admitting the first automation so a tick makes progress. Leftover overdue work waits for the next minute.

Recovery, bounded at 50 rows per category per tick:

| Sweep | Query | Failure reason |
| --- | --- | --- |
| Orphaned `starting` | `created_at` older than `ORPHAN_THRESHOLD_MS` (5 minutes) | `session_creation_timeout` |
| Timed-out `running` | `started_at` older than `EXECUTION_TIMEOUT_MS` (default 90 minutes) | `execution_timeout` |
| Finalization | Uncounted failed invocations and missed streak-resets in the last 24 hours | Re-runs `applyInvocationAccounting` |

The scheduler claims a generated `session_id` on the run **before** `initializeSession` so an orphan sweep cannot terminalize a row whose session is still being created.

Timed-out and failed children count toward auto-pause. Auto-pause is **per invocation**, not per child: `failure_counted_at` CAS admits one winner. Any failed child in a fan-out is one strike; the streak resets only when every child completed. Childless skips count neither way. After `AUTO_PAUSE_THRESHOLD` (3) consecutive invocation failures the automation is paused (`enabled = 0`, `next_run_at` cleared). Already-started sessions are not cancelled.

## Event matching

`Scheduler.event` loads candidates, then for each:

1. **Slack thread steering** (before conditions): if a run for this automation and concurrency key exists within `SLACK_THREAD_CONTINUITY_WINDOW_MS` (7 days from the root run's `created_at`, non-sliding) and has a `session_id`, the reply is enqueued on that session as a follow-up. Conditions do not apply to steers. Failure falls through to the new-trigger path.
2. Parse `trigger_config` and require `matchesConditions`.
3. Prepend `event.contextBlock` to the saved instructions (Slack also appends global Slack session instructions). Slack thread history is fetched **only after admission** via slack-bot `/internal/thread-context` (10s timeout); any failure launches with the original block.
4. `startInvocation` with `source: "event"`, `triggerKey`, and `concurrencyKey`.

Candidate selection:

| Source | Lookup |
| --- | --- |
| webhook / sentry | `getById(event.automationId)` — enabled, not deleted; Sentry also requires matching `event_type` |
| github / linear | `getAutomationsForEvent(repoOwner, repoName, trigger_type, eventType)` |
| slack | `SlackChannelStore.getSlackAutomationsForChannel(channelId)` |

## Inbound verification and shared normalizers

Public webhook routes are `handler-authenticated`: the router does not run Better Auth. Each handler verifies its own credential, then calls a **shared** normalizer in `@open-inspect/shared/triggers`, then `Scheduler.event`.

### Inbound webhook — `POST /webhooks/automation/:id`

1. `Content-Type` must include `application/json` (415 otherwise).
2. `Authorization: Bearer <api-key>` (401 if missing).
3. Automation must exist with `trigger_type = webhook` (404).
4. `verifyWebhookApiKey` against stored hash (401 if invalid).
5. Body capped at 64 KB (413), JSON parse (400).
6. Optional `idempotencyKey` string in the JSON body becomes both `triggerKey` and `concurrencyKey` (`webhook:idem:…`). Absent key → random delivery id, so retries without a key can overlap.
7. `normalizeWebhookEvent` always succeeds. The context block labels the payload as untrusted input, truncates JSON at 4096 characters, and **omits** `idempotencyKey` from the agent-visible payload.

Successful responses are `{ ok: true, triggered, skipped, steered }`.

### Sentry — `POST /webhooks/sentry/:id`

1. Automation must be `trigger_type = sentry` with `trigger_auth_data`.
2. `sentry-hook-signature` required (401).
3. Payload capped at 256 KB.
4. Decrypt the stored client secret; `verifySentrySignature` is HMAC-SHA256 with timing-safe compare.
5. `normalizeSentryEvent` using `sentry-hook-resource` (`issue`, `event_alert`, `metric_alert`). Unsupported action / unknown resource / invalid shape returns `{ ok: true, skipped: true }` without starting a run.
6. Normalized types: `issue.created`, `issue.regression`, `metric_alert.critical`. Conditions: `sentry_project`, `sentry_level`.

### GitHub — bot normalize, then `POST /internal/github-event`

github-bot verifies the GitHub App webhook, runs built-in handlers, and independently calls `normalizeGitHubEvent(eventHeader, payload)`. Unsupported event/action or a schema miss returns `null` (no forward). A normalized `GitHubAutomationEvent` is POSTed with the bot's service signature.

Control plane: `requireEventPoster(ctx, "github")` (must be service `github-bot`), `validateAutomationEventEnvelope` against `automationEventSchema`, then `Scheduler.event`. PR lifecycle tracking is `waitUntil` on the same request and **must not** affect automation matching.

Catalog (`GITHUB_WEBHOOK_EVENT_CATALOG`): `pull_request.{opened,synchronize,closed}`, `issue_comment.created`, `pull_request_review_comment.created`, `check_suite.completed`, `workflow_run.completed`, `issues.{opened,labeled}`. Conditions are per event (PR: branch, target branch, label, actor; workflow run adds `workflow_name` and `conclusion`). Path-glob is not offered: GitHub webhook payloads do not include a file list.

Dedup keys include the workflow run **attempt**, so a GitHub rerun can admit once per attempt while `concurrencyKey` stays `workflow_run:<id>`. PR events key concurrency by PR number.

### Slack — bot normalize, then `POST /internal/slack-event`

slack-bot `handleChannelTrigger` filters before forwarding:

1. Bot user id required (fail closed).
2. Structural candidacy + **mention suppression** (`isChannelTriggerCandidate`): `@mention` of the bot is the interactive path, never a trigger.
3. Cached watched-channel set.
4. `normalizeSlackEvent` strips the bot mention and drops empty/mention-only text. `concurrencyKey` is `slack:<channel>:<thread_ts or ts>` (thread-scoped). `triggerKey` is `slack:msg:<channel>:<ts>` (per message).

Control plane uses `createAutomationEventRoute` (`requireEventPoster` for `slack-bot`). After a successful forward with `triggered >= 1` or `steered >= 1`, the bot adds 👀 on the message. Completion posts in-thread via `SLACK_BOT` `/callbacks/automation-complete` (HMAC-signed, best-effort) and clears the reaction. A `NO_REPLY` (or empty) final message posts nothing. Attachments are not ingested; conditions match the triggering message text only, never fetched thread history.

## Session spawn

Each launched child:

- Title `[Auto] ${automation.name}`
- `spawnSource: "automation"`, `spawnDepth: 0`, `automationId` / `automationRunId`
- Model and reasoning from the automation row
- Target from `resolveAutomationSessionTarget` (repo snapshot or environment workspace)
- Session-scoped settings and **all** applicable managed skills (`mode: "all"`; personal skill profiles are not automation policy)
- Provider auth snapshot from admission
- Prompt = saved instructions, or event context + instructions
- `callbackContext` with `source: "automation"` so the Durable Object calls `Scheduler.runComplete` on terminal

`runComplete` SQL-guards the transition: only an active run may go terminal. A recovery sweep that already failed the row makes the callback a no-op. Slack completions are scheduled from invocation `trigger_metadata`, not from the session callback path.

## Invariants and failure behavior

- Schedule/manual: at most one active invocation per automation. Events: at most one active invocation per concurrency key.
- Cron double-fire of the same slot is a UNIQUE conflict, not a second session.
- Event retries with the same `trigger_key` are deduplicated; webhook retries without `idempotencyKey` are not.
- Overlap skips never consume `trigger_key`.
- `next_run_at` only moves forward.
- Auto-pause after 3 failed invocations; resume zeros the streak.
- Tick child budget defers work; it does not drop it.
- Public webhook verification happens before `Scheduler.event`. Internal event routes reject non-service callers and the wrong bot.
- Agent-visible webhook/Sentry/GitHub/Slack context is untrusted input data, not instructions.

## Extension seams

- New event source: add a `TriggerSourceDefinition` and conditions in `packages/shared/src/triggers`, register it in `registry.ts`, add a normalizer, and either a public webhook route or a bot forwarder plus `createAutomationEventRoute` / `EVENT_SOURCE_SERVICE` mapping.
- New GitHub event: extend `GITHUB_WEBHOOK_EVENT_CATALOG` and the payload schema; github-bot already forwards any successful `normalizeGitHubEvent`.
- New condition: add a Zod arm, a `ConditionHandler` with `appliesTo`, and UI support.
- Linear: types and scheduler candidate lookup exist; shipping means a registered source, bot normalizer, and `EVENT_SOURCE_SERVICE.linear = "linear-bot"`.

## Focused tests

- Scheduler tick, recovery, overlap, auto-pause, Slack steer: `packages/control-plane/src/scheduler/scheduler.test.ts`, `packages/control-plane/test/integration/scheduler.test.ts`, `scheduler-events.test.ts`, `scheduler-slack-events.test.ts`
- CRUD, target-count rules, Slack channel requirement: `packages/control-plane/src/routes/automations.test.ts`
- Webhook verification and envelopes: `packages/control-plane/src/webhooks/automation-webhook.test.ts`, `automation-event.test.ts`, integration `webhooks-slack.test.ts`, `webhooks-github-pr-lifecycle.test.ts`
- Shared normalizers and conditions: `packages/shared/src/triggers/**/*.test.ts`
- Bot forwards: `packages/github-bot/test/webhook.test.ts`, `packages/slack-bot/src/channel-trigger.test.ts`
