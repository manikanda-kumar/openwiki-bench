# Files

- [The Workshop Frontend](frontend.md) - The pure-client React SPA in packages/workshop-frontend — how it opens an RPC WebSocket, hosts sandboxed gadget iframes and gatekeeper apps, and renders the home, chat / gadget editor, connections, blueprints, and admin UI.
- [Architecture Overview](overview.md) - Top-level map of Cloudflare OS — a sandboxed AI productivity OS built on Cloudflare Workers where the Workshop backend is the kernel, gatekeepers are device drivers, gadgets are processes, and blueprints are executables, all speaking Cap'n Web RPC.
- [Shared API and Cap'n Web RPC](shared-api.md)
- [Gatekeepers: The Capability-Security Model](the-gate-by-model.md)
- [The Workshop Backend (Kernel)](workshop-backend.md) - Detailed walk-through of packages/workshop-backend, the kernel — its Durable Objects (User, Overseer, AdminSettings, PendingLogin), typed-storage collections, auth, the git object store, chat/agent loop, sharing, blueprints, and AI gateway.
