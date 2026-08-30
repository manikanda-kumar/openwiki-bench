---
type: "Reference"
title: "Automations: Triggers, Conditions, and Runs"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T05:37:27.905Z
sources:
  - id: openwiki-source-fe0fb48fd2470dfe4a6635ba
    resource: repo://docs/AUTOMATIONS.md
  - id: openwiki-source-43801d43be5d7e8f8c4f1696
    resource: repo://docs/MULTI_REPO_AUTOMATIONS.md
  - id: openwiki-source-ef8f72ccbf7b6fa3ff152e11
    resource: repo://packages/control-plane/src/auth/service/callback-signing.ts
  - id: openwiki-source-02d3d70cb0b58626d6823905
    resource: repo://packages/control-plane/src/auth/webhook-key.ts
  - id: openwiki-source-4f6315a3e425368382f195c9
    resource: repo://packages/control-plane/src/automation/repository.ts
  - id: openwiki-source-5124cbd391fc0001c5939668
    resource: repo://packages/control-plane/src/automation/session-target.ts
  - id: openwiki-source-713c00bcab0888d962eb7900
    resource: repo://packages/control-plane/src/db/automation-model-provider-auth.ts
  - id: openwiki-source-3a7ac9f1def780bcacf7f603
    resource: repo://packages/control-plane/src/db/automation-store.ts
  - id: openwiki-source-56a7eb78cbc2d1ff68c267a7
    resource: repo://packages/control-plane/src/db/slack-channel-store.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-9634c81ea81a2f17d2906353
    resource: repo://packages/control-plane/src/routes/automations.ts
  - id: openwiki-source-5fd49082b7e464556f638e18
    resource: repo://packages/control-plane/src/routes/session-prompt.ts
  - id: openwiki-source-c4555138a5e7037195c9f18b
    resource: repo://packages/control-plane/src/scheduler/scheduler.ts
  - id: openwiki-source-b5d214c2c446430420b8d994
    resource: repo://packages/control-plane/src/scheduler/slack-completion.ts
  - id: openwiki-source-8a60f97a9b060936daac3d9a
    resource: repo://packages/control-plane/src/session/callback-delivery.ts
  - id: openwiki-source-fba1dc72858ac1184df12fe6
    resource: repo://packages/control-plane/src/session/callback-notification-service.ts
  - id: openwiki-source-5c3aae3f8b776193c21c4216
    resource: repo://packages/control-plane/src/session/initialize.ts
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
  - id: openwiki-source-c030b3eb523ffa976f94a870
    resource: repo://packages/shared/src/triggers/conditions.ts
  - id: openwiki-source-1074bb6c718df1c82bf79005
    resource: repo://packages/shared/src/triggers/github/conditions.ts
  - id: openwiki-source-72d05df95c22ad73255d8552
    resource: repo://packages/shared/src/triggers/github/normalizer.ts
  - id: openwiki-source-487c6c43bd8d0dd0fbc7bb61
    resource: repo://packages/shared/src/triggers/github/webhook-types.ts
  - id: openwiki-source-c5addfcf2b9a7e31c65d2257
    resource: repo://packages/shared/src/triggers/registry.ts
  - id: openwiki-source-f61f9abad93e513536af6816
    resource: repo://packages/shared/src/triggers/sentry/signature.ts
  - id: openwiki-source-f367f5ca4f38d64c3281cd21
    resource: repo://packages/shared/src/triggers/slack/conditions.ts
  - id: openwiki-source-1634acbc2df602b6e390a92f
    resource: repo://packages/shared/src/triggers/types.ts
  - id: openwiki-source-86d1cdabac09a49828d04bd6
    resource: repo://packages/shared/src/triggers/webhook/conditions.ts
  - id: openwiki-source-0d06cadfd5ef1fb746c22a18
    resource: repo://packages/shared/src/triggers/webhook/context.ts
  - id: openwiki-source-597bfb2202a84fe3820ac184
    resource: repo://packages/shared/src/triggers/webhook/normalizer.ts
  - id: openwiki-source-e88b0fb51c375bcdb3f9857e
    resource: repo://packages/shared/src/types/automations.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
  - id: openwiki-source-f8dd01467907e9b2c90dc26a
    resource: repo://terraform/d1/migrations/0030_automation_repositories_and_invocations.sql
  - id: openwiki-source-c7deb7b2e7ca16c57762769d
    resource: repo://terraform/d1/migrations/0037_automation_environments.sql
