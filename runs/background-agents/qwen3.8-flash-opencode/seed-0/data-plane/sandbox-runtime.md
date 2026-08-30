---
type: runtime
title: Sandbox Runtime (Supervisor and Bridge)
description: The Python runtime baked into every Open-Inspect sandbox — boot-mode state machine, repository sync and setup/start hooks with fatal-vs-warn policy, OpenCode server management, the reconnecting WebSocket bridge with acked event delivery, and the brokered git credential helper.
tags: [sandbox, python, supervisor, bridge, credentials, opencode]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T19:06:13.207Z
sources:
  - id: openwiki-source-733f47731535b2543308ba09
    resource: repo://packages/modal-infra/src/images/base.py
  - id: openwiki-source-cbd064f0f85a511828117a62
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/bridge.py
  - id: openwiki-source-f9901af80e67fc5378194084
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/constants.py
  - id: openwiki-source-06d3b072476cfd51c8cb67f3
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py
  - id: openwiki-source-b5f0c29f69ff64079cdc20a4
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/entrypoint.py
  - id: openwiki-source-e512240e31ed74afef66c2e4
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/event_forwarder.py
  - id: openwiki-source-24a396617b4fd7056fc8dd39
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/opencode_server.py
  - id: openwiki-source-fb68899d3462859b54764231
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repo_image_callback.py
  - id: openwiki-source-efad196f8337a5eed6f4693a
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repository_boot.py
  - id: openwiki-source-cac68f5ceb0de1d13a1a4cf1
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repository_sync.py
  - id: openwiki-source-b185b5840284429fac0e62d7
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/runtime_config.py
  - id: openwiki-source-ba7b9750316811e45cbd444c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/supervisor.py
  - id: openwiki-source-b8d4dcd72c15353f277fba5c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/tunnel_environment.py
generated: { by: "opencode", at: "2026-08-29T19:06:13.207Z" }
---

`packages/sandbox-runtime` is the single Python package every provider image ships (Modal `base.py` copies it to `/app/sandbox_runtime`; Daytona/E2B/OpenComputer/Vercel bake or upload the same tree), and every sandbox — session *and* image-build — runs exactly one entrypoint: `python -m sandbox_runtime.entrypoint`, which composes the supervisor from env (`entrypoint.py:96–110`).

## Configuration and boot modes

`runtime_config.py` reads the env contract: `SANDBOX_ID`, `CONTROL_PLANE_URL` (**HTTPS required except loopback**, L40–48), `SANDBOX_AUTH_TOKEN`, `REPO_OWNER/REPO_NAME`, `VCS_HOST`, and the canonical `SESSION_CONFIG` JSON (frozen dict; must parse to an object). `BootMode.from_env` precedence (`runtime_config.py:22–29`) is `IMAGE_BUILD_MODE → BUILD`, `RESTORED_FROM_SNAPSHOT → SNAPSHOT_RESTORE`, `FROM_REPO_IMAGE → REPO_IMAGE`, else `FRESH` — the four modes the whole boot pipeline keys on. Constants (`constants.py`) fix OpenCode port 4096, `/workspace/.tunnels.env`, `/tmp/oi-repo-manifest.json`, `/tmp/oi-boot-warnings.jsonl`, and `DEFAULT_SANDBOX_TIMEOUT_SECONDS = 7200`.

## Supervisor

