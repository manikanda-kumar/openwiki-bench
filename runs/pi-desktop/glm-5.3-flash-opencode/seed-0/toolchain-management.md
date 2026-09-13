---
type: concept
title: Toolchain Management
description: How Pi Desktop discovers and verifies user toolchains, installs managed runtimes into app-private directories with integrity checks, ships bundled ripgrep/fd, and pushes revisioned snapshots to the Agent Host.
tags: [toolchains, discovery, probes, installer, bundled-tools, ripgrep, catalog]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-5298dc7f2807e154f7134bd1
    resource: repo://src/agent-host/npx.ts
  - id: openwiki-source-360ffc38dffabfeada5f18b8
    resource: repo://src/agent-host/toolchain-bash.ts
  - id: openwiki-source-e989b9d0d6b08a1c61d9c4ea
    resource: repo://src/agent-host/toolchain-git.ts
  - id: openwiki-source-99cd7b1a9f3c3249496f8cb8
    resource: repo://src/agent-host/toolchain-runtime.test.mjs
  - id: openwiki-source-c27c91e8b62cd93458de8ff2
    resource: repo://src/agent-host/toolchain-runtime.ts
  - id: openwiki-source-7a262332795bc36b572e0709
    resource: repo://src/agent-host/toolchain-search.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-e1d807323c79c1ae433127dd
    resource: repo://src/main/toolchains/bundled-core.ts
  - id: openwiki-source-90450bfbf94561ccf8e167bf
    resource: repo://src/main/toolchains/catalog.ts
  - id: openwiki-source-a3b5ae1eaa88f9d035b39271
    resource: repo://src/main/toolchains/discovery-registry.test.mjs
  - id: openwiki-source-81d6b731631ad3bc41db3616
    resource: repo://src/main/toolchains/downloader.ts
  - id: openwiki-source-6521d05b61e98b69de17600c
    resource: repo://src/main/toolchains/electron-runtime-fetch.ts
  - id: openwiki-source-96bf7a7d2ba060a8b68ea158
    resource: repo://src/main/toolchains/installer.test.mjs
  - id: openwiki-source-41b523288256cc10e48366da
    resource: repo://src/main/toolchains/installer.ts
  - id: openwiki-source-6c40097c76737ea2dda44e6f
    resource: repo://src/main/toolchains/manager.test.mjs
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-e8a73aae9225973c81043759
    resource: repo://src/main/toolchains/paths.ts
  - id: openwiki-source-023cc457b63a4be16795adbe
    resource: repo://src/main/toolchains/probes/capabilities.ts
  - id: openwiki-source-d9f47b20cc65b48f94ec8bf0
    resource: repo://src/main/toolchains/project-detector.ts
  - id: openwiki-source-1b0d8c928326258c01622cf6
    resource: repo://src/main/toolchains/runtime-manifest.ts
  - id: openwiki-source-25981a88302c55090adb3971
    resource: repo://src/main/toolchains/secure-extractor.ts
  - id: openwiki-source-96f1fd623d9536d818535d5d
    resource: repo://src/main/toolchains/shims.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Toolchain Management

The app needs Node.js/npm, Python/uv, Git/Bash, Bun, and jq to run Skills, Plugins, Agent Bash, Git operations, and search. It first discovers and verifies what the user already has (covering GUI launches where PATH is incomplete), and can install managed runtimes into the app's private directory after explicit user confirmation — never modifying system PATH, shell configuration, or the registry (README.md, 跨平台开发工具管理).

## Discovery and probing

`ToolchainManager` (Main) collects executable seeds from four ordered sources: user-selected custom tools (rank 0), system discovery (PATH plus known install locations like bun-home, fnm, mise shims, scoop, and Windows registry-style directories), bundled ripgrep/fd from app resources, and previously installed managed runtimes (src/main/toolchains/manager.ts:821-838). `DiscoveryRegistry` caps the seed set (64 per capability in tests) and handles platform-specific layouts (src/main/toolchains/discovery-registry.test.mjs:86-225). Every seed is probed concurrently (default concurrency 6) — most capabilities by running `--version` and parsing the output, ripgrep/fd via functional probe files (src/main/toolchains/probes/capabilities.ts:67-222; src/main/toolchains/manager.ts:56, 839-852). Results are normalized, deduplicated by realpath, and folded into a `ToolchainSnapshot` with a monotonically increasing revision, default command descriptors per capability, and a redacted public state (`$APP_DATA`, `$APP_RESOURCES`, `~` path labels so absolute paths never reach the Renderer) (src/main/toolchains/manager.ts:853-903, 267-271).

## Snapshot/ack protocol with the Host

