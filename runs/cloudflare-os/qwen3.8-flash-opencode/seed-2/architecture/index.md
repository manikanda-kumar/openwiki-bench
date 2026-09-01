# Files

- [Architecture Overview](overview.md) - How Cloudflare OS (the Gadgets Workshop) is decomposed into a kernel backend, gatekeeper "drivers", a frontend shell, and sandboxed gadget processes, and how requests and state are routed across them.
- [RPC and Capability Model](rpc-and-capability-model.md) - How the Workshop's Cap'n Web RPC works end to end — the single WebSocket session, in-band authentication, capability handoffs, stub lifecycle rules, runtime validation, and persistent stubs.
