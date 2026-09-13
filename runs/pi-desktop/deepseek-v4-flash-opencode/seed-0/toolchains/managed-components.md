---
type: concept
title: Managed Components and Bundled Tools
description: App-managed runtimes (Node LTS, CPython, uv, PortableGit, Bun, jq, ripgrep, fd) — the runtime catalog, the download/verify/extract/activate install pipeline, the state store, and the bundled core search tools shipped in app resources.
tags: [toolchains, managed-components, installer, catalog, bundled-tools]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-e1d807323c79c1ae433127dd
    resource: repo://src/main/toolchains/bundled-core.ts
  - id: openwiki-source-81d6b731631ad3bc41db3616
    resource: repo://src/main/toolchains/downloader.ts
  - id: openwiki-source-41b523288256cc10e48366da
    resource: repo://src/main/toolchains/installer.ts
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-e8a73aae9225973c81043759
    resource: repo://src/main/toolchains/paths.ts
  - id: openwiki-source-7cff10ac56e3e7919e9999fd
    resource: repo://src/main/toolchains/state-store.ts
  - id: openwiki-source-ce15c7c8427667ee9ad0582e
    resource: repo://src/shared/toolchains/catalog-schema.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Managed Components and Bundled Tools

Beyond discovering system tools, Pi Desktop can install and manage its own private runtimes (Node.js LTS, CPython, uv, PortableGit, Bun, jq, ripgrep, fd) into the application's userData directory. These are optional, user-confirmed, and never modify system PATH. Search (ripgrep/fd) additionally ships as verified bundled core tools inside the packaged app resources so basic offline search always works.

## Runtime catalog

`build/toolchains/runtime-catalog.json` (schema v2, `src/shared/toolchains/catalog-schema.ts`) describes each managed component:

- `id` (from `MANAGED_COMPONENT_IDS`), `version` (safe path segment, no placeholders), `provides` capabilities, license, and per-`platform`/`arch` `variants`.
- Each variant has an HTTPS `url` restricted to an allowlist per component (`isCatalogArtifactUrlAllowed`, e.g. `https://nodejs.org/dist/`, `github.com/git-for-windows/git/releases/download/`, `github.com/astral-sh/uv/releases/download/`), a 64-hex `sha256`, `downloadBytes`, an archive format (`zip | tar.gz | 7z-sfx | binary`), and an installer kind (`safe-archive | single-binary | portable-git-sfx`).
- The parser rejects placeholder/latest aliases, credentials in URLs, non-HTTPS, unsafe versions, mismatched installer/archive pairs, and duplicate component/version or platform/arch pairs (`catalog-schema.ts:99`). A second `core-catalog.json` describes the bundled core tools.

A signed copy of both catalogs ships as `extraResources` (`electron-builder.yml:105`), so a tampered app cannot redirect installs to arbitrary hosts.

## Install pipeline

`ManagedComponentInstaller.install` (`src/main/toolchains/installer.ts:172`) runs in stages, emitting `PublicToolchainOperation` progress:

1. **Lock**: an exclusive per-component lock file (`<componentId>.lock`, `O_EXCL`, records pid; stale locks from dead pids are removed) prevents concurrent installs (`installer.ts:70`).
2. **Download**: `downloadRuntimeArtifact` (`downloader.ts:127`) streams with a 10-minute timeout, manual redirects allowlisted to known hosts (max 5), a content-length pre-check, and streaming byte-count/sha256 verification against the catalog. Downloads are re-verified by `verifyDownloadedArtifact` (exact `downloadBytes` + `sha256`), so a cached valid artifact is reused.
3. **Verify/extract**: the artifact is extracted into a staging temp directory. `secure-extractor.ts` enforces a bounded max-extracted-bytes (download × 20, or ×40 for CPython, capped at 4 GiB), path-containment, and no symlink/path-escape escapes. `single-binary` copies the executable; `portable-git-sfx` runs the self-extracting archive through a hardened extraction path (`portable-git-installer.ts`).
4. **Probe**: entrypoints are discovered (`component-entrypoint.ts`, bounded BFS over names like `node.exe`/`python3.14`/`uv`), chmod 0o755 (non-Windows), then probed as managed seeds; every capability the component `provides` must come back healthy or the install fails (`installer.ts:239`).
5. **Activate**: a runtime manifest (`runtime-manifest.json`, schema v1) is written with component/version/platform/arch/catalogRevision/artifactSha256/entrypoints and key-file sha256s (`runtime-manifest.ts:97`), the staging root is renamed into `<runtimes>/<component>/<version>/<platform>-<arch>`, and the persistent state is updated. The previous root is kept as `<version>.previous-<uuid>` during the swap and rolled back on failure (`installer.ts:296`).

