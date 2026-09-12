# Files

- [Configuration, Models, and Credentials](configuration.md) - How Pi Agent Desktop stores and refreshes model/provider configuration, enabled-model preferences, credentials (CredentialVault, Pi credential sync), and UI state.
- [Agent Host Supervision and Resilience](host-supervision.md) - How the Electron Main process supervises the Agent Host utilityProcess, detects crashes and hangs, applies a restart budget, gates restarts on managed-process containment, and recovers the Renderer.
- [Architecture Overview](overview.md)
- [Persistence and State Surface](persistence.md) - Catalog where Pi Agent Desktop stores state — sessions and models in ~/.pi/agent, app-owned state in Electron userData, credential vaults, toolchain state, browser stores, reaper journal, and logs — and the write/versioning/failure conventions.
- [RPC Contract and System API](rpc-contract.md) - The typed MessagePort request/response and event-stream RPC contract connecting the Renderer to the Agent Host, its wire message kinds, subscriptions, leases, timeouts, errors, and the Main bridge for Host-to-Main calls.
