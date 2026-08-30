---
type: architecture
title: Architecture Overview
description: Open-Inspect's three-tier design — Cloudflare control plane, sandbox data plane, and client tier — plus the end-to-end prompt/event flow and the shared protocol-contract package that binds them.
tags: [architecture, overview, control-plane, data-plane, clients]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-83a5c69723e8f477e9b7dcbd
    resource: repo://docs/HOW_IT_WORKS.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-78da2b6e3769fd428b85fe5a
    resource: repo://packages/control-plane/src/index.ts
  - id: openwiki-source-02d8401c91a4f2936e65eb0b
    resource: repo://packages/control-plane/src/sandbox/daytona-rest-client.ts
  - id: openwiki-source-34e06057c714bce9a57f0b88
    resource: repo://packages/control-plane/src/sandbox/provider-name.ts
  - id: openwiki-source-9a736cd5ab523477b47ea706
    resource: repo://packages/control-plane/src/sandbox/provider.ts
  - id: openwiki-source-010b42f2bd8a163b8771ee37
    resource: repo://packages/control-plane/src/session/disconnect-handler.ts
  - id: openwiki-source-b5e52d398550648420138d80
    resource: repo://packages/control-plane/src/session/schema.ts
  - id: openwiki-source-4f606005c64e373cdd655a89
    resource: repo://packages/modal-infra/src/web_api.py
  - id: openwiki-source-cbd064f0f85a511828117a62
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/bridge.py
  - id: openwiki-source-0dfefeca89a6d1280d92409c
    resource: repo://packages/shared/src/types/websocket.ts
  - id: openwiki-source-866396dcda2257f4296197f1
    resource: repo://packages/web/src/lib/browser-api-fetch.ts
  - id: openwiki-source-f92a272da85b38851895803e
    resource: repo://packages/web/src/lib/control-plane-service.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

Open-Inspect is a background coding agent system: a user sends a prompt, the work runs in an isolated cloud sandbox independent of the sender's connection, and results stream back to any client. The codebase is organized as a monorepo of Cloudflare Workers (TypeScript), a Python data plane, a Next.js web client, and a shared contract library.

## The three tiers

### Control plane — `packages/control-plane`

A Cloudflare Worker plus one Durable Object class (`SessionDO`) that coordinates everything but executes no user code. The worker entrypoint (`packages/control-plane/src/index.ts`) has three handlers:

- `fetch` (L33–47): WebSocket upgrades on the path `/sessions/:id/ws` are checked against the D1 session index before waking the DO (L103–119), then forwarded to the session's Durable Object stub (L129–133). All other requests go to the API `router.ts` pipeline.
- `scheduled` (L52–80): three crons — the image-build scheduler, the abandoned-draft sweep, and an every-minute tick that runs the automation `Scheduler` plus autofix queue health checks.
- `queue` (L82–89): routes Durable Queue batches to the GitHub autofix consumer or the image-build finalization consumer.

Each session is a Durable Object with its own embedded SQLite database (schema in `packages/control-plane/src/session/schema.ts`), giving per-session isolation for messages, events, artifacts, participants, and sandbox state. Shared state — the session index, repository metadata, environments, secrets, automations, image builds — lives in a D1 database. See [Session Durable Object](/openwiki/control-plane/session-durable-object.md) and [D1 Data Model](/openwiki/control-plane/d1-data-model.md).

### Data plane — sandbox providers and `packages/sandbox-runtime`

Where code actually runs. The control plane talks to a pluggable sandbox backend (Modal, Daytona, E2B, OpenComputer, or Vercel) through a common `SandboxProvider` interface (`packages/control-plane/src/sandbox/provider.ts`); each backend creates an isolated sandbox containing a full dev environment plus **OpenCode**, the coding agent. Every provider image bakes the same provider-agnostic Python runtime (`packages/sandbox-runtime`): a supervisor that clones repositories, runs repo hooks, starts OpenCode, and spawns a WebSocket **bridge** that connects back to the control plane at `wss://{CONTROL_PLANE_URL}/sessions/{session_id}/ws?type=sandbox` (`packages/sandbox-runtime/src/sandbox_runtime/bridge.py:282–286`). Modal additionally runs a FastAPI data-plane service (`packages/modal-infra`) that the control plane calls over HMAC-authenticated HTTP. See [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md), [Sandbox Provider Abstraction](/openwiki/data-plane/sandbox-providers.md), and [Modal Data Plane](/openwiki/data-plane/modal-infra.md).

