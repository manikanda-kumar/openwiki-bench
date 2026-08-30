# Files

- [Shared Package (Protocol Contracts)](shared-package.md) - @open-inspect/shared — the single source of wire-protocol schemas (WebSocket, sandbox events, server messages), the sig1 service-auth signature, the model catalog, cron/trigger types, and repository identity helpers that every other TypeScript package imports.
- [Web Client (Next.js)](web-client.md) - The Next.js 16 dashboard — a same-origin BFF that signs every control-plane call, plus a layered real-time stack (transport, protocol state machine, pure reducer) and the session composer with target picker and draft warming.
