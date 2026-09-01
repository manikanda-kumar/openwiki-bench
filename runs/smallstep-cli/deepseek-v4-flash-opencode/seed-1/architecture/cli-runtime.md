---
type: architecture
title: CLI runtime, flag system, and error handling
description: How the step CLI process starts, builds the urfave/cli application, registers commands, dispatches plugins, renders help, parses shared flags, and reports errors including the STEPDEBUG escape hatch.
tags: [step-cli, cli, urfave-cli, flags, plugins, errors]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-90c79f73277cd4b004ddf996
    resource: repo://utils/utils.go
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---

# CLI runtime, flag system, and error handling

This page covers the process lifecycle of the `step` binary: entrypoint,
application construction, command registration, plugin dispatch, the shared
flag system, and error/panic reporting.

## Entrypoint

`cmd/step/main.go` is the build target (see `Makefile`, which builds
`github.com/smallstep/cli/cmd/step`). Its `init` registers the Smallstep CLI
name/version/build time with `cli-utils/step`, sets the `step-ca` user agent,
and lets `AppName` be overridden at link time; `main` delegates to
`cmd.Run()` (`internal/cmd/root.go:46-48`).

## Application lifecycle

`run()` in `internal/cmd/root.go:50-85`:

1. Defers `panicHandler`.
2. Calls `step.Init()` to initialize the STEPPATH environment; a failure prints
   the error to stderr and returns exit code 1.
3. Constructs the app with `newApp(os.Stdout, os.Stderr)`.
4. Runs `app.Run(os.Args)`; any returned error is printed according to the
   `STEPDEBUG` environment variable and the process exits with code 1.

`newApp` (`internal/cmd/root.go:95-154`) wires the urfave/cli app:

- Redirects `pemutil.WriteFile` and password prompting to the CLI's file
  utilities and `ui.PromptPassword`.
- Overrides urfave's help machinery (`VersionPrinter`,
  `AppHelpTemplate`, `SubcommandHelpTemplate`, `CommandHelpTemplate`,
  `HelpPrinter`, `FlagNamePrefixer`, `FlagStringer`) with the `cli-utils/usage`
  templates and a custom `stringifyFlag` that derives a `<placeholder>` from a
  flag's usage text.
- Sets the app name (default `step`, overridable via `SetName`), usage
  "plumbing for distributed systems", the version from `cli-utils/step`, and
  enables bash completion.
- Registers commands retrieved from `command.Retrieve()` (provided by
  `github.com/smallstep/cli-utils/command`) and appends the built-in help flag
  plus a global `--config` flag.
- Uses `app.Writer`/`app.ErrWriter` for stdout/stderr so commands can be
  constructed with arbitrary writers (as the unit tests do).

### Command registration model

Command packages live under `command/` and register themselves in `init()` via
`command.Register(cmd)` from `cli-utils/command` (for example
`command/ca/ca.go:15-89`). `internal/cmd/root.go` imports each top-level command
package for its side effect (`root.go:30-44`); `newApp` then collects them with
`command.Retrieve()`. The command list is asserted in
`internal/cmd/root_test.go:11-27`.

## Plugin dispatch

When `step <name>` matches no built-in command, the app action
(`internal/cmd/root.go:134-147`) looks for an external plugin:

- `plugin.LookPath(name)` finds an executable named `step-<name>-plugin` in
  `$(step path)/plugins` (i.e. `$STEPPATH/plugins`) or in `$PATH`; on Windows it
  also honors `PATHEXT` extensions (`internal/plugin/plugin.go:20-52`).
- If found, `plugin.Run` executes it with the CLI's stdin/stdout/stderr and the
  remaining arguments forwarded; PowerShell scripts get special handling on
  Windows (`internal/plugin/plugin.go:56-72`).
- If the name is a known plugin (currently `kms`), a helpful "download it from"
  error is produced via `plugin.GetURL` (`internal/plugin/plugin.go:74-82`);
  otherwise the command help is shown.

## Error and panic reporting

- Errors returned by `app.Run` are printed through a `Messenger` interface when
  available. With `STEPDEBUG=1` the full error (`%+v`) is shown followed by the
  message; otherwise only the message plus "Re-run with STEPDEBUG=1 for more
  info." (`internal/cmd/root.go:62-82`).
- `panicHandler` (`internal/cmd/root.go:156-170`) re-panics under
  `STEPDEBUG=1`; otherwise it prints a generic message, shows the exact command
  to rerun with `STEPDEBUG=1`, and exits with code 2.
- The shared `utils.Fail` helper follows the same rule: print `%+v` under
  `STEPDEBUG=1`, otherwise just the message, then exit 1 (`utils/utils.go:14-23`).

## Shared flags and parsing helpers

The `flags` package (`flags/flags.go`) centralizes flags reused across command
groups, including key parameters (`--kty`, `--size`, `--curve`), security
gates (`--subtle`, `--insecure`), CA connection flags (`--ca-url`, `--root`,
`--offline`, `--ca-config`), token/x5c/sshpop/nebula flags, admin credentials,
KMS URIs, and certificate template flags. It also provides parsing helpers:

- `ParseCaURL` / `ParseCaURLIfExists` require or allow an empty `--ca-url`,
  prepend `https://` when no scheme is present, reject non-https schemes, and
  normalize IPv6 host brackets (`flags/flags.go:645-706`).
- `ParseTimeOrDuration` and `ParseTimeDuration` parse RFC 3339 times or Go
  durations (`flags/flags.go:566-596`).
- `ParseTemplateData` / `GetTemplateData` merge `--set-file` JSON with repeated
  `--set key=value` pairs, JSON-decoding values when possible
  (`flags/flags.go:598-643`).
- `FirstStringOf` returns the first explicitly set (or defaulted) flag among a
  list of aliases (`flags/flags.go:708-730`).

## Process-execution helper

`exec/exec.go` provides child-process utilities used by commands:

- `Run`/`RunWithPid` start a child with inherited stdio, forward all signals
  received by `step` to the child, wait for completion, and exit with the
  child's exit status (`exec/exec.go:56-100`, `161-177`, `199-218`).
- `Exec` uses `execve(2)` on non-Windows platforms and `Run` on Windows
  (`exec/exec.go:41-50`).
- `OpenInBrowser` opens a URL with the platform's browser command (e.g.
  `xdg-open`, `open`, `rundll32`), detecting WSL (`exec/exec.go:102-127`).
- `Step` re-executes the current binary (`os.Args[0]`) with the given
  arguments and returns its stdout — used, for example, by the OIDC token flow
  to run `step oauth` (`exec/exec.go:129-146`).
