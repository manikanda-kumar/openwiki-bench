# Files

- [The Logic Decision Core (crates/logic)](decision-core.md) - The clean-sheet, replayable coordination state machine behind celld — the Event/Effect protocol, State, cell lifecycle phases, the output gate, node authority, capacity, and memory-pressure shedding.
- [Ownership, Leases, and Replication](ownership-and-replication.md) - How celld nodes claim cells via conditional bucket writes, hold self-node leases, self-fence, pick a follower ensemble, replicate LTX data, and prove a write durable through fleet verses bucket proofs.
- [SQLite Replication and LTX (crates/ltx)](sqlite-replication-ltx.md) - The embeddable streaming replication library celld uses — WAL capture into LTX segments, replica restore, compaction levels, the bundle overlay, and the object-store and file clients.
- [V8 Isolate Hosts and the Workers/DO API](v8-isolate-hosts.md) - How celld embeds rusty_v8 directly to run Wrangler bundles — one isolate per cell, the lazy/bootstrap code cache, JS bindings and compat flags, storage/R2/WebSocket/crypto ops, module resolution, and the runtime materialization seam.
