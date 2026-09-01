---
type: integration
title: Scheduled Tasks gatekeeper
description: The auto-provisioned scheduler — one ScheduleDriver Durable Object per account with alarm-driven delivery, registration/enable lifecycle split between the agent session and the Workshop Connections UI, bounded retries, and a read-only management app.
tags: [gatekeeper, scheduler, hooks, alarms, durable-objects]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T06:02:03.070Z
sources:
  - id: openwiki-source-1df43ef8a4f36d744722bc36
    resource: repo://packages/gatekeeper-scheduler/README.md
  - id: openwiki-source-ba5ed6f8a39e02ef06030626
    resource: repo://packages/gatekeeper-scheduler/src/driver-state.ts
  - id: openwiki-source-3cf1b245c90ed07be18f4946
    resource: repo://packages/gatekeeper-scheduler/src/schedule-driver.ts
  - id: openwiki-source-6e4b904940a56a0c9f48b90b
    resource: repo://packages/gatekeeper-scheduler/src/scheduler.ts
generated: { by: "opencode", at: "2026-09-01T06:02:03.070Z" }
---

# Scheduled Tasks gatekeeper

`packages/gatekeeper-scheduler` is an ambient gatekeeper letting workspace code register persistent
callbacks for elapsed intervals, wall-clock recurrences, and one-time runs. Each account gets a
read-only management app at `/gatekeepers/scheduler`
(`packages/gatekeeper-scheduler/README.md:1-5`). The vendor declares `autoProvisionsAccount` and
Workshop provisioning policy defaults the `scheduler` vendor to **optional** (an admin can set
disabled/optional/enabled) (`README.md:203-205`).

## Components

- **`SchedulerGatekeeper`** — the per-workspace `Gatekeeper<ScheduleSession>` facet installed by the
  Overseer. It describes itself as `scheduler://tasks` with suggested binding name `SCHEDULER`,
  publishes the `ScheduleSession` types, and reports no auto-approvable actions. Its workspace
  scope is **inherited from the containing Overseer facet** (`this.ctx.id` — the parent's id), with
  a smoke check that it is not the account id; callers cannot supply an account or workspace id
  (`scheduler.ts:228-269`).
- **`ScheduleDriver`** — one SQLite-backed Durable Object **per account** (addressed
  `getByName(accountId)`), holding every enabled schedule for the account under one alarm
  (`scheduler.ts:222-224`; `README.md:144-147`).
- **`ScheduleHookController`** — the `HookController` WorkerEntrypoint whose immutable `ctx.props`
  carry the activation (accountId, workspaceId, scheduleId, spec, cadence). `enable()` records the
  target and calls `driver.enable(...)`; `disable()` calls `driver.disable(...)` and removes all
  driver state (`scheduler.ts:185-225`).

## Registration → enablement lifecycle

Registration **only binds a disabled Workshop hook; it writes no schedule row**
(`README.md:112-116`). The agent's `ScheduleSession` calls `every(ms, cb, opts)` /
`calendarAt(rule, cb, opts)` / `runAt(when, cb, opts)`; the session normalizes the options, builds a
controller from its factory, and calls `approvalQueue.bindHook(controller, callback,
{title, description})` — the bound cadence stays in the controller's props; `bindHook` receives only
display metadata (`scheduler.ts:156-182`). Registration returns the stable `scheduleId`; **enabling
happens in the Workshop Connections UI**, not the scheduler app (which is deliberately read-only).

When the overseer approves the hook it calls `controller.enable(initiator, target)`: the driver
records where the hook delivers (workspace id, optional gadget id), creates the account-driver row,
and arms the alarm. Disabling removes the row and its stored capabilities; re-enabling creates
fresh active state, preserves the original recurrence phase, and never replays missed work
(`README.md:112-121`).

## Delivery: the alarm loop

The driver's alarm persists state before crossing an RPC boundary, processes **at most 20 due
schedules per pass with 4 concurrent deliveries**, and arms an immediate continuation when a
backlog remains (`README.md:149-156`; `schedule-driver.ts:29-34`, `237-258`, `282-297`). Per
delivery (`schedule-driver.ts:400-453`):

1. `initiator.startHook()` is awaited — **not pipelined** — because its rejection must skip the
   occurrence before a callback attempt is counted or either returned capability is used.
2. Admission (`#markAdmitted`, a synchronous storage transaction keyed by `runId`) fences late
   completions against disabled/re-enabled/revoked schedules.
3. The delivery is authorized as an **observation** on the returned approval queue
   (`authorizeObservation` with a title/description naming the schedule and planned time).
4. `callback.onSchedule(firing)` delivers `{scheduleId, runId, scheduledTime, actualTime,
   timeZone}`; the callback must have been made persistent with `ctx.restore()` and should use
   `runId` as an idempotency key, because delivery is best-effort **within a bounded retry window
   and may occur more than once** (`README.md:77-91`).

Failures are classified: a failed authorization or callback goes to `failRun` and retries —
**eight total attempts, exponential backoff starting at one minute, capped at one hour**
(`driver-state.ts:5-10`) — after which the schedule is `dead` ("Needs attention"). A rejected
`startHook` skips the occurrence *without* consuming an attempt. Leases (`RECOVERY_DELAY_MS` = 5
minutes) recover runs whose activation died mid-delivery (`schedule-driver.ts:32`, `478-505`).

## Caps and lifecycle semantics

- 500 schedule rows per account, 100 per workspace, 100 rows per management page, titles 200
  chars, descriptions 2,000 chars — fixed policy, not deployment settings (`README.md:162-171`;
  `schedule-driver.ts:33-34`).
- Occurrence bounds (`count` / `until`) bound **due slots, not successful runs**: a slot consumes
  its count as soon as it becomes due, retries reuse the same `runId`, and disabling a hook drops
  driver state so re-enabling restarts the count (`README.md:62-72`).
- Terminal statuses: `completed` (bound reached), `expired` (cutoff already past when enabled, or a
  missed one-shot), `dead` (retry budget exhausted — a `count: 10` schedule that dies on its third
  occurrence never reaches the fourth). Terminal rows remain visible and **consume enabled-schedule
  quota until their hook is disabled** (`README.md:67-72`, `118-119`).
- Disconnecting the account revokes its driver, deletes schedule state, and leaves a permanent
  tombstone so stale controllers cannot recreate it (`README.md:123-124`).
- Workspaces created from a blueprint do **not** copy schedules; the new workspace registers its
  own callback and receives fresh enablement (`README.md:120-121`).

## Security posture

The scheduler is capability-authorized: it receives no Workshop user identity, does not assert its
own ambient policy, exposes no external network authority, and implements no actions — the
Workshop's hook admission and observation authorization remain the boundaries (`README.md:158-160`).
The README also notes that `allow_irrevocable_stub_storage` is required while stored callback
capabilities exist and must not be removed from an existing deployment (`README.md:207-208`).

One documented tradeoff: the single account-wide driver is simple for management and revocation but
a shared failure domain — a user callback that never settles can delay other schedules in the same
account until the runtime aborts the alarm; bounded batches limit ordinary load without eliminating
that risk (`README.md:154-156`).
