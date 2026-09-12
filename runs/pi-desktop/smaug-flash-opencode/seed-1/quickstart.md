---
type: guide
title: Quickstart
description: Set up a local development environment, run Pi Agent Desktop with npm run dev, build and package for each platform, run the full verify gate, and navigate the wiki.
tags: [quickstart, setup, build, packaging, verify]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-436e0ba48b22bd7bf59403aa
    resource: repo://scripts/build.mjs
  - id: openwiki-source-7164859f3d7c069d9fda8e58
    resource: repo://scripts/dev.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a59d9de748e23f484194769a
    resource: repo://src/agent-host/session-reader.ts
  - id: openwiki-source-910e879cd3b0e278b2b0eccd
    resource: repo://src/preload/preload-location-policy.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---

# Quickstart

This page gets you from a fresh checkout to a running (or packaged) Pi Agent
Desktop, and points to the deeper architecture and ops pages.

## Prerequisites

- **Node.js 22.19 or newer** (must be `< 23` per `package.json` `engines`).
- **npm** (bundled with Node).
- A desktop OS — macOS, Windows, or Linux.

## Local development

```bash
git clone https://github.com/DLYZZT/pi-desktop.git
cd pi-desktop
npm ci
npm run dev
```

`npm run dev` (`scripts/dev.mjs`) orchestrates the multi-process dev loop:

1. Builds main/preload/Host once (`scripts/build-main.mjs`).
2. Starts a **tsup watch** for the main/preload/host sources (rebuild on change).
3. Starts **Vite** for the renderer (`http://localhost:5173`).
4. Waits for Vite to be ready (30s timeout), then launches Electron with
   `VITE_DEV_SERVER_URL=http://localhost:5173` and `ELECTRON_DISABLE_SECURITY_WARNINGS=1`.

Terminating the dev script tears down the whole process tree. Note the dev
renderer loads from `http://localhost:5173`; the preload only trusts `app://bundle`
or the Vite dev origin (see Change Guide).

## Where data lives

- Agent sessions, `models.json`, and Pi config: **`~/.pi/agent/`** (shared with
  the Pi CLI; no migration needed).
- App-owned state (ui-state, credential vault, browser stores, toolchain state,
  managed-process reaper journal): Electron `userData`.
- Main log: `<logs>/main.log`.

See the Persistence page for the full map.

## Running focused commands

| Command | Purpose |
| ------- | ------- |
| `npm run typecheck` | TypeScript typecheck (main/host + renderer) |
| `npm run test` | Node unit tests (GPU-free) |
| `npm run check:contract` | Api↔handler coverage |
| `npm run smoke` | Electron smoke test |
| `npm run test:browser-electron` | Browser Electron integration |
| `npm run test:managed-process-workflows` | Managed-process lifecycle/cleanup |
| `npm run verify` | Full pre-commit quality gate |
| `npm run build` | Build main/preload/renderer into `out/` |
| `npm run pack` | Unpacked app directory |
| `npm run dist` | Current platform installers |
| `npm run dist:mac:signed` / `dist:mac:notarized` | Signed / notarized macOS packages |

## Build and packaging

`npm run build` (`scripts/build.mjs`) builds the Windows managed-process helper
(on win32-x64), bundles main/preload/host, then runs Vite for the renderer,
producing `out/`.

`electron-builder.yml` defines the packaging targets:

- **macOS**: DMG + ZIP for arm64 and x64 (hardened runtime).
- **Windows**: NSIS x64 installer (unsigned `-Beta-` artifact until Authenticode).
- **Linux**: x64 AppImage (Chromium sandbox kept on).

`scripts/package-desktop.mjs` powers `--dir` (unpacked) and `--release`
(installers). The Windows helper and SBOM reproducibility checks and production
artifact checks are part of the release gate.

## The verify gate

`npm run verify` (`scripts/verify.mjs`) blocks `pack`/`dist`. It runs in order:
format check → lint → typecheck (main/host) → typecheck (renderer) → dependency
contract → unit tests → managed-process workflows → 60s flood → contract
coverage → Pi 0.84 compat → toolchain contract → toolchain catalog → browser
i18n → desktop security → build → production-artifact isolation → Electron
smoke → Browser Electron integration → Browser real Agent E2E.

Run it before opening a PR or cutting a release (README requires it for
contributions).

## First app run / configuration

On first launch the app reads `~/.pi/agent/`; if you already use Pi CLI, sessions
and config carry over. To use the agent you must configure a model provider
(Settings). Skills/Plugins/developer tools can be installed through the
corresponding panels; the app prefers healthy system dev tools and can install
app-private runtimes on consent (Developer Tools panel).

## Where to go next

- **Architecture Overview** — the three-process model and MessagePort contract.
- **Agent Host Supervision and Resilience** — crash recovery and restarts.
- **Agent Sessions and Project Workflows** — how sessions/projects are managed.
- **Main updates** — the update pipeline and packaging details.
- **Testing and Quality Gates** — how the suite and verify work.
