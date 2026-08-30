---
type: integration
title: Linear Bot
description: Linear AgentSessionEvent webhooks, OAuth app-actor install, team/project target mappings including environmentId, session start and follow-up, and signed completion callbacks back into Linear.
tags: [linear, linear-bot, webhooks, oauth, agent-sessions]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-e40c5cd3a09017a52e9ccdb1
    resource: repo://packages/linear-bot/src/callbacks.ts
  - id: openwiki-source-077e6dd5f75d553d6354f49b
    resource: repo://packages/linear-bot/src/callbacks/reject-invalid-callback.ts
  - id: openwiki-source-35a5f077ac7ea8b495bf2d49
    resource: repo://packages/linear-bot/src/callbacks/start-callback.ts
  - id: openwiki-source-1d61ec27ac9a40af36f1a940
    resource: repo://packages/linear-bot/src/index.ts
  - id: openwiki-source-b8ce849a42b4d50c9d3980f2
    resource: repo://packages/linear-bot/src/internal-auth.ts
  - id: openwiki-source-dd7903ba21c14d48106022f4
    resource: repo://packages/linear-bot/src/kv-store.ts
  - id: openwiki-source-4a4f9e95af61666ff2cceecd
    resource: repo://packages/linear-bot/src/target-resolution.ts
  - id: openwiki-source-f5b46c21d8dfee4486659792
    resource: repo://packages/linear-bot/src/types.ts
  - id: openwiki-source-67ccf8fe95d1c9e6cbaa02fc
    resource: repo://packages/linear-bot/src/utils/linear-client.ts
  - id: openwiki-source-9a303cd06297ed7ad83cc8f2
    resource: repo://packages/linear-bot/src/utils/linear-credentials.ts
  - id: openwiki-source-00d0b1818cd71403f7d2c2f0
    resource: repo://packages/linear-bot/src/webhook-handler.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Linear Bot

The Linear bot (`packages/linear-bot`) is a Cloudflare Worker that implements Linear's **agent workflow**: Linear sends `AgentSessionEvent` webhooks when someone @mentions or assigns the agent; the worker creates or continues an Open-Inspect coding session; signed callbacks from the control plane report start, tool progress, and completion back into Linear Agent Activities.

It is a signed HTTP client of the control plane (`sig1` as service `linear-bot` through `CONTROL_PLANE`). It does not host sessions. Linear **event automations** (`linear_event` trigger type) are typed in shared but have no registered trigger source or bot forwarder; this worker is the interactive agent path. See [Control Plane](/openwiki/architecture/control-plane.md), [Sessions and Workspaces](/openwiki/concepts/sessions-and-workspaces.md), [Session Lifecycle](/openwiki/workflows/session-lifecycle.md). Operator notes live in `packages/linear-bot/INTEGRATION.md`.

## Responsibility and ownership

| Piece | Owner |
| --- | --- |
| HTTP: health, OAuth, webhook, callbacks | `packages/linear-bot/src/index.ts` |
| AgentSessionEvent orchestration | `packages/linear-bot/src/webhook-handler.ts` |
| Five-stage target ladder | `packages/linear-bot/src/target-resolution.ts` |
| Team/project mappings in KV | `packages/linear-bot/src/kv-store.ts` |
| OAuth install + app-actor tokens | `packages/linear-bot/src/utils/linear-credentials.ts` |
| Start / tool_call / complete callbacks | `packages/linear-bot/src/callbacks.ts` and `callbacks/` |
| Linear GraphQL / Agent API | `packages/linear-bot/src/utils/linear-client.ts` |

## OAuth install

`GET /oauth/authorize` redirects to Linear. `GET /oauth/callback` exchanges the code (`completeLinearOAuthInstallation`): authorization-code token → workspace identity → **client-credentials** app-actor runtime token (`actor=app`) persisted in KV.

