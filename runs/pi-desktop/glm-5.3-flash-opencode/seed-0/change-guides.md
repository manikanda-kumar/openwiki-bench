---
type: guide
title: Change Guides
description: Step-by-step recipes for common maintenance tasks — adding an RPC method, adding a message-channel adapter, adding a managed process tool, updating the toolchain catalog — with the gates each change must pass.
tags: [change-guide, rpc, channels, managed-processes, toolchain-catalog, quality-gates]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T18:27:38.057Z
sources:
  - id: openwiki-source-6810085c35420f1c9d2f119c
    resource: repo://scripts/check-contract-coverage.mjs
  - id: openwiki-source-a4e8143cddae91f3141acee6
    resource: repo://scripts/check-pi-084-compatibility.mjs
  - id: openwiki-source-2d8f0cd0ba6772044de554d0
    resource: repo://scripts/verify.mjs
  - id: openwiki-source-675f64abd9b8550ea33cde07
    resource: repo://src/agent-host/channels/adapter-registry.ts
  - id: openwiki-source-6d0f49e871f7019c80505c20
    resource: repo://src/agent-host/channels/channel-manager.ts
  - id: openwiki-source-66df5ff9dbde17fb507df13d
    resource: repo://src/agent-host/channels/types.ts
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-1fd263edbf48cdfa7cd3fcc0
    resource: repo://src/agent-host/managed-process/service.ts
  - id: openwiki-source-cf828109fc80a4ee1ea13246
    resource: repo://src/agent-host/managed-process/tools.ts
  - id: openwiki-source-17dbe594e71a8f11f10194e9
    resource: repo://src/contract/api.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-90450bfbf94561ccf8e167bf
    resource: repo://src/main/toolchains/catalog.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
  - id: openwiki-source-74c6b0267a12bbfb67847a09
    resource: repo://tsup.config.ts
generated: { by: "opencode", at: "2026-09-12T18:27:38.057Z" }
---

# Change Guides

These guides cover representative maintenance tasks. Each one follows an existing analog; run `npm run verify` (format → lint → typecheck → unit → contract → security → build → smoke, per scripts/verify.mjs) before packaging.

## Pi 0.84 compatibility pin

The desktop app is pinned to Pi 0.84.0. `scripts/check-pi-084-compatibility.mjs` requires `@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent` to be exact `0.84.0` dependencies in both package.json and the lockfile, requires `@earendil-works/pi-telemetry` to be an exact root dependency plus override at the same version, and fails on source patterns that use APIs removed in 0.84 (e.g. `ModelRuntime.reloadConfig`, `ModelsStreamTransforms`, `Value.Mutate`, `context.store`) (scripts/check-pi-084-compatibility.mjs:19-60). `tsup.config.ts` additionally refuses to build unless `@earendil-works/pi-coding-agent` is an exact semver dependency and bakes it into `process.env.PI_DESKTOP_EXPECTED_PI_VERSION`, which packaged startup validation compares against the running Host (tsup.config.ts:8-16; src/main/main.ts:53, 113-115). Bumping Pi is therefore a coordinated change across package.json, the lockfile, this check script, and the startup validation.

## Adding an RPC method end-to-end

1. **Declare the contract.** Add the method to the `Api` interface in src/contract/api.ts (request/response surface) with typed params/result, or add a stream topic to `Streams` if it is event-only. The Api surface "replaces HTTP routes" — everything the Renderer can do is declared here (src/contract/api.ts:56-57).
2. **Implement the handler.** Register the handler in `registerHandlers` in src/agent-host/handlers.ts. Follow an existing analog such as `sessions.rename` for validation + `RpcError` codes, or `agent.new` for the create-then-bind-events pattern (src/agent-host/handlers.ts:1155-1196).
3. **Emit events if needed.** Use `server.emit(topic, key, data)`; the contract checker statically extracts every `server.emit` string literal and requires each topic to exist in the contract (scripts/check-contract-coverage.mjs:91-102).
4. **Renderer client.** Add a typed wrapper in src/renderer/lib/api-client.ts; components call these helpers and never touch the MessagePort directly (src/renderer/lib/api-client.ts:1-4).
5. **Run the coverage gate.** `npm run check:contract` parses the TS AST to verify that every `Api` method has a Host handler, that handlers match declared methods, and that emitted topics are declared. The checker also verifies the browser `dispatchHostRequest` method set against the contract (scripts/check-contract-coverage.mjs:190-200). It runs inside `npm run verify`, so a mismatch fails the build.

The RPC wire itself needs no changes: src/contract/rpc.ts is a generic five-message-kind protocol (request/response/subscribe/unsubscribe/event) over MessagePort (src/contract/rpc.ts:15-51).

