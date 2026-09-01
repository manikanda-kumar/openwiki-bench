---
type: architecture
title: "CLI Runtime and Command Registration"
description: "How the step binary boots: main entrypoint, urfave/cli app assembly, command.Register/blank-import registration, plugin dispatch for unknown subcommands, InjectContext middleware, and error/exit handling."
tags: [architecture, cli-runtime, entrypoint, plugins, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:10:44.156Z
---

# CLI Runtime and Command Registration

## Entrypoint chain

The shipped binary is `cmd/step` (built by the Makefile target that compiles
`github.com/smallstep/cli/cmd/step`). Its `main.go` is deliberately thin
(cmd/step/main.go:1-29):

- Build-time `LDFLAGS` set the package variables `Version` and `BuildTime`
  (Makefile:70-74 injects `-X main.Version=... -X main.BuildTime=...`).
- `init()` calls `step.Set("Smallstep CLI", Version, BuildTime)` from the
  external cli-utils module, sets `ca.UserAgent` in `smallstep/certificates` to
  the step version string, and applies an optional `AppName` override.
- `main()` delegates to `cmd.Run()` in `internal/cmd`.

`Run` exits the process with the integer returned by `run()`
(internal/cmd/root.go:46-85):

1. `step.Init()` initializes the step environment (STEPPATH/contexts — see the
   environment page; the mechanics live in cli-utils).
2. `newApp(os.Stdout, os.Stderr)` builds the `urfave/cli` v1 `*cli.App`.
3. `app.Run(os.Args)` executes; any returned error is printed to stderr and
   the process exits 1.

## App assembly and command registration

`newApp` (internal/cmd/root.go:95-154) does three notable things:

- **Overrides the framework's global hooks**: help templates and printers are
  replaced with `cli-utils/usage` versions; `pemutil.WriteFile`,
  `pemutil.PromptPassword`, and `jose.PromptPassword` are wired to the CLI's
  `fileutil`/`ui` implementations so the external crypto libraries prompt
  through the same terminal UI (root.go:96-114).
- **Populates commands from a registry**: `app.Commands = command.Retrieve()`
  collects everything registered by package `init()` functions. The concrete
  command set is selected by the blank imports at the top of
  `internal/cmd/root.go:31-43` (`command/api`, `command/ca`,
  `command/certificate`, …), plus the CAS implementations blank-imported from
  `smallstep/certificates/cas` (cloudcas, softcas, stepcas) at root.go:26-28.
  `SetName`/`AppName` exist so alternate distributions can rename the binary
  root (root.go:87-93, cmd/step/main.go:18-24).
- **Adds one global flag**, `--config`, for a CLI configuration file
  (root.go:128-131); `app.EnableBashCompletion` is on, and output/error writers
  are stdout/stderr respectively.

The registration convention is documented in `command/README.md`: each command
package calls `command.Register(cmd)` in its `init()` (e.g.
command/version/version.go:14-27), and new top-level commands must be
blank-imported in `internal/cmd/root.go` (the README still says
`cmd/step/main.go`, which now delegates there) for the `init()` to run.
Packages without explicit business logic (flags, errs, usage, ui) belong
outside `command/` so multiple command groups can share them.

## Plugin dispatch

If the first positional argument does not match a registered command,
`app.Action` treats it as a plugin (internal/cmd/root.go:134-147):

1. `plugin.LookPath(name)` (internal/plugin/plugin.go:20-52) searches for an
   executable named `step-<name>-plugin`, first in `$(step path)/plugins`
   (`step.BasePath()/plugins`), then in `$PATH` via `exec.LookPath`. On Windows
   it probes each `$PATHEXT` extension (defaults `.com;.exe;.bat;.cmd;.ps1`) in
   the plugins directory.
2. If found, `plugin.Run` (plugin.go:56-72) executes it with the remaining
   argv and inherited stdio; a `.ps1` plugin is launched through
   `powershell -noprofile -nologo`.
3. Otherwise `plugin.GetURL` (plugin.go:74-82) maps well-known names to
   download hints — currently only `kms` → the step-kms-plugin repository — and
   produces "plugin not found" with that URL; unknown names fall back to
   `cli.ShowCommandHelp`.

## Middleware: InjectContext

`internal/command` provides `InjectContext` (internal/command/inject.go:14-23):
it wraps a `func(context.Context) error` with middleware chain into a
`cli.ActionFunc`, first injecting an existing context (so all middleware
operate on it), then stacking the remaining middlewares, and finally storing
the `*cli.Context` in the resulting context (retrievable with
`CLIContextFromContext`, which panics if absent — inject.go:25-36). It is used
mainly by the `command/ca/policy/actions` packages (e.g.
command/ca/policy/actions/cn.go:54) rather than by classic commands, which take
`*cli.Context` directly.

## Error rendering and exit codes

`run()` handles returned errors in layers (internal/cmd/root.go:62-84):

- Errors implementing an unexported `Message() string` interface ("messenger"
  errors, e.g. cli-utils exit errors) print only the message plus the hint
  "Re-run with STEPDEBUG=1 for more info."; the full wrapped error is printed
  with `%+v` only when `STEPDEBUG=1` is set in the environment.
- All other errors print via `fmt.Fprintln(os.Stderr, err)` (or `%+v` under
  STEPDEBUG).
- Any error path returns exit code 1.

`panicHandler` (root.go:156-170) is deferred around the whole run: a panic
prints a "Something unexpected happened" report and exits with code **2**,
unless `STEPDEBUG=1`, in which case it re-panics after printing version info.
A parallel helper `utils.Fail` (utils/utils.go:12-21) prints `%+v` under
STEPDEBUG and `os.Exit(1)` otherwise, used by code paths outside the app loop.

## Process spawning helpers

The root `exec` package supports commands that must hand off to child
processes: `Exec` uses `syscall.Exec` on Unix (falling back to `Run` on
Windows), `Run` waits and exits with the child's status while forwarding
signals, `RunWithPid` writes a pidfile, and `OpenInBrowser` handles per-OS
browser launching including a WSL special case (exec/exec.go:20-120).
Consumers include `step ssh proxycommand` and `step oauth`'s browser flow.

## Boundaries

The registry (`command.Register`/`Retrieve`), `step.Set/Init/BasePath`, `ui`,
`usage`, and `errs` semantics are owned by the external
`github.com/smallstep/cli-utils` module; this page describes only the contract
visible from this repository. The repository does not establish plugin
sandboxing or privilege separation — plugins run as ordinary child processes
with the same user environment.

Related: environment files and context resolution are covered in
[step environment and configuration](/openwiki/architecture/step-environment-and-configuration.md);
how to add a command is in the [change guides](/openwiki/guides/change-guides.md).
