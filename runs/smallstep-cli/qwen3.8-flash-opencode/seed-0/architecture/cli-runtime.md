---
type: architecture
title: CLI Runtime and Plugin Dispatch
description: How the step binary boots the urfave/cli app, handles errors and panics with STEPDEBUG, customizes help output, and dispatches unknown commands to external step-<name>-plugin binaries.
tags: [architecture, cli-runtime, plugins, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---

# CLI Runtime and Plugin Dispatch

The `step` binary is a thin wrapper around `urfave/cli` v1 plus the Smallstep
`cli-utils` helper packages. This page covers process startup, error and panic
handling, help customization, and the plugin fallback mechanism. For how command
packages register themselves, see [Architecture Overview](/openwiki/architecture/overview.md); for flag contracts, see
[Shared Flags and Parsing Contracts](/openwiki/core/flags-and-configuration.md).

## Process startup

`cmd/step/main.go` is the only `main` package. Its `init()` sets the version
string into the `cli-utils` `step` environment (`step.Set("Smallstep CLI",
Version, BuildTime)`), overrides the CA client's `UserAgent`
(`github.com/smallstep/certificates/ca`) with that version string, and applies
an optional `AppName` override used when the code is embedded in a differently
named binary (`step-kms-plugin`-style builds set `AppName` via LDFLAGs).
`main()` simply calls `cmd.Run()` (internal/cmd/root.go:46), which runs the
internal `run()` and terminates with `os.Exit`.

`run()` performs three steps in order (internal/cmd/root.go:50):

1. `defer panicHandler()` — recover any panic before exit.
2. `step.Init()` — initialize the STEPPATH environment; a failure prints to
   stderr and returns exit code 1.
3. Build the app with `newApp(os.Stdout, os.Stderr)` and `app.Run(os.Args)`,
   translating the returned error into stderr output and exit code 1.

## Error handling and exit codes

The exit-code contract visible in `run()` is: 0 on success, 1 on a command
error (including `step.Init()` failure), 2 on a recovered panic
(internal/cmd/root.go:156-170). Errors that implement an unexported
`Message() string` interface (the shape produced by `cli-utils` `errs`
package error wrappers) print the user-facing message only, plus a hint to
re-run with `STEPDEBUG=1`; all other errors print the raw error. Setting
`STEPDEBUG=1` switches both paths to `%+v` verbose formatting (with the message
appended for messenger errors), and makes the panic handler re-panic after
printing version information instead of swallowing it.

The panic handler prints a "Something unexpected happened" report directing
users to re-run under `STEPDEBUG=1` and mail output to info@smallstep.com, then
exits with code 2.

## App construction and help customization

`newApp` (internal/cmd/root.go:95) does three kinds of wiring:

- **Library hooks:** it installs `cli-utils` implementations into third-party
  libraries — `pemutil.WriteFile` (go.step.sm/crypto) is bound to
  `fileutil.WriteFile`, and both `pemutil.PromptPassword` and
  `jose.PromptPassword` are bound to `ui.PromptPassword` so password prompts
  use the step UI aesthetic.
- **Framework overrides:** global `cli` templates, `HelpPrinter`,
  `FlagNamePrefixer`, and `VersionPrinter` are replaced with the `usage`
  package variants and `version.Command`, so `step -h` and `step version`
  render Smallstep-formatted help with positional-argument documentation.
- **App fields:** `app.Commands = command.Retrieve()` (the registry populated
  by package `init()` functions), `app.Version = step.Version()`, bash
  completion enabled, and a global `--config` string flag is added for CLI
  flag defaults. stdout/stderr writers are injected for testability.

`stringifyFlag` (internal/cmd/root.go:182) post-processes each flag's help line:
it extracts a `<placeholder>` from the Usage text (defaulting to `<value>` for
non-boolean flags) so the help output consistently shows value placeholders.

## Plugin dispatch

When `step <name>` is run and `<name>` is not a registered command, the app's
root `Action` treats it as a plugin invocation (internal/cmd/root.go:134-147):

1. `plugin.LookPath(name)` searches for an executable named
   `step-<name>-plugin`. On every OS it first stats
   `$(step path --base)/plugins/step-<name>-plugin` (the `$STEPPATH` plugins
   directory); on Windows it additionally tries each `PATHEXT` extension (or
   `.com .exe .bat .cmd .ps1` when `PATHEXT` is unset) against that directory.
   Only then does it fall back to `exec.LookPath` on `PATH`
   (internal/plugin/plugin.go:20-52).
2. If found, `plugin.Run` spawns it with `os/exec`, forwarding stdin/stdout/
   stderr and all remaining arguments, and waits for completion. On Windows, a
   `.ps1` plugin is launched indirectly as `powershell -noprofile -nologo
   <file> <args...>` (internal/plugin/plugin.go:56-72).
3. If not found but the name is a well-known plugin (`GetURL` currently knows
   only `kms`), the CLI errors with a download URL instead of printing help
   (internal/cmd/root.go:140-143).
4. Otherwise it shows help for the unknown command, or app help if no argument
   was given.

## Command action middleware

Commands that need dependency injection use `internal/command.InjectContext`
(internal/command/inject.go:14): it wraps an action function in a middleware
chain that starts from a supplied `context.Context` (rather than
`context.Background()` used by `wrap`) and stashes the `*cli.Context` inside it,
retrievable via `CLIContextFromContext` (which panics if unset). This is the
seam used by CA commands to thread configured contexts/teams through actions.

## Built-in version and completion commands

- `step version` prints `step.Version()` and its release date; the version
  strings originate from the `Version`/`BuildTime` LDFLAG variables in
  `cmd/step/main.go` (default `"N/A"`) piped through `step.Set`
  (command/version/version.go:14-34).
- `step completion <bash|zsh|fish>` emits a shell completion script: static
  embedded scripts for bash and zsh, and urfave/cli's generated
  `ToFishCompletion()` for fish; other shell names error
  (command/completion/completion.go:100-123). Bash completion of the CLI
  itself works because the app sets `EnableBashCompletion = true`.

## Non-obvious behaviors

- Plugin lookup checks `$STEPPATH/plugins` **before** `PATH`, so a user-local
  plugin shadows a system-installed one of the same name.
- Plugin failure propagates as the plugin's own stderr/exit behavior because
  stdio is inherited and `cmd.Run()`'s error is returned to `run()`; there is
  no exit-code remapping for the child process beyond the error path.
- `step.Init()` errors exit before any command runs, so even `step version`
  fails if the STEPPATH environment is broken.

## See also

- [Architecture Overview](/openwiki/architecture/overview.md)
- [STEPPATH, Contexts, and Local State](/openwiki/architecture/steppath-and-contexts.md)
- [Shared Flags and Parsing Contracts](/openwiki/core/flags-and-configuration.md)