## Adding a message-channel adapter

1. **Implement `ChannelAdapter`.** The interface in src/agent-host/channels/types.ts requires `id`, `start`, `send`, and `probe`, with optional `downloadInbound`, `beginTurn`, `setTyping`, and login lifecycle hooks. Media download must only happen after Channel Core accepted the sender policy (src/agent-host/channels/types.ts:110-122).
2. **Respect the context contracts.** `AdapterStartContext` supplies the account, secret, abort signal, state store, `onInbound`, and `onStatus` callbacks; `AdapterSendContext` carries optional explicitly authorized outbound attachments (src/agent-host/channels/types.ts:22-50).
3. **Register it.** Add the adapter to `AdapterRegistry`'s constructor list in src/agent-host/channels/adapter-registry.ts:7-25. `ChannelManager` drives everything else — inbound policy (`evaluateInboundPolicy`), pairing, lane scheduling, media staging, and redaction happen outside the adapter (src/agent-host/channels/channel-manager.ts:19-31).
4. **Persist nothing sensitive in plaintext.** Secrets flow through the `SecretAccess` indirection and Main's `CredentialVault` (OS-encrypted, validated key format `channel:<channel>:<id>`); adapters receive a `ChannelSecret` per call and errors must pass through `safeChannelError` before leaving the Host (src/agent-host/channels/channel-manager.ts:35-39; src/main/credential-vault.ts:10-16; src/agent-host/channels/redaction.ts).
5. **Add unit tests** mirroring src/agent-host/channels/adapters/telegram/adapter-runtime.test.mjs, plus i18n strings if you add UI.

## Adding a managed process tool

1. **Tool definitions live in src/agent-host/managed-process/tools.ts**, built with `defineTool` and TypeBox schemas. Follow the existing pattern: validate ids/runIds/cursors with schema constraints from `MANAGED_PROCESS_LIMITS`, return JSON `text` content, and convert `ManagedProcessError` to `code: message` (src/agent-host/managed-process/tools.ts:1-52).
2. **Gate channel turns.** Call `assertLocalTurn(ctx)` first — managed process tools are unavailable for messaging-channel turns (src/agent-host/managed-process/tools.ts:58-65).
3. **Operate only through `ManagedProcessService`.** Tools never spawn processes directly; the service owns ownership records, run ids, output cursors, rate limits, and backend selection (src/agent-host/managed-process/service.ts:47-61). A stale `runId` must be rejected.
4. **Register the tool name.** Export it from src/agent-host/managed-process/tool-names.ts so `isManagedProcessToolName` and the session tool-store pick it up, and add contract types in src/contract/processes.ts if you extend the public info shape.
5. **Test with the workflow suites.** `npm run test:managed-process-workflows` and `test:managed-process-flood` exercise lifecycle and resource bounds; `test:windows-managed-helper` covers the Windows backend.

## Changing the toolchain catalog

1. **Catalog location.** Packaged builds read `<resources>/toolchains/runtime-catalog.json`; development reads `build/toolchains/runtime-catalog.json` (src/main/toolchains/catalog.ts:18-26).
2. **Schema-validated.** `loadRuntimeCatalog` rejects files over 2 MiB and parses through `parseRuntimeCatalog` in src/shared/toolchains/catalog-schema.ts; `findCatalogComponent`/`findCatalogVariant` fail closed when a component or platform variant is missing (src/main/toolchains/catalog.ts:11-48).
3. **Update both verification scripts** when adding a component: `scripts/verify-toolchain-catalog.mjs` (local integrity) and `scripts/verify-toolchain-catalog-upstream.mjs` (upstream consistency) run in `npm run verify`.
4. **Remember the ack protocol.** The snapshot derived from catalog + discovery is pushed to the Host as `toolchain:init`/`toolchain:changed` and must be acknowledged by revision before packaged startup validation passes (src/main/host-manager.ts:211-216, 282-287).

## Adding a browser host method

1. Add the method to `BrowserHostMethod`/params/results in src/contract/browser.ts and its required permission level in `requiredPermissionForHostMethod` (src/agent-host/browser-tools.ts:188-223).
2. Dispatch it in `BrowserService.dispatchHostRequest` — the contract checker extracts the method comparison literals there and requires parity with the contract (scripts/check-contract-coverage.mjs:190-200).
3. If it is advanced-tier, wire any confirmation through `BrowserConfirmationManager` and consider the sensitive-result gate (src/main/browser/browser-confirmation.ts).

## Before you ship

`npm run verify` is the single quality gate that blocks pack/dist (scripts/verify.mjs:2). For Renderer-facing strings, `npm run check:i18n` enforces dictionary completeness; `npm run check:desktop-security` enforces security invariants such as sandbox and CSP settings.
