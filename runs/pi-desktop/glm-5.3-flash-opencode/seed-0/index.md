---
okf_version: "0.2"
---

# Files

- [Embedded Browser](agent-browser.md) - How the Main-owned embedded browser hosts real web pages, how Agent sessions gain scoped browser permission, and how network policy, advanced mode, and tool budgets constrain automation.
- [Agent Sessions and the Pi Runtime](agent-sessions.md) - How the Agent Host creates, runs, and streams Pi coding-agent sessions, how session files under ~/.pi/agent are indexed and watched, and how history paging, auto titles, and file access roots work.
- [Architecture Overview and Host Supervision](architecture-overview.md) - The Electron three-process topology, how Main supervises the Agent Host utilityProcess with heartbeats and a restart budget, and how renderer crashes and host exits are recovered.
- [Change Guides](change-guides.md) - Step-by-step recipes for common maintenance tasks — adding an RPC method, adding a message-channel adapter, adding a managed process tool, updating the toolchain catalog — with the gates each change must pass.
- [Data and Persistence](data-and-persistence.md) - Where the desktop app keeps state — ~/.pi/agent sessions and Pi config, app-data stores for toolchains, channels, browser, reaper journal, credentials, UI state, and logs — and the write/retention guarantees each store provides.
- [Managed Processes](managed-processes.md) - How Pi Desktop starts, observes, contains, and cleans up long-running project processes — POSIX process groups, the Windows Rust helper with Job Objects, the crash reaper, policy limits, redaction, and the process_* Agent tools.
- [Message Channels](message-channels.md) - How WeChat, Telegram, and Feishu/Lark messages reach Pi sessions — adapter registry, inbound policy and pairing, media staging, secret redaction, the Pi session bridge, and credential storage.
- [Models, Skills, and Plugins](models-skills-plugins.md) - How the Agent Host manages model providers and credentials (ModelRuntime, OAuth login, catalog refresh), Skills search/install, and Plugins management, and where each subsystem persists data.
- [Quickstart](quickstart.md) - What Pi Agent Desktop is, how to run it from source, what each src/ directory does, and where to read next in this wiki.
- [Typed RPC Contract](rpc-contract.md) - The five-message-kind MessagePort RPC protocol, the typed Api/Streams contract between Renderer and Agent Host, the preload bridge, the renderer transport facade, and the static contract-coverage gate.
- [Security Model](security-model.md) - The layered desktop security posture — sandboxed Renderer with strict CSP, custom app protocol, trusted-sender IPC, navigation policy, preload gating, browser-view isolation, and CI-enforced invariants.
- [Testing and Quality Gates](testing-and-quality-gates.md) - How quality is enforced — the staged npm run verify pipeline, the Node unit test runner with colocated *.test.mjs files, static contract/i18n/security checkers, Electron smoke and Browser E2E harnesses, and managed-process soak tests.
- [Toolchain Management](toolchain-management.md) - How Pi Desktop discovers and verifies user toolchains, installs managed runtimes into app-private directories with integrity checks, ships bundled ripgrep/fd, and pushes revisioned snapshots to the Agent Host.
- [Updates and Packaging](updates-and-packaging.md) - How updates are checked, downloaded, and installed safely, how desktop packages are built for macOS/Windows/Linux, and the release CI pipeline with signing, notarization, SBOM, and helper gates.
