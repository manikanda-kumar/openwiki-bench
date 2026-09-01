---
type: architecture
title: Command Dispatch and Runtime Lifecycle
description: How a `step` invocation travels from main() through the urfave/cli app, the command registry, the plugin fallback, and error handling to a process exit code.
tags: [architecture, cli, dispatch, plugins, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# Command Dispatch and Runtime Lifecycle

## Entry point and process boundaries

The shipped binary is built from `cmd/step/main.go` (the Makefile and GoReleaser
configuration both target this package). `main()` does nothing but call
`cmd.Run()`; all assembly of the application happens in
`internal/cmd/root.go`.

At package initialization, `cmd/step/main.go` sets three process-wide values:

- `Version` and `BuildTime` are package variables stamped by `-ldflags
  -X main.Version=... -X main.BuildTime=...` at build time (the Makefile `build`
  target and the GoReleaser `ldflags` both inject these; the defaults are
  `"N/A"`).
- `step.Set("Smallstep CLI", Version, BuildTime)` records the build metadata in
  the shared `cli-utils/step` state that later feeds `step version`.
- `ca.UserAgent = step.Version()` makes every `step-ca` HTTP client advertise
  the CLI version, and `cmd.SetName(AppName)` allows the binary name to differ
  from `step` (it defaults to `step`).

`cmd.Run()` wraps `run()` with `os.Exit`, so the process exit code is whatever
`run()` returns: `0` on success, `1` when `app.Run(os.Args)` or `step.Init()`
fails, and `2` on a recovered panic.

## Startup sequence in `internal/cmd/root.go`

`run()` performs, in order:

1. **Deferred panic recovery.** `panicHandler` is deferred first. If a panic
   escapes any command, the handler prints a short report and exits with code
   `2`. With `STEPDEBUG=1` it prints the version and release date and re-panics
   so the original stack trace is visible. The panic message instructs users to
   re-run with `STEPDEBUG=1` and mail the output to Smallstep.
2. **Step environment initialization.** `step.Init()` (from
   `github.com/smallstep/cli-utils/step`) prepares the on-disk step environment
   (STEPPATH and its defaults). A failure here prints to stderr and returns
   exit code `1`.
3. **App assembly.** `newApp(os.Stdout, os.Stderr)` builds the `urfave/cli`
   application.
4. **Run and report.** `app.Run(os.Args)` executes the parsed command. Errors
   are rendered to stderr; the exit code is `1`.

### Error rendering and `STEPDEBUG`

Errors returned by command actions are inspected for a `Message()` method —
the convention used by `cli-utils/errs` errors. Without `STEPDEBUG`, the user
sees only the short `Message()` plus the hint `Re-run with STEPDEBUG=1 for more
info.`; with `STEPDEBUG=1` the full `%+v` error (including stack details where
`pkg/errors` provides them) and the message are printed. Non-messenger errors
print their `Error()` string (or full detail under `STEPDEBUG=1`).

## App assembly and framework overrides

`newApp` does more than create a `cli.App`; it installs several framework-wide
behaviors:

- **Crypto I/O hooks.** `pemutil.WriteFile`, `pemutil.PromptPassword`, and
  `jose.PromptPassword` are pointed at the CLI's `fileutil.WriteFile` and
  `ui.PromptPassword`. This is how every PEM/JWE operation anywhere in the
  binary shares one consistent encrypted-file prompt behavior.
- **Usage rendering.** `cli.AppHelpTemplate`, `SubcommandHelpTemplate`,
  `CommandHelpTemplate`, `HelpPrinter`, and `FlagNamePrefixer` are replaced with
  implementations from `cli-utils/usage`, which document positional arguments
  and reflow flag help.
- **Flag stringification.** The local `stringifyFlag` renders flags as
  `--name, -n <placeholder>\tusage`, deriving the placeholder from a `<...>`
  span in the usage text and defaulting to `<value>` for non-boolean flags.
- **Version printing.** `cli.VersionPrinter` routes `--version` through
  `command/version`, which prints the version and release date recorded by
  `step.Set`.
- **Command set.** `app.Commands = command.Retrieve()` returns every command
  registered through `command.Register` (see below). `app.EnableBashCompletion`
  is on, and a global `--config` flag exists for CLI flag configuration files.
- **Identity.** `app.Name`/`app.HelpName` default to `step` (renameable via
  `SetName`), and usage is `"plumbing for distributed systems"`.

### The command registry

Command packages self-register: each package's `init()` builds a
`cli.Command` and calls `command.Register(cmd)` from
`github.com/smallstep/cli-utils/command`. The root package blank-imports all
enabled command groups (`api`, `base64`, `beta`, `ca`, `certificate`,
`completion`, `context`, `crl`, `crypto`, `fileserver`, `oauth`, `path`, `ssh`)
plus the enabled CA backends (`certificates/cas/cloudcas`, `softcas`,
`stepcas`) so their `init()` functions run. The unit test
`internal/cmd/root_test.go` pins the exact top-level command list —
`help, api, base64, fileserver, path, certificate, completion, context, crl,
crypto, oauth, version, ca, beta, ssh` — so adding a command package without
wiring it (or removing one) fails the test. `command/README.md` documents this
registration pattern as the required way to add commands.

`internal/command.InjectContext` is the bridge for commands that need a
`context.Context`: it wraps an action function with middleware, injects a
caller-supplied context first, and stores the `*cli.Context` inside the
`context.Context` for retrieval via `CLIContextFromContext`. Commands in the
policy and ACME groups use this instead of plain `func(*cli.Context) error`
actions.

## Fallback dispatch: unknown commands become plugins

`app.Action` runs when the first argument is not a registered command (or when
`step` is run bare). Its decision order:

1. If `plugin.LookPath(name)` finds an executable, run it via `plugin.Run`
   with all remaining arguments.
2. Else if `plugin.GetURL(name)` knows the plugin name (currently only `kms`,
   mapping to the step-kms-plugin GitHub project), return an error telling the
   user the plugin was not found and where to download it.
3. Else show help for that name (which prints "unknown command" style help).
4. With no arguments, show the app help.

### Plugin discovery and execution

`internal/plugin.LookPath` searches for `step-<name>-plugin`:

- first in `$(step path)/plugins` (the STEPPATH `plugins` directory);
- then on `PATH` via `exec.LookPath`.

On Windows, the STEPPATH check iterates the extensions from `PATHEXT`
(falling back to `.com .exe .bat .cmd .ps1`), and `plugin.Run` invokes
PowerShell scripts (`.ps1`) through `powershell -noprofile -nologo` instead of
executing them directly. The child process inherits stdin/stdout/stderr, so
plugins behave interactively like built-in commands.

## Shell completion

Beyond `EnableBashCompletion`, the `completion` command prints ready-made
scripts for `bash` and `zsh` (embedded in `command/completion/completion.go`)
and generates a `fish` script from the app definition itself via
`ctx.App.ToFishCompletion()`. The repository also ships standalone
`autocomplete/bash_autocomplete` and `autocomplete/zsh_autocomplete` files for
packagers.

## Failure behavior summary

| Situation | Exit code | Extra behavior |
| --- | --- | --- |
| Command succeeds | `0` | — |
| `step.Init()` fails | `1` | error on stderr |
| `app.Run` returns an error | `1` | short message unless `STEPDEBUG=1` |
| Recovered panic | `2` | debug instructions; full panic only with `STEPDEBUG=1` |

The `--config` global flag is parsed by `urfave/cli` itself (flags from the
named file are applied to the context), and `EnableBashCompletion` adds
`--generate-bash-completion` handling inside the app rather than in each
command.
