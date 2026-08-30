# Files

- [Control Plane](control-plane.md) - Cloudflare Worker composition root that authenticates requests, indexes shared D1 state, and forwards session work to Durable Objects without executing agent code.
- [Architecture Overview](overview.md)
- [Realtime Protocol and Snapshot Handoff](realtime-protocol.md) - Client, server, and sandbox WebSocket contracts, the subscribed snapshot handoff, bounded event replay, and why sandbox credentials stay off the snapshot.
- [Session Durable Object](session-durable-object.md) - Per-session Cloudflare Durable Object that owns SQLite session state, composes the session runtime, and exposes HTTP, WebSocket, and alarm entrypoints.
- [Shared Contracts Package](shared-contracts.md)
- [Web Client](web-client.md) - Next.js dashboard that authenticates users, proxies the control plane as a BFF, hydrates sessions from a secret-free snapshot, and applies live WebSocket updates.
