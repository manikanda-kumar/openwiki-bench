# Files

- [The bucket object contract](bucket-contract.md) - The JSON and LTX objects celld keeps in the fleet bucket, their key schemes, conditional ownership semantics, and the reserved key prefixes.
- [The decision core (celld-logic)](event-core.md) - How behavioral state advances through the deterministic celld-logic crate — Events, Effects, the no-IO purity contract, and how the production executor and simulator both drive it.
- [Architecture overview](overview.md) - celld is a Rust daemon that runs Cloudflare Workers and Durable Objects on user-owned machines — the node/fleet/cell model, the decision-core/executor split, and the main control flows.
