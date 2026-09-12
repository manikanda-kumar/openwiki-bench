# Files

- [CLI Runtime and Command Registration](command-runtime.md) - How the step binary boots, wires urfave/cli, self-registers command packages, injects context middleware, and handles errors and panics with STEPDEBUG diagnostics.
- [Plugin System](plugin-system.md) - How step discovers and executes external step-<name>-plugin executables from the plugins directory or PATH, including Windows PowerShell handling and well-known plugin resolution.
- [Token Model and JWT Claims](token-claims.md) - The JWT/one-time-token model used to authorize step-ca operations, including claim fields, signing feature options, supported token types, and strict validity constraints.
- [Certificate and Token Flows](token-flows.md) - Reusable certificate, token, and SSH flows that bridge CLI commands to step-ca, covering per-provisioner token generation, offline vs online mode, and client construction.