### Interrupted-operation recovery

`recoverInterruptedOperations` (run at toolchain initialization) cleans `.partial` downloads, removes locks whose pid is dead, prunes staging directories matching install/prune patterns, and restores or removes `*.previous-*` runtime directories (`installer.ts:367`). Version pruning at startup keeps only the active version plus one rollback (per-minor for CPython) (`manager.ts:548`, `retainedManagedVersions`).

## State store and paths

- `ToolchainStateStore` (`state-store.ts:123`) persists `state.json` (schema v2): per-capability `preferences`, `custom` absolute executable paths (never sent to the renderer), and per-component `managed` activation (`activeVersion`, `platformArch`, `installedVersions`). Writes are atomic with a `.bak`; a file written by a newer Pi Desktop (higher `schemaVersion`) puts the store in **compatibility read-only mode** (`state-store.ts:150`). Retired capability ids are ignored during migration.
- `createToolchainPaths` (`paths.ts:20`) lays out everything under `<userData>/toolchains`: `state.json(.bak)`, `locks/`, `downloads/`, `staging/`, `runtimes/`, `caches/{npm,uv,bun,downloads}`, `prefixes/{npm,uv-tools}`, `bin/`, `shims/`, `logs/`, `diagnostics/`.

## Bundled core search tools

`bundled-core.ts` ships `ripgrep` and `fd` in app resources under `toolchains/core/<platform>-<arch>`:

- `resolveBundledCorePaths` resolves `core-catalog.json` + `core/` from `resources/toolchains` (packaged) or `build/toolchains` (dev) (`bundled-core.ts:153`).
- `bundledSeedsFromResources` reads a per-target `manifests/core-tools.json`, validates it strictly (schema, catalog revision, platform/arch, per-tool version/artifactSha256 tying to the catalog, license files verified by sha256), and verifies each executable's sha256 (and, on macOS, the code digest of the signed executable) before registering seeds with provider `bundled` (`bundled-core.ts:167`).
- `legacyUpstreamSearchSeeds` reads read-only `rg`/`fd` from `~/.pi/agent/bin` if present (provider `legacy-upstream-managed`), so CLI-managed binaries remain usable (`bundled-core.ts:233`).
- The bundled tools are built by `scripts/prepare-bundled-tools.mjs` and gate packaging (verify-before-pack); `verify-packaged-toolchains.mjs` re-verifies them in the packaged app.

## Managed component env patches

When a managed component is selected, `applyDescriptorEnvironment` (`manager.ts:1001`) injects private cache/prefix env so installs stay inside the app: `npm_config_cache`/`npm_config_prefix` for Node, `UV_CACHE_DIR`/`UV_TOOL_DIR`/`UV_NO_MODIFY_PATH` for uv, `PIP_REQUIRE_VIRTUALENV` for CPython, `BUN_INSTALL_CACHE_DIR` for Bun, and PortableGit path/shell env entries.

## Tests

- `installer.test.mjs`, `downloader.test.mjs`, `secure-extractor.test.mjs`, `catalog.test.mjs`, `state-store.test.mjs`, `bundled-core.test.mjs`, `runtime-manifest.test.mjs`, `portable-git-installer.test.mjs`, and `component-entrypoint.test.mjs` cover the pipeline; `check-toolchain-catalog.mjs` and `verify-toolchain-catalog.mjs` validate the catalog and packaged tools in the verify pipeline.
