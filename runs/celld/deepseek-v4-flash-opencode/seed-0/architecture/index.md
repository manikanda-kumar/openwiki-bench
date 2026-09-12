# Files

- [Cell Lifecycle and Scheduling](cell-lifecycle.md) - How a Durable Object cell moves through its phases on a node — inactive, cold activation, resident/active/idle, dormant and hibernated — including eviction, the isolate pool, event scheduling, alarms, and the durable wake index.
- [Durability and Replication](durability-and-replication.md) - How celld proves a write durable before acknowledging it (RPO=0) — the output gate, LTX WAL capture, epoch-prefixed bucket layout, bucket versus fleet durability, the node-log follower ensemble, takeover recovery, restore sources, and compaction.
- [Architecture Overview](overview.md) - The node/fleet/cell model, the clean-sheet sans-I/O decision core (celld-logic) versus the effect-executor shell (celld), the serial actor execution shape, the crate boundaries, and the major subsystems.
- [Ownership, Leases, and Fencing](ownership-and-fencing.md) - How exactly one node serves a cell — per-cell ownership records written with conditional bucket writes, the fencing epoch, node leases and fleet discovery, takeover, and self-fencing when a node loses its lease.
