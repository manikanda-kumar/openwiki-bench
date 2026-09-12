---
type: concept
title: CLI Runtime and Command Registration
description: How the step binary is assembled from a urfave/cli app, commands registered via init() side-effect imports, plugins dispatched by step-<name>-plugin, and errors/panics surfaced with STEPDEBUG support.
tags: [cli-runtime, command-registration, plugins, error-handling, urfave-cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:30:03.399Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-09-12T20:30:03.399Z" }
---

# CLI Runtime and Command Registration

The `step` binary is a single-process urfave/cli application assembled at package
init time through side-effect imports across many `command/*` packages.
Understanding the run/build entrypoint, registration mechanism, and plugin
dispatch explains how any subcommand comes to exist and how failures are surfaced.

## Entrypoint

`cmd/step/main.go` is the binary entrypoint. `init()` calls
`step.Set("Smallstep CLI", Version, BuildTime)` to record the version globals,
sets the CA `UserAgent`, and calls `cmd.SetName(AppName)`. `main()` simply calls
`cmd.Run()`. `Version`, `BuildTime`, and `AppName` are runtime overridden at
build time via LDFLAGS (see the `Makefile`).

## Building the app: `internal/cmd/root.go`

`cmd.Run()` (in `internal/cmd/root.go`) calls `step.Init()` to initialize the
step environment, then constructs the `cli.App` and runs it with `os.Args`.
`newApp` wires framework overrides: custom help templates/printers, a custom
`VersionPrinter` that routes to `version.Command`, and
`pemutil`/`jose` password prompters backed by the CLI UI.

The command tree is `app.Commands = command.Retrieve()`. `command.Retrieve()`
(defined in the `smallstep/cli-utils/command` dependency) returns the commands
that all of these `command/*` packages registered into a global registry. Each
`command/*` package's `init()` builds a `cli.Command` and calls
`command.Register(cmd)`. For example, `command/ca/ca.go` and
`command/version/version.go` each register their top-level group with
`command.Register`. The packages are enabled by blank imports in
`internal/cmd/root.go`:

```go
_ "github.com/smallstep/cli/command/api"
_ "github.com/smallstep/cli/command/base64"
...
_ "github.com/smallstep/cli/command/ssh"
```

Because the imports are blank, the only effect is running each package's
`init()`, which registers its commands. The `-config <file>` global flag lets
users preconfigure flags from a JSON file.

The `app.Action` handles top-level dispatch: if the first argument names an
installed plugin it runs it; otherwise it shows the matching command help (or the
app help).

## Injection and middleware

`internal/command/inject.go` provides the `wrap`/`InjectContext` helpers. `wrap`
starts a fresh `context.Background()`, runs a chain of middleware functions
(which may inject state), pushes the CLI context into the Go context via
`context.WithValue`, and finally invokes the action function with that context.
Many command actions are registered as `command.ActionFunc(...)`, which is a
type provided by the `smallstep/cli-utils/command` dependency and is compatible
with this injection mechanism. `CLIContextFromContext` recovers the `*cli.Context`
from an annotated context (used for example by policy commands).

## Plugins

`internal/plugin/plugin.go` implements plugin discovery. A plugin is an executable
named `step-<name>-plugin`. `LookPath` looks for it first in
`$(step path)/plugins`, then in `$PATH`; on Windows it also iterates `$PATHEXT`
extensions and can invoke `.ps1` scripts through `powershell`. `Run` executes the
plugin with the CLI's stdin/stdout/stderr and waits. `GetURL` returns the known
download URL for certain plugins (currently `step-kms-plugin` for name `kms`).

If the top-level action finds a plugin for the invoked name, it runs it; if the
name is a known plugin that is missing, it prints a hint with the download URL.
The internal `cryptoutil` package routes non-file key references through
`plugin.LookPath("kms")` and the `step-kms-plugin` binary (see the
[KMS integration](../integrations/km-system-and-external-pki.md) page).

## Error handling and debugging

`run()` in `root.go` handles command errors. If the returned error implements
`Message() string`, a "messenger" error, its message is printed to stderr. All
other errors are printed plainly. When the `STEPDEBUG=1` environment variable is
set, the full `%+v` stack trace is printed instead, along with a message hinting
at `Re-run with STEPDEBUG=1 for more info.`

A `panicHandler()` is wrapped around the app run via `defer`. On an unexpected
panic, if `STEPDEBUG` is set it re-raises the panic with version and release
date; otherwise it prints `Something unexpected happened.` and the repro command,
and exits with status 2 to avoid spooking users with a raw stack trace.

All non-success output goes to stderr (`app.ErrWriter = stderr`).

## Byte build time version injection

`main.Version`, `main.BuildTime`, and `main.AppName` are intended to be set with
`-ldflags "-X main.Version=... -X main.BuildTime=..."` at release time (the
`Makefile` does this via `LDFLAGS`). The app's `Version` field and the
`version.Command` printout then report these values.
