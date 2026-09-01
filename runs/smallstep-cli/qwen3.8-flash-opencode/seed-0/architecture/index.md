# Files

- [CLI Runtime and Plugin Dispatch](cli-runtime.md) - How the step binary boots the urfave/cli app, handles errors and panics with STEPDEBUG, customizes help output, and dispatches unknown commands to external step-<name>-plugin binaries.
- [Architecture Overview](overview.md)
- [STEPPATH, Contexts, and Local State](steppath-and-contexts.md) - How step persists local state under $STEPPATH (defaults.json, ca.json, contexts.json, current-context.json), how context/profile/authority selection works, and which behaviors live in the external cli-utils module.
