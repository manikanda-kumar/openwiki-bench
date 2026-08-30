---
type: navigation
title: Open-Inspect Wiki Quickstart
description: Task-routing map for this repository wiki — where to read about sessions, prompts, sandboxes, deploy, tests, and bot or provider extensions.
tags: [quickstart, navigation, wiki]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Open-Inspect Wiki Quickstart

Open-Inspect is a **single-tenant** background coding-agent system: you send a prompt from the web app or a bot, a cloud sandbox runs the agent, and you can disconnect. Everyone on an instance shares the GitHub App's repository scope. This page only routes. Details live on the linked wiki pages; operator how-tos stay in `docs/`.

Start at [Architecture Overview](/openwiki/architecture/overview.md) if you want the three-tier picture first.

## Understand a session

| Job | Go to |
| --- | --- |
| What a session is, four workspace targets, nested owners | [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md) |
| Who may sign in and how tokens are brokered | [Security Model and Authentication](/openwiki/concepts/security-and-auth.md) |
| Per-session Durable Object and SQLite | [Session Durable Object](/openwiki/architecture/session-durable-object.md) |
| Web dashboard and live session UI | [Web Client](/openwiki/architecture/web-client.md) |
| Shared types and schemas | [Shared Contracts](/openwiki/architecture/shared-contracts.md) |

## Follow a prompt end to end

| Job | Go to |
| --- | --- |
| Create → enqueue → sandbox events → archive | [Session Lifecycle and Prompt Flow](/openwiki/workflows/session-lifecycle.md) |
| Client and sandbox WebSocket contracts | [Realtime Protocol](/openwiki/architecture/realtime-protocol.md) |
| Worker as API gateway, D1, crons, queues | [Control Plane](/openwiki/architecture/control-plane.md) |
| Models, provider accounts, device auth | [Models and Provider Accounts](/openwiki/features/model-providers.md) |
| Secrets, skills, MCP into the sandbox | [Secrets, Skills, and MCP](/openwiki/features/secrets-skills-and-mcp.md) |
| Git clone/push vs attributed PRs | [Source Control, Git Auth, and Pull Requests](/openwiki/workflows/source-control.md) |
| Agent-spawned extra sandboxes | [Child Sessions](/openwiki/workflows/child-sessions.md) |

Losing the browser tab does not stop the turn. That invariant is on the session-lifecycle page.

## Debug a sandbox

| Job | Go to |
| --- | --- |
| Spawn, warm, snapshot vs pause/resume, heartbeats | [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md) |
| Modal / Daytona / Vercel / OpenComputer / E2B | [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md) |
| In-sandbox OpenCode, git helper, tools | [Sandbox Runtime](/openwiki/data-plane/sandbox-runtime.md) |
| Prebuilt images and spawn selection | [Image Prebuild](/openwiki/workflows/image-prebuild.md) |

## Deploy or operate an instance

| Job | Go to |
| --- | --- |
| Terraform, web platform, one sandbox backend, PKCS#8, two-phase DOs | [Deployment and Operations](/openwiki/operations/deployment.md) |
| Vitest vs pytest, workerd D1 integration tests | [Testing Strategy](/openwiki/operations/testing.md) |
| Step-by-step credentials (not wiki) | `docs/GETTING_STARTED.md` |
| Local Path A/B/C (not wiki) | `docs/SETUP_GUIDE.md` |

`package.json` `typecheck` and `build` run `@open-inspect/shared` first. Always do that after changing shared types.

## Extend bots, automations, or providers

| Job | Go to |
| --- | --- |
| Slack mention/DM/threads (not ambient automations) | [Slack Bot](/openwiki/integrations/slack.md) |
| GitHub review, @mention, Autofix queue | [GitHub Bot and Autofix](/openwiki/integrations/github.md) |
| Linear AgentSessionEvent + callbacks | [Linear Bot](/openwiki/integrations/linear.md) |
| Cron, inbound webhook, Sentry, event matching | [Automations and Inbound Triggers](/openwiki/integrations/automations.md) |
| New SCM provider | [Source Control](/openwiki/workflows/source-control.md) and ADR 0001 |
| New sandbox backend | [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md) |

Ambient Slack channel automations are on the automations page, not the Slack bot page.

## Repo layout (one screen)

npm workspaces under `packages/*`: `shared`, `control-plane`, `web`, `slack-bot`, `github-bot`, `linear-bot`, plus Python `modal-infra` / other `*-infra` and `sandbox-runtime`. Terraform is `terraform/environments/production`. D1 SQL is `terraform/d1/migrations/`.
