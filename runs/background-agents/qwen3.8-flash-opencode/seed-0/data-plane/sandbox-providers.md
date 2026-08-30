---
type: subsystem
title: Sandbox Provider Abstraction
description: The control-plane SandboxProvider interface and capability flags, per-backend configuration via the provider factory, transient/permanent error classification, REST client conventions, and the sandbox env-injection contract (SESSION_CONFIG, boot-mode scrubbing, brokered git credentials).
tags: [sandbox, providers, rest-clients, env-contract, capabilities]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-ebca72c31e0d9adcc124cba1
    resource: repo://docs/VERCEL_SANDBOX_PROVIDER.md
  - id: openwiki-source-0339083ae2c7a7f44eacd1b4
    resource: repo://packages/control-plane/src/sandbox/client.ts
  - id: openwiki-source-8da0ed3025a13b3ed48b8b8e
    resource: repo://packages/control-plane/src/sandbox/e2b-rest-client.ts
  - id: openwiki-source-7c3e145b2a485e54a0e9643b
    resource: repo://packages/control-plane/src/sandbox/provider-factory.ts
  - id: openwiki-source-9a736cd5ab523477b47ea706
    resource: repo://packages/control-plane/src/sandbox/provider.ts
  - id: openwiki-source-2312e78016a3e899b195c16b
    resource: repo://packages/control-plane/src/sandbox/providers/daytona-provider.ts
  - id: openwiki-source-41952f779c848b0196f22641
    resource: repo://packages/control-plane/src/sandbox/providers/e2b-provider.ts
  - id: openwiki-source-5951ad3abbae5840613b8cda
    resource: repo://packages/control-plane/src/sandbox/providers/modal-provider.ts
  - id: openwiki-source-5bd0ac0dcec22450aa912fbb
    resource: repo://packages/control-plane/src/sandbox/providers/vercel/provider.ts
  - id: openwiki-source-b4fcd225b1d428a7ab560a2d
    resource: repo://packages/control-plane/src/sandbox/sandbox-env.ts
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

The control plane treats five very different compute backends as one concept. The contract lives in `packages/control-plane/src/sandbox/provider.ts`; implementations in `providers/`; construction in `provider-factory.ts`; and the *content* of what a sandbox receives in `sandbox-env.ts`.

## Interface and capabilities

`SandboxProvider` (`provider.ts:458–508`) exposes `name`, `capabilities`, `createSandbox`, and optional `restoreFromSnapshot` / `resumeSandbox` / `takeSnapshot` / `stopSandbox` — every optional operation is guarded by a capability flag (`SandboxProviderCapabilities`, L53–64): `supportsSandboxTimeout`, `supportsSnapshots`, `supportsRestore`, `supportsPersistentResume`, `supportsExplicitStop`. The lifecycle manager asks *policy* questions of `decisions.ts` and *capability* questions of these flags, which is the whole mechanism behind the two divergent teardown styles:

| Provider | Style | Capability signature |
| --- | --- | --- |
| Modal | snapshot/restore | `supportsSnapshots/Restore: true` (`providers/modal-provider.ts:88–94`) |
| Vercel | snapshot/restore + explicit stop, no persistent resume (`providers/vercel/provider.ts:84–90`) | base-snapshot management + 45-min lifetime cap |
| OpenComputer | all five: snapshots, checkpoints, hibernate/wake | `providers/opencomputer-provider.ts:75–81` |
| Daytona | persistent sandbox: stop/start/recover in place, **no snapshots** (`providers/daytona-provider.ts:59–65`; test pins `supportsSnapshots: false` at `daytona-provider.test.ts:118`) | inactivity → provider stop; later → resume same sandbox |
| E2B | persistent via auto-pause: `stopSandbox` = pause, resume = connect, `supportsSnapshots: false` at runtime (`providers/e2b-provider.ts:190–197`), but a side-door `takePrebuiltImageSnapshot` exists *only* for image builds (L294–330) | provider auto-resume deliberately disabled |

Capability ordering matters in `decisions.ts`: resume is consulted before snapshot restore when both are available (`e2b-provider.ts:180–184` comment).

## Factory and configuration

`createSandboxProviderFromEnv(env, backend?)` (`provider-factory.ts:151–184`) switches on the backend name (`provider-name.ts` — default `modal`; unknown value throws) with typed overloads returning concrete classes for image-build adapters. Each `<x>ProviderFromEnv` **throws on missing credentials at DO composition** (fail-at-construction, see [Session Durable Object](/openwiki/control-plane/session-durable-object.md)): Modal needs `MODAL_API_SECRET`+`MODAL_WORKSPACE`; Vercel `VERCEL_TOKEN`+`VERCEL_PROJECT_ID` (+`VERCEL_BASE_SNAPSHOT_NAME`); OpenComputer `OPENCOMPUTER_API_URL/KEY` (+`OPENCOMPUTER_TEMPLATE` required to start sandboxes); Daytona `DAYTONA_API_URL/KEY/BASE_SNAPSHOT`; E2B `E2B_API_KEY`+`E2B_TEMPLATE_ID` (+`E2B_AUTO_PAUSE` default true). Terraform wires the matching variables via the `sandbox_provider` toggle.

## REST client conventions

