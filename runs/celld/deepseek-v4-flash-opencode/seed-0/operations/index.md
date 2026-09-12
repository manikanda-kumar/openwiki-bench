# Files

- [Deployment and Application Generations](deployment.md) - How a Wrangler project becomes a running application — celld deploy, the Wrangler config allowlist, esbuild bundling, the bucket deployment objects, static assets, and how each node builds and adopts a generation in place.
- [Fleet Lifecycle and Graceful Handoff](fleet-lifecycle.md) - Startup listener reservation and the storage probe, the first-readiness fleet gate, graceful shutdown and the batched cell handoff, the fleet drain token, dead-node garbage collection, and rolling updates.
- [Memory Pressure and Capacity](memory-and-capacity.md) - How a node decides it can and cannot hold more work — the resident-cell cap and activation limits, the memory-pressure classifier with hysteresis latches, cgroup versus RSS measurement, V8 heap limits, and hot-cell overload admission.
- [Operator CLI](operator-cli.md) - The celld operator commands — diagnose, cell, d1, kv, queue, dev, and the control-plane enrollment commands — plus the shared stdout/stderr and bounded-listing conventions they all follow.
- [Telemetry and Node Logging](telemetry.md) - How celld reports what it is doing — the tracing stdout process log, the off-by-default OpenTelemetry telemetry with its Parquet bucket sink and OTLP collector sink, retention and compaction, and the span/log schema.
