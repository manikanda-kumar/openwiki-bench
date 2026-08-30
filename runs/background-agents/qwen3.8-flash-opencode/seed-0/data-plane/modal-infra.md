---
type: service
title: Modal Data Plane (modal-infra)
description: The Modal-hosted Python service — HMAC-authenticated FastAPI endpoints for sandbox create/restore/snapshot and build sessions, the launch-spec and tunnel plumbing, fail-closed control-plane host allowlist, the runtime-manifest-driven base image, and the deploy runbook.
tags: [modal, python, fastapi, snapshots, deployment]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-173fd173c9194b9f127bc676
    resource: repo://packages/modal-infra/deploy.py
  - id: openwiki-source-c4c7e63f567abf6db0c35d4d
    resource: repo://packages/modal-infra/src/app.py
  - id: openwiki-source-733f47731535b2543308ba09
    resource: repo://packages/modal-infra/src/images/base.py
  - id: openwiki-source-ca15e4453ec332452279c0d4
    resource: repo://packages/modal-infra/src/sandbox/build_session.py
  - id: openwiki-source-258b56de085088c4e2e10662
    resource: repo://packages/modal-infra/src/sandbox/manager.py
  - id: openwiki-source-4f606005c64e373cdd655a89
    resource: repo://packages/modal-infra/src/web_api.py
  - id: openwiki-source-e6c986b54f20618691685121
    resource: repo://packages/modal-infra/tests/test_deploy.py
  - id: openwiki-source-6f6cc3218c3b0eb01f668984
    resource: repo://packages/modal-infra/tests/test_web_api_create_sandbox.py
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/modal-infra` is the only backend that ships its *own* service. It defines a Modal app (`open-inspect`, `src/app.py:24`) whose functions are deployed as web endpoints; the control plane's `ModalClient` (`packages/control-plane/src/sandbox/client.ts:340–346`) calls `https://{workspace}--open-inspect-{endpoint}.modal.run` — Terraform reads the URLs back from the `modal-app` module outputs. Everything *inside* a Modal sandbox is `packages/sandbox-runtime`; this package is only the control surface + image definition.

## Endpoints and auth

`src/web_api.py` exposes POST endpoints: `api_create_sandbox` (L346–442), `api_snapshot_sandbox` (L452–514), `api_snapshot_build_sandbox` (L517–557), `api_restore_sandbox` (L560–664), `api_create_build_sandbox` (L667–742), `api_start_build_sandbox` (L745–773), `api_terminate_build_sandbox` (L776–804), and an unauthenticated GET `api_health` (L445–449). Auth is the shared HMAC `timestamp.signature` internal token (`require_auth`, L266–287, verified by `sandbox_runtime.auth.verify_internal_token` with a 5-minute window and constant-time compare): **bad token → 401, misconfigured `MODAL_API_SECRET` → 503** — never a silent pass.

Two deliberate endpoint mechanics (`_execute_endpoint`, L179–223): **authentication runs before request parsing** (`require_auth` before the `yield`, L195) so an unauthenticated caller can't trigger model validation work or error reflection, and every call emits one structured `modal.http_request` log with status/duration/outcome; unexpected exceptions collapse to a generic 500, cancellation logs as 499. Request models are `extra="ignore", strict=True` (`_ModalRequestModel`, L44–47): strict typing rejects e.g. string booleans, while unknown fields ride along for forward-compat during control-plane roll-forward; the create/restore handlers pick fields *by `SessionConfig`'s own names*, so adding a wire field usually only means editing the shared model.

**Fail-closed host allowlist.** Requests may carry a `control_plane_url` telling the sandbox where to dial back; `validate_control_plane_url` (`src/app.py:86–125`) requires it to match `ALLOWED_CONTROL_PLANE_HOSTS` (comma-separated `netloc`, case-insensitive) — and with an empty/missing allowlist it **rejects everything**, so a misconfigured deployment can't exfiltrate sandbox auth tokens to an attacker-chosen URL. Image-build callback URLs go through the same check (`web_api.py:717–722`).

## Launch spec and tunnels

Create/restore normalize into one `_SandboxLaunchSpec` with an image-source of exactly three kinds (`src/sandbox/manager.py:134–156`): `_BaseImageSource` (fresh), `_RepositoryImageSource` (prebuilt image; sets `FROM_REPO_IMAGE`/`REPO_IMAGE_SHA`), `_SnapshotImageSource` (restore; sets `RESTORED_FROM_SNAPSHOT`). `_launch_sandbox` (L356–498) generates `sandbox-{owner}-{name}-{ms}` ids, filters user env through `_RESERVED_LAUNCH_ENV_VARS` (L48–58, including `SESSION_CONFIG` and the boot-mode markers) so injected system env can't be shadowed, serializes `SESSION_CONFIG`, resolves service ports (per-session allocation with defaults from `sandbox_runtime.constants`), and never exposes raw VNC port 5900 (only noVNC, L262–263). Tunnel URLs are resolved with 3 retries + linear backoff and written to `/workspace/.tunnels.env` with a `TUNNEL_SANDBOX_ID=` first line so the in-sandbox supervisor can distinguish a fresh write from a snapshot leftover (`_write_tunnel_env_file`, L322–354; failures logged, never fatal). Snapshots are `sandbox.snapshot_filesystem` with a 300 s timeout (L45, L543–586) and persist indefinitely as Modal images.

