---
type: integration
title: Linear Bot Integration
description: The Linear agent worker — AgentSessionEvent webhook handling, the five-stage repo/environment resolution ladder, issue→session KV continuity with follow-ups, activity-streaming callbacks, and OAuth installation with a bot-key fallback.
tags: [linear, bots, webhooks, target-resolution, oauth]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-e40c5cd3a09017a52e9ccdb1
    resource: repo://packages/linear-bot/src/callbacks.ts
  - id: openwiki-source-35a5f077ac7ea8b495bf2d49
    resource: repo://packages/linear-bot/src/callbacks/start-callback.ts
  - id: openwiki-source-26a7f7f11cc65a7fe3b23c18
    resource: repo://packages/linear-bot/src/classifier/index.ts
  - id: openwiki-source-1d61ec27ac9a40af36f1a940
    resource: repo://packages/linear-bot/src/index.ts
  - id: openwiki-source-dd7903ba21c14d48106022f4
    resource: repo://packages/linear-bot/src/kv-store.ts
  - id: openwiki-source-dde48e9ff47182c93bd96535
    resource: repo://packages/linear-bot/src/model-resolution.ts
  - id: openwiki-source-4a4f9e95af61666ff2cceecd
    resource: repo://packages/linear-bot/src/target-resolution.ts
  - id: openwiki-source-f454165ba02206948c61803b
    resource: repo://packages/linear-bot/src/utils/linear-oauth.ts
  - id: openwiki-source-00d0b1818cd71403f7d2c2f0
    resource: repo://packages/linear-bot/src/webhook-handler.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/linear-bot` is a Hono Cloudflare Worker implementing Linear's **Agent** protocol: Linear POSTs `AgentSessionEvent` webhooks when a user assigns the agent to an issue, @mentions it, prompts a follow-up, or stops it; the bot runs the work as an Open-Inspect session and streams progress back as agent activities. Unlike Slack's classifier-first design, Linear resolution is **mapping-first**: deterministic operator tables before any model call.

## Webhook ingress

`src/index.ts` `POST /webhook` (L103+): HMAC-verify `linear-signature` against `LINEAR_WEBHOOK_SECRET` (401 before parsing), reject non-object payloads, then — the instructive detail — dedupe on the **`Linear-Delivery` header UUID**, *not* the body's `webhookId`, because `webhookId` is the constant registered-webhook configuration id and would swallow every delivery after the first (comment L140–143; 1 h KV TTL). Only `AgentSessionEvent` proceeds, in `waitUntil`. `/oauth/authorize` + `/oauth/callback` serve the installation flow (`completeLinearOAuthInstallation`, requiring `app:assignable`/`app:mentionable` scopes — `linear-oauth.ts`).

## Event handling (`src/webhook-handler.ts`)

`handleAgentSessionEvent` (L722–762) is a three-way fork:

- **stop** (`agentActivity.signal === "stop"` or action `stopped`/`cancelled`) → `handleStop`: signed `POST /sessions/:id/stop` to the control plane + delete the KV `issue:<id>` mapping.
- **follow-up** (action `prompted` *with* an existing `issue:<id>` mapping) → `handleFollowUp`: fetches the session's latest agent response (event pages) for context, then `buildFollowUpPrompt` into the same session — this is why a second @-prompt doesn't fork a new workspace.
- **new session** → `handleNewSession`: emits an "Analyzing issue…" *plan* activity (Linear's UI renders the plan steps: analyze → resolve repo → create session → code changes → open PR, `plan.ts`), fetches issue details (title, description, last 5 comments, project, labels, priority, assignee), resolves a target (below), gates on integration enablement (`resolveTargetIntegration` — environments governed by their primary repo's settings), resolves model settings, creates the session with `LinearCallbackContext` (`agentSessionId`, `organizationId`, `appUserId`, `emitToolProgressActivities`, `transitionIssueOnStart`), stores the `issue:<id>`→session KV mapping (7-day TTL, `kv-store.ts:100`), attaches the external "View Session" URL, and sends the composed prompt. Issue-derived content is wrapped in an escaped **untrusted-user-content block** with explicit non-instruction framing (`buildUntrustedUserContentBlock`, L59+).

