---
type: concept
title: Skills, Plugins, and Extension UI
description: How Pi Agent Desktop searches and installs Skills, manages Pi Plugins through an isolated worker, and bridges extension UI to the React renderer.
tags: [agent-host, extensions, skills, plugins, extension-ui]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T12:48:20.646Z
sources:
  - id: openwiki-source-5298dc7f2807e154f7134bd1
    resource: repo://src/agent-host/npx.ts
  - id: openwiki-source-a1389707d8f24ddcc2cd3222
    resource: repo://src/agent-host/plugin-worker-client.ts
  - id: openwiki-source-7582ce298391905df5981168
    resource: repo://src/agent-host/plugin-worker.ts
  - id: openwiki-source-d59a31a1ce964975a4013cb4
    resource: repo://src/agent-host/plugins-policy.ts
  - id: openwiki-source-bfb43ec6e8519bc6aaeeca26
    resource: repo://src/agent-host/plugins-service.ts
  - id: openwiki-source-5512bd60069393bf8eac652d
    resource: repo://src/agent-host/rpc-manager.ts
  - id: openwiki-source-be7e9ac336186b6f07446574
    resource: repo://src/agent-host/skills-cli.ts
  - id: openwiki-source-a5c3af185114022c93a8494c
    resource: repo://src/agent-host/skills-service.ts
generated: { by: "opencode", at: "2026-09-12T12:48:20.646Z" }
---

# Skills, Plugins, and Extension UI

The Agent Host exposes two kinds of extension content to the Pi coding agent:

- **Skills** — markdown-based, installable through the `skills` CLI, searched through the `skills.sh` registry or a CLI fallback.
- **Plugins** — Pi packages (extensions, skills, prompts, themes) managed by Pi's own package manager, installed with `npm` or `git` resolvers, executed in an isolated worker process.

Both are driven from the Host's `handlers.ts` RPC surface (`skills.list`, `skills.search`, `skills.install`, `skills.set`, `skills.getContent`, `plugins.list`, `plugins.set`, `src/agent-host/handlers.ts:1828`), and both depend on the Main-process toolchain resolution so the Host never guesses where `node`/`npm`/`git` live.

## Skill search and install

`skills-service.ts` implements the `skills.search` and `skills.install` handlers.

- Search first calls the `skills.sh` registry HTTP API (`https://skills.sh/api/search?q=...&limit=...`). If that request fails, it falls back to running the `skills` CLI through `npx` (`src/agent-host/skills-service.ts:11`). The CLI results are parsed from a `packageName + installs` table by `skills-search.ts`.
- Install runs `npx --yes --package skills@1.5.22 -- skills add <pkg> -y --agent pi [-g]` (`src/agent-host/skills-cli.ts:3`). The CLI package is **pinned** so a failed unversioned npx install cannot poison later invocations under a shared cache key. Global installs run in the Host's cwd; project installs run in the project `cwd`.
- Install success is detected by matching `Installation complete` or `Installed N skills` in the CLI output; anything else is surfaced as an error (`src/agent-host/skills-service.ts:59`).

### npx execution and isolated-cache retry

`npx.ts` (`runNpxWithRuntime`) executes the Main-resolved `js.npx` pair from a toolchain execution context with intent `skill-install`. The Host never scans `PATH`, guesses an npm layout, or treats Electron as Node (`src/agent-host/npx.ts:74`). npm flags disable audit/fund/update-notifier noise and set `npm_config_yes`.

On failure, `shouldRetryWithIsolatedCache` decides whether to retry once with a fresh temp `npm_config_cache` and `npm_config_maxsockets=1` (`src/agent-host/npx.ts:28`). Retry triggers are: the process was killed (timeout), or a network/concurrency/lock error such as `EAI_AGAIN`, `EBUSY`, `ECONNRESET`, `ETIMEDOUT`, `concurrency.lock`, or `fetch failed`. A successful install is never retried.

## Plugin management

`plugins-service.ts` implements the `plugins.list` and `plugins.set` handlers using Pi's `SettingsManager` and `DefaultPackageManager`.

