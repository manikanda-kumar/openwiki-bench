---
type: guide
title: Focused Change Guides
description: Step-by-step maintenance workflows for adding an Api method, adding a Browser tool, adding a toolchain component, adding a channel adapter, and debugging a Host crash.
tags: [guides, maintenance, change, debugging]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-443d436bf8959f95e46739f8
    resource: repo://src/agent-host/browser-tools.ts
  - id: openwiki-source-675f64abd9b8550ea33cde07
    resource: repo://src/agent-host/channels/adapter-registry.ts
  - id: openwiki-source-66df5ff9dbde17fb507df13d
    resource: repo://src/agent-host/channels/types.ts
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-4409b8bcec1076bcf5e8ef33
    resource: repo://src/main/diagnostics.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-51fbd3b8253de755f8410ca6
    resource: repo://src/main/toolchains/component-entrypoint.ts
  - id: openwiki-source-ce15c7c8427667ee9ad0582e
    resource: repo://src/shared/toolchains/catalog-schema.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Focused Change Guides

These guides show the concrete touchpoints for representative maintenance tasks. Each is grounded in the actual files and test suites; run `npm run verify` (or at least the specific check listed) before committing.

## Adding a new `Api` method end-to-end

The RPC contract is typed end-to-end. Adding a method touches exactly five places:

1. **Declare it in the contract** — add an entry to `Api` in `src/contract/api.ts` with `params` and `result` types (use existing `SessionInfo`-style types from `src/contract/types.ts` or `src/shared/api-types.ts`).
2. **Implement the handler** — in `src/agent-host/handlers.ts`, add the handler to the `server.handle({ ... })` object. Validate every input (absolute paths, lengths, no `\0\r\n`, enum membership) and throw `RpcError` with a stable code (`FORBIDDEN`, `BAD_REQUEST`, `CONFLICT`, `NOT_FOUND`).
3. **Add the renderer wrapper** — add a convenience wrapper in `src/renderer/lib/api-client.ts` that calls `call("your.method", ...)`.
4. **Cover it in tests** — add a case to the nearest `*.test.mjs` (e.g. `src/agent-host/handlers.test.mjs`) that invokes the handler with valid and invalid inputs and asserts both the success shape and the `RpcError` code.
5. **Verify contract coverage** — run `npm run check:contract`. `scripts/check-contract-coverage.mjs` parses `Api` with TypeScript and asserts every method has a Host handler, so an undeclared/undeclared handler fails CI.

Related surfaces if your method needs Main capabilities: add a `host-rpc` case to Main's request handler in `src/main/main.ts` (`src/main/main.ts:591`), or a `desktop:*` channel in `src/main/ipc.ts` guarded by `trustedHandle`/`trustedOn`.

## Adding a Browser tool

Browser agent tools live in `src/agent-host/browser-tools.ts` and dispatch to Main's `BrowserService` over `host-rpc`.

1. **Add the host method** — extend `BrowserHostRpc` in `src/contract/browser.ts` (params/result), and implement the method in `src/main/browser/browser-service.ts` `dispatchHostRequest` switch.
2. **Add the tool definition** — in `src/agent-host/browser-tools.ts`, add a `tool(name, description, Type.Object({...}), "browser.method")` entry (or a `defineTool` for custom rendering like `browser_inspect`). Declare its permission tier in `BROWSER_TOOL_PERMISSIONS` (`read`/`interact`/`advanced`).
3. **If it needs a permission tier** — extend `requiredPermissionForHostMethod` in `browser-tools.ts` and the rank table in `src/main/browser/browser-policy.ts`; advanced-only methods must be filtered out of `browserToolNamesForSnapshot` unless Advanced Browser Mode is on.
4. **Tests** — `src/main/browser/browser-*` tests (e.g. `browser-policy.test.mjs`, `browser-cdp-coordinator.test.mjs`) plus a `browser-renderer-contract.test.mjs` case for any renderer-facing surface.

## Adding a toolchain component

Managed runtimes (Node, Python, uv, Git, Bun, jq, rg, fd) install from the runtime catalog:

