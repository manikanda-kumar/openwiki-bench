---
type: guide
title: Quickstart
description: Get started with Pi Agent Desktop — what it is, system requirements, installation, first run and model setup, running from source, and the key commands to develop and verify it.
tags: [quickstart, getting-started, setup, install]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T14:52:03.282Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-7164859f3d7c069d9fda8e58
    resource: repo://scripts/dev.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
generated: { by: "opencode", at: "2026-09-12T14:52:03.282Z" }
---

# Quickstart

Pi Agent Desktop is a local-first Electron desktop workbench for the Pi Coding Agent. It bundles Pi Coding Agent 0.84.0, has no internal HTTP server for its UI or control plane, and reuses the sessions and configuration already in `~/.pi/agent/` so it works alongside Pi CLI (`package.json:5`, `README.md:9`).

## System requirements

- **Installed app**: macOS 12+ (Apple Silicon `arm64` or Intel `x64`), Windows 10/11 64-bit (`x64`), or Linux 64-bit (`x64`) AppImage. There is no Windows 32-bit or Windows ARM64 build (`README.md:130-133`).
- **Source development**: Node.js 22.19.0 or higher (below 23) and npm (`package.json:10-12`).

Managed background processes are supported on macOS, Linux, and **Windows 11 x64** only; Windows ARM64, Windows Server, and 32-bit Windows are not supported (`README.md:72`).

## Install and first run

1. Download the latest stable installer for your platform from the [releases page](https://github.com/DLYZZT/pi-desktop/releases) (v0.1.14 at the time of writing).
2. Launch the app. It reads sessions and Pi configuration from `~/.pi/agent/`; if you already use Pi CLI, your data is reused without migration, and if you have not used Pi CLI there is nothing to migrate (`README.md:124`).
3. Configure a model provider (Settings → Models). The app discovers and validates your installed Node.js/npm, Python, `uv`, Git/Bash, `jq`, and Bun; bundled `rg`/`fd` keep offline search working (`README.md:126`).
4. Skills, Plugins, the built-in browser, managed background processes, and messaging channels (WeChat/Telegram/Feishu/Lark) are configured from the UI; agent browser automation, advanced browser mode, and managed processes all default to **off** (`README.md:57-72`, `README.md:193-195`).

## Run from source

```bash
git clone https://github.com/DLYZZT/pi-desktop.git
cd pi-desktop
npm ci
npm run dev
```

`npm run dev` builds the main/preload/host bundle, starts Vite on port 5173 and tsup watch, then launches Electron with `VITE_DEV_SERVER_URL=http://localhost:5173` (`scripts/dev.mjs:85-112`).

## Key commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev loop: build + watch + Vite + Electron (`scripts/dev.mjs`) |
| `npm run typecheck` | TypeScript type checks for main/host and renderer (`package.json:32`) |
| `npm test` | Unit tests via `node --test src/**/*.test.mjs` (`scripts/test-runner.mjs`) |
| `npm run check:contract` | Exact API/streams/bridge/IPC contract coverage (`scripts/check-contract-coverage.mjs`) |
| `npm run smoke` | Electron smoke test against a temp user data dir (`scripts/smoke-electron.mjs`) |
| `npm run test:browser-electron` | Built-in browser Electron integration tests |
| `npm run verify` | Full pre-commit/pre-pack quality gate (format → lint → typecheck → tests → checks → build → smoke) (`scripts/verify.mjs`) |
| `npm run build` | Build main, preload, host, and renderer into `out/` (`scripts/build.mjs`) |
| `npm run pack` | Unpackaged app directory (`electron-builder --dir`) (`scripts/package-desktop.mjs`) |
| `npm run dist` | Release installers for the current platform (`scripts/package-desktop.mjs`) |

Run `npm run verify` before committing or packaging — it is the single gate that blocks pack/dist (`scripts/verify.mjs:2-44`, `scripts/package-desktop.mjs:26-31`).

## Data, security, and privacy

- Sessions and Pi configuration stay in `~/.pi/agent/`; no local network port is opened for UI/control traffic (`README.md:187-189`).
- The renderer runs sandboxed with a strict CSP; the preload exposes only the typed `piBridge`; Host RPC is governed by the typed contract (see [Security Model](architecture/security-model.md)).
- Messaging channels use only outbound long polling / WebSocket — no webhooks or listeners (`README.md:196`).
- Model request data handling depends on your configured provider; check its privacy policy (`README.md:197`).

## Where to go next

- [Three-Process Architecture](architecture/three-process-architecture.md) — how Main, the Agent Host, and the Renderer fit together.
- [Agent Host Runtime](architecture/agent-host-runtime.md) — sessions, tools, model runtime, skills/plugins.
- [Sessions and Project Files](systems/sessions-and-project-files.md) — on-disk session storage and file access.
- [Builtin Browser](systems/builtin-browser.md) — the shared user/agent browser and its authorization flow.
- [Managed Background Processes](systems/managed-processes.md) — the `process_*` tools and lifecycle control.
- [Messaging Channels](systems/messaging-channels.md) — WeChat, Telegram, and Feishu/Lark integration.
- [Development and Verification Guide](guides/development-and-verification.md) — builds, tests, packaging, and CI.
