---
type: "Reference"
title: "Architecture Overview"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T21:59:24.242Z
sources:
  - id: openwiki-source-9bc319c0fae31cf3f02b261a
    resource: repo://src/agent-host/handlers.ts
  - id: openwiki-source-a611c030075e0ff444b3617b
    resource: repo://src/agent-host/index.ts
  - id: openwiki-source-ab729f0aba4796e9191fbadd
    resource: repo://src/agent-host/parent-rpc.ts
  - id: openwiki-source-38f1591e0fc164ac360843e3
    resource: repo://src/agent-host/session-watcher.ts
  - id: openwiki-source-8d82f271885187427d3d9c99
    resource: repo://src/contract/rpc.ts
  - id: openwiki-source-27ccbc97399d0c101893be89
    resource: repo://src/main/credential-vault.ts
  - id: openwiki-source-0d80aae15a61214b1775064f
    resource: repo://src/main/host-manager.ts
  - id: openwiki-source-47f7aa64d81001b8633c508b
    resource: repo://src/main/main.ts
  - id: openwiki-source-f488fb585aa49ed9a956f8f6
    resource: repo://src/main/window-state.ts
  - id: openwiki-source-44a333de61f81bc982cdd164
    resource: repo://src/preload/preload.ts
  - id: openwiki-source-787426c4609eac497f048824
    resource: repo://src/renderer/lib/api-client.ts
generated: { by: "opencode", at: "2026-09-12T21:59:24.242Z" }
---


# Architecture Overview

Pi Agent Desktop is a pure Electron desktop app that wraps the `pi` coding
agent. It separates high-privilege desktop capabilities, the agent runtime, and
the UI into three cooperating processes connected by a typed MessagePort RPC
contract. The application deliberately exposes **no internal TCP service** for
its UI or control plane (`main.ts` header; README architecture section).

## Process model

- **Main process** (`src/main/main.ts`) owns window lifecycle, menus, tray and
  badge, application protocol / deep links, the system IPC surface, software
  updates, the toolchain manager, the built-in browser service, the managed
  process reaper, and supervision of the Agent Host. `main.ts` states it holds
  "No business logic."
- **Agent Host** (`src/agent-host/index.ts`) is an Electron `utilityProcess`
  that runs `@earendil-works/pi-coding-agent` in-process and serves
  `Api`/`Streams` over a MessagePort. It owns sessions, model management, file
  access, messaging channels, managed background processes, and toolchain
  execution contexts.
- **Renderer** (`src/renderer/App.tsx`) is the sandboxed React 19 UI. It talks
  to the Host only through a controlled preload bridge
  (`src/preload/preload.ts`) and the typed RPC client.
- **Main-owned WebContentsView browser** and **managed project processes** are
  additional views/child processes owned by Main or the Host (see the browser
  and managed-process pages).

The README models this as: Main → Host, Main → UI, Main → Browser, Host →
Processes (via a revisioned Browser RPC), Host ↔ ~/.pi/agent data, and
UI ↔ Host via a typed MessagePort.

## The MessagePort handoff

The Renderer never opens a socket. `api-client.ts` asks `piBridge.requestHostPort()`;
the preload forwards `desktop:connect-host` to Main; Main creates
`MessageChannelMain`, delivers the renderer-side port to the page (via preload
`window.postMessage` with the port as a transferable), and forwards the
Host-side port to the Host with `attach-port` (`host-manager.ts:139-166`). The
Renderer then wraps the port in `createRpcClient` (`contract/rpc.ts`) and proofs
liveness with a `host.ping`.

The preload deliberately exposes `piBridge` *only* — it does not hand a raw
Node/IPC surface to the page, and it uses `window.postMessage` transfer (never
`contextBridge` Promise resolution) for the port, per the note in `preload.ts`.

## Typed RPC contract

`src/contract/api.ts` defines the `Api` request/response surface and the
`Streams` server-push topics. `src/contract/rpc.ts` implements a framework-free
MessagePort RPC with five wire message kinds (`request`/`response`/`subscribe`/
`unsubscribe`/`event`), per-call timeouts (default 120s), and a lease mechanism
for per-request resource ownership. The Renderer uses convenience wrappers in
`api-client.ts` and never touches the raw port. Host→Main calls (browser,
toolchain, credentials, managed processes) use a separate
`callMain`/`host-rpc` channel bridged by `main.ts`.

This contract is a meaningful security and evolution boundary: the Renderer
(and anything that compromises it) can only invoke the declared typed surface.

## Control flow for a typical prompt

1. The Renderer connects via `ensureRpc`, waits for Host `ready`, receives the
   port, and pings.
2. The user types a message; the renderer calls `agent.command`
   (`{ sessionId, command: { type: "prompt", message } }`).
3. The Host validates the session, starts or resumes an `AgentSessionWrapper`,
   and forwards the prompt to Pi. Streaming `agent.events` events and running
   status are pushed back over `Streams`.
4. During the turn the agent may invoke Bash (via the toolchain-resolved shell),
   managed-process `process_*` tools, browser tools (with Main-mediated
   authorization), or file/search tools — all gated by policy in the Host or
   Main as appropriate.
5. The renderer renders streamed events live while differentiating copy; the
   session file is persisted by Pi under `~/.pi/agent/sessions`.

## Host supervision

Main supervises the Host with a heartbeat, crash window + restart budget,
fresh-snapshot acknowledgements, and a managed-process containment gate before
any restart. If the Host crashes or restarts, the renderer drops its RPC client
and reconnects. See the Host Supervision page.

## Persistence surface

The on-disk surface is centered on `~/.pi/agent/` (sessions, models.json, Pi
config), plus the Electron `userData` directory for app-owned state
(ui-state.json, channels.secrets.json credential vault, browser settings and
grants/secrets/tab-restore, the toolchain state store, the managed-process
reaper journal) and `logs/main.log`. See the Persistence page.

## No internal TCP / local-address principle

The app does not open a TCP port to serve UI or its control plane. The only
deliberate network listeners are user-initiated managed-project development
servers, which are contained by the managed-process subsystem and normally bind
loopback. `lib/api-client` and the RPC layer are MessagePort only. This keeps
the desktop surface off the network.

## Testability

The RPC layer is deliberately transport-agnostic (DOM `MessagePort`, Node
`worker_threads`/utilityProcess ports are all accepted via `AnyMessagePort`),
so unit tests exercise the protocol without Electron or a display. Focused
tests live under `src/**/*.test.mjs`.

## Related pages

- RPC Contract and System API
- Agent Host Supervision and Resilience
- Configuration, Models, and Credentials
- Persistence and State Surface
- Quickstart
