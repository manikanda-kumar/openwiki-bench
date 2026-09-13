---
type: development
title: Change Guides
description: Source-grounded step-by-step procedures for representative maintenance tasks — adding an RPC method, changing a toolchain capability, adjusting a browser permission rule, and validating any change end-to-end.
tags: [guides, maintenance, rpc, toolchains, browser, verification]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T13:27:03.630Z
---

# Change Guides

These procedures are grounded in the actual ownership boundaries described in [Architecture Overview](/openwiki/architecture/overview.md) and [IPC and Type Contracts](/openwiki/architecture/ipc-and-contracts.md). Each ends with the verification commands that must pass.

## Guide 1: Add a new renderer → Agent Host RPC method

The cleanest path keeps the change inside the Host boundary: the renderer talks to the Host over the typed `Api`, and contract coverage is machine-checked.

1. **Declare the method** in the `Api` interface in `src/contract/api.ts` with explicit `params` and `result` types (group it with its domain, e.g. `sessions.*`). If the method pushes events, add a topic to the `Streams` interface too (`src/contract/api.ts:57-420`).
2. **Implement the handler** in `registerHandlers` in `src/agent-host/handlers.ts` by adding an entry to the object passed to `server.handle({ ... })` (`src/agent-host/handlers.ts:736-1948`). Validate all `params` before acting and throw `RpcError` with a stable `code` for business failures (`src/contract/types.ts:230-239`).
3. **Emit stream events** with `server.emit(topic, key, data)` where required; keys support `"*"` matching on either side.
4. **If the method needs a desktop capability** (secrets, dialogs, reaper, browser), keep the Handler thin and call Main through `callMain(method, params)` (`src/agent-host/parent-rpc.ts:55-68`), then implement the dispatch arm in the `HostManager` request handler in `src/main/main.ts` (`src/main/main.ts:590-685`). Adding Main-side surface additionally requires a `piBridge` entry in `src/contract/desktop.ts`, its implementation in `src/preload/preload.ts`, and a `trustedHandle`/`trustedOn`/`browserHandler` registration in `src/main/ipc.ts` — prefer the Host-side path whenever the logic is Host-owned.
5. **Add a focused test** as a colocated `*.test.mjs` next to the handler or the contract (`src/contract/rpc.test.mjs` covers the transport).

Verification:

```bash
npm run check:contract   # fails unless Api method == handler (and Streams topic == emit)
npm run typecheck
npm test
```

`check:contract` fails with `Missing <method>` / `Unknown <method>` if the contract and implementation drift (`scripts/check-contract-coverage.mjs:211-227`).

## Guide 2: Change or add a toolchain capability

Toolchain capabilities are declared centrally and consumed by selection, probing, and public state, so a change touches several coordinated files.

1. **Declare the capability id** in `TOOL_CAPABILITY_IDS` in `src/shared/toolchains/types.ts` (and it flows automatically into `isToolCapabilityId`) (`src/shared/toolchains/types.ts:1-18,291-293`).
2. **Add/update the probe** in `src/main/toolchains/probes/capabilities.ts`, following the existing per-tool probe functions (e.g. `probeBash`, `probePowerShell`) and the `probeSucceeded`/`failedCandidate` helpers (`src/main/toolchains/probes/capabilities.ts:66-87`). Ensure discovery seeds in `src/main/toolchains/discovery-registry.ts` cover the executable locations the probe expects.
3. **Add the required-capability mapping** if the capability must be present for core readiness — `MISSING_REASON` in `src/main/toolchains/public-state.ts` maps a missing capability to a `TOOLCHAIN_*_REQUIRED` reason (`src/main/toolchains/public-state.ts:14-23`).
4. **If a managed component supplies it** (e.g. adding a component), extend `MANAGED_COMPONENT_IDS`/`PROFILE_COMPONENTS`/`COMPONENT_SOURCE_NAMES` in `src/main/toolchains/manager.ts`, the catalog schema in `src/shared/toolchains/catalog-schema.ts`, and the signed catalogs `build/toolchains/runtime-catalog.json` / `core-catalog.json`.
5. **Update the renderer config UI** if users select a provider/preference for it (`src/renderer/components/ToolchainsConfig.tsx`) and the action request type in `ToolchainActionRequest` if new actions are introduced.