### Clients — web and bot integrations

- `packages/web` — Next.js 16 / React 19 dashboard. It is a BFF: browser code only hits same-origin `/api/*` routes, which forward sig1-signed service requests (with the user's session cookie) to the control plane. See [Web Client](/openwiki/clients/web-client.md).
- `packages/slack-bot`, `packages/github-bot`, `packages/linear-bot` — Cloudflare Workers (Hono) that turn chat/issue/PR events into sessions and receive completion callbacks from the control plane. See the [integrations](/openwiki/integrations/slack-bot.md) pages.

## End-to-end prompt flow

```
User prompt (web WS / Slack / GitHub / Linear / automation)
  → control-plane API or client WebSocket frame
  → SessionDO message queue (durable, FIFO, one prompt processing at a time)
  → spawn/restore sandbox if needed (SandboxLifecycleManager)
  → `prompt` command over the sandbox WebSocket
  → sandbox bridge → OpenCode agent works (edits, commands, commits)
  → events stream back over the same WebSocket
  → DO persists events (timeline_sequence) and broadcasts to all clients
  → artifacts (PRs, screenshots) recorded and announced
```

Prompts sent while the agent is busy are queued and processed in order; disconnecting a client never stops the run, and a sandbox WebSocket drop triggers bridge reconnect plus a scheduled heartbeat check rather than teardown (`docs/HOW_IT_WORKS.md:186–192`). The queue and event-stream invariants are detailed in [Prompt Queue and Event Stream](/openwiki/control-plane/prompt-and-event-pipeline.md).

## The shared contract layer

`@open-inspect/shared` (`packages/shared`) is the single home of the wire protocol between all three tiers: the client→control-plane WebSocket messages (`packages/shared/src/types/websocket.ts:6–42`: `ping`, `subscribe`, `prompt`, `cancel_prompt`, `stop`, `typing`, `presence`, `fetch_history`), control-plane→client server messages, sandbox→control-plane event schemas, the sig1 service-auth signature scheme, the model catalog, cron/trigger types, and repository identity helpers. The control plane parses every inbound sandbox/client frame against these Zod schemas, and the web client validates every inbound frame, so protocol drift fails loudly at the boundary. All TS packages (`control-plane`, `web`, the three bots) depend on it, which is why **shared must be built before any dependent package** (`npm run build -w @open-inspect/shared`; enforced in CI and by the repo's own `.openinspect/setup.sh`).

## Package map

| Package | Stack | Tier |
| --- | --- | --- |
| `shared` | TypeScript | protocol contracts for everyone |
| `control-plane` | CF Workers + DO + D1/Queues/KV/R2 | control |
| `modal-infra` | Python / Modal + FastAPI | data (Modal backend) |
| `sandbox-runtime` | Python | data (in-sandbox supervisor/bridge) |
| `daytona-infra`, `e2b-infra`, `opencomputer-infra` | Python/TS build tooling | data (template/snapshot builds) |
| `web` | Next.js 16 | client |
| `slack-bot`, `github-bot`, `linear-bot` | CF Workers + Hono | client |

Deployment is Terraform-managed (`terraform/`), with the sandbox backend chosen by the `sandbox_provider` variable and the web app deployed to Vercel or Cloudflare via `web_platform`. See [Deployment and CI/CD](/openwiki/operations/deployment.md).

## Where to go next

- Deploying an instance: [Quickstart](/openwiki/quickstart.md) and [Deployment](/openwiki/operations/deployment.md)
- Session mechanics: [Session Durable Object](/openwiki/control-plane/session-durable-object.md), [Prompt Queue and Event Stream](/openwiki/control-plane/prompt-and-event-pipeline.md), [Sandbox Lifecycle](/openwiki/control-plane/sandbox-lifecycle.md)
- Security and tokens: [Authentication, Secrets, and Provider Accounts](/openwiki/control-plane/auth-and-secrets.md)
- Scheduled/background work: [Automation Engine](/openwiki/control-plane/automation-engine.md), [Image Prebuilds](/openwiki/control-plane/image-prebuilds.md)
