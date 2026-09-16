# Files

- [Command Framework and Lifecycle](command-lifecycle.md) - How the step binary boots: the main entrypoint, the urfave/cli app construction in internal/cmd, command registration via init and command.Register, plugin dispatch for unknown top-level commands, help/flag rendering, and error/exit-code behavior.
- [Architecture Overview](overview.md) - Map of the step CLI repository: the cmd/step entrypoint, the internal/cmd app bootstrap, top-level package ownership (command, flags, token, utils, internal, exec, pkg), and the external libraries the CLI is built on.
