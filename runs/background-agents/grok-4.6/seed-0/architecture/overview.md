---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-4e41d9b444e4a786f517355e
    resource: repo://docs/adr/0002-shared-session-contracts-and-correlation-boundary.md
  - id: openwiki-source-83a5c69723e8f477e9b7dcbd
    resource: repo://docs/HOW_IT_WORKS.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-8207def63e0d42ebbdef131a
    resource: repo://packages/control-plane/package.json
  - id: openwiki-source-5856d6dafe718ec27f678566
    resource: repo://packages/shared/src/service-auth.ts
  - id: openwiki-source-838775db970f8e98c97bcd00
    resource: repo://packages/slack-bot/package.json
  - id: openwiki-source-4b5549338e2c170c73ef3562
    resource: repo://packages/web/package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---


# Architecture Overview

Open-Inspect is a background coding-agent system. A user sends a prompt from the web app or a bot, a cloud sandbox runs the agent, and results stream back even if the original client disconnects. The system is a single-tenant deployment: every user of an instance is treated as a trusted member of the same organization. See [Security Model and Authentication](/openwiki/concepts/security-and-auth.md).

This page is the map. [Control Plane](/openwiki/architecture/control-plane.md), [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md), [Web Client](/openwiki/architecture/web-client.md), and [Shared Contracts](/openwiki/architecture/shared-contracts.md) own the details.

## Three tiers

```
Clients (web, Slack, GitHub, Linear, inbound webhooks)
        │  HTTP + WebSocket
        ▼
Control plane (Cloudflare Worker + per-session Durable Objects + D1)
        │  provider APIs + sandbox WebSocket
        ▼
Data plane (one selected sandbox backend running sandbox-runtime)
```

### Clients

Anything that can call the control-plane HTTP API and optionally hold a WebSocket can participate. The in-repo clients are:

- **Web** (`packages/web`) — Next.js dashboard, settings, automations, and the live session page
- **Slack bot** (`packages/slack-bot`) — Cloudflare Worker that turns messages into sessions
- **GitHub bot** (`packages/github-bot`) — Cloudflare Worker for PR review, @mentions, and autofix ingress
- **Linear bot** (`packages/linear-bot`) — Cloudflare Worker for Linear AgentSessionEvent webhooks

Bots are not a second control plane. They authenticate as services (`web`, `slack-bot`, `github-bot`, `linear-bot` in `SERVICE_NAMES`) and create or continue the same sessions the web UI would. Sending a prompt from Slack and watching it on the web works because **session state lives in the control plane, not in the client**.

### Control plane

The Cloudflare Worker authenticates callers, indexes shared state in D1, and forwards live session work to one Durable Object per session. The Durable Object holds that session's SQLite (messages, events, artifacts, sandbox rows) and the WebSocket hub that fans events out to every connected client and the sandbox bridge.

The Worker does not execute agent tools. It spawns and observes sandboxes through a `SandboxProvider` abstraction. See [Control Plane](/openwiki/architecture/control-plane.md) and [Session Durable Object](/openwiki/architecture/session-durable-object.md).

### Data plane

Each session gets an isolated sandbox with a full dev environment. Every backend runs the same in-sandbox runtime (`packages/sandbox-runtime`): supervisor, repository boot, OpenCode, and a WebSocket bridge back to the session Durable Object.

The deployment selects one sandbox provider (`SANDBOX_PROVIDER`): Modal, Daytona, Vercel Sandboxes, OpenComputer, or E2B. Capabilities differ (filesystem snapshots versus persistent pause/resume). See [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md) and [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md).

## Package graph

The npm workspaces live under `packages/*`. TypeScript clients and the control plane depend on `@open-inspect/shared` at build time:

```
@open-inspect/shared  ←  control-plane, web, slack-bot, github-bot, linear-bot
```

Root `npm run build` and `npm run typecheck` build `@open-inspect/shared` first. New WebSocket or sandbox-event variants belong in shared; control-plane re-exports them instead of keeping a parallel protocol.

Python packages (`sandbox-runtime`, `modal-infra`, `e2b-infra`) and small infra helpers (`daytona-infra`, `opencomputer-infra`) are the data-plane side. They do not import the TypeScript shared package; they consume the same wire shapes (session config, sandbox events) that the control plane and bridge agree on.

Terraform under `terraform/` deploys the control-plane Worker, D1, KV, R2, bot workers, the web app (Vercel or Cloudflare via OpenNext), and the chosen sandbox backend. See [Deployment and Operations](/openwiki/operations/deployment.md).

## Prompt-to-sandbox path

A typical interactive prompt:

1. A client enqueues a prompt (`POST /sessions/:id/prompt` or a `prompt` WebSocket message).
2. The session Durable Object appends it to an ordered message queue and spawns or restores a sandbox if none is running.
3. The control plane sends the prompt over the sandbox WebSocket, including author identity for commit attribution.
4. OpenCode inside the sandbox works. Tool calls, tokens, and status events flow back through the bridge.
5. The Durable Object persists events in SQLite and broadcasts `ServerMessage`s to every subscribed client.
6. Artifacts (PRs, screenshots) are stored and announced on the same stream.

Disconnecting a browser does not stop the sandbox. The bridge reconnects; the Durable Object treats sandbox lifecycle as authoritative across WebSocket loss. Clients that reconnect receive one canonical `subscribed` snapshot and then live messages. See [Session Lifecycle and Prompt Flow](/openwiki/workflows/session-lifecycle.md) and [Realtime Protocol](/openwiki/architecture/realtime-protocol.md).

## Where state lives

| Kind of state | Home | Why |
| --- | --- | --- |
| Session timeline, sandbox row, participants | Session Durable Object SQLite | Per-session isolation and WebSocket locality |
| Session index, users, secrets, environments, automations, image builds | D1 | Cross-session queries and encrypted config |
| Media and prompt attachments | R2 | Large objects |
| Repo listing cache, bot dedupe | KV | Short-lived or delivery keys |
| Workspace files and agent processes | Sandbox filesystem | Execution |

Clients hold UI state only. The web app hydrates from `GET /sessions/:id` (secret-free snapshot) and then the socket; bots persist their own mapping (Slack thread → session id) but the coding session itself is the Durable Object.

## Shared contracts

`@open-inspect/shared` is the protocol source of truth for `ClientMessage`, `ServerMessage`, `SandboxEvent`, and `SessionState`. Correlation keys at transport boundaries are snake_case (`trace_id`, `request_id`, `session_id`, `sandbox_id`) with `x-trace-id` / `x-request-id` headers. Repository identity helpers also live here so owners that contain `/` (GitLab subgroups) are handled consistently. See [Shared Contracts](/openwiki/architecture/shared-contracts.md) and [Sessions, Environments, and Repository Identity](/openwiki/concepts/sessions-and-workspaces.md).

## Background versus interactive

Open-Inspect is built so the user's presence is optional. Sessions stay active while work runs; they can be archived and later restored. Automations, GitHub review, and Slack mentions all create or reuse this same session object rather than a side-channel agent. The three-tier split is what makes that possible: clients come and go, the Durable Object keeps the timeline, and the sandbox keeps working until inactivity, heartbeat failure, or an explicit stop.
