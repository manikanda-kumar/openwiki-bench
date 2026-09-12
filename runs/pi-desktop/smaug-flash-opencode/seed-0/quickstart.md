---
type: quickstart
title: Quickstart
description: Fast path to building, developing, testing, and packaging Pi Agent Desktop — prerequisites, install, the dev loop, the quality gate, and common maintenance workflows.
tags: [quickstart, getting-started, development]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:51:41.516Z
sources:
  - id: openwiki-source-7127464d1b43314cda019b2a
    resource: repo://electron-builder.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-436e0ba48b22bd7bf59403aa
    resource: repo://scripts/build.mjs
  - id: openwiki-source-271207ef17f47666f42ad1f9
    resource: repo://scripts/check-desktop-security.mjs
  - id: openwiki-source-7164859f3d7c069d9fda8e58
    resource: repo://scripts/dev.mjs
  - id: openwiki-source-c2b7d7c7c94aa4069644b5ad
    resource: repo://scripts/package-desktop.mjs
  - id: openwiki-source-fd9851c14c7cf4097732cc47
    resource: repo://scripts/test-runner.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-07e08ac8a9b42c5bb7d70cd6
    resource: repo://src/contract/desktop.ts
  - id: openwiki-source-7bae2eb4b8f21c53df9aad0d
    resource: repo://src/main/browser/browser-policy.ts
  - id: openwiki-source-c49210803211e2a08f8b3e5e
    resource: repo://src/main/toolchains/manager.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
  - id: openwiki-source-b83aef15ac62539524c6b69f
    resource: repo://src/shared/toolchains/types.ts
generated: { by: "opencode", at: "2026-09-12T21:51:41.516Z" }
---

# Quickstart

Pi Agent Desktop is a pure Electron app that hosts the `pi-coding-agent`. There
is **no internal HTTP server and no bundled Node server** — the next process
topology is an Electron main process, a sandboxed renderer behind a preload,
and a supervised Agent Host utilityProcess connected by `MessagePort`s. See
[Architecture & Process Model](/openwiki/architecture/process-model.md) for the
big picture.

## Prerequisites

- **Node.js** `>=22.19.0 <23` (pinned in `package.json` `engines`; CI uses
  Node 22).
- `npm` (the repo uses `npm ci`/`npm install`; the lockfile is
  `package-lock.json`).
- **Windows note**: building the managed-process **native Rust helper**
  requires a pinned Rust toolchain (`1.96.1` MSVC) — the CI installs it, but
  a local Windows build needs Rust + MSVC. On Windows the helper build is a
  normal part of `npm run build`.
- Building macOS signed artifacts additionally needs Apple signing/notarization
  credentials (not needed to develop or build `--dir`).

## Install dependencies

```sh
npm ci
```

`npm ci` installs the exact lockfile. The `prepare` script is `husky`, which
installs the pre-commit hook.

## Run the dev loop

```sh
npm run dev
```

`scripts/dev.mjs` starts a Vite dev server on `localhost:5173`, runs a `tsup
watch` loop that rebuilds the main, preload, and Agent Host bundles into `out/`,
then launches Electron. It tears down the whole process tree on exit. The
renderer connects to the Host through the transferred MessagePort; watch the
dev console for `agent-host ready`.

To iterate on one bundle without the interactive loop:

```sh
npm run build:main      # tsup main/preload/host
npm run build:renderer  # vite build renderer
```

## Lint, typecheck and unit tests

```sh
npm run lint            # ESLint --max-warnings=0
npm run typecheck       # tsc -p tsconfig.json + tsconfig.renderer.json
npm test                # node --test src/**/*.test.mjs
```

Unit tests use Node's built-in runner with a default 120 s per-test timeout
(`PI_TEST_TIMEOUT_MS` overrides). Targeted suites exist for managed processes
(`test:managed-process-*`), the Windows helper (`test:windows-managed-helper`),
and browser/electron flows (`test:browser-electron`, `test:browser-agent-e2e`).

## The release gate

```sh
npm run verify
```

`scripts/verify.mjs` is the single gate that blocks `pack`/`dist`: format →
lint → typecheck → dependency contract → unit tests → managed-process
workflows/flood → contract coverage → Pi 0.84 compat → toolchain contract/
catalog → browser i18n → desktop security → build → artifact isolation →
smoke / browser e2e. It exits on the first failure. See
[Build, Test & Release Tooling](/openwiki/operations/build-and-test.md).

## Build and package

```sh
npm run build           # helper (win32) + tsup main/preload/host + vite renderer → out/
npm run pack            # verify, prepare bundled tools, electron-builder --dir → dist/
npm run dist            # release: verify, signability checks, electron-builder (Windows = Unsigned-Beta)
```

Packaged artifacts land in `dist/`: `dmg`/`zip` (macOS), `nsis`
(Windows, named `Pi-Agent-Desktop-Unsigned-Beta-Setup-*` until Authenticode is
provisioned), and `AppImage` (Linux). Electron Builder ships the signed
toolchain catalogs and core search tools as `extraResources`.

## Common maintenance workflows

**Adding or fixing an RPC method.** The surface is typed in
`src/contract/api.ts` (request/response `Api` and server-push `Streams`).
Handlers go into `src/agent-host/handlers.ts` and are registered on the RPC
server; the renderer calls them through the facade in
`src/renderer/lib/api-client.ts`. Never let components touch `MessagePort`
directly.

**Changing toolchain behavior / a managed component.** The capability model,
health states, and error codes live in `src/shared/toolchains/types.ts`; the
scan pipeline is `src/main/toolchains/manager.ts`; install/repair lifecycle is
`src/main/toolchains/installer.ts`. The signed `RuntimeCatalog`
(`build/toolchains/*-catalog.json`) must be updated via
`npm run check:toolchain-catalog`/`prepare:bundled-tools` and the security and
contract checks must still pass.

**Adjusting the browser surface / agent authorization.** All browser policy,
permission, lease, and confirmation logic is in `src/main/browser/`; the
contract is `src/contract/browser.ts`; the renderer drives it via
`piBridge.browser*`. Coding permissions never imply browser rights — new
browser capabilities must route through `BrowserAuthorizationCoordinator`
and the `BrowserPolicyEngine` lease checks.

**Adding or adjusting a security invariant.** `scripts/check-desktop-security.mjs`
is the compile-time gate asserting the source invariants (sandbox, preload
policy, IPC trust, redaction, helper containment). Change it and the source
together, then run `npm run check:desktop-security` and `npm run verify`.

## Where to go next

- [Architecture & Process Model](/openwiki/architecture/process-model.md)
- [Agent Host & MessagePort RPC](/openwiki/architecture/agent-host-rpc.md)
- [Toolchains & Developer Tools](/openwiki/architecture/toolchains.md)
- [Build, Test & Release Tooling](/openwiki/operations/build-and-test.md)
