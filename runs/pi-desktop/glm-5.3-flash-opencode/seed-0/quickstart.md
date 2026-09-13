---
type: overview
title: Quickstart
description: What Pi Agent Desktop is, how to run it from source, what each src/ directory does, and where to read next in this wiki.
tags: [quickstart, dev-setup, architecture-map, electron]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-436e0ba48b22bd7bf59403aa
    resource: repo://scripts/build.mjs
  - id: openwiki-source-ceec8285580ad24a28bd3d14
    resource: repo://scripts/check-dependency-contract.mjs
  - id: openwiki-source-7164859f3d7c069d9fda8e58
    resource: repo://scripts/dev.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Quickstart

Pi Agent Desktop is a local-first, cross-platform Electron desktop workbench for the Pi coding agent. It embeds `@earendil-works/pi-coding-agent` 0.84.0, shares session and configuration data with the Pi CLI under `~/.pi/agent/`, and runs no internal server for its UI or control plane — user-started managed project services may listen on loopback only (package.json; README.md, 架构设计).

## Environment

- Node.js 22.19 or higher (bounded to Node 22 by the dependency contract: `engines: ">=22.19.0 <23"`)
- npm (ships with Node)
- macOS, Windows, or Linux

End users do not need Node/npm to use the Agent itself — the packaged app embeds the Pi runtime and bundled ripgrep/fd (README.md, 快速开始).

## Run from source

```bash
git clone https://github.com/DLYZZT/pi-desktop.git
cd pi-desktop
npm ci
npm run dev
```

`npm run dev` (scripts/dev.mjs) orchestrates three things: a Vite dev server for the Renderer on `http://localhost:5173` (readiness-polled for up to 30 seconds), tsup watch builds for main/preload/Host, and Electron itself (scripts/dev.mjs:2-33). In development the main window may navigate to the Vite URL; in production it loads `app://bundle/index.html` from the custom protocol (src/main/host-manager.ts:475-490).

## Build and package

```bash
npm run build    # main (tsup) + renderer (vite) → out/
npm run pack     # unpackaged app directory (--dir)
npm run dist     # installers for the current platform (--release)
npm run verify   # the full quality gate that blocks pack/dist
```

On Windows x64, `npm run build` also compiles the Rust managed-process helper first (scripts/build.mjs:14-18). Packaging always runs `npm run verify` before electron-builder (scripts/package-desktop.mjs:16-49).

## Where code runs

| Directory | Process | Role |
| --- | --- | --- |
| `src/main/` | Electron Main | Window lifecycle, tray, protocol, updates, Host supervision, browser service, toolchain manager, crash reaper |
| `src/agent-host/` | Agent Host (`utilityProcess`) | Pi agent sessions, files, config, channels, managed processes, extensions |
| `src/renderer/` | Renderer (sandboxed) | React 19 UI; talks only via the preload bridge and typed RPC |
| `src/preload/` | Preload | Exposes the single `window.piBridge` bridge |
| `src/contract/` | Shared | Typed Api/Streams/RPC protocol used by both sides |
| `src/shared/` | Shared | Pure, testable modules (policy, types, worktree, markdown) |
| `src/smoke/` | Test harnesses | Electron smoke and Browser E2E entry points |
| `native/windows-managed-process-helper/` | Windows helper binary | Rust Job Object containment source |

## Reading map

- **Architecture**: [Architecture Overview and Host Supervision](/openwiki/architecture-overview.md), [Typed RPC Contract](/openwiki/rpc-contract.md), [Security Model](/openwiki/security-model.md), [Data and Persistence](/openwiki/data-and-persistence.md)
- **Workflows**: [Agent Sessions and the Pi Runtime](/openwiki/agent-sessions.md), [Managed Processes](/openwiki/managed-processes.md), [Embedded Browser](/openwiki/agent-browser.md), [Message Channels](/openwiki/message-channels.md)
- **Operations**: [Toolchain Management](/openwiki/toolchain-management.md), [Models, Skills, and Plugins](/openwiki/models-skills-plugins.md), [Updates and Packaging](/openwiki/updates-and-packaging.md), [Testing and Quality Gates](/openwiki/testing-and-quality-gates.md)
- **Changing the code**: [Change Guides](/openwiki/change-guides.md)

## First checks after a change

```bash
npm run typecheck   # both tsconfig projects
npm run test        # unit tests
npm run check:contract
npm run verify      # everything, required before packaging
```
