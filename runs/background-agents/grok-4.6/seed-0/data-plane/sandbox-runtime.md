---
type: architecture
title: Sandbox Runtime
description: Provider-agnostic in-sandbox supervisor that boots repositories, runs OpenCode, and reconnects an agent bridge WebSocket to the session Durable Object.
tags: [sandbox-runtime, supervisor, opencode, bridge, git]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-29T14:40:34.741Z
sources:
  - id: openwiki-source-cbd064f0f85a511828117a62
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/bridge.py
  - id: openwiki-source-06d3b072476cfd51c8cb67f3
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/credentials/git_credential_helper.py
  - id: openwiki-source-b5f0c29f69ff64079cdc20a4
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/entrypoint.py
  - id: openwiki-source-06e38d23b5f3fbd3e1fc1731
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/repository_hooks.py
  - id: openwiki-source-b185b5840284429fac0e62d7
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/runtime_config.py
  - id: openwiki-source-ba7b9750316811e45cbd444c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/supervisor.py
  - id: openwiki-source-b8d4dcd72c15353f277fba5c
    resource: repo://packages/sandbox-runtime/src/sandbox_runtime/tunnel_environment.py
generated: { by: "grok", at: "2026-08-29T14:40:34.741Z" }
---

# Sandbox Runtime

`packages/sandbox-runtime` is the process that runs **inside every sandbox**, regardless of Modal, Daytona, E2B, Vercel, or OpenComputer. Providers supply the VM and network; this package supplies supervisor, git boot, OpenCode, and the WebSocket bridge. See [Sandbox Providers](/openwiki/data-plane/sandbox-providers.md).

`entrypoint.py` is the composition root. `RuntimeConfig.from_env` reads process environment (including `SESSION_CONFIG` JSON). VNC password is popped from the environment before other services start. `build_supervisor` wires `RepositoryBoot`, `OpenCodeServer`, `AgentBridgeProcess`, optional `ManagedSkillsMaterializer`, code-server, ttyd, and VNC desktop.

`CONTROL_PLANE_URL` must be HTTPS except loopback. That is a runtime invariant, not a comment.

## Boot modes

`BootMode.from_env`:

| Env | Mode | Typical path |
| --- | --- | --- |
| `IMAGE_BUILD_MODE=true` | `BUILD` | Prebuild: clone + setup, callback, no agent loop |
| `RESTORED_FROM_SNAPSHOT=true` | `SNAPSHOT_RESTORE` | Quick git sync + `start.sh` |
| `FROM_REPO_IMAGE=true` | `REPO_IMAGE` | Incremental sync; skip `setup.sh` (already ran at image build) |
| otherwise | `FRESH` | Clone + `setup.sh` + `start.sh` + agent |

`start.sh` failure is fatal on session boots. If the script exists and exits non-zero, startup fails instead of continuing with a broken runtime. See [Sandbox Lifecycle](/openwiki/workflows/sandbox-lifecycle.md).

## Supervisor order (session boot)

`SandboxSupervisor.run` (non-build):

1. Derive boot mode; clear stale tunnel env as needed
2. Start VNC desktop (warn and continue on failure)
3. `repository_boot.boot` — git, hooks, manifests
4. Materialize managed skills **once per sandbox boot** (OpenCode restarts reuse the tree; they must not depend on control-plane availability)
5. Start code-server and web terminal (warn and continue on failure)
6. Start OpenCode, then the agent bridge
7. `monitor_processes` with restart policy `MAX_RESTARTS = 5`, exponential backoff capped at 60s

Fatal errors POST to `/sessions/:id/sandbox-error` with the sandbox Bearer token (`fatal: true`), truncated, up to 3 attempts. SIGTERM/SIGINT set the supervisor shutdown event.

Build mode skips the agent: it runs image-build execution, reports success/failure via `RepoImageBuildCallback`, then waits for shutdown.

## Repository boot

`RepositoryBoot` parses `SESSION_CONFIG` through `parse_repositories` (nested owners, unique `repo_name` checkout dirs). Invalid config is a **fatal** `RuntimeError`. It writes the repo manifest; every other in-sandbox consumer (bridge push, JS create-PR tool) **reads that file** instead of re-deriving `/workspace/<repo_name>`.

Git uses the control-plane credential helper (`credentials/git_credential_helper.py`): each `git credential get` fetches a short-lived token from `POST /sessions/:id/scm-credentials`. Successful responses cache under `/run/oi/scm-creds.json` (0600) until near expiry. The cache is **never** a fallback for a failed refresh. See [Source Control](/openwiki/workflows/source-control.md).

Per repository, in position order:

- Fresh: clone
- Restore / repo-image: fetch + reset
- `.openinspect/setup.sh` — skipped on restore and repo-image; default timeout 300s
- After tunnels: `.openinspect/start.sh` — default timeout 120s

Multi-repo sessions also write `/workspace/AGENTS.md` listing each `./{name}/` path and reminding the agent that `create-pull-request` is per repository. OpenCode’s working directory is the single clone when there is one git checkout; otherwise the `/workspace` root.

No-repo sessions skip git sync (`supervisor.no_repo_configured`).

## Tunnel URLs before start.sh

When `tunnelPorts` is set, resolved URLs are written to `/workspace/.tunnels.env` (`TUNNEL_<port>=…`, `TUNNEL_SANDBOX_ID=…`). On every non-build boot the supervisor:

1. Clears a file whose `TUNNEL_SANDBOX_ID` is not this sandbox (snapshot leftover). A file already written for **this** sandbox is kept — the backend may write it before the supervisor starts.
2. Waits up to `TUNNEL_WAIT_TIMEOUT_SECONDS` (default 30s).
3. Runs `start.sh`.

Timeout logs `tunnel.env_file_wait_timeout` and continues without fresh local URLs; the control plane still broadcasts URLs to clients separately. Empty `tunnelPorts` or build mode skips the file.

## Agent bridge

`bridge.py` is the WebSocket seam to the session Durable Object: heartbeats, OpenCode event forwarding, prompt/stop/snapshot commands, per-prompt git identity, attachment hydration, and diff capture.

The main loop **reconnects** on transient errors with exponential backoff. HTTP 410 (session terminated) and non-retryable git-signing errors are fatal and set shutdown. Losing the socket is not the same as the sandbox dying; the Durable Object treats lifecycle as authoritative across reconnects.

## Optional services and tools

Code-server, ttyd, and VNC are opt-in at session create. Failure to start them is a warning, not a fatal boot. Agent tools under `tools/` (`spawn-child`, `slack-notify`, …) talk back to the control plane with the sandbox token. MCP server config is passed into OpenCode from `RuntimeConfig`.

Managed skills are fetched with that same token and written into OpenCode’s global skills directory before OpenCode starts. They are trusted instruction content, not a permission boundary. See [Secrets, Managed Skills, and MCP Servers](/openwiki/features/secrets-skills-and-mcp.md).

## Tests

`packages/sandbox-runtime/tests/test_*.py` cover supervisor lifecycle, bridge reconnect, git helper, repo_config nested owners, tunnel env, managed skills, and child-session tools.
