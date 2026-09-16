---
type: architecture
title: "Command Framework and Lifecycle"
description: "How the step binary boots: the main entrypoint, the urfave/cli app construction in internal/cmd, command registration via init and command.Register, plugin dispatch for unknown top-level commands, help/flag rendering, and error/exit-code behavior."
tags: [cli-framework, urfave-cli, registration, plugins, error-handling, lifecycle]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T18:31:05.987Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-09-14T18:31:05.987Z" }
---

This page traces the full lifecycle of a `step` invocation, from `main()` to a command action function, and documents the conventions for adding commands.

## Call path from main() to an action

1. `cmd/step/main.go` declares `Version`, `BuildTime`, and `AppName` variables set at build time via ldflags, and its `init()` calls `step.Set("Smallstep CLI", Version, BuildTime)` (cli-utils), sets the certificates library user agent `ca.UserAgent = step.Version()`, and calls `cmd.SetName(AppName)` (`cmd/step/main.go:10-25`). `main()` is a one-liner: `cmd.Run()` (`cmd/step/main.go:27-29`).
2. `internal/cmd/root.go` `Run()` does `os.Exit(run())` (`internal/cmd/root.go:46-48`).
3. `run()` (`internal/cmd/root.go:50-85`) defers `panicHandler()`, calls `step.Init()` from cli-utils to initialize the step environment (exit 1 with a message if it fails), builds the app with `newApp(os.Stdout, os.Stderr)`, and runs `app.Run(os.Args)`. Success returns 0; any error is reported (see below) and returns 1.
4. `newApp` (below) returns a configured `*cli.App`; urfave/cli parses arguments and invokes the matching command's `Action`, which is a thin `cli.ActionFunc` wrapper around the package's action function (e.g., `command/ca/token.go:282` `tokenAction`).

## App construction (newApp)

`newApp` (`internal/cmd/root.go:95-154`) performs these global customizations:

- **Library hooks**: `pemutil.WriteFile = fileutil.WriteFile`, and both `pemutil.PromptPassword` and `jose.PromptPassword` are routed to `ui.PromptPassword`, so every key write and password prompt across the codebase uses the cli-utils UI/file utilities.
- **Framework overrides**: `cli.VersionPrinter` is replaced with `version.Command`, the three help templates and `cli.HelpPrinter` are replaced with cli-utils `usage` templates, `cli.FlagNamePrefixer` with `usage.FlagNamePrefixer`, and `cli.FlagStringer` with the local `stringifyFlag`.
- **App fields**: name `step` (overridable via `SetName`, used e.g. for forked binaries), `Usage: "plumbing for distributed systems"`, `Version: step.Version()`, `app.Commands = command.Retrieve()` (all registered commands), `EnableBashCompletion = true`, a copyright line with the current year, and a global `--config` string flag documented as "path to the config file to use for CLI flags". Nothing else in this repository reads the `config` flag value; it is consumed by the cli-utils step environment layer.
- **`app.Action`** (see next section) is the fallback for `step` with no arguments or an unknown first argument.

`stringifyFlag` (`internal/cmd/root.go:172-193`) renders flags for help text using reflection over the flag's `Name` and `Usage` fields. It extracts a `<placeholder>` from the usage string with the regex `<.*?>`; boolean flags get no placeholder and everything else defaults to `<value>`. This is why flag usage strings in `flags/flags.go` embed angle-bracketed placeholders.

## Command registration model

Each top-level command group lives in its own package under `command/` and registers itself in `init()` via `command.Register(cli.Command{...})` from `github.com/smallstep/cli-utils/command` (see `command/context/context.go:10-58` as a canonical example). Subcommands are nested in the same package's `Subcommands: cli.Commands{...}` list (e.g., `command/ca/ca.go:68-85` wires health, init, bootstrap, token, certificate, rekey, renew, revoke, provisioner, sign, root, roots, federation, acme, policy, admin).

Registration only takes effect if the package is imported. The authoritative side-effect import list lives in `internal/cmd/root.go:30-43`:

```
api, base64, beta, ca, certificate, completion, context, crl, crypto, fileserver, oauth, path, ssh
```

