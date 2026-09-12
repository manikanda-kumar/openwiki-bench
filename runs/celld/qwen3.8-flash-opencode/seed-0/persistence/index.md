# Files

- [The celld-ltx replication engine](ltx-engine.md) - crates/ltx is an owned Litestream-v0.5/Rust port that captures committed SQLite WAL frames as LTX L0 segments, uploads them through a ReplicaClient abstraction, restores and compacts levels, and wraps segments in celld-original bundle objects.
