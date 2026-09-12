---
type: architecture
title: Toolchains & Developer Tools
description: How the desktop discovers, probes, selects, installs and supervises developer tools — the capability model, providers/preferences/health, managed components, profiles and caches, and the snapshot the Agent Host consumes.
tags: [architecture, toolchains, developer-tools, managed-runtime]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-c27c91e8b62cd93458de8ff2
    resource: repo://src/agent-host/toolchain-runtime.ts
  - id: openwiki-source-81d6b731631ad3bc41db3616
    resource: repo://src/main/toolchains/downloader.ts
  - id: openwiki-source-41b523288256cc10e48366da
    resource: repo://src/main/toolchains/installer.ts
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-553ef67aa5ebee1b0410e799
    resource: repo://src/main/toolchains/public-state.ts
  - id: openwiki-source-ce15c7c8427667ee9ad0582e
    resource: repo://src/shared/toolchains/catalog-schema.ts
  - id: openwiki-source-b83aef15ac62539524c6b69f
    resource: repo://src/shared/toolchains/types.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Toolchains & Developer Tools

Pi Agent Desktop lets users (and the agent) run coding tools without a preinstalled
toolchain by managing a set of software components (Node, Python, Git, uv, and
search utilities) itself. Everything is grounded in a capability model, a
signed runtime catalog, and a discovery/probe pipeline whose result is pushed to
the Agent Host as a `ToolchainSnapshot`.

## Capability model

`src/shared/toolchains/types.ts` defines the fixed capability set:
`shell.bash`, `shell.powershell`, `vcs.git`, `js.node`, `js.npm`, `js.npx`,
`js.bun`, `python.interpreter`, `python.uv`, `python.uvx`, `search.rg`,
`search.fd`, `data.jq`, `network.curl`. Capabilities are provided by one of
`project | custom | system | bundled | managed | legacy-upstream-managed`.
A user can set a per-capability `ToolPreference` of
`auto | system | bundled | managed | custom`. Every candidate carries a
`ToolHealth` from `healthy | missing | incomplete | unsupported | unverified |
broken | modified | blocked-by-trust`.

Toolchain errors are a closed set of codes (`TOOLCHAIN_*`) in the same file, and
`ToolchainError` (`src/shared/toolchains/errors.ts`) carries a `capability` and
`causeCode` that the RPC layer maps onto structured failures.

## Discovery, probing and selection

`ToolchainManager` (`src/main/toolchains/manager.ts`) is the main-process
owner. Its scan pipeline (`performScan`) collects `ExecutableSeed`s from
custom-selected tools, system `PATH` (`DiscoveryRegistry`, discovering
`git`, `node`, `bun`, `uv`, managers, etc.), bundled core tools
(`bundled-core.ts` for the signed small search binaries), managed runtimes
(`runtime-manifest.ts`), and legacy search seeds. It probes each seed with
`probeExecutableSeed` from `probes/capabilities.ts` (capability, version,
health), concurrency `probeConcurrency` (6), then `normalizeAndDedupeCandidates`
(Capability names are normalized, symlinks realpathed, and same-executable
candidates de-duplicated). `selectDefaultCandidates` and
`commandDescriptorFromCandidate` (`public-state.ts`) turn the winning candidates
into per-capability `CommandDescriptor`s and a `PublicToolchainState`; a
`ToolchainSnapshot` carries `{ revision, generatedAt, platform, arch,
candidates, defaults, publicState }`.

The snapshot is what the main process pushes to the Agent Host. It is surfaced
via `getPublicState` / `getPublicStateForProject` to the renderer's Developer
Tools panel and the workspace-focused toolchain views.

## Managed component catalogue

`src/shared/toolchains/catalog-schema.ts` is the schema (version 2) for the
bundled, signed `RuntimeCatalog`. Each `RuntimeCatalogComponent` carries
`ManagedComponentId`s and per-platform/arch `RuntimeCatalogVariant`s with
`url` (allow-list restricted), `sha256`, `downloadBytes`, `archive` format
(`zip | tar.gz | 7z-sfx | binary`), and an `installer`
(`safe-archive | single-binary | portable-git-sfx`). The app ships two signed
catalogs as extra resources (`build/toolchains/runtime-catalog.json` and
`core-catalog.json`) plus the current target's small `core` search tools; the
large Node/Python/Git archives download on user consent and are never shipped.

## Install / repair / remove lifecycle

The `ManagedComponentInstaller` (`src/main/toolchains/installer.ts`) installs
and repairs managed components through a phase machine
(`idle → queued → downloading → verifying → extracting → probing →
activating → ready | error | cancelled`). Downloads are hashed and compared
byte-for-byte against the catalog (`verifyDownloadedArtifact`), extraction uses
the app's `secure-extractor`, portable Git uses the SFX installer shim, and
each installed runtime writes a signed manifest (`writeRuntimeManifest`).
Installs are serialized and idempotent (a `--continue`-style partial resume
re-verifies the existing archive). Remove operations rename the component tree
into a staging `trashPath` before deleting, and refuse while an agent command
is running (`isRuntimeInUse`) or a matching install is active.

Persistent install state (`ToolchainStateStore` / `state-store.ts`) records
active and installed versions; at startup `pruneManagedVersionsAtStartup`
retains the active version plus the prior one. Profiles
(`javascript-essentials`, `python-essentials`, `windows-shell-essentials`,
`cli-essentials`) map to component sets (e.g. `node-lts`, `uv+cpython`,
`portable-git`, `jq`). Caches (`npm`, `uv`, `bun`, `downloads`) are enumerable
and clearable via `PublicToolchainCacheState`.

## The Agent Host consumption

`src/agent-host/toolchain-runtime.ts` is the Host-side reader of the pushed
`ToolchainSnapshot`. `apply` stores it (rejecting older revisions and clearing
cached resolutions when the revision changes). `prepare(cwd, intent, trusted)`
resolves a project-specific `ToolchainResolution` for an
`ExecutionIntent` (`agent-shell`, `managed-process`, `skill-install`,
`plugin-install`, `git-operation`, `python-script`, `project-command`), caching
by `cwd/intent/trusted/revision`. `createExecutionContext` assembles the actual
`ToolExecutionContext` — `nativeEnv`, `shellEnv`, per-capability
`CommandDescriptor`s (`envPatch`, `shellEnvPatch`, `cwdSemantics`), and the
`summary` — used to spawn bash/git/node/etc. The Host can also fetch the current
snapshot from main (`toolchain.getSnapshot`) and re-prepare if the revision it
sees is stale (`prepare` refetches when the resolution revision no longer
matches). `rpc-manager.ts` calls `createExecutionContext` when building agent
sessions and passes it to the Bash/search/Git tool definitions.

## Security and trust

`ExecutionContextRequest.trusted` is only honored from the app-owned Host; a
Renderer cannot request a trusted (project-untrusted) resolution. Toolchain
state paths are under the user-data dir, removes refuse while in use, and the
candidate-normalizer redacts tool paths in public state so absolute home paths
do not leak to the renderer or logs.
