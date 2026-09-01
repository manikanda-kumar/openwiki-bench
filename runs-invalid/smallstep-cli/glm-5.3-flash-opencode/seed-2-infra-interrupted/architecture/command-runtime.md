---
type: runtime-and-dispatch
title: Command registration, dispatch, and runtime behavior
description: How the step binary boots, registers commands, dispatches to built-ins or plugins, and reports errors, panics, and exit codes.
tags: [cli, runtime, dispatch, urfave-cli, plugins, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:55:27.913Z
---

# Command registration, dispatch, and runtime behavior

This page explains what happens between `step ...` being typed at a shell and a
command's action function running, and how the process reports errors, panics,
versions, and exit codes. It covers the machinery in `internal/cmd` and
`internal/command`, the plugin fallback for unknown commands, and the small
always-registered utility commands. For the layered architecture and module
boundaries around this runtime, see [Architecture and ownership
boundaries](/openwiki/architecture/overview.md).

## Entry point and boot sequence

The `main` package is intentionally trivial: `cmd/step/main.go` declares three
package-level variables — `Version`, `BuildTime`, and `AppName` — whose values
are injected at build time via `-ldflags -X` (see [Build, release, and
packaging](/openwiki/operations/build-release-packaging.md)), then `main()` does
nothing but call `cmd.Run()`.

```go
// cmd/step/main.go
var Version = "N/A"
var BuildTime = "N/A"
var AppName = ""

func init() {
	step.Set("Smallstep CLI", Version, BuildTime)
	ca.UserAgent = step.Version()
	cmd.SetName(AppName)
}

func main() {
	cmd.Run()
}
```

The package `init()` publishes the injected values to cli-utils' global `step`
state (`step.Set`), sets the user agent that the `smallstep/certificates` CA
client sends (`ca.UserAgent = step.Version()`), and lets the binary be renamed
via `cmd.SetName(AppName)` (`internal/cmd/root.go:89-93` keeps the default
`step` when the variable is empty).

`cmd.Run()` is a thin wrapper: `os.Exit(run())` (`internal/cmd/root.go:46-48`),
so the integer returned by `run()` is the process exit code. `run()` performs
three steps in order (`internal/cmd/root.go:50-85`):

1. `defer panicHandler()` — recover from panics (below).
2. `step.Init()` — initialize the cli-utils environment (base path, contexts)
   before any command logic runs. On failure the error is printed to stderr and
   the process exits 1. The initializer itself lives in the external
   `github.com/smallstep/cli-utils` module (go.mod pins `cli-utils v0.12.2`);
   this repository only establishes that it must succeed before the app is
   built.
3. `app.Run(os.Args)` on the app from `newApp`, then error presentation (below).

## Command registration model

Commands are not listed centrally. Every command group calls
`command.Register(cmd)` from its package `init()` — for example the `version`
command (`command/version/version.go:14-27`) and the whole `ca` group
(`command/ca/ca.go:15-89`). The root assembles the tree with
`app.Commands = command.Retrieve()` (`internal/cmd/root.go:122`).

Because registration depends on package `init()`, a top-level command only
exists if its package is imported — which is done with blank imports in
`internal/cmd/root.go`:

```go
// internal/cmd/root.go
// Enabled cas interfaces.
_ "github.com/smallstep/certificates/cas/cloudcas"
_ "github.com/smallstep/certificates/cas/softcas"
_ "github.com/smallstep/certificates/cas/stepcas"

// Enabled commands
_ "github.com/smallstep/cli/command/api"
_ "github.com/smallstep/cli/command/base64"
_ "github.com/smallstep/cli/command/beta"
_ "github.com/smallstep/cli/command/ca"
_ "github.com/smallstep/cli/command/certificate"
_ "github.com/smallstep/cli/command/completion"
_ "github.com/smallstep/cli/command/context"
_ "github.com/smallstep/cli/command/crl"
_ "github.com/smallstep/cli/command/crypto"
_ "github.com/smallstep/cli/command/fileserver"
_ "github.com/smallstep/cli/command/oauth"
_ "github.com/smallstep/cli/command/path"
_ "github.com/smallstep/cli/command/ssh"
```

The same import block is also where the CA backend interfaces
(`cloudcas`, `softcas`, `stepcas` from `smallstep/certificates`) are registered.
`internal/cmd/root_test.go:22-26` pins the resulting top-level command list —
`help`, `api`, `base64`, `fileserver`, `path`, `certificate`, `completion`,
`context`, `crl`, `crypto`, `oauth`, `version`, `ca`, `beta`, `ssh` — so adding
or removing a blank import visibly changes that test (see [Change guide:
adding a new command](/openwiki/guides/add-a-new-command.md)).

## App construction and framework overrides

`newApp` (`internal/cmd/root.go:95-154`) configures the urfave/cli app:

- **Password and file-write injection.** `pemutil.WriteFile`,
  `pemutil.PromptPassword`, and `jose.PromptPassword` (globals owned by
  `go.step.sm/crypto`) are wired to cli-utils' `fileutil.WriteFile` and the ui
  password prompter (`internal/cmd/root.go:96-103`). Every command that reads or
  writes encrypted keys through those libraries inherits step's prompting and
  atomic-write behavior from this single injection point.
- **Help and flag formatting.** `cli.AppHelpTemplate`,
  `cli.SubcommandHelpTemplate`, `cli.CommandHelpTemplate`, `cli.HelpPrinter`,
  `cli.FlagNamePrefixer`, and `cli.FlagStringer` are replaced with the cli-utils
  `usage` package implementations (`internal/cmd/root.go:109-114`), which is how
  step's markdown-style help (argument documentation, `**bold**` usage text)
  renders. `stringifyFlag` (`internal/cmd/root.go:182-194`) derives flag
  placeholders from the usage text.
- **Identity.** `app.Name`/`app.HelpName` come from `stepAppName` (default
  `step`), usage string is "plumbing for distributed systems", and
  `app.Version` is `step.Version()` (`internal/cmd/root.go:117-125`).
- **Global flags.** `--config` ("path to the config file to use for CLI flags")
  and the help flag are appended app-wide (`internal/cmd/root.go:123-131`).
  Individual commands then add their own flags, frequently reusing shared
  definitions from the `flags` package.
- **Completion.** `app.EnableBashCompletion = true` enables urfave/cli's
  `--generate-bash-completion` machinery that the `step completion` scripts
  invoke.

## Dispatch: built-ins, plugins, and help

The app-level `Action` runs when urfave/cli does not match a registered
subcommand (`internal/cmd/root.go:134-147`):

```go
app.Action = func(ctx *cli.Context) error {
	args := ctx.Args()
	if name := args.First(); name != "" {
		if file, err := plugin.LookPath(name); err == nil {
			return plugin.Run(ctx, file)
		}
		if u := plugin.GetURL(name); u != "" {
			return fmt.Errorf("The plugin %q was not found on this system.\nDownload it from %s", name, u)
		}
		return cli.ShowCommandHelp(ctx, name)
	}
	return cli.ShowAppHelp(ctx)
}
```

So an unknown first argument is resolved in this order:

1. **Plugin on disk.** `plugin.LookPath(name)` looks for an executable named
   `step-<name>-plugin` in `$STEPPATH/plugins` and then on `PATH`
   (`internal/plugin/plugin.go:20-52`; on Windows it also tries the extensions
   from `PATHEXT`, defaulting to `.com/.exe/.bat/.cmd/.ps1`). A hit is executed
   with the remaining arguments and inherited stdio
   (`internal/plugin/plugin.go:56-72`); a `.ps1` plugin on Windows is run via
   `powershell -noprofile -nologo`. This is the mechanism behind
   `step-kms-plugin` and other `step-<name>-plugin` executables (see
   [KMS URIs, step-kms-plugin, and the plugin
   system](/openwiki/integrations/kms-and-plugins.md)).
2. **Known-but-absent plugin.** `plugin.GetURL` currently only knows `kms` and
   returns its project URL (`internal/plugin/plugin.go:75-81`), producing the
   "was not found on this system / Download it from ..." error.
3. **Help.** Otherwise `cli.ShowCommandHelp` prints help for that name (which
   covers misspellings of real commands), and with no arguments the app help is
   shown.

## Context middleware

Actions that work with `context.Context` do not take the raw urfave/cli context.
`internal/command/inject.go` provides the bridge:

- `InjectContext(injectedCtx, fn, middleware...)` returns a `cli.ActionFunc`
  that builds a fresh `context.Background()`, applies each middleware
  sequentially (with the injected context as the mandatory first middleware so
  later middleware operate on it), stores the `*cli.Context` inside the context
  under a private key, and finally calls `fn(ctx)`
  (`internal/command/inject.go:14-56`).
- `CLIContextFromContext(ctx)` retrieves that `*cli.Context` and panics if it
  was never attached (`internal/command/inject.go:34-36`), which is safe because
  only actions wrapped by this bridge can call it.

Several command groups (for example the CA policy commands under
`command/ca/policy`) use this pattern to thread policy contexts through
middleware.

## Error presentation, exit codes, and panics

`run()` maps errors to process behavior (`internal/cmd/root.go:62-84`):

- If the error implements `Message() string` (the "messenger" interface used by
  cli-utils' `errs` types), the friendly message goes to stderr followed by
  `Re-run with STEPDEBUG=1 for more info.`; with `STEPDEBUG=1` the full error
  with stack (`%+v`) and the message are printed instead.
- Plain errors are printed with `fmt.Fprintln(os.Stderr, err)` (or `%+v` under
  `STEPDEBUG=1`).
- Any error path returns exit code 1; success returns 0. Commands themselves
  normally return wrapped errors rather than calling `os.Exit`.

Panics are handled by the deferred `panicHandler`
(`internal/cmd/root.go:156-170`): with `STEPDEBUG=1` it prints the version and
release date and re-panics (preserving the crash for a debugger); without it, it
prints "Something unexpected happened." plus instructions to rerun with
`STEPDEBUG=1` and report to info@smallstep.com, then exits with code **2** —
distinct from the exit code 1 used for ordinary errors.

The `exec` package adds process-level behaviors used across commands
(`exec/exec.go`): `Exec` replaces the current process via `syscall.Exec` on
non-Windows platforms and falls back to `Run` on Windows
(`exec/exec.go:41-50`); `Run` starts a child with inherited stdio and forwards
all signals to it, exiting with the child's status
(`exec/exec.go:56-69, 200-217`); and `Step` re-executes the step binary itself
(`os.Args[0]`) capturing stdout — the mechanism `step ca token` uses to shell
out to `step oauth` for OIDC provisioners
(`exec/exec.go:130-146`, used by `generateOIDCToken` in
`utils/cautils/token_generator.go:144-169`).

## Version reporting

`step version` prints `step.Version()` and `step.ReleaseDate()`
(`command/version/version.go:30-33`), and `cli.VersionPrinter` is overridden to
the same function so `step --version` produces identical output
(`internal/cmd/root.go:106-108`). The values originate from the `-ldflags "-X
main.Version=... -X main.BuildTime=..."` injection in the Makefile and
GoReleaser config (see [Build, release, and
packaging](/openwiki/operations/build-release-packaging.md)), and the CA client
user agent is set from the same version string in `cmd/step/main.go:23`.

## Utility commands always registered

A few small commands ride along with the runtime and are useful as minimal
registration examples:

- **`step path`** prints the configured step path (see [STEPPATH, defaults.json,
  and contexts](/openwiki/concepts/steppath-and-contexts.md)).
- **`step completion <shell>`** prints hardcoded bash/zsh completion scripts and
  generates the fish script from the app (`command/completion/completion.go:100-123`).
- **`step base64`** encodes/decodes stdin or arguments, auto-detecting raw/url
  alphabets when decoding (`command/base64/base64.go:82-114`).
- **`step fileserver`** is `Hidden: true` and explicitly documented as
  experimental/test-only: it serves a directory over HTTP(S) with an optional
  mTLS client-CA, a pidfile, SIGHUP-triggered TLS reload, and a 5-second
  graceful shutdown on SIGINT/SIGTERM (`command/fileserver/fileserver.go:28-40,
  187-208`).
- **`step beta`** re-exposes in-development APIs — currently it nests
  `ca.BetaCommand()`, which in turn exposes the `acme` group
  (`command/beta/beta.go:14-28`, `command/ca/ca.go:159-170`).

## Representative tests

- `internal/cmd/root_test.go:11-46` asserts the exact set of top-level commands
  produced by registration (`TestAppHasAllCommands`) and that a bare `step` run
  prints the app banner to stdout with empty stderr (`TestAppRuns`).
- The `integration/` package runs end-to-end scenarios through the same
  `cmd.Run` entrypoint using testscript txtar fixtures — see [Testing
  strategy](/openwiki/operations/testing.md).

## Boundaries and uncertainty

- The behavior of `step.Init()`, `command.Register/Retrieve`, the `usage`
  templates, and `errs` error types is owned by the external
  `github.com/smallstep/cli-utils` module; this repository pins
  `cli-utils v0.12.2` in `go.mod` but does not vendor its implementation, so
  precise internals of those calls are not established here.
- Plugin resolution depends on the environment (`$STEPPATH`, `PATH`,
  `PATHEXT`); the repository establishes the lookup order above but not any
  caching or version negotiation with plugin binaries.