The create path **never resolves a clone token** — fresh sandboxes authenticate git through the control-plane credential helper; only the *restore* path mints a fallback token for legacy snapshots (`web_api.py:394–424, 625`; pinned by `tests/test_web_api_create_sandbox.py:339`). Repository lists are validated server-side via `repo_config.parse_repositories` (nested owners allowed, name-collision-safe) without echoing values in errors (L818–845).

## Image-build sessions

`src/sandbox/build_session.py` implements the Modal leg of the [prebuild workflow](/openwiki/control-plane/image-prebuilds.md): `create` launches a *dormant* sandbox (`IMAGE_BUILD_MODE=true`, `SANDBOX_ID=build-<id>`, **no LLM secrets** — `secrets=[]`, L118) with `secrets=[]`, env-tagged `openinspect_kind=image-build` / `build_id` / `scope_kind` / `scope_id` / `openinspect_launch_protocol=stdin-token-v1` (L106–112), and the entrypoint argument `--await-modal-image-build-token-stdin-v1` gating the stdin protocol. `start` re-resolves by *build id + provider session id + launch protocol tag* (`_resolve`, L194–207 — a tag mismatch reads as absent-or-bound-to-another-build), refuses unknown protocols, and writes **only** the callback token line to sandbox stdin (L135–153). `terminate` validates the tags again and treats not-found as success. User env is scrubbed of reserved keys (`OI_REPO_IMAGE_*` callback quartet, `PROVIDER_SESSION_ID`, `MODAL_SANDBOX_ID` which Modal injects itself) so no repository secret can spoof identity or callback routing (`RESERVED_USER_ENV_KEYS`, L41–48).

## The base image and its cache buster

`src/images/base.py` builds the Debian/py3.12 toolchain: pinned **OpenCode 1.18.18** (with a documented never-below-1.18.15 floor — the message-ID wraparound), code-server 4.109.5 and ttyd 1.7.7 **sha256-verified**, agent-browser + headless Chromium, VNC stack, the staged `/app/opencode-deps` plugin tree (so first boot skips reify), the `oi-git-credentials` system git-credential-helper config, and `/app/sandbox_runtime` copied from the sibling package. **`CACHE_BUSTER = RUNTIME_VERSION`** (L54): the buster is no longer hand-bumped — it *is* the single `runtime_manifest.json` generation (v61 at time of writing), embedded in a no-op `echo 'cache: …'` layer (L137–139) and exported as `SANDBOX_VERSION`; bumping the manifest rebuilds this image, ages out prebuilt images, and retires incompatible snapshots together (shared by every image-build provider).

## Deploy runbook

From `packages/modal-infra`: `uv run python deploy.py --build-sandbox-image` **before** `uv run modal deploy deploy.py` (or `-m src`). `deploy.py` eagerly `base_image.build()`s against `modal.App.lookup(create_if_missing=True)` (L27–31) because `modal deploy` alone registers functions without building the dynamic image. `tests/test_deploy.py` pins both the eager-build semantics and the exact order used by `terraform/modules/modal-app/scripts/deploy.sh` (`uv sync --frozen` → build → deploy; stop on build failure) — which is also why `deploy.sh` and its inputs appear in the Terraform module's hash. Modal secrets: `llm-api-keys` (`ANTHROPIC_API_KEY`), `github-app`, `internal-api` (`MODAL_API_SECRET` + optional `ALLOWED_CONTROL_PLANE_HOSTS`, `SCM_PROVIDER`, `GITLAB_ACCESS_TOKEN`) (`src/app.py:43–65`).

## Testing

16 pytest files in `tests/` pin the wire contract and security ordering: auth-before-validation (`test_web_api_create_sandbox.py:317`), strict typing (`:128`), no clone tokens on fresh/repo-image boots (`:339, :444`), env-override ordering and managed-OAuth suppression (`test_sandbox_env_vars.py`), tunnel validation/dotenv semantics (`test_tunnel_ports.py`), build-session tag binding and stdin protocol (`test_build_sandbox_lifecycle.py` — which also reads the *TypeScript* source to pin shared timeout numbers and callback env names), and the deploy ordering (`test_deploy.py`).
