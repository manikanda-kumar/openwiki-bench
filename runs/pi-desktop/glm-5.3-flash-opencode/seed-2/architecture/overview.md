---
type: architecture-overview
title: Architecture Overview
description: Pi Agent Desktop's Electron three-process model — Main, Agent Host utilityProcess, sandboxed Renderer — plus the Main-owned browser view, managed project processes, and the no-local-server principle.
tags: [electron, architecture, main-process, utility-process, renderer, ownership]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T22:28:03.854Z
---

Pi Agent Desktop is a pure Electron application (no bundled sidecar Node) that wraps the `@earendil-works/pi-coding-agent` 0.84.0 runtime (repo://package.json#L2-L8, repo://package.json#L64-L67). The architecture isolates four concerns across processes: high-privilege desktop capabilities (Main), the agent runtime (Agent Host utilityProcess), the user interface (sandboxed Renderer), and remote/local web content (Main-owned browser views).

## Process ownership map

### Electron Main — privileged desktop shell

`src/main/main.ts` declares its scope in its header: "window lifecycle, menus, tray/badge, deep link, Host supervision, system IPC. No business logic" (repo://src/main/main.ts#L1-L5). On startup it composes, in order:

1. **App protocol + crash reporter** before `app ready` (repo://src/main/main.ts#L43-L48).
2. **Single-instance lock** with deep-link forwarding from secondary launches (repo://src/main/main.ts#L283-L291).
3. **Managed-process crash reaper**, initialized from a journal in `userData`, and — on Windows x64 — resolution and integrity verification of the Rust helper plus journal-directory securing before the reaper starts (repo://src/main/main.ts#L432-L459).
4. **CredentialVault**, **BrowserService**, **UpdateManager** (only on production-enabled platforms or test mode), and **ToolchainManager** wired with the runtime catalog, bundled core, and an Electron-`net`-based fetch that follows the system proxy/PAC (repo://src/main/main.ts#L460-L530).
5. **HostManager** constructed with the resolved Host entry, pre-wired with the current toolchain and browser-capability snapshots, and given a request handler that Main uses to answer Host→Main calls for channel secrets, toolchain resolution, managed-process settings/registration/LAN-bind confirmation/export dialogs, and `browser.*` requests (repo://src/main/main.ts#L597-L698).
6. Window, tray, menu, and deep-link protocol registration (`pi-agent-desktop://`) (repo://src/main/main.ts#L730-L742, repo://src/main/main.ts#L824-L831).

Main also owns cross-cutting lifecycle: a `before-quit` handler that confirms with the user when managed processes are running and performs bounded cleanup (15 s deadline) of managed processes, the Host, and browser resources (repo://src/main/main.ts#L744-L786), and a certificate-error handler that defers only to the browser service's per-host policy (repo://src/main/main.ts#L788-L796).

### Agent Host — the agent runtime utilityProcess

The Host is a separate `utilityProcess` forked by `HostManager` (`utilityProcess.fork(this.hostEntry, ...)`, with `ELECTRON_RUN_AS_NODE` explicitly deleted from the child env so the Electron parentPort is available) (repo://src/main/host-manager.ts#L226-L241). Its entry, `src/agent-host/index.ts`, constructs the RPC server, registers all Api handlers, starts the session watcher, installs the toolchain Git runner, and then reports `ready` with the Pi runtime version over the parent port (repo://src/agent-host/index.ts#L19-L22, repo://src/agent-host/index.ts#L109-L111).

The Host owns the actual agent business logic: Pi sessions, file access, models/config, skills/plugins, messaging channels, and managed-process spawning. It is disposable by design — `uncaughtException`/`unhandledRejection` handlers exit(1) with the comment that the Main supervisor will restart the process within its budget (repo://src/agent-host/index.ts#L115-L124). `HostManager` supervises it with a 30 s crash window, max 2 restarts, and a 15 s ping / 10 s pong-timeout heartbeat (repo://src/main/host-manager.ts#L17-L20); before a restart it reaps all managed processes and refuses to restart if cleanup did not confirm empty (repo://src/main/main.ts#L598-L606).

### Renderer — sandboxed React UI

The main window is created with `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true` (repo://src/main/window.ts#L48-L54). It runs React 19 loaded through the strict-CSP `app://` protocol (repo://src/main/protocol.ts#L8-L25). The window blocks `window.open` (http/mailto is delegated to the OS shell, everything else denied) and guards `will-navigate` with an allowlist policy (repo://src/main/window.ts#L80-L105). A `RendererCrashRecovery` distinguishes recoverable crashes from a halt condition and serves a local crash page (repo://src/main/window.ts#L58-L60, repo://src/main/window.ts#L115-L120).

### Main-owned browser views

Remote web pages never enter the main Renderer. `BrowserTabManager.createSecureView` creates Electron `WebContentsView` instances with `nodeIntegration: false`, `sandbox: true`, `contextIsolation: true`, and no webview tag; these views are owned by Main and survive a Renderer reload (repo://src/main/browser/browser-tab-manager.ts#L2310-L2333, repo://src/main/browser/browser-service.ts#L325-L326). Details of policy and agent authorization live in [Browser Integration](/openwiki/workflows/browser-integration.md).

### Managed project processes

Long-running project commands (dev servers, watchers) are spawned by the Host under lifecycle containment: POSIX process groups on macOS/Linux and the verified Rust helper with Job Objects on Windows x64. Capability is projected by Main from reaper readiness, owner identity, platform, and the user-facing setting (repo://src/main/main.ts#L79-L91). Details: [Managed Processes](/openwiki/workflows/managed-processes.md).

## How the processes connect

- **Renderer → Host**: typed MessagePort RPC; ports are created by Main, attached to the Host, and transferred to the page through the preload (`window.postMessage` transfer, since a port must not cross contextBridge as a Promise value). See [IPC and RPC Contract](/openwiki/architecture/ipc-and-rpc.md).
- **Renderer → Main**: `piBridge` (preload) over trusted `ipcMain.handle/on` channels.
- **Host → Main**: parent-port RPC (`host-rpc` / `host-rpc-result`), answered by the request handler Main installed at startup (repo://src/main/main.ts#L622-L698).
- **Main → Host**: revisioned policy snapshots (toolchain, browser capability, managed-process owner identity), each acked by the Host (repo://src/agent-host/index.ts#L63-L98).
- **No internal TCP control plane**: the UI and control paths run entirely over Electron IPC and MessagePorts; the README's "无内部本地服务" claim matches the code — only user-started managed project services may listen on loopback (repo://README.md#L185, repo://src/contract/api.ts#L57-L66).

## Startup sequencing and shutdown

`app.whenReady` wiring is strictly ordered: helper/reaper bootstrap → vault/browser/update/toolchain services → IPC/menu/tray → HostManager construction and `hostManager.start()` → window creation → `toolchainManager.initialize()` → automatic update checks (repo://src/main/main.ts#L432-L742). Packaged builds support a `--validate-packaged-startup` gate that fails unless renderer, Host, toolchain core, bundled search binaries, Pi version, and snapshot acks are all confirmed within 45 s (repo://src/main/main.ts#L108-L130, repo://src/main/main.ts#L460-L466).

Shutdown (`before-quit`) prevents immediate quit, prompts if managed processes are live, stops automatic update checks, destroys the tray, and runs bounded cleanup of managed processes and browser resources before re-invoking quit (repo://src/main/main.ts#L744-L786).

## Why this split

The dependency direction is deliberate: the Renderer is untrusted (sandboxed, CSP-bound, allowlist navigation), the Host is untrusted-adjacent (crash-restartable, no direct desktop dialogs — it must ask Main), and Main concentrates every capability that touches the OS: dialogs, tray, notifications, credentials, updates, and process containment. A Host crash degrades to UI reconnect (renderer `resetRpc()`), not app loss; a Renderer crash is recovered by Main without touching agent sessions.

## Key entrypoints

| Concern | Entrypoint |
| --- | --- |
| App composition | repo://src/main/main.ts |
| Host supervision | repo://src/main/host-manager.ts |
| Host runtime entry | repo://src/agent-host/index.ts |
| Window + sandbox | repo://src/main/window.ts |
| Preload bridge | repo://src/preload/preload.ts |
| Renderer boot | repo://src/renderer/App.tsx |
