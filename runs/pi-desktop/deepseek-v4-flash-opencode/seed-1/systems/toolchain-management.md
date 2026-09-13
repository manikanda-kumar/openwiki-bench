---
type: "Reference"
title: "Toolchain Management"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-eece3a9ce8c2d186c3eea7df
    resource: repo://src/agent-host/tool-environment.ts
  - id: openwiki-source-c27c91e8b62cd93458de8ff2
    resource: repo://src/agent-host/toolchain-runtime.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-e1d807323c79c1ae433127dd
    resource: repo://src/main/toolchains/bundled-core.ts
  - id: openwiki-source-90450bfbf94561ccf8e167bf
    resource: repo://src/main/toolchains/catalog.ts
  - id: openwiki-source-c7c746634e2604a41fd48d02
    resource: repo://src/main/toolchains/discovery-registry.ts
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-e8a73aae9225973c81043759
    resource: repo://src/main/toolchains/paths.ts
  - id: openwiki-source-b83aef15ac62539524c6b69f
    resource: repo://src/shared/toolchains/types.ts
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---


# Toolchain Management

Pi Agent Desktop discovers, verifies, and manages the developer tools used by the agent, the desktop itself, skills/plugins, and managed processes: `shell.bash`/PowerShell, `git`, Node.js/npm/npx, Python/uv/uvx, `rg`/`fd`, `jq`, `curl`, and Bun. Toolchain ownership lives in Electron Main (`ToolchainManager`), and the Agent Host receives revisioned snapshots to build execution environments without ever scanning PATH itself.

## Snapshot and revision flow

- `ToolchainManager.initialize` runs crash-residue recovery and startup version pruning, then calls `rescan` (`src/main/toolchains/manager.ts:275-279`).
- `performScan` (`manager.ts:792-...`) collects four seed families in parallel — system seeds from the discovery registry, managed seeds from installed state + catalog, bundled core seeds from packaged resources, and persisted custom seeds — probes them (concurrency 6), normalizes/deduplicates candidates, and builds a revisioned `ToolchainSnapshot` (`candidates`, `defaults`, `publicState`).
- Every scan notifies subscribers; Main forwards the snapshot to the Host (`toolchain:init` / `toolchain:changed`) and the Host acknowledges it with its revision (`src/main/host-manager.ts:87-92`, `host-manager.ts:418-425`, `src/agent-host/index.ts:76-86`). The Host rejects snapshots whose revision regresses, and caches resolutions per request key (`src/agent-host/toolchain-runtime.ts:161-212`).

## Discovery

- `DiscoveryRegistry` (`src/main/toolchains/discovery-registry.ts:84-112`) maps capability → candidate executable names per platform (`node`, `node.exe`, `python3`, `python`, `pwsh`, `git`, `uv`, `rg`, `fd`, `jq`, `curl`, …), scanning PATH, home-directory bins, and version-manager layouts with bounded enumeration (max 320 seeds, 64 children per directory).
- Each seed is probed by `probeExecutableSeed` (`probes/capabilities.ts`) with version detection; results carry a `ToolHealth` (`healthy`/`missing`/`incomplete`/`unsupported`/`unverified`/`broken`/`modified`/`blocked-by-trust`) and reason codes (`shared/toolchains/types.ts:54-63`).
- Windows GUI launches commonly have incomplete PATHs; the registry adds the standard shell/profile locations so tools are found even when launched from a Finder/Explorer context.

## Bundled core tools

- The installer ships target-platform `ripgrep` and `fd` binaries plus signed runtime/core catalogs as extra resources (`electron-builder.yml:100-110`). `bundledSeedsFromResources` verifies each binary against a manifest (SHA-256, and a macOS code digest) before offering it as a candidate (`src/main/toolchains/bundled-core.ts:38-...`, `scripts/prepare-bundled-tools.mjs`).
- Packaged-startup validation requires healthy bundled `search.rg` and `search.fd` candidates before the app reports a clean startup (`src/main/main.ts:117-120`).

## Managed components