`supervisor.py` `run()` (L355–472): set boot mode → prepare tunnel env (clear a file whose `TUNNEL_SANDBOX_ID` isn't this sandbox — snapshot leftovers must not masquerade as fresh, `tunnel_environment.py:39–55`; `wait_until_ready` polls for expected `TUNNEL_<port>=` lines up to `TUNNEL_WAIT_TIMEOUT_SECONDS`, default 30 s, non-fatal on timeout) → **repository boot** → managed-skills install → code-server → web terminal → VNC desktop (best-effort) → **OpenCode server** (config `{"model": provider/model, "permission": allow-all}` + MCP servers; local npm MCP packages pre-installed; staged `.opencode/` merge for multi-repo; token-broker plugin when provider auth is managed; then `opencode serve --port 4096 --hostname 0.0.0.0` with a 30 s health poll, `opencode_server.py:480–600`) → spawn the **bridge as a child process** → `monitor_processes()`.

**Restart policy** (L138–304): per-process budget `MAX_RESTARTS = 5` with exponential backoff (base 2, 60 s cap). OpenCode crash → restart after boot; budget exhausted → `_report_fatal_error` (`POST {CP}/sessions/{id}/sandbox-error` with the sandbox bearer token, 3 attempts, 1000-char tail; L76–110) + shutdown. Bridge child **exit 0 → graceful whole-sandbox shutdown** (L175–178) — the bridge is treated as a session liveness signal; crash → restart → fatal. code-server/terminal/desktop exhaustion is **non-fatal** drop. Shutdown order is explicit (L478–489): desktop, bridge, terminal, code-server, desktop, opencode.

**BUILD mode** is the odd one: run repo boot (clone + `setup.sh` only), report success/failure to the image-build callback (`repo_image_callback.py`, 3 retries; partial callback config **aborts boot** rather than run unreported, L51–95), then idle until shutdown so the control plane can snapshot the live provider session; a signal-driven cancel is *not* reported as a build failure.

## Repository boot: fatal vs warn

`repository_boot.py` (L149–240) is where the fatal-vs-warn policy is decided, per boot mode:

| Step | FRESH | BUILD | SNAPSHOT_RESTORE / REPO_IMAGE |
| --- | --- | --- | --- |
| repo config invalid | fatal | fatal | fatal (fail fast, L153–154) |
| git sync failure/timeout | **fatal RuntimeError** | **fatal RuntimeError** | warn: "checkout may be stale" |
| `setup.sh` | warn: "the session continues without it" | **fatal RuntimeError** | **skipped entirely** (the image already ran it) |
| `start.sh` (after tunnel wait) | first repo's failure **fatal**, later repos warn | not run | same as FRESH |

(Sync semantics: shallow `--depth 100` clone with per-command timeouts — clone 300 s, fetch 120 s; restore path uses `preserve_checkout` so a snapshot's worktree is never force-reset, `repository_sync.py:289–297`; repo manifests are written twice, pre/post-sync, the post-sync copy carrying discovered base SHAs the bridge reports in its `ready` event.) Hooks are plain bash with env passthrough, `OPENINSPECT_BOOT_MODE`, default timeouts setup 300 s / start 120 s, and process-group kill on timeout (`repository_hooks.py`). Multi-repo workspaces also get a generated `AGENTS.md` manifest (`repository_boot.py:91–141`).

## The bridge

`bridge.py` is the session's only channel to the control plane: WS to `.../sessions/{id}/ws?type=sandbox` with headers `Authorization: Bearer {SANDBOX_AUTH_TOKEN}` + `X-Sandbox-ID`, 20 s ping interval (`bridge.py:465–468`). On connect it sends a `ready` event carrying `sandboxId`, persisted OpenCode session id, `runtimeVersion` (from `SANDBOX_VERSION` — feeds the control plane's image/snapshot compatibility stamping) and per-repository `baseSha`s from the manifest (L288–309), then drains boot warnings exactly once. Reconnect is exponential to 60 s, **fatal without retry on HTTP 401/403/404/410** (`_is_fatal_connection_error`, L437–456; status check L540) — a rotated credential or dead session must not loop.

Commands handled (`_handle_command`, L598–669): `prompt` runs as a **background task that survives WebSocket disconnects** (L647–649): refresh git identity from the prompt's author mode, hydrate image attachments from `{CP}/sessions/{id}/attachments/{attachmentId}` (bounded concurrency + size caps, `attachment_processor.py`), translate the OpenCode SSE stream into `token`/`step_*`/`tool_call`/`session_title`/`context_compacted` events (`prompt_stream.py`, with assistant-message authorization buffering and Anthropic thinking-budget handling), and finish with terminal `execution_complete`; a run with *no* assistant output is hardened to still terminate cleanly (`bridge.py:727–735`). Also: `stop` (cancel + OpenCode `/abort`), `snapshot` (reply `snapshot_ready`), `shutdown`, `push` (validate provider `pushSpec` — both-or-nothing repo identity — resolve checkout *only* via the supervisor manifest so spec strings never become paths, `git push` with 300 s timeout and terminate→kill escalation, stderr redaction of URL credentials, always answer `push_complete`/`push_error` echoing `branchName`, L844–1051), `git_sync_complete`, `refresh_diff`, `ack`.

**Event delivery** (`event_forwarder.py`) is at-least-once for the important five: `execution_complete`, `error`, `snapshot_ready`, `push_complete`, `push_error` get deterministic `ackId`s (type + message id) and stay pending until the control plane `{type:"ack",ackId}` (L20–28, L115–146 — CP acks in `session/sandbox-events/processor.ts:124`); a bounded 1000-event buffer drops non-criticals first; `bind()` on reconnect snapshots pending ids, flushes the buffer, and re-sends only what's still pending under one lock (L83–107). Prompt timeout math (L214–229): `prompt_max_duration = SANDBOX_TIMEOUT_SECONDS − min(900 s, 25%)`, the reserve doubling as cleanup budget.

## Git credentials and signing

`credentials/git_credential_helper.py` implements git's `credential get` server protocol, scoped to `VCS_HOST` over https only (deliberately **not repo-scoped** — so private aux repos an agent clones work too, comment L128–132): each miss mints fresh credentials via `POST {CP}/sessions/{id}/scm-credentials`, cached at `/run/oi/scm-creds.json` (0600, flock, 5-min expiry buffer, **no stale fallback**; concurrent callers share one refresh). The env `VCS_CLONE_TOKEN` fallback applies *only* when there's no control-plane context at all (image-build sandboxes); a malformed `SESSION_CONFIG` refuses the fallback for live sessions. `gh-wrapper.sh` shadows `/usr/bin/gh` and mints a `GH_TOKEN` only in the explicit fallback-marker case. Commit signing proxies `ssh-keygen -Y sign` to `{CP}/sessions/{id}/commit-signing` (`git_signing.py`, `git_signer.py`) so the key never enters the sandbox.

## Tests

`tests/` (~60 files) pin this behavior rather than its internals: `test_bridge_reconnection.py` (fatal-status matrix), `test_bridge_ack.py` + event-buffer tests (bind recovery, prompt-task-survives-disconnect), `test_git_credential_helper.py` (host scoping incl. LFS/aux repos, cache refresh, gh-mint matrix), `test_entrypoint_build_mode.py` (the fatal/warn matrices end to end, repository_shas reporting, deadline-vs-cancel), `test_multi_repo_workspace.py`, `test_restore_integrity.py` (HEAD/index/worktree preserved across restores), and `conftest.py` documents the three fixed filesystem paths as a dogfooding hazard.
