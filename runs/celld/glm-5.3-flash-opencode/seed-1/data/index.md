# Files

- [Bucket contract and object-store adapters](bucket-contract.md) - The object-store properties celld requires, the per-provider conditional-write dialects, key prefixes and reserved prefixes, and the startup storage probe.
- [Ownership, epochs, and fencing](ownership-fencing.md) - How celld guarantees exactly one writer per cell — ownership records via CAS, fencing epochs in replication key prefixes, lease renewal, and self-fencing with exit code 3.
- [Replication and durability proofs](replication-durability.md) - How celld proves every write durable before acknowledging — LTX WAL capture, the output gate, bucket vs fleet durability, follower ensembles and node-log sessions, and LTX compaction.
- [Restore and takeover](restore-takeover.md) - How an inactive or failed cell comes back — cold activation, node-log recovery of open sessions, full-prefix restore, dead-node GC, and the graceful handoff with its drain token.
