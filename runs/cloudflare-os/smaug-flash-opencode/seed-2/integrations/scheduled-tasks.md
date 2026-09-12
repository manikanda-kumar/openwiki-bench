---
type: integration
title: "Scheduled Tasks Gatekeeper"
description: The Scheduled Tasks ambient gatekeeper — persistent workspace callbacks (every / calendarAt / runAt), the account-scoped ScheduleDriver Durable Object with one alarm, retries, cadence, lifecycle, and the read-only management app.
tags: [gatekeeper, scheduler, durable-objects, alarms, callbacks]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:03:26.424Z
sources:
  - id: openwiki-source-1df43ef8a4f36d744722bc36
    resource: repo://packages/gatekeeper-scheduler/README.md
  - id: openwiki-source-3cf1b245c90ed07be18f4946
    resource: repo://packages/gatekeeper-scheduler/src/schedule-driver.ts
generated: { by: "opencode", at: "2026-09-12T21:03:26.424Z" }
---

# Scheduled Tasks Gatekeeper

`packages/gatekeeper-scheduler` is an ambient Gatekeeper that lets workspace code register
**persistent callbacks** for elapsed intervals, wall-clock recurrences, and one-time runs. Each
account also gets a read-only management app at `/gatekeepers/scheduler`
(`README.md`). It is capability-authorized, does not route an external network authority, and does
not implement actions — the Workshop's existing hook admission and observation authorization remain
the security boundaries.

## Registration API

The ambient binding exposes `ScheduleSession`. Three registration methods map to user intent
(`README.md` §"Agent API", exact contract in `src/types.d.ts`):

- `every(everyMs, callback, options)` — elapsed **UTC** time; minimum interval 60 seconds.
- `calendarAt(rule, callback, options)` — **local wall-clock** time with an explicit IANA timezone;
  supports hourly, daily, weekly rules.
- `runAt(when, callback, options)` — once at an absolute epoch-millisecond timestamp or an explicit
  timezone-aware wall-clock time.

Callbacks implement `ScheduledTaskHook.onSchedule()` and must be **persistent** (`ctx.restore()`)
before registration. Registration creates a **disabled hook** and returns its schedule ID; it does
not start the schedule. Enable happens in the Workshop's Connections UI.

### Occurrence bounds

Recurring `every()`/`calendarAt()` may stop after a finite bound — give `occurrences: { count: N }`
or `occurrences: { until: {...} }`, never both; `runAt()` accepts neither
(`README.md`). The `count` bounds **due slots, not successful runs**: a slot consumes one count as
soon as it becomes due and takes a `runId`, even if admission or delivery then fails; missed
occurrences are skipped and do not count. A bound is checked against live state: a schedule reaching
it reports `completed`; a cutoff already passed when the hook is enabled reports `expired`; a
schedule whose callback exhausts its retries reports `dead`. Disabling a hook drops its driver state,
so re-enabling restarts the count — treat `count` as a per-enablement bound, not a lifetime guarantee.

## Architecture and lifecycle

Each account owns one SQLite-backed **`ScheduleDriver`** Durable Object and one alarm for all its
workspaces (`README.md` §"Architecture and security"). `src/schedule-driver.ts` implements it: state
is stored in a `StoredSchedule` (schema version 1) plus a separate `StoredCapabilities` record
holding the `initiator` RPC capability, changed transactionally (`schedule-driver.ts:64`).

The lifecycle (`README.md` §"Lifecycle"):
1. Registration only binds a **disabled** Workshop hook — it writes no schedule row.
2. Enabling records the target workspace ID (+ optional gadget ID), then creates the account-driver
   row and arms its alarm.
3. A repeated enable while the row still exists **preserves its current schedule state** and
   refreshes the activation details (title/description/gadget), rather than restarting; a terminal
   row "can never fire, so it must not hold a delivery capability until disable"
   (`schedule-driver.ts:132`).
4. Disabling removes the row and its stored capabilities; re-enabling creates fresh active state,
   preserves the original recurrence phase, and does not replay missed work.
5. Successful one-shots become **Finished**; past/rejected one-shots become **expired**. Terminal
   rows stay visible and consume quota until the hook is disabled.