Main pushes the snapshot to the Agent Host as `toolchain:init` on (re)connect and `toolchain:changed` on updates; the Host applies it via `toolchainRuntime` and acknowledges by revision (`toolchain:ack`) (src/main/host-manager.ts:270, 282-287; src/agent-host/index.ts:76-85). Acknowledgements are not transferable between Host instances — a replacement Host must acknowledge both policy snapshots itself (src/main/host-manager.ts:211-216). The Host-side `ToolchainRuntime` resolves per-project execution contexts by intent (`project-command`, `skill-install`, `plugin-install`, `managed-process`), keeping trusted and untrusted project resolutions in separate caches, and exposes capability lookups (`requireFromContext`) for bash, git, npx, and search (src/agent-host/toolchain-runtime.ts:18-49; src/agent-host/toolchain-runtime.test.mjs:105-154).

## Bundled ripgrep/fd

The installer packages manifest-verified ripgrep and fd per target platform so basic search works offline. `bundled-core.ts` validates a manifest (schema version, catalog revision, platform/arch, per-tool sha256/bytes, optional macOS code-directory digest, license entries with sources) and only yields seeds whose on-disk bytes hash-match the manifest (src/main/toolchains/bundled-core.ts:10-60, 105-227). Desktop grep/find tools consume the resolved `search.rg`/`search.fd` descriptors with `allowUpstreamDownload: false` — no dynamic upstream download at runtime (src/agent-host/toolchain-search.ts:20-46; scripts/check-desktop-security.mjs:359-366).

## Managed installation

`ManagedComponentInstaller` installs components from the runtime catalog (`build/toolchains/runtime-catalog.json` in dev, `<resources>/toolchains/runtime-catalog.json` packaged) into `<userData>/toolchains` (src/main/toolchains/paths.ts:20-30; src/main/toolchains/catalog.ts:18-26). The install pipeline:

1. Acquires a per-component lock; reuses a cached artifact if its sha256 and byte size match the catalog variant (src/main/toolchains/installer.ts:172-213).
2. Downloads to a `.partial` file via Electron networking with synchronous, allowlisted redirect checks (GitHub release asset hosts only, GET-only, bounded redirect count) and verifies the hash before renaming (src/main/toolchains/downloader.ts:36-121; src/main/toolchains/electron-runtime-fetch.ts:73-125).
3. Extracts with `extractRuntimeArchive` (path-normalized entries, link validation, byte budget) or the PortableGit SFX extractor (src/main/toolchains/installer.ts:216-229; src/main/toolchains/secure-extractor.ts:12-28).
4. Probes the staged runtime before atomically activating it via directory rename, writes a runtime manifest with per-file sha256, and preserves the previous same-version runtime until the new state is durable (src/main/toolchains/installer.test.mjs:197-232; src/main/toolchains/runtime-manifest.ts:97-138; scripts/check-desktop-security.mjs:404-411).
5. Startup recovery removes partial downloads and restores interrupted renames; removal is refused while runtimes are in use, and installs support cancellation (`TOOLCHAIN_CANCELLED`) (src/main/toolchains/installer.ts:367-373; src/main/toolchains/installer.test.mjs:558; scripts/check-desktop-security.mjs:412-419).

Python shims (`python`/`python3` wrappers, `0700`/`0600` on Windows) are written with a tamper-detecting manifest (src/main/toolchains/shims.ts:76-87).

## Project tool detection

`detectProjectTools` reads `.nvmrc`, `.python-version`, `pyproject.toml`, `uv.lock`, `requirements-dev.txt`, and `package.json` engines to derive per-project version requirements; `nodeVersionSatisfies`/`pythonVersionSatisfies` match candidates against them so a project can pin a specific managed or system tool (src/main/toolchains/project-detector.ts:284-384). Custom tools registered by the user (`registerCustomTool`) persist in the toolchain state store and take rank 0 (src/main/toolchains/manager.ts:376, 821-837).

## How the Agent consumes capabilities

- **Bash**: `createToolchainBashOptions` builds Bash tool options from one immutable project resolution, with a spawn hook that sanitizes the environment (src/agent-host/toolchain-bash.ts:7-42).
- **Git**: `installToolchainGitRunner` installs the resolved git at Host startup and is restored on shutdown (src/agent-host/index.ts:20; src/agent-host/toolchain-git.ts:20).
- **Search**: grep/find tools use the context's rg/fd executables with a 2 MiB output limit and result caps (src/agent-host/toolchain-search.ts:16-46).
- **npx**: skill/plugin installs use the resolved Node + npx pair with `ELECTRON_RUN_AS_NODE` isolation (src/agent-host/npx.ts:73-99).

## Representative tests

- src/main/toolchains/manager.test.mjs — discovery, preferences, custom tools, removal protection
- src/main/toolchains/installer.test.mjs — atomic activation, recovery, cancellation, in-use protection
- src/main/toolchains/downloader.test.mjs and electron-runtime-fetch.test.mjs — redirect allowlisting and hash verification
- src/main/toolchains/bundled-core.test.mjs — manifest verification and seed generation
- src/agent-host/toolchain-runtime.test.mjs — per-intent resolution and environment isolation
