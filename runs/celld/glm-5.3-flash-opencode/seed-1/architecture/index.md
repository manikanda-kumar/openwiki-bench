# Files

- [Fleet model — nodes, listeners, and discovery](fleet-model.md) - How celld organizes processes into a fleet, the two-listener topology, how nodes discover each other and claim cells through the bucket, and how peer traffic moves between nodes.
- [Security boundary and peer authentication](security-boundary.md) - celld's trust model — who is trusted, the two external boundaries, the three internal-listener request groups, and how the fleet HMAC signs and authenticates peer traffic.
- [Workspace layout and crate ownership](workspace-layout.md) - The three-crate workspace — pure decision core (celld-logic), effect executor/adapter host (celld), and the vendored replication engine (celld-ltx) — plus dependency policy and build profiles.
