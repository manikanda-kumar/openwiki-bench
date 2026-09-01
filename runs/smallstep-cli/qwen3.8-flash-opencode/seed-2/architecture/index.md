# Files

- [Command Framework and Registration](command-framework.md) - How the step CLI assembles its urfave/cli v1 app: command registration via cli-utils, command-group patterns, help/flag customization, hidden and beta namespaces, plugin fallback, and error/exit-code handling.
- [Configuration, STEPPATH, and Contexts](configuration-and-steppath.md) - How step persists CLI state: STEPPATH layout, contexts.json/current-context.json, defaults.json written by bootstrap, step context subcommands, and how --ca-url/--root/fingerprint values are resolved, validated, and defaulted.
- [System Architecture Overview](overview.md) - Ownership boundaries and dependency map of the step CLI: thin binary entrypoint, internal/cmd app wiring, command groups, shared flow libraries, and the external smallstep modules and OS/cloud integration surfaces it relies on.
