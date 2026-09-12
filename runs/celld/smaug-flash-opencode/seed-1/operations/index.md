# Files

- [Configuration and Environment Variables](configuration.md) - The celld CLI surface, storage backends (S3/R2/GS/Azure), bucket prefixes and reserved space, the durability posture, and every CELLD_* environment knob.
- [Operating a Fleet and Node Lifecycle](fleet.md) - Starting nodes, adding capacity, diagnosing a fleet, listing cells, D1/KV/Queue operator commands, node-lease behavior, memory-pressure shedding, the /state route, and the graceful shutdown drain.
- [Telemetry and Observability](telemetry.md) - How celld records traces and logs (off by default), the bucket Parquet sink vs the OTLP sink, the v0-unstable schema, retention, and correlation with W3C traceparent.
