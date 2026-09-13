---
type: concept
title: Developer Toolchain Manager
description: Cross-platform developer tool discovery and resolution — capability inventory, probes, preferences, per-project resolution, and the ToolchainRuntime used by the Agent Host for bash/git/skill/plugin/process execution.
tags: [toolchains, discovery, resolution, runtime]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-360ffc38dffabfeada5f18b8
    resource: repo://src/agent-host/toolchain-bash.ts
  - id: openwiki-source-e989b9d0d6b08a1c61d9c4ea
    resource: repo://src/agent-host/toolchain-git.ts
  - id: openwiki-source-c27c91e8b62cd93458de8ff2
    resource: repo://src/agent-host/toolchain-runtime.ts
  - id: openwiki-source-c3b5d176ff815d2a3cfaed6e
    resource: repo://src/main/toolchains/candidate-normalizer.ts
  - id: openwiki-source-c7c746634e2604a41fd48d02
    resource: repo://src/main/toolchains/discovery-registry.ts
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-023cc457b63a4be16795adbe
    resource: repo://src/main/toolchains/probes/capabilities.ts
  - id: openwiki-source-d9f47b20cc65b48f94ec8bf0
    resource: repo://src/main/toolchains/project-detector.ts
  - id: openwiki-source-553ef67aa5ebee1b0410e799
    resource: repo://src/main/toolchains/public-state.ts
  - id: openwiki-source-b83aef15ac62539524c6b69f
    resource: repo://src/shared/toolchains/types.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Developer Toolchain Manager

The toolchain system gives Pi Desktop a single, cross-platform answer to "which `node`, `npm`, `python`, `git`, `bash`, `rg`, `fd`, `jq`, `uv` do I run and with what environment?" It runs in two halves: the **Main process** discovers and resolves tools (`src/main/toolchains/manager.ts`), and the **Agent Host** consumes immutable snapshots and resolutions (`src/agent-host/toolchain-runtime.ts`).

## Capabilities, providers, and health

`src/shared/toolchains/types.ts` defines the model:

- **Capabilities** (`TOOL_CAPABILITY_IDS`): `shell.bash`, `shell.powershell`, `vcs.git`, `js.node`, `js.npm`, `js.npx`, `js.bun`, `python.interpreter`, `python.uv`, `python.uvx`, `search.rg`, `search.fd`, `data.jq`, `network.curl`.
- **Providers** (`TOOL_PROVIDERS`): `project`, `custom`, `system`, `bundled`, `managed`, `legacy-upstream-managed`.
- **Health** (`TOOL_HEALTH_VALUES`): `healthy`, `missing`, `incomplete`, `unsupported`, `unverified`, `broken`, `modified`, `blocked-by-trust`.
- **Execution intents** (`EXECUTION_INTENTS`): `agent-shell`, `managed-process`, `skill-install`, `plugin-install`, `git-operation`, `python-script`, `project-command`. A resolution is computed per cwd × intent × trust.

## Discovery and probing

`ToolchainManager.performScan` (`manager.ts:792`) gathers seeds from four sources concurrently — system discovery, managed components, bundled core tools, and custom selections (plus legacy search seeds) — then probes each with bounded concurrency (default 6):

- **System discovery** (`discovery-registry.ts`): enumerates PATH/bin directories (bounded to 320 seeds / 64 children per dir) for known tool names per platform (`node.exe` on Windows, `python3`/`python` on POSIX, etc.), plus version managers and other candidate locations.
- **Probes** (`probes/capabilities.ts`): run `--version` and capability-specific checks. Bash/PowerShell verify an execution sentinel (`PI_TOOLCHAIN_BASH_OK`); Python runs a JSON payload probe and rejects unsupported or too-new minor versions (`TOOLCHAIN_UNSUPPORTED`/`TOOLCHAIN_UNVERIFIED`); ripgrep writes and greps a sentinel file; node/git/uv/npm check version output.
- **Normalization** (`candidate-normalizer.ts`): paths are normalized and de-duplicated via `toolPathComparisonKey` (realpath + platform casing); `redactToolPath` replaces absolute roots (`userData`, resources, home) with labels (`$APP_DATA`, `$APP_RESOURCES`, `~`) so the renderer never sees full absolute paths (`manager.ts:267`).
- The scan result is a `ToolchainSnapshot` with a monotonic `revision`, and `publicState` is built path-free (`public-state.ts:75`), selecting a default per capability honoring the user `preference` (`auto | system | bundled | managed | custom`).

## Per-project resolution

`resolveForProject(cwd, { trusted, intent })` (`manager.ts:602`) computes the commands for a specific project:

