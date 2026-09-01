# Files

- [Authentication and Sign-In](authentication.md) - How users authenticate to the Gadgets Workshop — client-hashed passwords, Cloudflare Access JWTs, and gatekeeper-driven sign-in bridged through the PendingLogin Durable Object — and why this configuration lives in environment variables rather than the admin panel.
- [Platform Architecture Overview](overview.md) - What the Gadgets Workshop (Cloudflare OS) is, how its packages divide responsibilities (kernel, shell, drivers, shared contracts), and the end-to-end request flow from the browser through the router into the backend's Durable Objects and gatekeeper Workers.
- [Cap'n Web RPC Protocol and API Surface](rpc-protocol.md) - How the Workshop's client-server communication is structured — the interface hierarchy in workshop-shared, WebSocket transport with pipelining, runtime validation, subscription and stub-lifecycle conventions, and coded error families.
