---
okf_version: "0.2"
---

# Files

- [Architecture and crate boundaries](architecture.md) - How the celld workspace splits decision-making (celld-logic) from effects (celld) and replication (celld-ltx), and how the single actor serializes events.
- [Cell lifecycle and Durable Object semantics](cell-lifecycle.md) - How a cell moves through phases from inactive to resident and back, how alarms/cron/queues wake it, and how restore picks a durable source.
- [Operational CLI and configuration](cli-operations.md) - The celld command surface, its environment variables, listener addresses, output discipline, and telemetry sinks — as parsed from the source.
- [Deployment pipeline](deployment.md) - How celld deploy bundles a Worker project with esbuild, refuses unsupported wrangler config, publishes manifests to the bucket, and how nodes adopt generations.
- [JS runtime and Workers compatibility](js-runtime.md) - The V8 engine host: one isolate per cell, the JS harness over synchronous Rust storage, module shims and lazy builtins, host services injection, and the Cloudflare compatibility boundary.
- [Maintenance and change guides](maintenance-guides.md) - Source-grounded, task-focused guides for common maintenance changes: adding a JS builtin shim, extending the deploy config allowlist, bumping the peer protocol version, and supporting another storage dialect.
- [Networking and peer protocol](networking-peer-protocol.md) - How requests reach the right node: the two listeners, cell forwarding rules, the HMAC-authenticated peer tunnel, diagnostics probing, and WebSocket proxying.
- [Ownership, leases, and fencing](ownership-fencing.md) - How celld guarantees exactly one writer per cell through bucket conditional writes, node leases, expiry-driven self-fencing, and dead-node reconciliation.
- [Quickstart](quickstart.md) - Fastest paths to a working celld node and fleet: install or build, celld dev locally, deploy a Wrangler project, run a two-node fleet against a bucket, and where each subsystem is documented.
- [Durability and LTX replication](replication-durability.md) - How celld proves writes durable before acknowledging: LTX capture of SQLite WAL, bucket proofs and the follower ensemble (RPO=0), the output gate, node-log recovery on takeover, and compaction.
- [Security boundaries](security.md) - What celld trusts: the trusted private network, the fleet secret, bucket credentials as fleet authority, advertise and forwarded-header guards, and the alpha status.
- [Storage backends and credentials](storage-backends.md) - The bucket adapter's dialects (S3/etag, GCS/generation, Azure/etag, local dev store), qualified vs broken services, and the credential chains per provider.
- [Testing strategy](testing.md) - The three promises and the four test layers that protect them: differential execution against workerd, TLA+ model checking, deterministic simulation of celld-logic, and fault injection on a live fleet lab.