Normal Agent API delivery uses those 30-day app-actor tokens, cached at `oauth:client-credentials:{orgId}`. Missing, near-expiry, or rejected tokens are re-issued; no refresh token is stored. The token's viewer organization must match the webhook organization, and `appUserId` must match. `LINEAR_API_KEY` is an optional legacy fallback used only to post a completion **comment** when a callback lacks Agent API context.

Terraform supplies `linear_client_id`, `linear_client_secret`, and `linear_webhook_secret`. Client-credentials tokens must be enabled on the Linear OAuth application (`read,write,app:assignable,app:mentionable`).

## Webhook ingress

`POST /webhook`:

1. Verify `linear-signature` as HMAC-SHA256 of the raw body against `LINEAR_WEBHOOK_SECRET` (timing-safe). Invalid → 401.
2. Non-`AgentSessionEvent` types ack `{ ok: true, skipped: true }`.
3. Payload must include `organizationId`, `appUserId`, `webhookId`, and `agentSession.id`.
4. Dedup key is the **`Linear-Delivery` header** (per-delivery UUID), not body `webhookId` (that is the registered webhook config id and is constant). Missing header → 400. `isDuplicateEvent` stores `event:<deliveryId>` in `LINEAR_KV` for 3600 seconds.
5. Ack `{ ok: true }` and run `handleAgentSessionEvent` in `waitUntil`.

## Agent session lifecycle

`handleAgentSessionEvent` branches:

| Linear action | Behavior |
| --- | --- |
| `stopped` / `cancelled`, or activity `signal: stop` | `POST /sessions/:id/stop` on the mapped session, delete `issue:<issueId>` KV |
| `prompted` **and** an issue→session mapping exists | Follow-up prompt on the existing session |
| Otherwise (including `created`, or `prompted` after elicitation with no session yet) | New session |

A webhook without `agentSession.issue` is dropped. Missing OAuth for the org/`appUserId` logs `agent_session.no_oauth_token` and does not create a session.

### New session

