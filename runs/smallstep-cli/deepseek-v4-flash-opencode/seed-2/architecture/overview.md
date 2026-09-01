---
type: architecture
title: Architecture Overview
description: How the step binary is assembled — the urfave/cli app, init()-based command registration, plugin dispatch, version injection, framework overrides, and error handling.
tags: [architecture, cli, commands, plugins]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Architecture Overview

`step` is a single Go binary (module `github.com/smallstep/cli`) built on the
`urfave/cli` framework. Its design makes the command tree extensible through
package `init()` side effects, delegates heavy crypto and CA work to external
libraries (`smallstep/certificates`, `go.step.sm/crypto`), and extends itself at
runtime through external plugin executables.

## Entry point and startup

`cmd/step/main.go` is the binary entry point. Before running it:

- `step.Set("Smallstep CLI", Version, BuildTime)` seeds the cli-utils `step`
  package with the CLI name, version, and build time.
- `ca.UserAgent = step.Version()` configures the certificates library user agent.
- `cmd.SetName(AppName)` allows overriding the app name (default `step`).

`Version`, `BuildTime`, and `AppName` are plain package variables intended to be
set at build time via LDFLAGS (e.g. by goreleaser/Makefile). The `version`
command simply prints `step.Version()` and `step.ReleaseDate()`.

`cmd.Run()` in `internal/cmd/root.go` is the single runtime entrypoint:

1. `step.Init()` initializes the STEPPATH environment.
2. `newApp(stdout, stderr)` constructs the `*cli.App`.
3. `app.Run(os.Args)` executes; any error is printed to stderr and the process
   exits with code 1 (or the error's semantics). `STEPDEBUG=1` toggles verbose
   error rendering.

## Command registration

Commands are **not** wired imperatively. Each command package defines an
`init()` that calls `command.Register(cmd)` with a `cli.Command`
(see `command/ca/ca.go`, `command/base64/base64.go`, `command/version/version.go`).
The root package imports every enabled command package for its side effect:

```go
_ "github.com/smallstep/cli/command/api"
_ "github.com/smallstep/cli/command/ca"
// ...
```

`app.Commands = command.Retrieve()` then assembles the final command tree. Both
`Register` and `Retrieve` come from the shared `github.com/smallstep/cli-utils`
module, so enabling/disabling a command group is a matter of adding/removing the
blank import. Group commands (like `ca`) register their subcommands via ordinary
`Subcommands: cli.Commands{...}` slices.

## Framework configuration and overrides

`newApp` (internal/cmd/root.go:95-154) customizes the stock urfave/cli behavior:

- Replaces `cli.VersionPrinter` with the `version` command and installs help
  templates/printer from the cli-utils `usage` package, plus a custom flag
  stringifier.
- Adds a global `--config` flag (config file for CLI flags).
- Wires crypto-library I/O to CLI primitives: `pemutil.WriteFile = fileutil.WriteFile`,
  and both `pemutil.PromptPassword` and `jose.PromptPassword` to
  `ui.PromptPassword`.
- Enables bash completion and keeps all non-success output on stderr
  (`app.Writer = stdout`, `app.ErrWriter = stderr`).
- Registers the enabled CAS backends (`cloudcas`, `softcas`, `stepcas`) through
  blank imports of `smallstep/certificates/cas/*`.

## Action wiring

`command.ActionFunc` (from cli-utils) lets actions be written as
`func(context.Context) error`. `internal/command/inject.go` provides the
machinery: `InjectContext` and `wrap` build a `context.Context`, run a middleware
chain over it, and stash the `*cli.Context` inside via `withCLIContext`. Actions
later recover it with `CLIContextFromContext`. This separates CLI flag access
from the surrounding `context.Context`.

## Plugin dispatch

When the user runs `step <name>` for a name that is not a built-in command, the
app's default `Action` treats it as a plugin invocation
(internal/cmd/root.go:134-147):

1. `plugin.LookPath(name)` looks for an executable `step-<name>-plugin`, first
   in `$(step path)/plugins` and then in `PATH` (on Windows it checks `.com`,
   `.exe`, `.bat`, `.cmd`, `.ps1` extensions).
2. If found, `plugin.Run(ctx, file)` executes it with the remaining arguments
   and inherits stdin/stdout/stderr (PowerShell scripts are re-invoked through
   `powershell`).
3. If not found, `plugin.GetURL(name)` returns a download URL for well-known
   plugins (e.g. `kms` -> the step-kms-plugin repository) used to print a hint.

## Error handling and panics

`run()` inspects returned errors: if the error implements
`interface{ Message() string }`, it prints only the friendly message unless
`STEPDEBUG=1`, in which case it prints the full `%+v` error plus the message.
Plain errors are printed directly (with stack in STEPDEBUG mode).

`panicHandler()` recovers from panics. Without `STEPDEBUG`, it prints
"Something unexpected happened." plus a hint to re-run with
`STEPDEBUG=1 <command>` and sends output to `info@smallstep.com`, then exits
with code 2. With `STEPDEBUG=1` it prints the version/release date and
re-panics so a debugger/crash dump can capture the trace.

## Testing

Unit tests sit next to their packages (e.g. `internal/cmd/root_test.go`,
`internal/command/inject_test.go`, `command/ca/sign_test.go`), and the
`Makefile` drives `go test` for the whole module. Integration-level coverage
lives under `integration/`.