- `detectProjectTools` (`project-detector.ts:384`) walks up to 32 ancestor directories to find the project root (`.git` first, then markers like `package.json`, `pyproject.toml`, lockfiles), parses `engines.node`/`packageManager` from `package.json`, `requires-python` from `pyproject.toml`, `.nvmrc`/`.node-version`/`.python-version`, lockfile-inferred package manager, and a contained `.venv` (only used when the project is trusted; otherwise marked `python-environment-blocked`).
- Resolutions are cached by a key of `snapshot revision : workspaceHash : requirementsHash`, so repeated requests are cheap (`manager.ts:621`).
- Node resolution selects a healthy `js.node` satisfying the project's Node range and pairs it with a same-component npm/npx (or a legacy npm command for plugin installs) (`manager.ts:663`). Python resolution prefers the project's trusted `.venv` python, else a selected interpreter, and patches `UV_PYTHON` for uv/uvx (`manager.ts:695`).
- The result is a `ToolchainResolution` with `id`, `inventoryRevision`, `workspaceKey`, `requirementsHash`, per-capability `CommandDescriptor`s, and a human `summary`.

`CommandDescriptor` carries `executable`, `argvPrefix`, `binDir`, `pathEntries`, `shellPathEntries`, `componentId/root`, `version`, `cwdSemantics` (`native | msys | posix` — msys for Windows Git bash), `envPatch`, and `shellEnvPatch` (`shared/toolchains/types.ts:112`).

## ToolchainRuntime in the Agent Host

`toolchainRuntime` (`src/agent-host/toolchain-runtime.ts`) is the Host's consumer:

- `apply(snapshot)` stores the latest `ToolchainSnapshot` and clears cached resolutions when the revision changes; stale (older) snapshots are rejected (`toolchain-runtime.ts:161`).
- `prepare(cwd, intent, trusted)` fetches a resolution from Main (`toolchain.resolve` parent-RPC), refetches the snapshot if the resolution's inventory revision is stale, and caches per `cwd:intent:trusted:revision` (`toolchain-runtime.ts:197`).
- `createExecutionContext` builds two environment layers: `nativeEnv` (PATH prepended with descriptor bin dirs, env patches applied, `PI_DESKTOP_TOOLCHAIN_REVISION`/`RESOLUTION` injected) and `shellEnv` (native env + shell-only PATH entries and shell env patches, plus msys cwd semantics vars on Windows) (`toolchain-runtime.ts:220`).
- `exec`/`spawn` run the resolved executable with `windowsHide: true`, `shell: false`, and the native env; `requireFromContext` raises typed `ToolchainError`s (e.g. `TOOLCHAIN_NODE_REQUIRED`) when a capability is missing (`toolchain-runtime.ts:271`).
- **Bash integration**: `createToolchainBashOptions` (`toolchain-bash.ts:7`) feeds the resolved bash shell/exec operations and `shellEnv` into Pi's Bash tool, so the Agent's bash runs with the exact resolved environment and a `beforeExec` hook (e.g. browser bash guard).
- **Git integration**: `installToolchainGitRunner` (`toolchain-git.ts:20`) routes `shared/worktree.ts` git calls through the resolved `vcs.git` descriptor.
- Search (`toolchain-search.ts`) registers `search.rg`/`search.fd` tool definitions backed by the resolution.

## Preferences and custom tools

- Preferences per capability (`auto | system | bundled | managed | custom`) persist in the toolchain state store and are applied during selection (`manager.ts:171`).
- `registerCustomTool` (Main, invoked from a file picker after IPC validation) verifies the selected executable is a real absolute file that passes a healthy probe for the requested capability, then persists it as a `custom` seed and flips the preference to `custom` (`manager.ts:376`). The renderer never supplies absolute custom paths directly — the Main file picker is required (`TOOLCHAIN_INVALID_SELECTION` otherwise).

## Public state and redaction

The renderer receives only `PublicToolchainState` (path-free, redacted `pathLabel`s), `components` (managed component health), `caches` (bounded disk sizes), and `operations` (in-flight installs). `getPublicStateForProject` overlays a project-aware summary (`manager.ts:289`). Toolchain errors carry structured codes (`shared/toolchains/errors.ts`) that RPC serializes into `ToolchainError` shapes.

## Tests

- `manager.test.mjs`, `discovery-registry.test.mjs`, `candidate-normalizer.test.mjs`, `public-state.test.mjs`, `project-detector.test.mjs`, `probes/capabilities.test.mjs`, and `toolchain-bash.test.mjs`/`toolchain-git.test.mjs`/`toolchain-search.test.mjs` cover discovery, resolution, and runtime integration.
- `scripts/check-toolchain-contract.mjs` enforces the action/contract invariants in the verify pipeline.
