# Files

- [Deployments and generations](deployments-and-generations.md) - How a code change travels from a Wrangler project to every node — esbuild builds, bucket manifests, the deploy/current.json pointer, and per-node in-place Generation adoption.
- [Durability and replication](durability-and-replication.md) - How celld earns RPO=0 — the output gate, LTX WAL capture, per-cell epoch-prefix uploads, the fleet node-log tier, bundle tiering, takeover recovery, and full-prefix restore.
- [Ownership, leases, and fencing](ownership-and-leasing.md) - How celld earns exactly-one-owner per cell — conditional records, fencing epochs, node leases, self-fencing, takeover recovery, and dead-node reconciliation.
- [Cell runtime and isolates](runtime-and-isolates.md) - How V8 executes a cell — one isolate per cell, the runtime manager and stateless worker pools, the JS API surface over SQLite storage, the ingress listener and WebSocket pump, and hibernation.
