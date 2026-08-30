---
type: library
title: Shared Package (Protocol Contracts)
description: "@open-inspect/shared — the single source of wire-protocol schemas (WebSocket, sandbox events, server messages), the sig1 service-auth signature, the model catalog, cron/trigger types, and repository identity helpers that every other TypeScript package imports."
tags: [shared, protocol, contracts, service-auth, models]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4b89134f3f6974b1017cbfb4
    resource: repo://packages/control-plane/src/session/message-router.ts
  - id: openwiki-source-5691b8c2b7f7ad4c56c661bf
    resource: repo://packages/shared/src/models.ts
  - id: openwiki-source-a527d2c54bf55e6948b659b1
    resource: repo://packages/shared/src/module-boundaries.test.ts
  - id: openwiki-source-5856d6dafe718ec27f678566
    resource: repo://packages/shared/src/service-auth.ts
  - id: openwiki-source-1634acbc2df602b6e390a92f
    resource: repo://packages/shared/src/triggers/types.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
  - id: openwiki-source-713802fc09174392f83f9daf
    resource: repo://packages/shared/src/types/sandbox-events.ts
  - id: openwiki-source-a53cb4aa1c5a2d2ed8b0d99b
    resource: repo://packages/shared/src/types/server-messages.ts
  - id: openwiki-source-c093f36a31fe1ddbc40cce9d
    resource: repo://packages/shared/src/types/type-contracts.test.ts
  - id: openwiki-source-0dfefeca89a6d1280d92409c
    resource: repo://packages/shared/src/types/websocket.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/shared` (`@open-inspect/shared`) is the contract library binding the web client, control plane, and bot workers together. It contains no runtime service: Zod schemas, signature machinery, catalogs, and pure utilities that all packages import through **38 narrow subpath exports** (`packages/shared/package.json:8+` — e.g. `./models`, `./service-auth`, `./types/websocket`, `./triggers`, `./slack`). Because the other packages import it at build time, **shared must be built first** (`npm run build -w @open-inspect/shared`; enforced by the root `build`/`typecheck` scripts and every CI test job).

## Wire-protocol schemas

Three Zod discriminated unions define the entire real-time protocol, used on *both* sides of the socket:

- **Client → control plane** — `clientMessageSchema` (`packages/shared/src/types/websocket.ts:6–42`): `ping`, `subscribe` (token + clientId), `prompt` (extends `webPromptPayloadSchema` with a `clientRequestId` for correlation), `cancel_prompt`, `stop`, `typing`, `presence`, `fetch_history` (cursor + limit). The control plane parses every client frame against it (`packages/control-plane/src/session/message-router.ts`), and the web client constructs its messages to match.
- **Control plane → client** — `serverMessageSchema` (`packages/shared/src/types/server-messages.ts`), whose `subscribed` message embeds `sessionSnapshotSchema` (`packages/shared/src/types/server-messages.ts:112–119`: session state, artifacts, timeline, prompt queue). The web transport re-validates every inbound frame and closes with code 4004 on a schema failure.
- **Sandbox → control plane** — `sandboxEventSchema` (`packages/shared/src/types/sandbox-events.ts:49–188`): `token`, `tool_call`, `step_start`/`step_finish`, `user_message`, `push_complete`/`push_error`, `execution_complete`, `ready`, `heartbeat`, `warning`, and more. The persisted-event `eventTypeSchema` is *derived* from the sandbox-event discriminator values so the event-type enum can never drift from the wire union (`packages/shared/src/types/sandbox-events.ts:221–226`).

Type-level tests (`types/type-contracts.test.ts`) pin Zod input/output identity for these messages, so a schema edit that would silently change a wire type fails in CI.

## sig1 service authentication

