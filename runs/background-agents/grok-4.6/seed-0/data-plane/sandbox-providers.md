---
type: architecture
title: Sandbox Providers
description: Deployment-wide SANDBOX_PROVIDER selection among Modal, Daytona, E2B, Vercel Sandboxes, and OpenComputer, compared by snapshot, restore, persistent resume, stop, and timeout capabilities.
tags: [sandbox, providers, modal, daytona, e2b, vercel, opencomputer]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-83a5c69723e8f477e9b7dcbd
    resource: repo://docs/HOW_IT_WORKS.md
  - id: openwiki-source-7c3e145b2a485e54a0e9643b
    resource: repo://packages/control-plane/src/sandbox/provider-factory.ts
  - id: openwiki-source-34e06057c714bce9a57f0b88
    resource: repo://packages/control-plane/src/sandbox/provider-name.ts
  - id: openwiki-source-9a736cd5ab523477b47ea706
    resource: repo://packages/control-plane/src/sandbox/provider.ts
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
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Sandbox Providers

The control plane talks to **one** sandbox backend per deployment, selected by `SANDBOX_PROVIDER` (`modal`, `daytona`, `vercel`, `opencomputer`, `e2b`). The default is Modal. An unknown value throws at provider construction. Missing credentials for the selected backend also throw — a misconfigured deployment fails session initialization rather than running degraded. See [Session Durable Object](/openwiki/architecture/session-durable-object.md).

`createSandboxProviderFromEnv` in `packages/control-plane/src/sandbox/provider-factory.ts` is the switch. Lifecycle code (`SandboxLifecycleManager`) depends on the `SandboxProvider` interface and `SandboxProviderCapabilities`, not on Modal-specific types. ADR 0002: providers own lifecycle semantics and error classification; HTTP/auth wiring is delegated to each provider’s client.

Infra packages (`modal-infra`, `daytona-infra`, `e2b-infra`, `opencomputer-infra`, plus Vercel snapshot scripts) are **implementation details of that one backend**. They are not a menu at session create.

Every backend runs the same [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md).

## Capabilities

| Backend | Timeout | Filesystem snapshots | Restore | Persistent resume | Explicit stop |
| --- | --- | --- | --- | --- | --- |
| Modal | yes | yes | yes | no | no |
| Vercel | yes | yes | yes | no | yes |
| OpenComputer | yes | yes | yes | yes | yes |
| Daytona | no | no | no | yes | yes |
| E2B | yes | no | no | yes | yes |

`DEFAULT_SANDBOX_TIMEOUT_SECONDS` is 7200 (2 hours) on the provider interface. Python runtimes use seconds; TypeScript control-plane inactivity uses milliseconds. See [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md).

**Snapshot/restore backends** (Modal, Vercel, OpenComputer): inactivity or completion takes a filesystem snapshot; the next prompt restores that image (or a prebuilt image) into a new sandbox. Modal does not expose explicit stop/resume in place.

**Persistent backends** (Daytona, E2B): the same sandbox is stopped or paused and later resumed. They do not take per-turn filesystem snapshots (`supportsSnapshots: false`). For those two, the control plane stops/pauses on inactivity or stale heartbeat, then resumes that sandbox later.

## Image prebuild

Control-plane image-build workflow supports **Modal, Vercel, and OpenComputer**. Daytona and E2B rely on a base snapshot/template baked by their infra packages, not that shared prebuild pipeline. E2B can still **spawn** from a template id when a prebuilt image id is supplied; that is not the same as the Modal/Vercel/OpenComputer create-bind-launch build job. See [Image Prebuild](/openwiki/workflows/image-prebuild.md).

## Provider notes

**Modal** (`packages/modal-infra`) — FastAPI endpoints on Modal call sandbox-runtime directly (not nested `.remote()`). Sensitive endpoints require HMAC tokens (`MODAL_API_SECRET`, `MODAL_WORKSPACE`). Image-build trigger config extends the shared contract with SCM clone identity. Deploy via `deploy.py`, not `src/app.py`.

**Daytona** — Direct REST. Requires `DAYTONA_API_URL`, `DAYTONA_API_KEY`, `DAYTONA_BASE_SNAPSHOT`. `packages/daytona-infra` bootstraps the named base snapshot.

**Vercel Sandboxes** — Requires `VERCEL_TOKEN` and `VERCEL_PROJECT_ID`. Optional managed base snapshot id/name. Snapshot expiration is configured in milliseconds (`VERCEL_SNAPSHOT_EXPIRATION_MS`; `0` means none).

**OpenComputer** — Requires API URL and key; starting a sandbox also requires `OPENCOMPUTER_TEMPLATE` unless spawning from a prebuilt image. Checkpoints back both restore and prebuild. `packages/opencomputer-infra` builds the template.

**E2B** — Requires `E2B_API_KEY` and `E2B_TEMPLATE_ID`. Default API `https://api.e2b.app`. `E2B_SANDBOX_TIMEOUT_SECONDS` (Hobby plans must stay within provider limits) and `E2B_AUTO_PAUSE` (default true: pause on TTL instead of kill). `packages/e2b-infra` builds the template.

## Factory failure behavior

- Unsupported `SANDBOX_PROVIDER` → throw `Unsupported SANDBOX_PROVIDER: …`
- Modal without `MODAL_API_SECRET` and `MODAL_WORKSPACE` → throw
- Same pattern for Daytona, Vercel, OpenComputer, E2B required env vars
- Numeric env such as `VERCEL_SNAPSHOT_EXPIRATION_MS` must parse as a finite number or construction throws

There is no per-session provider column. Switching backends is a deployment change (and usually a new image/template), not a session setting.
