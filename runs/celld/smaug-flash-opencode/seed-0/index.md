---
okf_version: "0.2"
---

# Files

- [celld Architecture](architecture.md) - The node-fleet-cell model, per-cell SQLite, the bucket as root of authority, the clean-sheet decision-core split between crates/logic and crates/celld, and the event-effect control loop.
- [Change Guides](change-guides.md)
- [Cloudflare Compatibility Boundary](compatibility.md) - The Cloudflare Workers and Durable Objects API surface celld implements, the supported Wrangler configuration subset, the deployment feature gates and manifest schema, and known compatibility gaps.
- [Durability, Fencing, and the Replication Protocol](durability.md) - RPO=0 durability guarantees, epoch fencing, ownership records, the fleet node-log ensemble, the takeover recovery gate, storage requirements, and self-fencing.
- [Limitations and Alpha Boundaries](limits.md) - The alpha-era operational limits across fleets, networking and security, object storage credentials, WebSockets, and platforms, with uncertainty stated where the repository does not establish a fact.
- [Fleet Operations, Diagnostics, and Configuration](operations.md)
- [celld Quickstart](quickstart.md) - The fastest path from clone to a running Worker — installing celld, local development with celld dev, deploying to a Cloud bucket fleet, and starting a node.
- [V8 Runtime, JS Embedding, and Application Execution](runtime.md) - How celld embeds V8, runs Wrangler workers and Durable Objects, pools isolates, exposes the per-cell SQLite storage and Durable Object storage API, and runs WebSockets, cron, KV, Queues, D1, Workflows, R2, and Assets.
- [Security Boundary](security.md) - celld's security model — the trust boundary, the public and internal listeners, the fleet HMAC peer authentication with clock limit and replay protection, operator API authentication, request-body limits, and bucket credential handling.
- [Object Storage Backends and Bucket Contract](storage.md) - The bucket abstraction across S3-compatible, Google Cloud Storage, and Azure Blob Storage — conditional-write dialects, credential sources per provider, reserved prefixes, the storage probe, and the fleet key prefix scheme.
- [Telemetry and Observability](telemetry.md) - The optional telemetry system — Parquet-to-bucket and OTLP sinks, the span/log schema, trace correlation, file partitioning, compaction, DuckDB querying, and configuration.
- [Testing and Verification Strategy](testing.md) - celld's multi-layer verification — differential conformance against workerd, TLA+ model checking, deterministic simulation of the pure decision core, and live fleet fault injection — and the results the project trusts.
