---
okf_version: "0.2"
---

# Files

- [celld system architecture](architecture.md) - How celld runs Cloudflare Workers and Durable Objects as self-hosted cells on your own machines, the three-crate layering, the single-actor decision core, and the primary control and data flows.
- [Cell lifecycle, routing, alarms, cron, and WebSockets](cell-lifecycle.md) - How a Durable Object cell moves through its states (inactive, dormant/hibernated, resident, remote, fenced), the decision-core phase machine, request routing, alarm wake entries, cron triggers, and the WebSocket kinds a cell can hold.
- [Change guides for common maintenance tasks](change-guides.md)
- [Deployments, Wrangler configuration, and in-place adoption](deployments.md) - How celld deploy builds a Wrangler project into durable bucket objects (manifest, pointer, assets), the supported config allowlist and feature gates, and how running nodes adopt a new deployment in place through generations.
- [Memory management and pressure shedding](memory-and-pressure.md) - How celld samples memory (RSS, jemalloc slack, cgroup working set), the two independent pressure latches and their watermarks, the shedding walk down, V8 heap limits, and resident-cell admission caps.
- [Node lifecycle: lease, fencing, graceful shutdown, and rolling updates](node-lifecycle.md)
- [Object storage: bucket providers, credentials, and conditional writes](object-storage.md) - The single object-store client, the three conditional-write dialects (S3/Azure etag, GCS generation), provider credentials, reserved bucket prefixes, the storage qualification test, and fleet key prefixes.
- [CLI and internal operator API](operator-cli.md) - The celld command-line surface (run, dev, deploy, diagnose, cell, d1, kv, queue, connect), the stdout-is-data output rule, and the internal listener operator API routes.
- [Cell ownership, fencing, and the RPO=0 durability protocol](ownership-and-durability.md) - How celld enforces exactly one owner per cell with conditional bucket writes and fencing epochs, and how every write is acknowledged only after a durability proof covers it.
- [celld quickstart](quickstart.md)
- [SQLite replication, the LTX format, and the fleet log tier](replication-and-ltx.md) - How celld captures each cell's SQLite WAL as LTX data, the LTX v0.5.2 object layout and compaction levels, the bundle envelope, and the in-fleet node-log that enables fleet-durable write acknowledgements.
- [V8 isolates and the Workers runtime surface](runtime-and-isolates.md) - The V8 isolate-per-cell execution model, the Workers and Durable Objects runtime API surface, SQLite-backed storage, WebSockets, WebAssembly, the Worker Loader, and the Cloudflare compatibility boundary.
- [Security boundary and fleet authentication](security.md) - The celld trust boundary, the public and internal listeners, the fleet HMAC peer authentication with clock limit and replay protection, the peer tunnel, forwarded-header policy, and bucket credential authority.
- [Telemetry: traces and logs](telemetry.md)
- [Testing strategy: conformance, model checking, simulation, and live fleets](testing.md) - How celld tests its three promises — an acknowledged write is durable, a cell has one writer at a time, and Cloudflare Workers code operates the same — across four layers.
