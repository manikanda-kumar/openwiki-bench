---
type: subsystem
title: Sandbox Lifecycle Manager
description: The SessionDO's sandbox orchestration — pure decision functions for spawn/restore/resume, circuit breaker, heartbeat and inactivity watchdogs, two-phase spawn reservation, runtime-generation snapshot gating, and the persistent status machine.
tags: [sandbox, lifecycle, state-machine, alarms, providers]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-e4612bca9a94285f802d6062
    resource: repo://packages/control-plane/src/sandbox/lifecycle/decisions.ts
  - id: openwiki-source-416a2efbd05cc2aaf16d47c6
    resource: repo://packages/control-plane/src/sandbox/lifecycle/manager.ts
  - id: openwiki-source-9a736cd5ab523477b47ea706
    resource: repo://packages/control-plane/src/sandbox/provider.ts
  - id: openwiki-source-7d94c4842f675779386f1422
    resource: repo://packages/control-plane/src/sandbox/runtime-manifest.ts
  - id: openwiki-source-25f732b7b5de5b09b4f9e087
    resource: repo://packages/control-plane/src/sandbox/sandbox-status.ts
  - id: openwiki-source-6ca2b78de156c7927d717fae
    resource: repo://packages/control-plane/src/sandbox/settings.ts
  - id: openwiki-source-f69048d2562235a60f688786
    resource: repo://packages/control-plane/src/session/components.ts
  - id: openwiki-source-85f16310824bd9d0bfe42c60
    resource: repo://packages/control-plane/src/session/presence-service.ts
  - id: openwiki-source-cbd064f0f85a511828117a62
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/bridge.py
  - id: openwiki-source-3c5f1a9eb38076e18b0019f2
    resource: repo://packages/shared/src/types/sessions.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

The sandbox lifecycle is orchestrated per session by `SandboxLifecycleManager` (`packages/control-plane/src/sandbox/lifecycle/manager.ts`, ~1700 lines), built as tier-5 of the DO composition (`session/components.ts:852–955`). Its design split is the page's thesis: **every policy is a pure function in `lifecycle/decisions.ts`** — timestamps in, action out — while the manager owns side effects (provider calls, WS, broadcasts, alarms). Both files are unit-testable without Cloudflare, and the decision matrix is exhaustively pinned in `decisions.test.ts`/`manager.test.ts`.

## Status machine

`SandboxStatus` (shared, `packages/shared/src/types/sessions.ts:35–45`): `pending → spawning → connecting → ready`, with `warming` (typing-triggered), `snapshotting`, and terminal `stale`/`stopped`/`failed`. Two deny-lists define reuse rules (`decisions.ts:20–41`):

- **Dead** for spawn evaluation = `stopped|stale|failed` — none of these can be skipped; the question becomes restore/resume/spawn.
- **Reconnect-blocked** = `stopped|stale` only. `failed` stays reconnectable on purpose: a slow boot can outlive the 120 s connecting watchdog and self-heal when its bridge finally arrives (comment L35–38, pinned by `test/integration/websocket-sandbox.test.ts`).

An unrecognized persisted status coerces to `failed` — the only value that both refuses reuse and permits a clean spawn (`sandbox/sandbox-status.ts:26–40`); a throw would abort spawn evaluation and alarm ticks over a survivable value.

## Spawn decision and circuit breaker

`evaluateSpawnDecision` (docblock `decisions.ts:225–243`) resolves to `skip | wait | resume | restore | spawn`: skip while a spawn is in flight (in-memory flag) or status is `spawning`/`connecting` unless older than `spawningTimeoutMs = 120s` — the guard for a crashed spawn that pinned the status forever (`SpawnConfig`, L166–191); wait during the 30 s cooldown or when `ready` without a socket but recently spawned; **resume** the same provider sandbox (`stopped|stale`) when the capability set is persistent (Daytona/E2B); **restore** from a snapshot image for snapshot-capable providers (Modal/Vercel/OpenComputer). A fresh sandbox connects within `readyWaitMs = 60s` of its spawn.

The **circuit breaker** (L68–137) blocks spawning after `threshold: 3` failures inside a 5-minute window, with `waitTimeMs` telling callers when to retry. Only *permanent* provider errors count — transient 502/503/504s and network timeouts are classified out of the breaker in `sandbox/provider.ts:347–430` — so a provider brownout doesn't trip every session's breaker.