1. Thought activity: analyzing / resolving repository.
2. Fetch issue details (labels, project, comments).
3. `resolveSessionTarget` (below). Uncertain classification **elicits** in Linear and returns without creating a session; a later `prompted` reply is treated as a new-session clarification (the reply body is the resolution comment).
4. `resolveTargetIntegration` — Linear integration settings are keyed by the **repository** (or the environment's **primary** repository). If that repo is outside `enabledRepos`, emit an error activity and stop.
5. Model: integration defaults, optional user prefs (`user_prefs:<userId>` in KV), optional label override.
6. Signed `POST /sessions` with mutually exclusive `repoOwner`/`repoName` **or** `environmentId`, title `{identifier}: {title}`, actor `linear:<userId>`.
7. Persist issue→session in KV (`sessionId`, optional repo fields or `environmentId`, model, `agentSessionId`).
8. Set Linear `externalUrls` (web session link) and plan `session_created`.
9. Enqueue prompt `source: "linear"` with `LinearCallbackContext` (`agentSessionId`, `organizationId`, `appUserId`, issue fields, optional `transitionIssueOnStart`).
10. Thought with target, model, and session URL.

Issue title, description, comments, and Linear `promptContext` are wrapped as untrusted `<user_content>`. Optional `issueSessionInstructions` from integration settings are appended.

`transitionIssueOnStart` is true only for `action === "created"` with a responsible human `creatorId`. Automation-like or follow-up turns omit it. When the control plane later POSTs `/callbacks/start` and the flag is true, the bot moves the issue to the team's lowest-position `started` workflow state (20s Linear timeout; stale callbacks older than 5 minutes are ignored).

### Follow-up

Look up the stored target, rebuild callback context (no start-transition), emit a thought, optionally pull a short token summary from `GET /sessions/:id/events`, and `POST /sessions/:id/prompt` with `buildFollowUpPrompt`. Callback context is **message-scoped**: every queued turn must attach it again or the control plane skips completion delivery.

## Team and project mappings (`environmentId` or repository)

Target resolution is a five-stage ladder. Team and project mappings may name a **repository or a saved environment** (design §7.5). Suggestion and classification stages remain repository-only. Repository mapping entries keep working; environments join them.

| Stage | Source | Target kinds |
| --- | --- | --- |
| 1 | Project mapping `LINEAR_KV` `config:project-repos` `{ [projectId]: { environmentId } \| { owner, name } }` | Environment or repo |
| 2 | Team mapping `config:team-repos` `{ [teamId]: StaticTargetConfig[] }` with optional label filters | Environment or repo |
| 3 | Explicit `owner/repo` in the trigger comment or clarification reply (`matchExplicitRepo`) | Repository only |
| 4 | Linear `issueRepositorySuggestions` at confidence ≥ 0.7 | Repository only |
| 5 | LLM `classifyRepo`; if uncertain, elicitation asking for `owner/repo` | Repository only |

`resolveMappedTarget` validates environment ids against the live environment list. A deleted or unfetchable environment returns null so the ladder **falls through**, the same as an inaccessible repository mapping. Environment-first union order is load-bearing: a stored object with both `environmentId` and repo keys must keep resolving to the environment.

Create-session fields come from `targetRequestFields`: `{ environmentId }` or `{ repoOwner, repoName }` — mutually exclusive, matching `createSessionInputSchema`. Follow-ups rehydrate via `resolveStoredSessionTarget`.

Malformed mapping entries are rejected **per key** so one typo cannot drop every other team/project onto the classifier.

## Callbacks into Linear

Control plane POSTs to the linear-bot service binding. Routes under `/callbacks` require `SERVICE_AUTH_SECRET` and verify the in-body HMAC (`rejectInvalidCallback`). Invalid signature → 401; missing secret → 500.

| Path | Purpose |
| --- | --- |
| `POST /callbacks/start` | If `transitionIssueOnStart === true` and the callback is fresh, move the issue to `started` |
| `POST /callbacks/tool_call` | Emit Linear `action` activities (`formatToolAction`) unless `emitToolProgressActivities === false` |
| `POST /callbacks/complete` | Extract agent response from session events; emit `response` or `error` activity; update plan; attach PR `externalUrls` |

Completion without Agent API context falls back to `postIssueComment` via `LINEAR_API_KEY`. Callback failures are retried by the control plane and never block sandbox execution.

## Invariants and failure behavior

- Invalid webhook signatures never start sessions.
- Delivery dedupe uses `Linear-Delivery`, not `webhookId`.
- No OAuth for the webhook org → no session, no silent personal-key Agent API.
- Uncertain repo classification elicits; it does not guess a repository.
- Environment mappings that no longer exist fall through rather than launching a repo-less session.
- Integration allowlist is evaluated on the target's settings repo (environment primary).
- The bot is not the session runtime: stopping the worker stops new Linear ingress; in-flight sessions continue in the control plane.

## Extension seams

- New mapping stage: insert into `resolveSessionTarget` before classification.
- New callback: add a signed route on `callbacksRouter` and a control-plane delivery using `LINEAR_BOT`.
- Linear **event automations**: still require a shared trigger source and a normalized forwarder; this worker does not implement that path.

## Focused tests

- Webhook signature, AgentSessionEvent shape, delivery header: `packages/linear-bot/src/index.test.ts`
- New session, follow-up, stop, prompts: `packages/linear-bot/src/webhook-handler.test.ts`
- Target ladder and environment mappings: `packages/linear-bot/src/target-resolution.ts` plus `environments.test.ts`
- Callbacks: `packages/linear-bot/src/callbacks.start.test.ts`, `callbacks.validation.test.ts`, `callbacks.helpers.test.ts`
- Credentials / OAuth: `packages/linear-bot/src/utils/linear-credentials.test.ts`
