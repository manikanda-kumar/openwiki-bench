# Files

- [Worker Bindings and APIs](bindings.md) - The supported Worker bindings and runtime APIs — Durable Objects, KV, R2, D1, Queues, Workflows, WebSockets, Web Crypto, node compat — and the Cloudflare compatibility boundary celld enforces at deploy or first use.
- [Control Plane and Peer Protocol](control-plane.md) - The two HTTP listeners — the public Worker ingress and the internal peer and operator listener — the operator API routes, the HMAC-authenticated peer tunnel, peer-control routes, and the request limits.
- [V8 Runtime and Worker Execution](v8-runtime.md) - How celld executes Workers and Durable Objects in V8 — the isolate pool and turn scheduling, isolate bootstrap and module loading, worker/DO/RPC invocation, the async runtime facade, WebAssembly, and the Worker Loader.
