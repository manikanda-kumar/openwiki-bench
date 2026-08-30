---
type: subsystem
title: Automation Engine (Scheduler)
description: The D1-backed automation engine — minute-tick Scheduler, six trigger types with condition gating, invocation→runs fan-out across up to ten repositories, idempotent cron slots, concurrency guards, failure strikes with auto-pause, and Slack thread steering.
tags: [automations, scheduler, cron, webhooks, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-4f6315a3e425368382f195c9
    resource: repo://packages/control-plane/src/automation/repository.ts
  - id: openwiki-source-5124cbd391fc0001c5939668
    resource: repo://packages/control-plane/src/automation/session-target.ts
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-9634c81ea81a2f17d2906353
    resource: repo://packages/control-plane/src/routes/automations.ts
  - id: openwiki-source-c4555138a5e7037195c9f18b
    resource: repo://packages/control-plane/src/scheduler/scheduler.ts
  - id: openwiki-source-8632b1c61cb7a28c9f861ec5
    resource: repo://packages/control-plane/src/webhooks/index.ts
  - id: openwiki-source-d150675a573204e7fe173cc0
    resource: repo://packages/control-plane/test/integration/scheduler.test.ts
  - id: openwiki-source-1634acbc2df602b6e390a92f
    resource: repo://packages/shared/src/triggers/types.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Automations run coding sessions on schedules or external events without a human in the loop. The engine lives in the control plane: `packages/control-plane/src/scheduler/scheduler.ts` (a request-driven, D1-backed coordinator — no long-lived process), triggered by the Worker's every-minute cron (`packages/control-plane/src/index.ts:71–79`), by automation routes (manual trigger), and by `SessionDO` completion callbacks (`runComplete`, wired in `session/components.ts`).

## Data model: automation → invocation → runs → sessions

One firing is an **invocation** with 0–10 **runs** (children), each opening one session against one target — a repository, an environment workspace, or (for target-less automations) a single null-repo child (`automation/session-target.ts:36–66`: an environment run resolves the environment's full repository set, otherwise the run's repo snapshot columns win). Multi-repo selection is stored normalized in `automation_repositories` / `automation_environments` (D1 migrations 0030/0037); repository identity resolves **at firing time** — `automation/repository.ts` resolves each repo's access independently so one bad repo fails its child without blocking siblings, and runs snapshot repos/environments at creation, which is why editing an automation while it runs is safe (`docs/MULTI_REPO_AUTOMATIONS.md:70–92`). The invocation itself has **no stored status**; it is derived from children via a single SQL definition (`DERIVED_INVOCATION_STATUS_SQL`, `db/automation-store.ts`), yielding `partial_failed` among other states.

## Trigger types and event ingress

`automationTriggerTypeSchema` is `schedule | github_event | linear_event | sentry | webhook | slack_event` (`packages/shared/src/triggers/types.ts:9–16`, in shared so the web UI and engine agree). Linear events are currently reserved/planned (`docs/AUTOMATIONS.md`). Event ingress registers four routes in `packages/control-plane/src/webhooks/index.ts:11–16`:

- `POST /webhooks/automation/:id` — generic webhook (Bearer API key checked against a SHA-256 hash in `automations.trigger_auth_data`, 64 KB cap, optional `idempotencyKey`);
- `POST /webhooks/automation/:id/sentry` — Sentry HMAC verified with the automation's encrypted client secret;
- `POST /internal/github-event` and `POST /internal/slack-event` — normalized events forwarded **by the github-bot / slack-bot workers** under sig1 with actor-namespace enforcement.

All feed `Scheduler.event()`, which finds candidates per source (webhook/sentry by automation id; github by repo+event; slack by watched-channel store), applies the 15-type condition registry from shared (`triggers/registry.ts`, evaluated via `matchesConditions`), then admits.

## Firing pipeline and invariants

`startInvocation()` (scheduler.ts L314–560) is the single admission funnel for all three entry points, with deliberately atomic steps:

- **Overlap guard**: schedule/manual firings block on any active run of the automation; event firings block per `concurrencyKey` so unrelated PRs don't serialize (`scheduler.ts:320–338`). A lost race records an overlap **skip** — for schedules, atomically with the schedule advance, so a skipped slot still burns.
- **Idempotent slots**: the invocation+children batch insert is guarded by unique indexes — `(automation_id, scheduled_at) WHERE source='schedule'` and `(automation_id, trigger_key)`. A UNIQUE violation rolls the batch back *including* the schedule advance; the code then re-advances monotonically (never rewinding) and stands down as `deduplicated` (`scheduler.ts:440–460`). Integration tests pin "admits exactly one run across two triggers and a concurrent tick" and "a firing that lost the slot does not advance the schedule" (`test/integration/scheduler.test.ts`).
- **Budgets**: `MAX_PER_TICK = 25` automations, `TICK_CHILD_LAUNCH_BUDGET = 50` children per tick (Workers subrequest limit), and `AUTOMATION_LAUNCH_CONCURRENCY = 4` in-flight launches to smooth Modal cold starts (`scheduler.ts:76–91`). Overdue automations whose estimated children would overshoot are deferred whole, always admitting at least one to guarantee progress (`tick()`, L604–640).

A run goes `starting` → session init (`[Auto] <name>` title, `spawnSource:"automation"`) → prompt enqueued into the session's normal durable queue via `/internal/prompt` → `running`. Each child row is claimed before init so the orphan sweep can't race it.

## Failure accounting and auto-pause

`runComplete()` maps session terminal status onto the run, then `applyInvocationAccounting` (L288–303) aggregates siblings: at most **one strike per invocation**, admitted by a CAS stamp on `failure_counted_at` (concurrent callbacks, launch failures, and sweeps all contend; one winner increments `consecutive_failures`). Reaching `AUTO_PAUSE_THRESHOLD = 3` auto-pauses the automation (`trackAutomationFailure`, L260–278); the streak resets only when every child of an invocation completed successfully. Two sweeps make this crash-safe: `recoverySweep` fails orphaned `starting` runs (>5 min) and timed-out `running` runs (default 90 min, env `EXECUTION_TIMEOUT_MS`), and a `finalizationSweep` (24 h window) repairs accounting missed in the crash-after-callback window. Manual trigger returns 409 while an invocation is active and, while paused, is allowed but never moves `next_run_at`.

## Slack thread continuity

Slack event firings are keyed by thread. A reply arriving within `SLACK_THREAD_CONTINUITY_WINDOW_MS` (7 days, measured from the root run's `created_at`, does not slide) **steers** the existing session — posting the follow-up into it — regardless of trigger conditions, because a natural reply won't contain the keyword that started the run (`scheduler.ts:920–941`, `steerSession`). After the window (or if steering fails), the reply is re-evaluated as a potential new trigger. Thread history is fetched lazily from the slack-bot *after* admission with a 10 s bound, and on timeout the run launches with no history. Concurrency-skip notices post ephemerally back to the thread.

## Scheduling rules

Cron automations must fire at most every 15 minutes (`MIN_CRON_INTERVAL_MINUTES`, `routes/automations.ts:73` — enforced with shared's `cronIntervalMinutes`), instructions cap at 15,000 chars, and every firing evaluates `nextCronOccurrence` in the automation's timezone. The routes surface (`routes/automations.ts:1366–1416`) adds pause/resume, cursor-paginated invocations/runs, and webhook-key regeneration.

**Operations note**: migrations 0030/0031 rewrote the automation tables; the repo warns the change is not code-revertible without a DB restore (`docs/MULTI_REPO_AUTOMATIONS.md:234–259`).
