# Files

- [Configuration](configuration.md) - How celld parses and validates its environment variables — strict parsing with no silent typos, validated before startup, boolean/positive/optional classes, and the table of primary operational knobs.
- [Node command surface and graceful shutdown](node-cli.md) - The celld command set and settings parsing, listener wiring and validation at startup, the internal operator API, the process shutdown sequence, and rolling-update guidance.
- [Observability and telemetry](observability.md) - Node logging conventions (a node's stdout is its log), the optional CELLD_OTEL telemetry pipeline (Parquet in the bucket or OTLP to a collector), and its sampling, shedding, and schema behavior.
- [Developer and operator tooling](tooling-cli.md) - The non-serve commands — deploy (esbuild bundling and durable bucket publication), dev (local store, supervised node, watcher), diagnose (signed peer probes), cell list, and the d1/kv/queue operator subcommands.