## Snapshot gating by runtime generation

Restoring a filesystem snapshot resurrects the exact agent runtime it captured (including the pinned OpenCode binary), so a runtime fix would never reach a session that keeps restoring — the incident that stranded sessions on the OpenCode message-ID wraparound. Therefore `isSnapshotRuntimeCompatible` fails **closed**: a snapshot without a recorded runtime version, or one below the floor, triggers a fresh spawn instead (`decisions.ts:193–215`). The floor lives in one place — `packages/sandbox-runtime/src/sandbox_runtime/runtime_manifest.json` (`runtimeVersion`, `generation`, `minimumCompatibleGeneration`, `minimumRebuildGeneration`), imported by both the control plane (`sandbox/runtime-manifest.ts`, which throws if version and generation disagree) and the Python runtime; bumping it retires both prebuilt images *and* snapshots. Snapshots are taken after successful prompt completion, before inactivity shutdown, and on explicit save.

## Inactivity, heartbeat, and alarms

The DO has a single alarm slot fed by a persisted-deadline-first scheduler (`session/alarm/scheduler.ts`); `handleAlarm` (`manager.ts:1266–1448`) composes in order: connecting-timeout watchdog (fail + provider stop) → heartbeat-stale check → inactivity evaluation → stuck fail+resume.

- **Inactivity** (`evaluateInactivity`, `decisions.ts:372–461`): default 10 minutes idle (`SANDBOX_INACTIVITY_TIMEOUT_MS`, overridable via `sandbox_settings.sandboxTimeoutMs`), but while clients are connected the manager grants a 5-minute **extension** and a warning broadcast instead of shutdown (`DEFAULT_INACTIVITY_CONFIG`, L382–386). On timeout the manager persists status **`stopped` first, then** tears down — closing the reconnect window before the socket dies. Snapshot-capable providers snapshot-then-shutdown; persistent providers (Daytona/E2B) simply stop/pause the same sandbox for later resume — the divergence the capability flags encode.
- **Heartbeat staleness** (`decisions.ts:472–529`): the bridge pings every 30 s; missing 3 (90 s) marks the sandbox `stale` and drives provider-managed stop vs snapshot+shutdown, returning `sandbox_terminated` so the queue surfaces the failure. Losing the WebSocket alone never kills the sandbox — that path waits for the heartbeat check (see `docs/HOW_IT_WORKS.md:186–192`).
- **Execution timeout** (`decisions.ts:657–690`): a per-run watchdog armed when a prompt dispatches; expiry fails the message rather than the sandbox.

## Two-phase spawn reservation (#1589)

`doSpawn` reserves identity before contacting a provider (`manager.ts:479–530`): phase 1 writes a *new* sandbox identity with **invalidated** credentials; phase 2 publishes the auth-token hash scoped to that reservation via a conditional compare (`expectedSandboxId`). If a newer reservation superseded it mid-flight, `SpawnSupersededError` aborts the loser **without clobbering** the winner's row (L320–331). Combined with the WS-manager's refusal to adopt zombie sockets (`websocket-manager.ts:157–203`), an old bridge can never authenticate against a newer sandbox or vice versa. On provider-create failure with a selected prebuilt image, the manager marks that build failed and retries once from the base identity (`manager.ts:595–629`).

## Warming and settings

`warmSandbox` (`manager.ts:1517+`) starts the restore/spawn path on typing without a queued prompt (status `warming`, no credential publish until ready), so by the time the user submits, dispatch often skips straight to send. Sandbox behavior knobs — `tunnelPorts`, `codeServer`, `vnc`, `terminal`, resources (`cpuCores`/`memoryMib`), `sandboxTimeoutMs` — persist per session in `sandbox_settings` (`sandbox/settings.ts`, resolved at tier-5 and threaded into `CreateSandboxConfig`); port services are computed from those settings by `providers/port-resolution.ts`. `terminateUnresponsiveSandbox`/`terminateFailedSandbox` (L1450–1512) give the queue and prompt-dispatch paths their explicit teardowns.

Provider interfaces, per-backend quirks, and env injection are covered on [Sandbox Provider Abstraction](/openwiki/data-plane/sandbox-providers.md); prebuilt-image selection feeding `doSpawn` on [Image Prebuild System](/openwiki/control-plane/image-prebuilds.md).