1. **Add the catalog entry** — edit `build/toolchains/runtime-catalog.json` with a component whose `id`/`version` is new, `provides` capabilities, license, and per-platform variants (url/sha256/downloadBytes/installer). The schema in `src/shared/toolchains/catalog-schema.ts` enforces https-only, allowlisted upstream prefixes, safe path segments, and matching installer/archive kinds — a bad catalog fails `npm run check:toolchain-catalog`.
2. **Register the id and entrypoints** — add the id to `MANAGED_COMPONENT_IDS` in `src/shared/toolchains/types.ts`, an entrypoint definition in `src/main/toolchains/component-entrypoint.ts` (names to search), and a capability map in `src/main/toolchains/runtime-manifest.ts` (`COMPONENT_ENTRYPOINT_CAPABILITIES`).
3. **Add a variant/installer path if needed** — `installer.ts` handles `safe-archive`, `single-binary`, and `portable-git-sfx`; a new installer kind needs `TOOLCHAIN_INSTALLERS` and extractor support plus tests (`src/main/toolchains/secure-extractor.test.mjs`).
4. **Verify** — `npm run check:toolchain-contract`, `npm run check:toolchain-catalog`, and the installer tests. The catalog is also re-verified by `scripts/verify-toolchain-catalog.mjs` in the verify pipeline.

## Adding a channel adapter

1. **Implement `ChannelAdapter`** — in `src/agent-host/channels/adapters/<channel>/adapter.ts`, implement the interface from `src/agent-host/channels/types.ts:110` (`start`, `send`, `probe`, plus optional `downloadInbound`, `beginTurn`, `setTyping`, and login methods).
2. **Register it** — add it to `AdapterRegistry` in `src/agent-host/channels/adapter-registry.ts`, and extend the `ChannelId` union in `src/shared/channel-types.ts` if the channel is new (this ripples into `channelDisplayName`, `secretKey` regex in `src/main/credential-vault.ts`, and the outbound-attachment MIME table).
3. **Add the secret key pattern** — `credential-vault.ts:10` only accepts `channel:(weixin|telegram|feishu):<id>`; extend the regex and the vault tests.
4. **Write adapter tests** — mirror `src/agent-host/channels/adapters/<existing>/adapter-runtime.test.mjs` and `api.test.mjs`, plus a `channel-manager.test.mjs` case for inbound routing.

## Debugging an Agent Host crash

The Host is a supervised `utilityProcess`; a crash triggers supervision, not silent death.

1. **Read the status transitions** — Main logs every `agent-host` lifecycle event to `main.log` (`<logs>/main.log`, `src/main/logger.ts:15`). Look for `agent-host ready`, `agent-host exit code=N`, `restarting agent-host (attempt X/2)`, and `restart budget exhausted`.
2. **Check the crash budget** — `HostManager` allows 2 restarts within 30 s (`src/main/host-manager.ts:17`); `crashed` status with detail `"...restart budget exhausted"` means repeated fast crashes. Host stdout/stderr are captured into the log with `[host:out]`/`[host:err]` prefixes (`src/main/host-manager.ts:244`).
3. **Export diagnostics** — in the UI use menu → "Export diagnostics" (or `desktop:export-diagnostics`). `src/main/diagnostics.ts:19` writes `system.json`, redacted `main.log` (≤ 5 MiB tail, path/secret redaction via `diagnostics-redaction.ts`), toolchain and browser summaries, and crash-dump **metadata only** (minidumps can hold credentials; raw dumps are intentionally not copied).
4. **For uncaught exceptions** — the Host logs the stack to Main (`uncaughtException`/`unhandledRejection` handlers exit the process deliberately so Main can restart it; `src/agent-host/index.ts:113`). Match the stack to the failing subsystem (session, channel, managed process) and reproduce with the relevant targeted test first.
5. **Reproduce in isolation** — `npm run smoke` runs the packaged-entry harness (`src/smoke/main.ts`) that boots Main + Host + window and runs `runSmokeHostChecks`; add a check there to reproduce a deterministic crash path.

## Verification commands

| Task | Minimum check |
| --- | --- |
| Api method | `npm run check:contract` + `npm run test` |
| Browser tool | `npm run test` + `npm run test:browser-electron` |
| Toolchain component | `npm run check:toolchain-catalog` + `npm run check:toolchain-contract` + `npm run test` |
| Channel adapter | `npm run test` |
| Any change before merge | `npm run verify` (format → lint → typecheck → unit → contract → security → build → smoke → browser E2E) |

The full gate is defined in `scripts/verify.mjs:21`; CI runs it in `build-desktop.yml` with a platform matrix.