`service-auth.ts` implements the per-service request signature used by web and the bots to call the control plane. Each service (`web`, `slack-bot`, `github-bot`, `linear-bot`) has its own secret; the signature covers a canonical string newline-joining `sig1`, service, timestamp, nonce, method, pathname, canonical query, body SHA-256, and actor (`packages/shared/src/service-auth.ts:92–107`), sent as `X-OpenInspect-Service` / `-Service-Signature` / `X-OpenInspect-Actor` headers (L16–18). `signedControlPlaneFetch` signs and sends the *same* bytes so the signed body always equals the dispatched body. The canonical layout is pinned by immutable golden vectors in `test-fixtures/service-auth-vectors.json`: any change requires a new format tag (`sig2`), never an edit (`packages/shared/src/service-auth.ts:1–12`).

## Model catalog

`models.ts` is the authoritative `MODEL_CATALOG` (Anthropic, OpenAI, OpenCode Zen, xAI, Z.AI, DeepSeek groups) from which every public view is *derived*: `VALID_MODELS`, `MODEL_OPTIONS`, `DEFAULT_ENABLED_MODELS` (opt-in providers excluded), and `MODEL_REASONING_CONFIG` per model. Module load throws unless exactly one entry carries `default: true` (`packages/shared/src/models.ts:258–262`). `normalizeModelId` prefixes bare legacy `claude-*`/`gpt-*` ids for backward compatibility with existing D1/SQLite/Slack-KV rows (`packages/shared/src/models.ts:315–323`). `docs/AVAILABLE_MODELS.md` is a human mirror with no automated check — updating the catalog means updating the doc by hand.

## Repository identity (nested owners)

`types/repositories.ts` centralizes the rule that a `repoOwner` may contain `/` (GitLab subgroups) while `repoName` is always one segment: `parseRepositoryFullName` splits on the **last** `/` (`packages/shared/src/types/repositories.ts:178–188`), and `encodeRepositoryPathSegments`/`decodeRepositoryPathSegments` (L172–205) treat the owner as a single encoded API path segment. Control plane, bots, and web use these instead of hand-rolled splits.

## Other contracts

- `git.ts` — the session branch convention `open-inspect/{sessionId}` (`BRANCH_PREFIX`, `generateBranchName`, `isInspectBranch`) shared by PR creation and cleanup.
- `cron.ts` — thin `cron-parser` wrappers enforcing 5-field expressions with timezone support (`nextCronOccurrence`) plus min-interval enforcement, used by the automation UI and the scheduler alike.
- `triggers/` — automation trigger union (`schedule | github_event | linear_event | sentry | webhook | slack_event`), the 15-type condition schema with a `conditionRegistry`, per-source normalizers, and testing helpers.
- `classification.ts` — provider dispatch and OpenAI structured-output plumbing shared by the Slack and Linear bot classifiers.
- `completion/extractor.ts` — turns control-plane event/artifact pages into an `AgentResponse` so every bot renders completions identically.
- `auth.ts` — HMAC helpers including the `timestamp.hmac` internal token the control plane uses to call Modal endpoints.

## Boundary invariants

`module-boundaries.test.ts` is AST-driven over every production module and enforces three rules (`packages/shared/src/module-boundaries.test.ts:150–211`): implementation modules may not import the package-root or `types/` barrels (nor the self-package specifier `@open-inspect/shared…`), there are no runtime dependency cycles, and no compile-time cycles including `import("./x")` type edges. `public-api.test.ts` pins the root-barrel re-export identity (e.g. `automationRepositoryInputSchema === repositoryInputSchema`) and the provider-account constants. Together these make the package's dependency graph an enforced contract, not a convention.

## How consumers use it

```
web BFF route ── buildServiceAuthHeaders(sig1) ──▶ control plane authenticate()
browser ◀── serverMessageSchema frames ──▶ SessionDO broadcast (same union types it)
sandbox bridge ── sandboxEventSchema JSON ──▶ CP ingest (message-router exhaustive switch)
bots ── signedControlPlaneFetch + completion extractor ──▶ sessions & Slack/Linear posts
```

See [Prompt Queue and Event Stream](/openwiki/control-plane/prompt-and-event-pipeline.md) for the control-plane side of these contracts and [Web Client](/openwiki/clients/web-client.md) for the browser side.
