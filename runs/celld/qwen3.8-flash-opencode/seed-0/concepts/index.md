# Files

- [Cell lifecycle and placement](cell-lifecycle.md) - A cell moves through core Phase states from Inactive through cold activation to Resident/Dormant; admission, eviction, hibernation, restore-source choice, and alarm wake are all decided in celld-logic and performed by the shell's runtime, pool, and wake adapters.
- [Durability, fencing, and leases](durability-and-fencing.md) - celld keeps two promises — one owner per cell and RPO=0 acknowledgement — using bucket conditional writes for ownership, fencing epochs stamped into replication prefixes, an output gate that proves durability (bucket read-back or fleet node-log ensemble) before any egress, and lease-expiry self-fencing.
