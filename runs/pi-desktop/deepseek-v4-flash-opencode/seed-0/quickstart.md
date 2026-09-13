---
type: guide
title: Quickstart
description: How to set up, run, build, test, and package Pi Agent Desktop from source, plus where its data lives and which developer tools it needs.
tags: [quickstart, development, build, test]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-436e0ba48b22bd7bf59403aa
    resource: repo://scripts/build.mjs
  - id: openwiki-source-7164859f3d7c069d9fda8e58
    resource: repo://scripts/dev.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-4d903eaf7a3b75c622fde541
    resource: repo://src/main/logger.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Quickstart

Pi Agent Desktop is a pure Electron desktop app that embeds the Pi Coding Agent. This guide covers source development. For end-user installers, see the README.

## Prerequisites

- **Node.js ≥ 22.19, < 23** (`package.json` `engines`), plus npm.
- A desktop session for Electron. Linux CI uses Xvfb only where needed (Windows smoke runs without Xvfb — `desktop-workflow.test.mjs` asserts this).

## Install and run in dev

```bash
npm ci
npm run dev
```

`npm run dev` → `scripts/dev.mjs`:

1. Runs an initial `scripts/build-main.mjs` (tsup bundle of main/preload/host).
2. Starts `tsup --watch` and Vite (`http://localhost:5173`), waiting for Vite to become ready.
3. Starts Electron with `VITE_DEV_SERVER_URL=http://localhost:5173` and `ELECTRON_DISABLE_SECURITY_WARNINGS=1` (`scripts/dev.mjs:85`).

The main window loads `http://localhost:5173` while `VITE_DEV_SERVER_URL` is set; otherwise it loads the built renderer via `app://bundle/index.html` (`src/main/host-manager.ts:475`). Ctrl+C tears down the whole tree (`terminateProcessTree`).

## Build

```bash
npm run build        # scripts/build.mjs → tsup main/preload/host + vite renderer → out/
npm run build:main   # tsup only (main/preload/host)
npm run build:renderer
```

On Windows x64, `build` first builds the native managed-process helper (`scripts/build-windows-managed-helper.mjs`).

## Test and quality gates

```bash
npm test                                    # node --test over src/**/*.test.mjs
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/agent-host/handlers.test.mjs   # one file
npm run check:contract                      # Api ⇄ Host handler coverage
npm run smoke                               # real Electron smoke (Host + window + MessagePort checks)
npm run test:browser-electron               # Main-owned browser service against real Chromium
npm run test:browser-agent-e2e              # full Agent + Browser tools E2E
npm run verify                              # the complete pre-merge gate
```

`npm run verify` runs (in order): format check → lint → typecheck → dependency contract → unit tests → managed-process workflows → managed-process flood → contract coverage → Pi 0.84 compat → toolchain contract → toolchain catalog → browser i18n → desktop security → build → production artifact isolation → smoke → browser-electron → browser-agent-e2e (`scripts/verify.mjs:21`). Run it before committing; CI runs it in `.github/workflows/build-desktop.yml`.

## Package

```bash
npm run pack          # scripts/package-desktop.mjs --dir   → unpacked app in dist/
npm run dist          # --release → installers for the current platform/arch
npm run dist:mac:signed / dist:mac:notarized
```

Every package run first executes `prepare-bundled-tools` (builds bundled ripgrep/fd into `build/toolchains/core`) and then `verify`; release mode also validates Windows helper reproducibility and SBOMs (`scripts/package-desktop.mjs:16`). Targets: macOS DMG+ZIP (arm64/x64), Windows NSIS (x64), Linux AppImage (x64) — see `electron-builder.yml`.

## Where data lives

- **`~/.pi/agent/`** — sessions (`sessions/*.jsonl`), `models.json` (provider config), and Pi CLI-shared data (`src/agent-host/session-reader.ts:20`). Reusing CLI data requires no migration.
- **Electron `userData`** — desktop-owned state: `ui-state.json` (window/theme/settings), `channels.json`/`channels.state.json`/`channel-media/`, `channels.secrets.json` (encrypted channel credentials), `toolchains/` (managed runtimes/caches), `managed-process-reaper/journal-v2.json`, `browser-*.json` (settings, grants, profiles, tabs, header rules, secrets, snippets), `browser-network-bodies/`, and `logs/main.log`.

In dev, `PI_DESKTOP_USER_DATA` is set to Electron's `userData` and injected into the Host at spawn (`src/main/host-manager.ts:227`); the Host falls back to `~/.pi/desktop` when unset (`src/agent-host/channels/channel-manager.ts:61`).

## Developer toolchain notes

On startup the app discovers existing Node/npm/Python/uv/Git/Bash/Bun/jq from the system and bundled `rg`/`fd`; it can install private managed runtimes (Node LTS, CPython, uv, PortableGit, Bun, jq) into `userData/toolchains` on user confirmation, without touching system PATH. For most agent work you do not need a separate Pi CLI install — the bundled Pi Coding Agent 0.84.0 is embedded (`package.json`).

## Useful scripts

| Command | What it does |
| --- | --- |
| `npm run check:pi-compat` | Validates compatibility with the pinned Pi 0.84.0 |
| `npm run check:desktop-security` | Static security-invariant checks |
| `npm run check:production-artifacts` | Verifies packaged `files`/`extraResources` isolation |
| `npm run test:managed-process-workflows` / `flood` / `frameworks` | Managed-process lifecycle/stress/framework acceptance |
| `npm run test:windows-managed-helper` | Windows x64 Rust helper + Job Object acceptance |
| `npm run bench:sessions` | Session performance benchmarks |

## Start debugging

- Logs: `logs/main.log` in Electron `userData` (rotating, 5 MiB × 3), with Host output under `[host:out]`/`[host:err]` prefixes.
- Diagnostics: menu → Export diagnostics writes a redacted bundle (`system.json`, logs, toolchain/browser summaries, crash-dump metadata).
- See the Focused Change Guides for Host-crash debugging and the Testing & Quality Gates page for test infrastructure.