generated: { by: "openwiki/0.4.3", at: "2026-08-29T05:37:27.905Z" }
---


# Automations: Triggers, Conditions, and Runs

Automations let Open-Inspect start coding-agent sessions on a recurring schedule or when an
external event arrives. An automation defines one shared prompt plus a repository/environment
target selection; every time its trigger fires, that prompt is run as one or more ordinary
sessions. Common uses are nightly dependency updates, deploy-incident reaction, Sentry issue
triage, and recurring report generation.

The trigger types are **schedule** (5-field cron), **inbound webhook** (authenticated HTTP POST),
**Sentry alert** (Custom Integration), **Slack message** (watched channels), **GitHub event**
(opt-in), and **Linear event** (planned). Event-driven types are scoped to exactly one repository
(or none); schedule and manual "Trigger Now" may fan out across up to 10 targets.

## The invocation/run model

Every firing takes one uniform path (design `MULTI_REPO_AUTOMATIONS.md`):

```text
automation ── repositories (0..10) + environments (0..N), the live selection
    │
    └── invocation              one per firing (schedule tick, manual trigger, or event)
          │                     carries firing-scoped keys, skip reason, source
          └── runs (0..10)      one per target (repository or environment)
                └── session     ordinary sandbox session; owns branch, artifacts, PR
```

There is **no separate single-repo pipeline and no group-of-N special case**. A single-repo
firing is an invocation with one run; a skipped firing is a childless invocation carrying a
`skip_reason`; a repo-less automation still materializes one null-repository child per firing.
The API vocabulary is `automation / repository / invocation / run / session`; the UI keeps its
"Run History" wording, rendering a fan-out invocation as one expandable row whose children are
per-repository rows.

### State and derivation

An invocation row stores only identity, `source` (`schedule | manual | event`), the cron slot
(`scheduled_at`), the event dedup key (`trigger_key`), the per-key concurrency scope
(`concurrency_key`), source-specific metadata (e.g. Slack message coordinates), and a skip
reason. **It never stores a status or completion time.** Derived status is computed from the
child runs by one SQL fragment with a TypeScript twin (integration tests assert the two agree):

- no children → `skipped`
- any child `starting`/`running` → `starting` until any child leaves `starting`, then `running`
- all children terminal: all `skipped` → `skipped`; none `failed` → `completed`; none
  `completed` → `failed`; a mix → `partial_failed`

`partial_failed` preserves the distinction between "the sweep failed everywhere" and "one
repository failed while nine completed". Deriving rather than storing status makes the
read-modify-write wedge class (crash between last child completion and parent update)
unrepresentable. Completion time is likewise derived as the latest child completion once all
children are terminal; a childless skip is settled at its creation time.

### Firing-time snapshots

Each run snapshots its target at firing time — `repo_owner/repo_name/repo_id/base_branch`, or
`environment_id` for environment targets. History rendering and the session-creation path read
the snapshot, never the automation's live selection. Because history is self-contained there is
**no edit-while-active guard and no cardinality freeze**: repository/environment selections can
be edited at any time, in-flight children keep their snapshots, and the next firing uses the new
selection (`resolveAutomationSessionTarget` is the session-creation counterpart that consumes the
snapshot). Backfilled legacy history snapshots each run's repository from **its session**, not
from the automation row, so a retargeted automation cannot fabricate history.

## Trigger entry points

### Schedule: the D1-backed scheduler

The Cloudflare Worker's `scheduled()` handler calls `Scheduler.tick()` (on the `* * * * *` cron)
which both runs a recovery sweep and processes overdue automations:

- `MAX_PER_TICK = 25` automations per tick, ordered by `next_run_at` ascending.
- `TICK_CHILD_LAUNCH_BUDGET = 50`: each child launch costs ~8 subrequests, so an uncapped
  25-automation × 10-repo tick would blow the Workers per-invocation subrequest limit. The tick
  estimates each firing's child count up front (always admitting the first automation so a tick
  makes progress, and deferring whole automations past the budget); automations left overdue are
  simply picked up next tick.