Five clients under `src/sandbox/` share house style: fetch with an explicit `AbortSignal.timeout` deadline (`request-deadline.ts`; Modal uses named deadlines — start 60 s, snapshot 310 s deliberately just above the provider's own 300 s, cleanup 60 s, `client.ts:26–29`), `SandboxProviderError` classification on every failure path, correlation headers (`x-trace-id`/`x-request-id`/`x-session-id`), and provider-auth (`Authorization: Bearer …` for Modal HMAC, Daytona, OpenComputer, Vercel; `X-API-Key` for E2B/OpenComputer variants). Provider-specific patterns worth knowing:

- **Modal** (`client.ts`) is the only HTTP-to-own-service client — snake_case bodies mirroring the FastAPI models, endpoints `{workspace}--open-inspect-{fn}.modal.run` (see [Modal Data Plane](/openwiki/data-plane/modal-infra.md)).
- **Daytona** (`daytona-rest-client.ts`): `POST /sandbox` with snapshot name + auto-stop/auto-archive labels, `start/stop/recover` state transitions, signed per-port preview URLs used to build tunnel/code-server URLs; 404 maps to `DaytonaNotFoundError`.
- **E2B** (`e2b-rest-client.ts`): control-plane REST for lifecycle (pause with `memory:false` for filesystem-only snapshots, `/connect` for a fresh `envdAccessToken`) plus the **envd Connect-RPC** `process.Process/Start` at port 49983 with 5-byte envelope framing to exec the supervisor; `scrubEnvValues` redacts every create-env value from error text (L238–266); port URLs are host-derived `https://{port}-{id}.{domain}`.
- **OpenComputer** (`opencomputer-rest-client.ts`): paths table at L182–196 (`/sandboxes`, `/wake`, `/hibernate`, `/checkpoints`, `/secret-stores*`, `/exec/run`); `startRuntime` re-exports the full env preamble over `/exec/run` because exec doesn't inherit image env (L225–229); checkpoints are `disk_only` with `delete_oldest max 30`.
- **Vercel** is **control-plane-only** — there is no separate data-plane service; `providers/vercel/` implements snapshots, the managed base snapshot (Terraform bootstraps it; the provider resolves `VERCEL_BASE_SNAPSHOT_NAME` to the newest created one, `provider.ts:499+`), and source precedence prebuilt > manual base id > managed base.

## The env-injection contract

`sandbox-env.ts` is the single place defining what a sandbox's process environment looks like, shared by all providers:

- `buildSessionConfig` (L72–88) serializes the canonical **`SESSION_CONFIG`** JSON — `session_id`, repo identity, provider/model, branch, ordered `repositories` — which is the *same shape* the Python `SessionConfig` decodes; multi-repo identity travels there, not in loose env vars.
- `buildSandboxEnvVars` (L279–337): user env (global + repo/environment secrets) first, **system vars overlaid last** (`SANDBOX_ID`, `CONTROL_PLANE_URL`, `SANDBOX_AUTH_TOKEN`, `SANDBOX_TIMEOUT_SECONDS`, `SESSION_CONFIG`, …) so secrets can never shadow them; `BOOT_MODE_ENV_KEYS` (`IMAGE_BUILD_MODE`, `RESTORED_FROM_SNAPSHOT`, `FROM_REPO_IMAGE`, `REPO_IMAGE_SHA`) are **deleted from the user layer** so a repo secret cannot fake a boot mode.
- **No long-lived git token, ever**: `VCS_CLONE_TOKEN`/`GITHUB_TOKEN` are deliberately absent from interactive sandboxes (comment L325–334); the runtime's credential helper brokers per-request from the control plane. What *is* injected is identity metadata: `VCS_HOST` + `VCS_CLONE_USERNAME` per SCM (github `x-access-token`, gitlab `oauth2`, bitbucket `x-token-auth`, L194–210).
- Derived credentials: code-server password and VNC password are HMACs of the sandbox id under the provider key with domain separation (`deriveCodeServerPassword`/`deriveVncPassword`, L235–248) — never random, never stored; E2B additionally redirects its credential cache via `OI_SCM_CRED_CACHE_DIR=/tmp/oi` because `/run` is root-owned (`e2b-provider.ts:113–125`).
- `buildImageBuildEnvVars` (L401–426) is the build-mode twin: callback env names come from the shared manifest `image_build_callback_env.json` (mirrored TS/Python tests), and managed provider markers (`OPENAI_API_KEY`/`XAI_API_KEY` or OAuth markers) are derived by `managed-provider-env.ts` per the session's D1-bound auth mode.
- Service enablement (code-server, VNC, terminal, tunnel ports) flows from the session's `sandbox_settings`, with ports resolved by `providers/port-resolution.ts`; `DEFAULT_SANDBOX_TIMEOUT_SECONDS = 7200` (provider.ts L15) is the single default every layer imports.

## Extension points

Adding a provider means: a `provider-name.ts` entry, a REST client, a `SandboxProvider` implementation declaring capabilities honestly, a `<x>ProviderFromEnv` factory branch, a provider-policy entry in `image-builds/`, and a Terraform module for template/base-snapshot builds — `docs/provider-contribution-checklist.md` enumerates the same. The lifecycle machine itself needs no changes: capabilities and error classification are the only levers it reads.
