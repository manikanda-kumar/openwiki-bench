# Files

- [Agent Host Runtime](agent-host-runtime.md) - How the Agent Host utilityProcess runs the pi-coding-agent in-process, manages sessions and custom desktop tools, and serves the typed RPC surface to the renderer.
- [RPC and Contract Layer](rpc-and-contracts.md) - How the typed Api/Streams contract, the MessagePort wire protocol, renderer and host RPC clients, host-to-main parent RPC, and static contract coverage enforcement work together.
- [Security Model](security-model.md)
- [Three-Process Architecture](three-process-architecture.md) - How Electron Main, the Agent Host utilityProcess, and the sandboxed React renderer are structured, connected via MessagePort and preload, supervised, and kept free of internal network servers.