- `AUTOMATION_LAUNCH_CONCURRENCY = 4` worker lanes smooth Modal cold-start pressure during
  fan-out.

An overdue automation is fired by `startInvocation(source: "schedule")` which claims the cron
slot `next_run_at` and advances the schedule atomically in the same D1 batch. **A UNIQUE
violation on the idempotency index `(automation_id, scheduled_at)` rolls back the whole batch**
including the advance; the colliding firing owns the slot (cron double-fire), and the loser
re-advances monotonically (`advanceNextRunAt` never rewinds — a stale duplicate for an old slot
must not move `next_run_at` behind a newer tick's advance) and stands down as `deduplicated`.

Next run times come from `nextCronOccurrence(schedule_cron, schedule_tz)`; the minimum schedule
interval is 15 minutes and six-field expressions are rejected at save time.

### Inbound webhook: `/webhooks/automation/:id`

The most flexible event-driven option. POST with `Content-Type: application/json` and
`Authorization: Bearer <api-key>`; the key is 32 bytes of `crypto.getRandomValues` data,
base64url-encoded, stored **hashed with SHA-256** (`trigger_auth_data`), compared with
`timingSafeEqual`, and shown once at creation (regeneration returns a fresh key). Payload cap 64
KB (checked via `Content-Length` fast-path and after reading). Error mapping: `400` invalid JSON,
`401` missing/invalid key, `404` unknown automation or wrong trigger type, `413` too large,
`415` wrong content type.

Every accepted delivery becomes a `webhook.received` event with
`triggerKey = concurrencyKey = "webhook:idem:<idempotencyKey>"` when the body carries an
`idempotencyKey` string, else a fresh random `webhook:<deliveryId>` per delivery (so separate
deliveries without a shared key can overlap). The idempotency key is stripped from the context
block but stays in the stored event body. The agent's context block states the trigger, the
receive time, the JSON payload (truncated at 4096 chars), and a warning to treat the payload as
untrusted input data, not as instructions.

### Sentry alert: `/webhooks/sentry/:id`

The Sentry client secret is encrypted with AES-256-GCM (`REPO_SECRETS_ENCRYPTION_KEY`) at rest,
decrypted per request, and verified as an HMAC-SHA256 signature against the raw body
(`sentry-hook-signature`, timing-safe). Payload cap 256 KB. Normalization recognizes
`issue`/`event_alert`/`metric_alert` resources, maps actions to `issue.created` /
`issue.regression` (a regression carries a time-qualified trigger key), and skips
unsupported actions/resources. Event types gate candidates at the scheduler: a Sentry event
matches only automations whose `event_type` equals the normalized event's.

### GitHub event: `/internal/github-event`

The github-bot pre-normalizes GitHub webhooks and POSTs normalized `GitHubAutomationEvent`s;
this endpoint authenticates the service principal (`requireEventPoster`), validates the event
envelope against `automationEventSchema`, piggybacks best-effort PR lifecycle tracking in the
background (its failure never affects automation matching), and forwards to the scheduler.
Candidate selection joins `automation_repositories` on `(repo_owner, repo_name)`, the automation's
`trigger_type = 'github_event'`, and its `event_type`.

Each catalog event type offers only the conditions its payload can answer (PRs: branch, target
branch, label, actor; issues: label, actor; comments: actor; `check_suite.completed` adds
conclusion; `workflow_run.completed` adds workflow_name). GitHub payloads carry no file list, so
`path_glob` exists as a parsed-but-unoffered condition. Workflow-run dedup keys include the
attempt number (`workflow_run:<id>:<attempt>`), so each GitHub rerun is admitted once, with the
run id as the concurrency scope.

### Slack message: `/internal/slack-event`

The slack-bot owns ingress: it polls `GET /integration-settings/slack/watched-channels` to
pre-filter channel messages, strips the bot-mention token, normalizes text (capped), and POSTs
pre-normalized `SlackAutomationEvent`s. Conditions are `slack_channel` (required), `text_match`
(substring/exact/regex with allowlisted `i`/`m` flags, patterns capped at 200 chars), and
`slack_actor` (allowlist recommended). All conditions must pass for a new run; a message whose
entire text is the bot mention normalizes to null and never double-fires as a trigger.

Thread continuity: any reply in a watched thread **continues the same session** for up to 7 days
after the thread's first trigger (matching the interactive thread→session KV TTL), routed by
`getLatestSteerableRunForThread` and enqueued as a follow-up turn with a `slack` callback
context — conditions gate new runs, not replies. A reply racing the first trigger before its
session exists falls back to an ephemeral "a run is already active" notice (reason
`concurrent_run_active`); a reply after the window forks a fresh run. Thread history is fetched
lazily only after admission (one shared fetch per event, 10 s timeout, fallback to the plain
context block), so unmatched messages and skips never pay for a Slack read. On completion the
scheduler tells the bot to post the agent's final response in-thread and clear the 👀 reaction
(`/callbacks/automation-complete`, HMAC-signed with the slack-bot's own service secret,
best-effort 2-attempt delivery); `NO_REPLY`/empty final messages post nothing. A run that
opened a PR or produced artifacts always posts.

## Conditions: the registry

`trigger_config` is a JSON blob of `conditions` on the automation row. `conditionRegistry`
assembles per-source handlers (`githubConditions`, `sentryConditions`, `webhookConditions`,
`slackConditions`) plus shared `label`/`actor` handlers and a reserved `linear_status`. Each
handler declares `appliesTo`, a `validate` (run at create/update time) and an `evaluate` (run at
event time). `matchesConditions` requires **every** condition to pass.

- GitHub: `branch` / `target_branch` (exact or glob), `label` (any_of/none_of), `actor`
  (include/exclude), `conclusion` / `check_conclusion` (validated per event type — conclusions
  like `success`, `failure`, `neutral`, `cancelled`, `timed_out`, `action_required`, `stale`,
  `skipped`), `workflow_name`.
- Webhook: `jsonpath` with `eq/neq/gt/gte/lt/lte/contains/exists` filters over simple
  `$.dot.notation` paths — no array indexing, recursive descent, or full JSONPath (a server-side
  `resolveJsonPath` walks the dot path literally).
- Slack: `slack_channel`, `text_match`, `slack_actor` as above.
- Sentry: `sentry_project` / `sentry_level` (any_of).

Validation is source- and event-type-aware: `validateConditions` rejects conditions that do not
apply to the trigger source, and GitHub conditions are additionally checked against the selected
event type (`isGitHubConditionSupported`). The create/update routes rebuild/validate the watched
Slack channel index from the `slack_channel` condition. Changing a GitHub event type drops
conditions the new event cannot answer, while pre-existing source-wide conditions are preserved
on unrelated edits.

## The unified firing pipeline

`startInvocation` is the single firing path for tick, manual trigger, and events:

1. **Overlap check per source**: schedule/manual firings block on *any* active run of the
   automation (whole-automation scope); event firings block per `concurrency_key` (an
   automation-wide guard would serialize unrelated events, e.g. PR #42 against PR #43). A cheap
   pre-check runs first; the guarded insert re-applies the same predicate atomically.
2. **Target resolution**: `resolveAutomationRepositories` checks SCM access for every selected
   repository concurrently. One inaccessible repository never blocks its siblings — its child is
   **pre-failed** with the failure reason (snapshotted from the selection row) and the rest
   continue; if every target fails resolution the invocation is born terminal and finalizes
   immediately, counting one failure (parity with the revoked-installation behavior).
3. **Provider-auth pinning**: `resolveAutomationProviderAuth` resolves the automation's
   `providerSelections` pins through the unattended provider policy *before* admission, and the
   result is the immutable launch snapshot — edits made after the guarded insert cannot change
   which account an admitted child uses (pinned selections are marked
   `selectionSource: "automation_pin"`).
4. **Atomic insert**: invocation + children (+ optional schedule advance) in one D1 batch, every
   statement self-guarded because D1 rolls back only on statement *error*. The invocation insert
   is suppressed when the overlap predicate matches; child inserts are 0-row no-ops when the
   invocation was suppressed; the schedule advance still runs for a blocked schedule firing, as a
   compare-and-set on the claimed slot (`WHERE next_run_at = fromSlot`) so only the firing that
   still owns the slot moves it. A UNIQUE violation (cron double-fire, event dedup) rolls back
   the whole batch.
5. **Lazy prompt assembly**: only after admission does the scheduler pay for anything the prompt
   needs — Slack thread history via `instructionsOverrideFactory`, global Slack session
   instructions, etc. Provider errors are contained: children already exist in `starting`, so a
   rejected lazy override must not escape and strand persisted state.
6. **Concurrent launch**: up to `AUTOMATION_LAUNCH_CONCURRENCY` lanes; each child first
   `claimRunSession` (atomically `starting → running` with the generated session id, so the
   orphan sweep cannot terminalize an old `starting` row mid-initialization), then
   `createSessionForAutomationRun` → `initializeSession`, then
   `enqueueSessionPrompt` on the session DO's `/internal/prompt` route with an
   `AutomationCallbackContext` (`automationId`, `runId`, `automationName`). A launch failure
   marks the child `failed` with the reason and triggers invocation accounting immediately.
7. **Invocation accounting**: pre-failed and launch-failed children have no callback coming, so
   the failure strike is applied right after the launch loop (CAS-deduped).

### Sessions are sessions

Triggered sessions go through the exact `initializeSession` path (D1 index write first, then DO
init) with `title = "[Auto] <name>"`, `spawnSource: "automation"`, `automationId` /
`automationRunId` provenance, the run's target snapshot, session-scoped integration settings
resolved from the primary member (environment-bound runs layer that environment's overrides),
and all target-applicable shared skills (`resolveManagedSkills` with `mode: "all"` — personal
profiles are not automation policy). The scheduler replays the automation's stored
`created_by` / `user_id` as session identity; identity enforcement at creation (including the
Google-login `user_id` resolution, with a GitHub-identity fallback for legacy NULL rows) is what
makes that replay trustworthy.

### Completion callback

When a session message with an automation callback context finishes, the SessionDO's
`CallbackNotificationService.notifyComplete` recognizes `source === "automation"` in the message's
stored `callback_context`, validates it, and calls `Scheduler.runComplete` (retried without an
AbortSignal timeout because D1 operations do not accept signals — a fake timeout would retry
while the first in-process completion is still running). `runComplete` performs an SQL-guarded
`starting|running → completed|failed` transition (a terminal run must never transition again; a
sweep flipping a completed child to failed would retroactively corrupt the invocation's derived
status), applies invocation accounting, and — for Slack-origin runs — notifies the slack-bot to
post the result in-thread.

### Callback delivery

Cross-service callbacks use `deliverWithRetry`/`retryDelivery` (2 attempts, 1 s backoff, 10 s
attempt timeout) with in-body HMAC signatures using the **destination bot's** service secret —
the control plane legitimately holds every bot's verification key (`callbackSigningSecret`).
Only callback-owning bots may attach a `callbackContext` to prompts (enforced in
`session-prompt.ts`); the scheduler is the only automation caller.

## Overlap, dedup, and skips

- Schedule/manual firings block on the whole automation; event firings block per concurrency key.
- A blocked schedule/event firing records a **childless skipped invocation** (skip reason
  `concurrent_run_active`), atomically with the schedule advance for schedule slots — a skip
  recorded without its advance would re-collide on the same cron slot every tick. Manual
  firings surface as `409` and record nothing.
- A skip never stores the event `trigger_key`: a skip must not consume the dedup slot of a
  firing that never ran.
- Event dedup is enforced atomically by `idx_invocations_trigger_key` (unique
  `(automation_id, trigger_key)`); cron double-fire by `idx_invocations_idempotency` (unique
  `(automation_id, scheduled_at)` where source = 'schedule'). Webhook deliveries without an
  `idempotencyKey` get a fresh per-delivery key so they may overlap.
- Within one invocation, each repository has at most one run (`idx_runs_invocation_repo`), and
  each environment at most one (`idx_runs_invocation_environment`) — enforced by unique indexes,
  so the retry model is "a **new linked invocation** over the failed subset", never a second run
  under the same invocation.

## Auto-pause and failure accounting

- `AUTO_PAUSE_THRESHOLD = 3` consecutive failures auto-pauses the automation
  (`enabled = 0, next_run_at = NULL`). Auto-pause stops future firings but never cancels
  in-flight children; the status badge reads Enabled / Degraded / Paused.
- A firing with **any** failed child counts exactly **one** failure (a weekly sweep that fails
  one repository every week is still broken), counted when the *first* child fails via the
  `failure_counted_at` compare-and-set on the invocation — concurrent completion callbacks,
  launch failures, and recovery sweeps cannot double-count. Childless skips never count either
  way.
- The counter resets only when an invocation finishes with **every** child completed;
  `partial_failed` never resets, and a successful manual invocation resets without resuming.
- The recovery sweep (each tick) fails orphaned `starting` runs older than 5 minutes
  (`session_creation_timeout`) and `running` runs older than `EXECUTION_TIMEOUT_MS` (default 90
  minutes; `execution_timeout`), then applies invocation accounting once per affected invocation
  (two stuck children of one fan-out cost one strike). A bounded finalization sweep (24 h window,
  limit 50) closes crash windows: all-terminal invocations with uncounted failures
  (`failure_counted_at IS NULL` + a failed child + no active children) and failing automations
  whose latest invocation may be a fully-completed one (missed reset). Every application goes
  through the same CAS-guarded, idempotent helper, so overlap with live callbacks is harmless.
- Running over `EXECUTION_TIMEOUT_MS` also counts toward auto-pause.

## Concurrency, edits, Trigger Now

- **Pause** stops future firings (event automations ignore incoming events). **Resume**
  reactivates, resets `consecutive_failures`, and computes `next_run_at` from the current
  moment for schedules.
- **Trigger Now** (`POST /automations/:id/trigger`, returns `201 {invocationId, runs}` or `409`)
  fires one invocation across the full selection, never affects the cron cadence, works while
  paused (verify a fix before resuming), resets the failure counter on success, and counts a
  failure on failure.
- **Delete** is a soft delete: existing run history and created sessions are preserved.
- Edits to name, instructions, model/reasoning effort, schedule/timezone (next run recomputed),
  trigger config, provider pins, or target selection are never blocked by in-flight runs.

## Persistence and schema notes

- `automations` row: identity, instructions, `trigger_type`, `schedule_cron`/`schedule_tz`,
  `model`/`reasoning_effort`, `enabled`, `next_run_at`, `consecutive_failures`, identity
  (`created_by`/`user_id`), `event_type`, `trigger_config` (JSON conditions),
  `trigger_auth_data` (hashed webhook key or encrypted Sentry secret). No repository columns —
  the selection lives in `automation_repositories` (single source of truth, exposed as
  `Automation.repositories`; 0 rows = repo-less, 1 = single-repo, N = fan-out) and
  `automation_environments` (`environmentIds`; combined with repositories under one cap of
  `MAX_AUTOMATION_REPOSITORIES` = 10).
- `automation_invocations` (0030): source, slot, firing keys, skip reason, `failure_counted_at`
  CAS. `automation_runs` gained `invocation_id` + the firing-time snapshot columns in 0030,
  `environment_id` in 0037; migration 0059 made `invocation_id` NOT NULL.
- `automation_slack_channels` is a denormalized watched-channel index written in the same
  `db.batch` as the automation row so the canonical `trigger_config` and the index cannot drift.
- Migrations 0030/0031 backfill legacy rows (one invocation per legacy run reusing the run's id,
  source labeled `event` for keyed firings else `schedule`, `failure_counted_at` pre-stamped so
  the sweep does not re-count legacy strikes) then drop the deprecated scalar/frozen-key columns
  — a table rebuild that only passes on backfilled data, so the feature is not code-revertible
  without a database restore.

## Limits

| Limit | Value |
| --- | --- |
| Automation name | 200 characters |
| Instructions | 15,000 characters |
| Targets per automation | 10 repositories + environments combined (fan-out only on schedule/manual) |
| Minimum schedule interval | 15 minutes |
| Webhook payload | 64 KB (`application/json`, bearer key) |
| Sentry payload | 256 KB (HMAC-SHA256 signature) |
| Overlap | 1 active run per automation (schedule/manual); per concurrency key (events) |
| Consecutive failures before auto-pause | 3 |
| Execution timeout | 90 minutes (`EXECUTION_TIMEOUT_MS`, env-overridable) |
| Tick caps | 25 automations / 50 child launches / 4 concurrent launches |
| Slack thread continuity | 7 days from the thread's first trigger |
| Slack text/pattern | text 8 KB cap; regex patterns 200 chars, flags `i`/`m` only |