Verification:

```bash
npm run check:toolchain-contract   # enforces safe ToolchainActionRequest shape
npm run check:toolchain-catalog    # validates catalogs against the schema
npm run typecheck
npm test
```

The toolchain contract check statically forbids renderer-writable action properties like `url`, `executable`, or `command` (`scripts/check-toolchain-contract.mjs:23-53`), so new action payloads must use the allowlisted property names.

## Guide 3: Adjust a browser permission rule

Browser permissions are enforced by the `BrowserPolicyEngine` and streamed to the Host as a capability snapshot that gates the agent browser tools.

1. **Change the permission vocabulary** in `src/contract/browser.ts`: `BrowserPermissionLevel`, `BrowserPersistentDefaultPermission`, `BrowserPersistentSessionPermission`, or `BrowserAgentAuthorizationDecision` (`src/contract/browser.ts:3-8`).
2. **Update the policy engine** in `src/main/browser/browser-policy.ts`: the `PERMISSION_RANK` ordering (`src/main/browser/browser-policy.ts:13-18`), the `grantSession` gate that rejects `advanced` unless Advanced Mode is enabled, channel-session gating, and the settings/advanced-downgrade behavior in `updateSettings` (`src/main/browser/browser-policy.ts:85-112`).
3. **Keep the authorization flow consistent** in `src/main/browser/browser-authorization-coordinator.ts` — it decides when a session grant request is surfaced to the renderer and what default permission applies.
4. **Confirm the snapshot pipeline**: `BrowserService` subscribes to the policy and pushes each revision to the Host via `onCapabilitySnapshot` (`src/main/browser/browser-service.ts:168-171`), and Main forwards it with `setBrowserCapabilitySnapshot` → `browser:changed` (`src/main/main.ts:435`, `src/main/host-manager.ts:98-101`). Agent tool definitions react in `src/agent-host/browser-tools.ts` / `browser-capability-runtime.ts`. Only then does a target-tool side effect pass validation (`browser-policy.ts` lease/revision checks).
5. **Update settings persistence and confirmation** if the setting is user-editable: `src/main/browser/browser-settings.ts`, `browser-settings-confirmation.ts`, and the store file, plus bump `BROWSER_SETTINGS_VERSION` in `src/contract/browser.ts:1` if the persisted shape changes.
6. **Update tests**: `src/main/browser/browser-policy.test.mjs`, `browser-authorization-coordinator.test.mjs`, and any contract tests for the new decision type.

Verification:

```bash
npm run check:desktop-security   # source-level security invariants
npm run check:contract
npm run typecheck
npm test
```

## Guide 4: Validate any change end-to-end

`npm run verify` (`scripts/verify.mjs`) is the single gate that `pack`/`dist` run first, so a change is not shippable until it passes:

```bash
npm run verify
```

For faster iteration during development, run the cheapest relevant slice first, then the full gate before packaging:

```bash
npm run check:contract && npm run typecheck && npm test   # fast slice
npm run verify                                             # full gate (blocks pack/dist)
```

For packaging-specific guarantees, run `npm run pack` (unpacked directory) and, for Windows releases, `npm run check:windows-helper-reproducibility` and the SBOM verify — these are also wired into CI (`scripts/package-desktop.mjs:32-63`, `.github/workflows/build-desktop.yml:276-305`).

## Related pages

- [Build, Test, and Packaging](/openwiki/development/build-and-test.md)
- [IPC and Type Contracts](/openwiki/architecture/ipc-and-contracts.md)
- [Developer Toolchains](/openwiki/systems/toolchains.md)
- [Built-in Browser and Agent Browsing](/openwiki/systems/browser.md)