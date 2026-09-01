# Files

- [Gatekeeper architecture and lifecycle](architecture.md) - The vendor/user/instance tier model, how a gatekeeper is discovered and installed as an Overseer facet, binding names, AI-model and agent-spawner built-ins, UI frames, the agent catalog, ambient capsules, hooks, and external message gateways.
- [Cloudflare gatekeeper: sign-in, billing, and telemetry](cloudflare-gatekeeper.md)
- [Context Library gatekeeper](context-library.md) - The auto-provisioned Context Library gatekeeper — singleton accounts, sharing-domain namespacing, public/private collections across three Durable Objects, the read-only agent session with catalog and slash commands, strategy-C observers, and the management UI.
- [MCP connectors: gatekeeper-mcp and gatekeeper-mcp-portal](mcp-connectors.md)
- [OAuth connectors: GitHub, Google, and friends](oauth-connectors.md)
- [Scheduled Tasks gatekeeper](scheduler.md) - The auto-provisioned scheduler — one ScheduleDriver Durable Object per account with alarm-driven delivery, registration/enable lifecycle split between the agent session and the Workshop Connections UI, bounded retries, and a read-only management app.
