# Files

- [Architecture: the decision core, the effect executor, and replication](architecture.md)
- [Cells, scopes, and the lifecycle state machine](cells.md) - What a Durable Object cell is, the scope charset security fence, and the complete phase state machine from cold start through residency, dormancy, eviction, and takeover.
- [Ownership, fencing, durability, and the output gate](durability.md)
- [The V8 JS runtime: isolates, the input gate, alarms, and WebSockets](js-runtime.md)
- [LTX replication and the in-fleet node log](replication.md) - How each committed SQLite write becomes an LTX capture and replica object, L0-L9 compaction and bundles, and the fleet node-log tier (write-all/ack-all ensemble).
- [Reserved cells: D1, KV, Queues, Workflows, and cron](reserved-cells.md)
