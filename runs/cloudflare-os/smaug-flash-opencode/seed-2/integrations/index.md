# Files

- [Context Library Gatekeeper](context-library.md) - The Context Library — auto-provisioned accounts, private vs public collections, sharing-domain scoping, the three Durable Objects plus KV, the agent read session, and the management UI.
- [Cloudflare Gatekeeper (Auth, Billing, Observability)](gatekeeper-cloudflare.md) - The single Cloudflare OAuth account serving three purposes — sign-in, AI Gateway billing, and Workers Observability — plus the scope fail-closed behavior and the observability layering.
- [MCP Gatekeepers and Trust Tiers](mcp.md) - The two MCP connectors and their shared library — endpoint discovery, tool classification, the byo/vetted trust tiers, the at-most-once approval guarantee, auto-approval eligibility, and shared limits.
- [Scheduled Tasks Gatekeeper](scheduled-tasks.md) - The Scheduled Tasks ambient gatekeeper — persistent workspace callbacks (every / calendarAt / runAt), the account-scoped ScheduleDriver Durable Object with one alarm, retries, cadence, lifecycle, and the read-only management app.