Disconnecting the Scheduler account revokes its driver, deletes schedule state, and leaves a
permanent tombstone so retained stale controllers cannot recreate the account.

## Alarm-driven delivery

The alarm **persists state before crossing an RPC boundary** (`README.md`). Each alarm pass processes
at most **20** due schedules with **4** concurrent deliveries, then arms an immediate continuation
when a backlog remains (`src/schedule-driver.ts:29`, `ALARM_BATCH_SIZE` / `DELIVERY_CONCURRENCY`).

**Admission and retry:** the Workshop admission check runs before every attempt. If the hook,
gatekeeper, or account is no longer allowed, the occurrence is skipped without consuming a callback
attempt; recurring schedules advance to their next future occurrenceholmes. Authorization or callback
failures retry up to **eight** total attempts with exponential delays (1 minute to 1 hour capped);
exhausted schedules enter the "Needs attention" state. Delivery is best-effort within a bounded
retry window and may occur more than once — callback code should use `runId` as an idempotency key.

Stable `runId` fencing prevents late completion or retry continuations from mutating a disabled,
re-enabled, or revoked schedule.

## Cadence behavior

- Recurrences preserve the phase established at registration.
- Missed occurrences are skipped, not replayed or caught up.
- Fixed intervals measure elapsed time (they shift relative to local clocks across DST); calendar
  schedules retain their requested wall-clock cadence across DST.
- A nonexistent spring-forward time moves forward by the transition gap; an ambiguous fall-back time
  uses the earlier instant and fires once.
- Date-less wall-clock one-shots resolve to the next future occurrence of that local time.

The API always asks for the timezone of a wall-clock schedule rather than inferring it from locale or
silently choosing UTC.

## Management app

The account advertises its UI via the generic `AccountDescription.providesUi` mechanism; the Workshop
discovers it dynamically and hosts the single-file app in an opaque-origin, network-isolated `srcDoc`
frame. The app can only call the account-scoped, read-only `list()` capability plus bounded host
methods for theming, workspace-title resolution, navigation, and starter prompts (which only place
fixed editable text in the Home composer and never submit it). Pages contain at most 100 schedules;
search is case-insensitive over title/description and limited to 200 chars; cursors are opaque and
bounded. The **All / Active / Needs attention / Finished** tabs map to the projected `active`/`dead`/
`completed`/`expired` statuses. Opening a validated internal route grants no new authority.

## Limits

Fixed policy limits (not deployment settings; `README.md` §"Limits"):
- 500 enabled or terminal schedule rows per account; 100 per workspace.
- 100 rows per management page; 20 due per alarm pass; 4 concurrent deliveries; 8 callback attempts
  per logical occurrence.
- Titles 200 chars; descriptions 2000 chars.

One account-wide driver is a **shared failure domain**: a user callback that never settles can delay
other (never-settling) schedules in that account until the runtime aborts the alarm; bounded batches
limit ordinary load but do not eliminate that tradeoff.

## Deployment / troubleshooting

Before exposing Scheduler: deploy the Workshop hook target-metadata contract + `startHook()`
admission backstop, deploy this Worker so its `ScheduleDriver` and `SchedulerGatekeeper` migration
exist, then add `GATEKEEPER_SCHEDULER` to the deployment's service bindings. The `scheduler` vendor
defaults to **optional** provisioning. The `allow_irrevocable_stub_storage` compatibility flag is
required while stored callback capabilities exist and must not be removed from an existing
deployment. Common troubleshooting (`README.md`): Scheduler missing from nav → binding/vendor/enabled
issue; a new schedule not running → enable its hook; "Needs attention" → retry budget exhausted, fix
the callback/resource then disable+re-enable; a one-shot "Expired" → firing time passed without
admission; a recurrence an hour off → use `calendarAt` for wall-clock intent with the explicit
timezone; a blueprint-created workspace has no schedules → schedules are deliberately not copied.

## Uncertainty

Non-goals for v1 (`README.md` §"Non-goals") mean several things do not exist: schedule editing,
local pause/toggle/delete, recurring run history, `lastRunAt`, account default timezones, actor
attribution, blueprint schedule cloning, catch-up delivery, and collaborator-owned schedule routing —
hook lifecycle remains in the Workshop Connections UI.