## Target resolution ladder (`src/target-resolution.ts:215–330`)

1. **Project map** — `config:project-repos` KV: projectId → repo *or* `{environmentId}` (validated against the live environment list; a dead entry falls through).
2. **Team map** — `config:team-repos` with optional **label filter** (`resolveStaticTarget` lets a label override the team default).
3. **Explicit mention** — `owner/repo` in the triggering comment (`matchExplicitRepo`, boundary-guarded, splits on the **last** `/` for nested GitLab-style owners).
4. **Linear repo suggestions** — the `getRepoSuggestions` agent API, accepted at confidence ≥ 0.7.
5. **LLM classification** — Anthropic tool-call or OpenAI structured output behind shared's `resolveClassificationProvider` (provider dispatch identical to the Slack bot, `classifier/index.ts:140/194`), with the same needs-clarification policy; uncertainty emits an **elicitation activity** (Linear's ask-the-user primitive) instead of a wrong guess.

Both LLM stages and repo/environment catalogs use the fail-open cached-resource pattern (memory → control-plane signed fetch → KV last-known-good).

## Model resolution precedence

`model-resolution.ts`: `model:<label>` extraction (when `allowLabelModelOverride`) > per-user preference (when `allowUserPreferenceOverride`) > repo/environment integration config > `DEFAULT_MODEL` env — checked in that order so label shortcuts stay operator-controllable.

## Callbacks back to Linear (`src/callbacks.ts`)

The control plane's completion pipeline calls the bot through HMAC-signed callbacks like Slack's:

- `POST /callbacks/start` (`callbacks/start-callback.ts`) — transitions the issue to **In Progress** (guarded: only if not already terminal, 5-min freshness window on the event, 20 s Linear timeout).
- `POST /callbacks/tool_call` — maps Edit/Read/Run tool calls into `type:"AgentActivity"` thought/action lines (`formatToolAction`), skipped when the context set `emitToolProgressActivities: false` or when no OAuth client exists.
- `POST /callbacks/complete` — `handleCompletionCallback` (L227+): extracts the agent response via shared's completion extractor, posts an `AgentMessage` activity + marks the plan completed/failed, attaches the PR artifact as an external URL, and — if the OAuth path is unavailable — **falls back to a plain issue comment, which requires `LINEAR_API_KEY`** and logs a warning when it's missing (L316–329). Session-create/prompt failures surface as `type:"error"` activities with truncated upstream bodies (`webhook-handler.ts:612–626`).

## Configuration

Env (`types.ts`): `LINEAR_KV`, `CONTROL_PLANE` service binding, `LINEAR_CLIENT_ID/SECRET` (OAuth app), `LINEAR_WEBHOOK_SECRET`, `LINEAR_API_KEY?` (fallback comment posting), `ANTHROPIC_API_KEY?`/`OPENAI_API_KEY?` (classifier), `DEFAULT_MODEL`, `CLASSIFICATION_MODEL`. Terraform gates the worker behind `enable_linear_bot` (default false) and injects the classifier key per chosen provider (`workers-linear.tf` `classifier_secret_bindings`). Setup walkthrough: `docs/GETTING_STARTED.md` Step 4b + `packages/linear-bot/INTEGRATION.md`.

Tests: `src/webhook-handler.test.ts` (1307 lines; dispatch, environment targets, auth failures), `src/callbacks.*.test.ts` (validation, start transitions), `src/classifier/index.test.ts` (provider dispatch), `src/target-resolution` coverage via the handler suites, `src/kv-store.test.ts`, `src/model-resolution.test.ts`, `src/utils/linear-client.test.ts`.
