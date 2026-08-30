---
type: "Reference"
title: "Shared Contracts Package"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-4e41d9b444e4a786f517355e
    resource: repo://docs/adr/0002-shared-session-contracts-and-correlation-boundary.md
  - id: openwiki-source-5691b8c2b7f7ad4c56c661bf
    resource: repo://packages/shared/src/models.ts
  - id: openwiki-source-5856d6dafe718ec27f678566
    resource: repo://packages/shared/src/service-auth.ts
  - id: openwiki-source-133e9fc09887c13da93c8221
    resource: repo://packages/shared/src/types/index.ts
  - id: openwiki-source-f000fa0dd3efa6df8cfb9a25
    resource: repo://packages/shared/src/types/repositories.ts
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---


# Shared Contracts Package

`@open-inspect/shared` (`packages/shared`) is the TypeScript contract layer for Open-Inspect. Control-plane, web, slack-bot, github-bot, and linear-bot import it at **build time**. Root `npm run build` and `npm run typecheck` compile this package first.

Python data-plane packages do not import it. They speak the same wire shapes (session config, sandbox events) that the control plane and sandbox bridge agree on, but the TypeScript schemas here are the documented source of truth for those shapes on the Worker/client side.

## Protocol source of truth (ADR 0002)

Session WebSocket and sandbox event contracts used to be duplicated across `shared`, `control-plane`, and `web`. ADR 0002 makes this package the single home:

- `ClientMessage` — `packages/shared/src/types/websocket.ts`
- `ServerMessage`, `SessionState`, `SessionSnapshot` — `packages/shared/src/types/server-messages.ts`
- `SandboxEvent` — `packages/shared/src/types/sandbox-events.ts`

Control-plane **re-exports** these types. It must not grow a parallel protocol. The web app may keep UI-local types but must normalize shared payloads at the WebSocket boundary before storing UI state.

**Extension rule:** add a new WebSocket or sandbox-event variant in `packages/shared` first, then consume it in control-plane and web. See [Realtime Protocol](/openwiki/architecture/realtime-protocol.md).

Correlation at transport boundaries is canonical snake_case: `trace_id`, `request_id`, `session_id`, `sandbox_id`, with headers `x-trace-id`, `x-request-id`, `x-session-id`, `x-sandbox-id`. Provider/client configs use a `correlation` object with those keys.

## Public surface

The root barrel (`packages/shared/src/index.ts`) re-exports types plus helpers: git branch naming, service auth, HTTP body caps, models, cron, automation triggers, completion extraction, logger, KV cache store, app name, user ids, sign-in providers, Slack block helpers, and pull-request tool contracts.

The types barrel (`packages/shared/src/types/index.ts`) is a compatibility surface. Implementation modules import one another directly; only consumers import through the barrel. Internal schemas stay off that export list.

Subpath exports in `package.json` (`./models`, `./service-auth`, `./types/sessions`, and others) let packages import a slice without pulling the whole barrel. `public-api.test.ts` locks aliases such as `MAX_SESSION_REPOSITORIES === MAX_TARGET_REPOSITORIES` and `SUBSCRIPTION_PROVIDER_IDS === ["openai", "xai"]`. `module-boundaries.test.ts` walks production modules so runtime imports do not sneak across the intended graph.

## Repository identity

A repository is `(repoOwner, repoName)`, not a single slash-joined string that you split on the first `/`.

- `repoName` is one path segment. It is the checkout directory under `/workspace/{repoName}`.
- `repoOwner` may contain `/` (GitLab subgroups such as `group/subgroup`). GitHub owners are a single segment; the helpers still treat owner as opaque.

`parseRepositoryFullName` splits on the **last** `/`. `encodeRepositoryPathSegments` / `decodeRepositoryPathSegments` percent-encode the owner as **one** API route segment so nested owners round-trip. `formatRepositoryFullName` is display/opaque-key only.

`normalizeOptionalRepositoryPair` is the single write-side normalization for scalar pairs: trim + lowercase, map a blank pair to `null`, throw `RepositoryPairValidationError` if only one identifier is present. Routes and stores must not roll their own.

Lists are capped at `MAX_TARGET_REPOSITORIES` (10). Session lists additionally reject empty arrays and duplicate `repoName` across owners, because two checkouts cannot share `/workspace/{repoName}`. Identifiers in input schemas are lowercased.

`prArtifactBelongsToRepo` is the single home of “does this PR artifact belong to this session repository?”, including the pre-multi-repo case where `artifactRepo` is null (belongs to primary). Comparison is case-insensitive.

See [Sessions, Environments, and Repository Identity](/openwiki/concepts/sessions-and-workspaces.md).

## Models

`packages/shared/src/models.ts` is the authoritative model catalog (`MODEL_CATALOG`) and reasoning-effort config. Control plane, web UI, and Slack bot all validate against it so a model id cannot mean two things. Subscription provider ids (`openai`, `xai`) live next to provider-account contracts. See [Models and Provider Accounts](/openwiki/features/model-providers.md).

## Service authentication

`packages/shared/src/service-auth.ts` defines `sig1`. Each named service (`web`, `slack-bot`, `github-bot`, `linear-bot`) signs method, path, query, body hash, and asserted actor with its own secret. A captured credential cannot be replayed against a different request.

The canonical request string is pinned by golden vectors in `packages/shared/test-fixtures/service-auth-vectors.json`. Changing layout or canonicalization requires a new format tag (`sig2`), not an in-place edit of `sig1`. Headers: `X-OpenInspect-Service`, `X-OpenInspect-Service-Signature`, `X-OpenInspect-Actor`. See [Security Model and Authentication](/openwiki/concepts/security-and-auth.md).

## Triggers and other shared domains

`packages/shared/src/triggers` owns automation event normalizers and condition matching for GitHub, Sentry, Slack, and generic webhooks. Control-plane scheduler and webhook routes import this instead of parsing provider payloads ad hoc. See [Automations and Inbound Triggers](/openwiki/integrations/automations.md).

The same package also hosts session list query helpers, git branch prefix `open-inspect/{sessionId}`, completion extractors, and Slack formatting so bots and the Worker stay aligned.

## Failure and compatibility

Zod schemas at the boundary fail closed: invalid client messages, snapshots, or repository lists are rejected rather than coerced into a third mode (for example an empty `repositories: []` is not a valid session target). Unknown sandbox events in a stored timeline envelope are dropped at parse time so one bad row cannot fail snapshot hydration.

When a shared contract changes, every TypeScript consumer must rebuild against the new `dist/`. That coordinated bump is intentional: protocol drift was the bug this package exists to prevent.