- The runtime catalog (`runtime-catalog.json`, max 2 MiB) declares components — `node-lts`, `cpython`, `uv`, `portable-git`, `ripgrep`, `fd`, `jq`, `bun` — with per-platform/arch variants (`src/main/toolchains/catalog.ts:11-48`). Catalog/checksum mismatches become `TOOLCHAIN_INVALID_CATALOG`.
- `ManagedComponentInstaller` downloads via Electron networking (`net.request` with synchronous redirect allowlisting), verifies SHA-256, extracts with a secure extractor, probes the result, and activates it. Activation preserves the previous same-version runtime until the new state is durable, and interrupted operations, partial downloads, and previous runtime directories are recovered on startup (`manager.ts:275-279`, installer recovery paths, `check-desktop-security.mjs:404-420`).
- Installs are cancellable, removal is blocked while the runtime is in use (`isRuntimeInUse`), and managed runtimes are versioned per `platform-arch` under `userData/toolchains/runtimes/<component>/<version>/<platform>-<arch>` with strict version/arch validation (`src/main/toolchains/paths.ts:48-64`).
- Downloads and destructive operations keep consent in Main (`ipc.ts` confirmation dialogs), and future-state files written by a newer app version remain read-only to prevent rollback from overwriting runtime ownership (`check-desktop-security.mjs:430-436`).

## Per-project resolution

`resolveForProject` (`manager.ts:602-636`) validates the cwd (absolute, bounded, no control chars), runs `detectProjectTools` (Node range, package manager, Python request/environment, trust), hashes a `workspaceKey` and `requirementsHash`, and consults a cache keyed by `snapshot.revision:workspaceKey:requirementsHash`. Resolution:

- starts from the snapshot defaults (`resolveCommands`, `manager.ts:638-661`);
- selects Node candidates whose version satisfies the project range and pairs npm/npx with the same component; for `plugin-install` it may substitute a verified legacy npm command (`manager.ts:663-693`);
- prefers a **trusted project virtualenv** for Python when inside the environment and version-compatible, otherwise the best system/managed/bundled candidate; sets `VIRTUAL_ENV`, `UV_PYTHON`, and Python shim PATH entries (`manager.ts:695-772`).

The renderer's per-project state (`getPublicStateForProject`) resolves the project and annotates capabilities with the actual chosen executable path (redacted) (`manager.ts:289-328`).

## Execution contexts on the Host

`ToolchainRuntime` (`src/agent-host/toolchain-runtime.ts:138-350`) builds a `ToolExecutionContext` from a snapshot + resolution:

- `nativeEnv` and `shellEnv` are constructed by prepending each capability's `binDir`/`pathEntries` and applying `envPatch`/`shellEnvPatch` in a fixed capability order; Windows msys shells receive workspace path translation (`toolchain-runtime.ts:220-268`);
- `require`/`requireFromContext` throw typed `ToolchainError`s with capability-specific codes when a capability is missing (`toolchain-runtime.ts:118-136`);
- `exec`/`execFromContext`/`spawn`/`spawnFromContext` run commands with the resolved executable and env; the base environment is sanitized so provider credentials and credential-bearing URLs never reach agent tools or managed processes (`src/agent-host/tool-environment.ts`, `check-desktop-security.mjs:234-241`).

## Preferences, custom tools, and caches

- Capability preferences (`auto`/`system`/`bundled`/`managed`/`custom`) and custom tools are persisted in `userData/toolchains/state.json` (with backup). `registerCustomTool` validates that the selected executable is an absolute file that probes healthy before persisting (`manager.ts:376-442`); renderer `choose-custom-tool` is intentionally routed through the Main file picker (`manager.ts:353-357`).
- Caches (`npm`, `uv`, `bun`, `downloads`) can be cleared from the UI; downloads always use the Electron `net` module so system proxy and OS trust settings apply (`src/main/main.ts:503-508`).

## Related pages

- [Agent Host Runtime](../architecture/agent-host-runtime.md)
- [Sessions and Project Files](./sessions-and-project-files.md)
- [Managed Background Processes](./managed-processes.md)
- [Security Model](../architecture/security-model.md)
