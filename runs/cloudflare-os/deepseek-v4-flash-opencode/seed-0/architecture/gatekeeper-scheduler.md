---
type: subsystem
title: Scheduled Tasks gatekeeper
description: The Scheduled Tasks gatekeeper is an auto-provisioned account exposing an ambient singleton for registering persistent workspace callbacks and a read-only management UI, with one ScheduleDriver Durable Object per account running a lease-based state machine from a shared alarm.
tags: [gatekeeper, scheduler, hooks, alarm, durable-object]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-01T03:10:52.365Z
sources:
  - id: openwiki-source-ba5ed6f8a39e02ef06030626
    resource: repo://packages/gatekeeper-scheduler/src/driver-state.ts
  - id: openwiki-source-3cf1b245c90ed07be18f4946
    resource: repo://packages/gatekeeper-scheduler/src/schedule-driver.ts
  - id: openwiki-source-6e4b904940a56a0c9f48b90b
    resource: repo://packages/gatekeeper-scheduler/src/scheduler.ts
generated: { by: "opencode", at: "2026-09-01T03:10:52.365Z" }
---

# Scheduled Tasks gatekeeper

`packages/gatekeeper-scheduler` is **Scheduled Tasks**: an auto-provisioned gatekeeper whose ambient
singleton lets a workspace register persistent callbacks that run on recurring or one-shot schedules.
The account also provides a read-only management UI.

## Auto-provisioned account and ambient singleton

`GatekeeperVendor` declares `autoProvisionsAccount: true` (`scheduler.ts:402-414`) and
`createAccount()` mints a `ScheduleAccount` with an opaque accountId and no user identity
(`scheduler.ts:417-422`). The account's `describe()` declares an agent singleton
(`singleton: { tsType: "ScheduleSession" }`) and a management UI (`providesUi: { title: "Scheduled" }`),
so the Workshop auto-provisions one account per user, installs the `SchedulerGatekeeper` facet into
the owner's workspaces, and auto-provides its session as an ambient capsule.

The session is `ScheduleSession` (`ScheduleSessionImpl`, `scheduler.ts:89`):

- `every(everyMs, callback, options)` — an interval anchored to registration time;
- `calendarAt(rule, callback, options)` — a timezone-aware calendar recurrence;
- `runAt(when, callback, options)` — a numeric or timezone-aware one-shot;
- `list()` — the workspace's enabled schedules, after observation authorization.

Each registration builds an immutable `ScheduleHookController` (a `WorkerEntrypoint` whose props carry
the account, workspace, schedule id, spec, title/description, and occurrence limits) and passes it to
`approvalQueue.bindHook()` along with the callback. The controller is what enables/disables the
schedule in the driver; all its state lives in its props, so nothing else needs storing until
enabled. Registering is an observation-authorized operation on a **read-only** gatekeeper — no
actions are ever submitted (`applyAction`/`rejectAction`/`revertAction` throw), and observer policy is
low-stakes strategy D (trivial verifier, `addObserver`/`removeObserver` no-ops).

## The ScheduleDriver Durable Object

One `ScheduleDriver` DO per account (`getByName(accountId)`) stores all enabled schedules and
delivers them from a **single shared alarm** (`schedule-driver.ts`). Its storage layout:

- `metadata` — `{ schemaVersion, revoked }`;
- `schedule:<workspace>:<scheduleId>` — one row per enabled schedule (`StoredSchedule`: versioned
  `state` plus title/description/gadgetId);
- `caps:<workspace>:<scheduleId>` — the delivery capability row holding the `HookInitiator` stub,
  stored only while the schedule can still fire and released (disposed) once it reaches a terminal
  state.

Enablement enforces quotas (`#assertScheduleQuota`): at most **500 enabled schedules per account** and
**100 per workspace**. `enable()` also arms a recovery alarm 5 minutes out, so even a delivery that
hangs the DO gets revisited.

### The delivery loop

The alarm handler (`#runAlarm`) collects every due schedule (by `nextFire` / `nextAttempt` /
`leaseExpiresAt`), takes a batch of `ALARM_BATCH_SIZE` (20), delivers them at
`DELIVERY_CONCURRENCY` (4) with each delivery wrapped in `#deliverSafely`, then replans the alarm to
the next due target (`#planAlarm`). A delivery (`#deliverPrepared`) walks the run's stages:

1. **prepare** (`#prepareRun`) — under a storage transaction, a due active/retrying schedule becomes a
   `pending` run with a fresh `runId`, `stage: "admission"`, and a `leaseExpiresAt` 5 minutes out; an
   already-pending run gets its lease extended.
2. **admission** — `initiator.startHook()` returns the re-bound callback plus a fresh `ApprovalQueue`;
   a rejection here means the workspace no longer accepts the hook, and the occurrence is rejected
   without consuming a callback attempt.
3. **authorization** — `approvalQueue.authorizeObservation` records the firing as an observation;
   failure transitions the run to `failed`/`dead`.
4. **callback** — `callback.onSchedule(firing)` delivers the event; failure schedules a retry.

The callback is never stored by the gatekeeper: it is always re-obtained via `startHook()`, which
binds it to the fresh session.

### The run state machine

`driver-state.ts` defines the persisted states. A **logical run** per schedule is created by
`beginDueRun` (active -> pending/admission, or retrying -> pending/admission with its runId kept),
advanced by `admitRun` (pending -> pending/delivery, consuming one attempt), and settled by:

- `rejectRun` — admission rejected; a one-shot becomes `expired`, a recurrence returns to `active`
  (or `completed` at its limit) without consuming a callback attempt;
- `failRun` — a callback/authorization failure during delivery; after `MAX_ATTEMPTS` (8) the schedule
  becomes `dead` with a `failureCode`, otherwise `retrying` with an exponential backoff
  (`retryDelay`: 60 s doubling to a 3.6 h cap);
- `completeRun` — delivered; a one-shot becomes `completed`, a recurrence advances its cadence.

Because the alarm handler cannot overlap its own live handler, a hung callback stalls the batch — the
**lease/recovery watchdog** is what bounds it: every pending run carries `leaseExpiresAt`, a run
already in `delivery` when the next alarm passes is failed as `callback_failed`, and the recovery
alarm re-arms the DO so a wedged batch is revisited after 5 minutes. Failures whose outcome is
unknown close as they may-or-may-not-have-fired (the run is failed, not retried blindly).

## Management UI, observability, and revocation

`ScheduleAccount.startAppUi()` returns the bundled single-file React SPA as `iframeHtml` plus a
`ui` capability (`ScheduleManagementApi`) that can only list schedules across the account — no
mutation authority. The management UI also carries hook enablement/disablement out of the Workshop's
Connections UI via the ordinary hook lifecycle.

The driver uses the shared observability conventions: every operation runs inside
`obsContext.with({...})` and unexpected failures are reported via `reportIssue`
(`scheduler.delivery`, `scheduler.alarm`, `scheduler.revoke`, ...). `revoke()` marks the account
permanently revoked and schedules a cleanup alarm that drains and disposes every capability row in
batches of 100 before deleting the schedule rows.

Quotas and safety bounds that matter operationally: `MAX_ENABLED_SCHEDULES_PER_ACCOUNT` (500),
`MAX_ENABLED_SCHEDULES_PER_WORKSPACE` (100), `ALARM_BATCH_SIZE` (20), `DELIVERY_CONCURRENCY` (4),
`RECOVERY_DELAY_MS` (5 min), `MAX_ATTEMPTS` (8).
