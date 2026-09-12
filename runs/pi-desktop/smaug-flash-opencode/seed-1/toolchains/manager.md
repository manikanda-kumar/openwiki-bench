---
type: reference
title: Developer Toolchains (Discovery and Managed Runtimes)
description: The toolchain subsystem — capability discovery from system/bundled/managed/custom sources, probing and selection, per-project resolution caching, and app-private managed runtime install/repair/remove.
tags: [toolchains, discovery, runtimes, capabilities, managed]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-c27c91e8b62cd93458de8ff2
    resource: repo://src/agent-host/toolchain-runtime.ts
  - id: openwiki-source-c629dc39882eebcbdc9f4fd5
    resource: repo://src/main/ipc.ts
  - id: openwiki-source-c7c746634e2604a41fd48d02
    resource: repo://src/main/toolchains/discovery-registry.ts
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-b83aef15ac62539524c6b69f
    resource: repo://src/shared/toolchains/types.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Developer Toolchains (Discovery and Managed Runtimes)

Pi Agent Desktop resolves the concrete developer tools the Agent uses (Bash,
Git, Node/npm/npx, Python/uv, ripgrep/fd, jq, curl) against what is actually
available on the machine, and can optionally install app-private managed
runtimes. The implementation centers on `ToolchainManager` in the **Main**
process (`src/main/toolchains/manager.ts`), with an execution-facing
`ToolchainRuntime` in the **Agent Host** (`src/agent-host/toolchain-runtime.ts`).

## Capability model

`src/shared/toolchains/types.ts` defines the capability inventory:

- Capabilities: `shell.bash`, `shell.powershell`, `vcs.git`, `js.node`,
  `js.npm`, `js.npx`, `js.bun`, `python.interpreter`, `python.uv`, `python.uvx`,
  `search.rg`, `search.fd`, `data.jq`, `network.curl`.
- Managed components installable to the app: `portable-git`, `node-lts`,
  `cpython`, `uv`, `ripgrep`, `fd`, `jq`, `bun`.
- Providers: `project`, `custom`, `system`, `bundled`, `managed`,
  (`legacy-upstream-managed`).
- Preferences: `auto`, `system`, `bundled`, `managed`, `custom`.
- An `ExecutionIntent` (agent-shell, managed-process, skill-install,
  plugin-install, git-operation, python-script, project-command) scopes how a
  capability is resolved.

## Discovery

`DiscoveryRegistry` (`discovery-registry.ts`) collects candidate executables
("seeds") from the OS PATH, version manager dirs, and the legacy npm command. It
is bounded (max 320 seeds, 64 enumerated children per directory) and realpath
-normalizes inputs. During a scan (`manager.ts:792-864`), `ToolchainManager`
collects seeds from four sources in priority order and probes each:

- **custom** — user-chosen executables (persisted selections);
- **system** — OS-resolved PATH entries;
- **bundled** — signed core runtimes shipped in the app (`build/toolchains/core`);
- **managed** — app-private runtime installs;
- plus legacy upstream search seeds.

Each seed is probed by `probeExecutableSeed` (version check, capability
verification, `--version` etc.) to produce `ToolCandidate`s. Candidate results
are normalized/deduped by real path.

## Selection and preferences

`selectDefaultCandidates` picks the default provider for each capability from
the healthy candidates honoring the stored `preference` mode (`auto` prefers the
highest-priority healthy candidate). A per-project resolution
(`resolveForProject`) augments this with project-aware logic:

- detects the project's Node `engines` range and picks a satisfying node;
- for Python, can select the project's own venv interpreter when the project is
  trusted;
- produces a `requirementsHash` so identical inputs reuse a cached resolution.

Resolutions are cached keyed on `revision:workspace:requirementsHash`
(`manager.ts:602-636`).

## Managed runtimes

`ManagedComponentInstaller` (`installer.ts`) downloads, verifies, extracts, and
probes each managed component from a signed catalog. Operations are surfaced as
`PublicToolchainOperation` (queued → downloading → verifying → extracting →
probing → activating → ready/error). Install/repair/remove/cancel is driven by
`performAction` and gated by Main confirmation dialogs
(`ipc.ts:406-452`). Managed runtimes live in an app-private directory (default
`userData/toolchains`-style paths via `createToolchainPaths`), never modify
system PATH, and their cache directories are bounded. At startup the manager
prunes stale versions while retaining the active version plus a rollback
candidate (`manager.ts:548-600`).

A **startup-pruned future-schema** state file is treated read-only (see
Persistence page).

## Executing with a resolution

`ToolchainRuntime` (`toolchain-runtime.ts`) in the Host turns a
`ToolchainResolution` into a ready-to-use `ToolExecutionContext`:

- It merges each selected command's `pathEntries`/`binDir` into `PATH` (native
  env) and applies `envPatch`, plus shell-only entries/env for `shell.bash`.
- It embeds `PI_DESKTOP_TOOLCHAIN_REVISION` and `PI_DESKTOP_TOOLCHAIN_RESOLUTION`
  to trace which inventory/resolution produced a process.
- On Windows it also sets `PI_DESKTOP_SHELL_CWD_SEMANTICS`/the MSYS workspace
  path for the Git-Bash shell.

It exposes `require(capability, resolution)`, `createExecutionContext(request)`,
`exec`/`execFromContext`, and `spawn`/`spawnFromContext`, so both Bash tools
(`toolchain-bash.ts`) and managed-process launching consume resolved descriptors
with the exact PATH/env a tool needs.

## Snapshot flow into the Host

Main pushes the `ToolchainSnapshot` to the Host (`toolchain:init` /
`toolchain:changed`); the Host acknowledges with the revision. The Host caches
snapshots and resolutions and can request a fresh snapshot or a project
resolution from Main via `callMain("toolchain.getSnapshot")` /
`toolchain.resolve`. This keeps resolutions consistent with Main's inventory
and lets the Host avoid touching the toolchain stack directly
(`toolchain-runtime.ts:152-212`).

## Public state and Developer Tools UI

`buildPublicToolchainState` produces a path-free `PublicToolchainState`
(`capabilities`, `components`, `caches`, `operations`, per-project
`projectSummary`) used by the Developer Tools panel — no absolute paths leak to
the renderer. Custom-tool selection is performed via the Main file picker and
only a verified healthy executable can be registered
(`manager.ts:376-442`).

## Failure handling

- A candidate probe failure simply drops that candidate; a whole-scan failure
  yields a `TOOLCHAIN_INTERNAL` last-error without crashing (`manager.ts:839-864`).
- Required-but-missing capabilities raise typed `ToolchainError` codes
  (`TOOLCHAIN_NODE_REQUIRED`, `TOOLCHAIN_PYTHON_REQUIRED`, …) that the RPC layer
  maps back to the agent.
- Managed installs enforce offline/integrity/extraction error codes and are
  concurrency-guarded (`TOOLCHAIN_INSTALL_BUSY`).

## Related pages

- Architecture Overview
- Configuration, Models, and Credentials
- Managed Background Processes (Agent Host)