- `readPlugins(cwd)` resolves configured packages (global + project), collects enabled resource counts per package (extensions/skills/prompts/themes), and reports diagnostics for packages that are configured but not installed (`src/agent-host/plugins-service.ts:231`).
- **Disable/enable** actions rewrite the package entry's resource arrays to empty (`extensions: []`, etc.) and back up the original entry to `pi-desktop-plugin-filters.json` under the agent dir so it can be restored later (`src/agent-host/plugins-service.ts:124`).
- **Install/remove/update** actions run through `applyPluginAction` which classifies the package source to decide required toolchain capabilities: `npm:` sources need `js.npm`, `git:`/https/ssh sources need `vcs.git` (`src/agent-host/plugins-policy.ts:4`). The execution context is created with intent `plugin-install`, and the resolved npm executable is passed to the worker.

### Isolated plugin worker

Install/update/remove run in a separate child Node process (`plugin-worker.mjs`) instead of the Host process (`src/agent-host/plugin-worker-client.ts:78`):

- The worker is spawned with `ELECTRON_RUN_AS_NODE=1`, `PI_DESKTOP_PLUGIN_WORKER=1`, and the toolchain inventory revision injected into its environment (`src/agent-host/plugin-worker-client.ts:31`).
- The request is passed over stdin (capped at 64 KiB), and the worker validates the request (`cwd` must be an absolute path ≤ 4096 chars, action must be in the allowed set, npmCommand entries must be clean) before invoking `applyPluginActionInProcess` (`src/agent-host/plugin-worker.ts:15`).
- The result is written back to stdout as a base64 JSON blob prefixed by a marker, decoded by `extractPluginWorkerResponse` (`src/agent-host/plugin-worker-client.ts:49`). If the worker exits without a result, the tail of stderr is surfaced (redacted, ≤ 1000 chars) as a `TOOLCHAIN_INTERNAL` error.
- A 3-minute watchdog terminates the worker tree (with a 1 s grace) if it does not finish (`src/agent-host/plugin-worker-client.ts:165`).
- Worker stdout/stderr are trimmed to a 2 MiB tail so memory is bounded.

## Extension UI bridge

When a session is created, `AgentSessionWrapper.beginExtensionBinding` binds Pi extensions to an RPC-mode UI context (`src/agent-host/rpc-manager.ts:300`). This is the desktop equivalent of Pi's TUI extension surface.

- Extension UI requests (`select`, `confirm`, `input`, `editor`, `notify`, `setStatus`, `setWidget`, `setTitle`, `set_editor_text`, `custom`) are emitted as `extension_ui_request` agent events that the Renderer renders (`src/agent-host/rpc-manager.ts:1081`). Responses come back as `extension_ui_response` commands.
- The bridge is session-scoped; a `WeakMap`-free design keeps pending request/response state in `AgentSessionWrapper` and cancels all pending UI on teardown (`src/agent-host/rpc-manager.ts:888`).
- **Terminal-only features are explicitly unsupported**: raw terminal input, custom TUI header/footer, TUI autocomplete providers, and theme switching report a compatibility warning (`reportUnsupportedExtensionFeature`) rather than being silently dropped (`src/agent-host/rpc-manager.ts:946`).
- During messaging-channel (external) turns, interactive extension UI is blocked and returns a default value, since there is no user at the desktop to answer (`src/agent-host/rpc-manager.ts:1027`).

## Extension diagnostics and reload

- `extension-diagnostics.ts` projects Pi's runtime diagnostics into a small set of `{ key, text }` statuses that appear in the UI.
- `session.reload` re-dispatches `session_start` to extensions and clears the extension status/widget state (`src/agent-host/rpc-manager.ts:512`).

## Extension points

To add a new skill/plugin capability, the touchpoints are the `Api` methods in `src/contract/api.ts` (`skills.*`, `plugins.*`), their handlers in `src/agent-host/handlers.ts`, and the shared result types in `src/shared/api-types.ts`. Toolchain requirements flow through `toolchainRuntime` with explicit execution intents, never through `PATH` guessing.

## Tests

- `src/agent-host/npx.test.mjs` covers isolated-cache retry decision logic.
- `src/agent-host/plugins-service.test.mjs` and `src/agent-host/skills-service.test.mjs` cover plugin lifecycle actions and skill search/install paths.
- `src/agent-host/plugin-worker-client.test.mjs` covers worker protocol framing and error mapping.
