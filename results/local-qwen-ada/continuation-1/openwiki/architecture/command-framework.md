---
type: "Reference"
title: "Command Framework and Application Lifecycle"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-882e38f88802d0d233736d95
    resource: repo://internal/cryptoutil/cryptoutil.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-09-14T13:44:47.469Z" }
---

# Command Framework and Application Lifecycle

The `step` binary is a `urfave/cli` (v1.22.17 per `go.mod`) application. All commands
self-register through Go `init()` functions, and the set of commands that actually ship
is controlled by a list of blank imports in one file. This page documents the boot
sequence, the registration model, the plugin dispatch, the context-injection helper,
error/panic handling, and how version strings are injected.

## Entry point

`cmd/step/main.go` is the entire `main` package:

- Package variables `Version`, `BuildTime`, and `AppName` default to `"N/A"`/`""` and are
  intended to be set by LDFLAGS at build time (see [Version injection](#version-injection)).
- `init()` calls `step.Set("Smallstep CLI", Version, BuildTime)` from
  `github.com/smallstep/cli-utils/step`, sets the HTTP user agent used by
  `smallstep/certificates` clients via `ca.UserAgent = step.Version()`, and calls
  `cmd.SetName(AppName)` to override the binary name.
- `main()` calls `cmd.Run()` in `internal/cmd/root.go`.

## Boot sequence

`internal/cmd/root.go` implements the lifecycle:

1. `Run()` executes `os.Exit(run())`.
2. `run()` defers `panicHandler()`, then calls `step.Init()` (cli-utils) to initialize the
   step environment (`$STEPPATH`, contexts). If initialization fails, the error is written
   to stderr and the process exits with status 1.
3. `newApp(os.Stdout, os.Stderr)` builds the `*cli.App` and `app.Run(os.Args)` dispatches.

Error handling in `run()`: if the returned error implements a `Message() string` method
(a `messenger` interface), that user-facing message is printed; otherwise the raw error is
printed. In both cases, when the environment variable `STEPDEBUG=1` is set, the full error
(`%+v`) is printed instead. For messenger errors without `STEPDEBUG`, the hint
`Re-run with STEPDEBUG=1 for more info.` is appended. Any failure returns exit code 1.

## App construction and framework overrides

`newApp` (`internal/cmd/root.go`) wires framework-level behavior:

- Default file writer and password prompters for `go.step.sm/crypto` are replaced:
  `pemutil.WriteFile = fileutil.WriteFile`, and `pemutil.PromptPassword`/`jose.PromptPassword`
  call `ui.PromptPassword` from cli-utils.
- Global `urfave/cli` components are overridden: `cli.VersionPrinter` (delegates to
  `command/version` `Command`), help templates from `cli-utils/usage`
  (`AppHelpTemplate`, `SubcommandHelpTemplate`, `CommandHelpTemplate`, `HelpPrinter`,
  `FlagNamePrefixer`), and `cli.FlagStringer = stringifyFlag`, which renders a flag's
  `Usage` and pulls the `<placeholder>` token out of the usage text with the regex
  `` `.*?>`` (falling back to `<value>` for non-bool flags).
- The app: `Name`/`HelpName` come from the package variable `stepAppName` (default
  `"step"`, overridable via `SetName`), `Usage` is `"plumbing for distributed systems"`,
  `Version` is `step.Version()`, `Commands = command.Retrieve()` (all registered commands),
  `EnableBashCompletion = true`, and copyright is computed from the current year.
- A global `--config` flag is added: `path to the config file to use for CLI flags`.
- The app `Action` handles the bare `step` invocation and unknown top-level names:
  - If the first argument is non-empty, it first tries `plugin.LookPath(name)`; a match is
    executed with `plugin.Run(ctx, file)`.
  - Otherwise, if `plugin.GetURL(name)` is non-empty (currently only `kms` maps to
    `https://github.com/smallstep/step-kms-plugin`), it errors with a "not found /
    download it from" message.
  - Otherwise it falls back to `cli.ShowCommandHelp`, or `cli.ShowAppHelp` with no args.

## Command registration model

Per the convention in `command/README.md`, each level of the command hierarchy lives in its
own package under `command/`. A command is defined by constructing a `cli.Command` and
registering it in the package `init()`:

```go
func init() {
    cmd := cli.Command{ ... }
    command.Register(cmd) // github.com/smallstep/cli-utils/command
}
```

`command.Retrieve()` in `newApp` returns everything that has been registered. A package is
only linked (and therefore only registers) if it is imported, so the enabled command set is
determined by the blank imports at the bottom of `internal/cmd/root.go`:

- Enabled command groups: `command/api`, `command/base64`, `command/beta`, `command/ca`,
  `command/certificate`, `command/completion`, `command/context`, `command/crl`,
  `command/crypto`, `command/fileserver`, `command/oauth`, `command/path`, `command/ssh`.
- Enabled CAS interfaces (from `smallstep/certificates`, needed by the embedded offline
  CA): `cas/cloudcas`, `cas/softcas`, `cas/stepcas`.

A minimal registration example is `command/base64/base64.go`, whose `init()` builds the
`step base64` command with its flags and calls `command.Register(cmd)`.

## Plugin system

`internal/plugin/plugin.go` implements external extension via executables named
`step-<name>-plugin`:

- `LookPath(name)`:
  - Windows: checks `$(step path)/plugins` (via `step.BasePath()` from cli-utils) for the
    name with extensions from `PATHEXT` (default `.com .exe .bat .cmd .ps1`), then
    `exec.LookPath` over `PATH`.
  - Other platforms: checks `$(step path)/plugins/step-<name>-plugin`, then `exec.LookPath`.
- `Run(ctx, file)`: executes the file with the command's arguments (`args[1:]`), wiring
  stdin/stdout/stderr. On Windows, `.ps1` files are invoked through
  `powershell -noprofile -nologo`.
- `GetURL(name)`: returns a download hint for well-known plugins; only `kms` is mapped.

Plugins are used in two places:

1. App fallback: an unknown top-level `step <name>` is dispatched to `step-<name>-plugin`
   (see [App construction](#app-construction-and-framework-overrides)).
2. KMS URIs: `internal/cryptoutil/cryptoutil.go` calls `plugin.LookPath("kms")` (for
   public key, signing, and attestation) to talk to `step-kms-plugin`; the
   `Attestor` interface (`crypto.Signer` + `Attest`) is defined there.

## Context injection for context-based actions

`internal/command/inject.go` provides `InjectContext(injectedCtx, fn, middleware...)`,
which adapts a `func(context.Context) error` into a `cli.ActionFunc`:

- The injected context is forced as the first middleware so every later middleware and
  `fn` operate on the same `context.Context` instance.
- `wrap` starts from `context.Background()`, applies middleware in order, then stores the
  `*cli.Context` under an unexported `cliCtxKey`.
- `CLIContextFromContext(ctx)` retrieves the stored `*cli.Context` and panics if it was
  never set.

This is the pattern used by commands that need both the Go context (for cancellation and
CA clients) and the urfave `*cli.Context` (for flags/args).

## Panic handling

`panicHandler()` in `internal/cmd/root.go` recovers from panics:

- With `STEPDEBUG=1`: prints the CLI version and release date, then re-panics (so a full
  stack trace is produced).
- Otherwise: prints `Something unexpected happened.`, the instruction to re-run with
  `STEPDEBUG=1 <command>`, and to send the output to `info@smallstep.com`, then exits
  with status 2.

## Version injection

`Makefile` lines 66/69 define:

```make
LDFLAGS := -ldflags='-X "main.Version=$(VERSION)" -X "main.BuildTime=$(DATE)"'
```

(the `GOOS_OVERRIDE`/release variant strips symbols with `-w`). `main.Version` and
`main.BuildTime` in `cmd/step/main.go` are the injection targets; `step.Version()` and
`step.ReleaseDate()` (cli-utils, populated by `step.Set` in `main.init`) surface them, and
`step version` (registered in `command/version/version.go`) prints them.

## Change guide: add a new top-level command

1. Create a package at `command/<name>/` (per `command/README.md`, one package per
   hierarchy level; shared non-business logic belongs at the repo top level, e.g.
   `flags/` or cli-utils).
2. In its `init()`, construct the `cli.Command` (with `Usage`, `UsageText`, `Description`,
   `Flags`, `Action`) and call `command.Register(cmd)`.
3. Add the blank import `_ "github.com/smallstep/cli/command/<name>"` to
   `internal/cmd/root.go` to enable it.
4. Add tests (unit tests in the package and/or an `integration/` test that drives the
   built binary, see `integration/main_test.go`).
5. Update `CHANGELOG.md` per `docs/CONTRIBUTING.md` for user-visible changes.
6. Validate with `make lint` and `make test`.

## Related

- [Repository Architecture and Ownership](/openwiki/architecture/overview.md)
- [Configuration, Contexts, and Environment](/openwiki/configuration/environment.md)
- [Build, Test, and Change Guides](/openwiki/development/build-test-and-change-guides.md)
