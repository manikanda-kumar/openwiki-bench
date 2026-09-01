# Files

- [Capability Security Model](capability-security-model.md) - The repository's capability-based security invariants — single chokepoint for minting gatekeeper capabilities, the no-self-ambience rule, env-var/soft-config separation, sandbox isolation with no outbound network, and observer tracking enforcing read-through sharing permissions including lockdown mode.
- [Gatekeeper Framework](gatekeeper-framework.md) - The gatekeeper RPC protocol every connector speaks — vendor/account/resource layering, OAuth connect contract, the approval queue with observations and asynchronous action simulation, hooks, and how the overseer records and applies actions.
