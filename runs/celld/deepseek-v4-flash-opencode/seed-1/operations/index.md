# Files

- [Configuration surface](configuration.md) - The complete operator configuration surface — CLI actions and options, the strict environment-variable parsing and validation, listener and fleet resolution rules, and where each setting is consumed.
- [The fleet bucket and object storage](fleet-bucket.md) - The object-store adapter behind every fleet, the three conditional-write dialects (S3, Google Cloud Storage, Azure Blob Storage), the reserved key prefixes, the startup storage probe, provider qualification, and credential handling.
- [Operating a node and a fleet](fleet-operations.md) - How a node starts, serves health, handles overload, sheds under memory pressure, shuts down gracefully with a handoff and the drain token, gates its first readiness, and how the operator CLI subcommands (diagnose, cell list, d1, kv, queue) inspect and control a fleet.
- [Security and networking boundaries](security.md) - The public and internal listeners, the fleet HMAC peer authentication and replay protection, the peer tunnel, challenge-bound probing, advertised addresses, forwarded-header policy, the operator API, and the threat model.
- [Telemetry and observability](telemetry.md) - The opt-in tracing and logging pipeline — spans and log records, the bucket Parquet sink and the OTLP sink, sampling, the v0-unstable schema, and the DuckDB query and compaction workflow.