The same import block enables the registration-authority backends used by `step ca init` via blank imports of `cloudcas`, `softcas`, and `stepcas` from `smallstep/certificates/cas` (`internal/cmd/root.go:25-28`).

`command/README.md` documents the conventions: one package per hierarchy level when possible, shared helpers (flags, errs, prompts, usage) at the repository top level, `command.Register` plus a side-effect import for every top-level command, and `Hidden: true` to hide deprecated or unreleased commands from help output. The README describes importing in `cmd/step/main.go`; in the current layout the import list has moved to `internal/cmd/root.go`.

The pinned surface is enforced by `TestAppHasAllCommands`, which asserts the exact top-level command list is `help, api, base64, fileserver, path, certificate, completion, context, crl, crypto, oauth, version, ca, beta, ssh`, and `TestAppRuns`, which asserts bare `step` prints help containing `step -- plumbing for distributed systems` with empty stderr (`internal/cmd/root_test.go:11-46`). Adding or removing a top-level command requires updating this test.

## Fallback action and plugin dispatch

`app.Action` (`internal/cmd/root.go:133-147`) handles `step` with no enabled command matching:

- No arguments: `cli.ShowAppHelp`.
- First argument `<name>`: `plugin.LookPath(name)`; if found, `plugin.Run(ctx, file)` executes it. Otherwise, if `plugin.GetURL(name)` is non-empty, the CLI errors with "The plugin ... was not found on this system. Download it from <url>". Otherwise it shows help for the (unknown) command name.

The plugin package (`internal/plugin/plugin.go`):

- `LookPath` (`internal/plugin/plugin.go:20-52`): the plugin executable is named `step-<name>-plugin`. On non-Windows it first checks `$(step path)/plugins/step-<name>-plugin` (via `step.BasePath()`), then falls back to `$PATH` with `exec.LookPath`. On Windows it expands `PATHEXT` (defaulting to `.com .exe .bat .cmd .ps1`), probes each extension in the plugins directory first, then `$PATH`.
- `Run` (`internal/plugin/plugin.go:56-72`): executes the plugin with the remaining arguments (dropping the command name), inheriting stdin/stdout/stderr, and waits. On Windows, a `.ps1` plugin is invoked as `powershell -noprofile -nologo <file> ...args`.
- `GetURL` (`internal/plugin/plugin.go:75-82`): maps `kms` to the `step-kms-plugin` GitHub URL; all other names return `""`.

This is how `step-kms-plugin` integrates: `step kms ...` is dispatched to an external binary, and the README notes the plugin is also built into `step` for KMS-backed key operations (see the crypto toolkit page).

## Error output and exit codes

In `run()` (`internal/cmd/root.go:62-84`), an error from `app.Run` is inspected: if it implements the interface `{ Message() string }` (cli-utils `errs` types do), the message is printed to stderr — with `STEPDEBUG=1` the full `%+v` form is printed first, followed by a blank line and the message; without it the CLI prints the message plus `Re-run with STEPDEBUG=1 for more info.`. Other errors print their plain form (or `%+v` under `STEPDEBUG=1`). Both paths return exit code 1.

`panicHandler` (`internal/cmd/root.go:156-170`) recovers panics: with `STEPDEBUG=1` it prints version and release date and re-panics (full stack trace); otherwise it prints `Something unexpected happened.`, suggests re-running the exact command with `STEPDEBUG=1`, tells the user to send the output to `info@smallstep.com`, and exits with code **2**.

## Change guide: adding a new top-level command

1. Create `command/<name>/<name>.go` with `package <name>` and an `init()` that builds a `cli.Command` (Name, Usage, UsageText, Description, Flags, Action or Subcommands) and calls `command.Register(cmd)`.
2. Add a blank import `_ "github.com/smallstep/cli/command/<name>"` to `internal/cmd/root.go` (the import block at lines 30-43).
3. Update the expected name list in `TestAppHasAllCommands` (`internal/cmd/root_test.go:22-26`).
4. Follow the conventions in `command/README.md`: reuse or add flags in `flags/flags.go`, raise errors with cli-utils `errs` (so exit codes and STEPDEBUG behavior work), and use the `usage` package annotations for arguments.
5. For a subcommand, no import change is needed — add it to the parent group's `Subcommands` slice.
