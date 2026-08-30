---
type: workflow
title: Sandbox Lifecycle
description: Session Durable Object sandbox spawn, warm, snapshot versus persistent pause/resume, inactivity and heartbeat, circuit breaking, and reconnect denial for stopped or stale sandboxes.
tags: [sandbox, lifecycle, snapshots, heartbeat, circuit-breaker]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-e4612bca9a94285f802d6062
    resource: repo://packages/control-plane/src/sandbox/lifecycle/decisions.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-2312e78016a3e899b195c16b
    resource: repo://packages/control-plane/src/sandbox/providers/daytona-provider.ts
  - id: openwiki-source-41952f779c848b0196f22641
    resource: repo://packages/control-plane/src/sandbox/providers/e2b-provider.ts
  - id: openwiki-source-5951ad3abbae5840613b8cda
    resource: repo://packages/control-plane/src/sandbox/providers/modal-provider.ts
  - id: openwiki-source-a2cd7291c8cde154baee7977
    resource: repo://packages/control-plane/src/sandbox/providers/opencomputer-provider.ts
  - id: openwiki-source-5bd0ac0dcec22450aa912fbb
    resource: repo://packages/control-plane/src/sandbox/providers/vercel/provider.ts
  - id: openwiki-source-17525a70b871e2e83636b91f
    resource: repo://packages/control-plane/src/session/alarm/handler.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Sandbox Lifecycle

Each session Durable Object owns one sandbox through `SandboxLifecycleManager`. Pure decisions live in `packages/control-plane/src/sandbox/lifecycle/decisions.ts`; the manager executes them via a `SandboxProvider`. Alarms (`packages/control-plane/src/session/alarm/handler.ts`) run execution-timeout recovery then `lifecycleManager.handleAlarm()`.

Related: [Session Durable Object](/openwiki/architecture/session-durable-object.md), [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md), [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md), [Image Prebuild](/openwiki/workflows/image-prebuild.md).

## Provider capability split

`SandboxProviderCapabilities` (`packages/control-plane/src/sandbox/provider.ts`) is how the manager branches. Default lifetime is `DEFAULT_SANDBOX_TIMEOUT_SECONDS` (7200).

| Backend | Snapshots / restore | Persistent resume | Explicit stop |
| --- | --- | --- | --- |
| Modal | yes / yes | no | no |
| Vercel | yes / yes | no | yes |
| OpenComputer | yes / yes | yes | yes |
| Daytona | no / no | yes | yes |
| E2B | no / no | yes (stop is a pause) | yes |

**Snapshot/restore path** (Modal, Vercel, OpenComputer): inactivity or completion takes a filesystem snapshot (`snapshot_image_id` + `snapshot_runtime_version`). The next prompt **restores** that image into a **new** sandbox (or a prebuilt image — see [Image Prebuild](/openwiki/workflows/image-prebuild.md)). Modal has no explicit stop; the old object is abandoned after snapshot.

**Persistent path** (Daytona, E2B): the same provider object is stopped/paused and later **resumed in place**. `supportsPersistentResume` makes `evaluateSpawnDecision` return `resume` with `providerObjectId` instead of `restore`. `usesProviderManagedStop` is explicit-stop AND persistent-resume.

OpenComputer is both: it can snapshot **and** resume.

A snapshot whose runtime version is missing, unparseable, or below `MIN_COMPATIBLE_RUNTIME_VERSION` is not restored (`isSnapshotRuntimeCompatible` fails closed) — one fresh spawn, then the next snapshot records a version.

## Spawn and warming

`spawnSandbox`:

1. **Circuit breaker** — `evaluateCircuitBreaker`. Default threshold 3 failures in `windowMs` 5 minutes. Open → skip spawn and report wait time. Window elapsed → reset count. Only **permanent** provider errors increment the count; transients do not.
2. **`evaluateSpawnDecision`** with in-memory `isSpawningSandbox || isTerminatingSandbox` so two concurrent calls in the same isolate cannot double-create. Actions: `skip` (already spawning/connecting/ready+WS), `wait` (cooldown 30s, or ready without WS for `readyWaitMs` 60s), `restore`, `resume`, or `spawn`. Stuck `spawning`/`connecting` older than `spawningTimeoutMs` (120s) is treated as dead so a cancelled provider call cannot pin the session forever.
3. Fresh spawn may select a prebuilt image (`evaluateImageBuildForSpawn`); miss falls back to the base runtime.
4. Success resets the circuit breaker.

**Warming** (`evaluateWarmDecision`): when the user starts typing, spawn unless a WebSocket is already up or a spawn is in progress. Setup scripts run on fresh/base boots; restore/prebuilt skip setup and run `start.sh` only.

Default inactivity is 10 minutes (`DEFAULT_INACTIVITY_CONFIG.timeoutMs`), extendable 5 minutes with a warning when a client is still connected. Heartbeats are expected every 30s; 90s silence is stale (`evaluateHeartbeatHealth`). Stale → snapshot (if capable) and persist status `stale`.

## Persistence that blocks reconnects

`isDeadSandboxStatus` is a deny-list: `stopped`, `stale`, `failed`. Unknown future statuses are treated as live.

`isSandboxReconnectBlockedStatus` is **only** `stopped` and `stale`. **Failed is reconnectable**: a slow boot can outlive the connecting watchdog and self-heal when its bridge arrives. Explicit `stopped`/`stale` persistence is what prevents a dead sandbox's old token from reconnecting after replacement.

Connecting-timeout and inactivity alarms schedule the next check through the Durable Object's single alarm slot. The alarm handler reasserts a processing-message execution deadline before lifecycle handling so stuck-prompt recovery is not delayed.

## Concurrent spawn guard

`isSpawningSandbox` is in-memory on the manager (same DO isolate). Combined with persisted `spawning`/`connecting` status, it is the guard against double spawn in one request burst. Cross-isolate races still rely on provider-side create + the later WebSocket token check.

## Invariants

- Decisions are pure; I/O is in the manager and adapters.
- Circuit breaker is spawn-failure scoped, not heartbeat-stale scoped.
- Snapshot restore is gated on runtime version the same way prebuilt images are.
- Sessions never wait on an in-flight image build; they miss and use the base image.
- Python provider timeouts are seconds; TypeScript inactivity/alarms are milliseconds.

## Focused tests

- Decision matrix: `packages/control-plane/src/sandbox/lifecycle/` neighboring `decisions` tests
- Manager spawn/restore/circuit: `packages/control-plane/src/sandbox/lifecycle/manager` tests
- Provider capability objects: each `packages/control-plane/src/sandbox/providers/*-provider.test.ts`
- Alarm ordering: `packages/control-plane/src/session/alarm/` tests
