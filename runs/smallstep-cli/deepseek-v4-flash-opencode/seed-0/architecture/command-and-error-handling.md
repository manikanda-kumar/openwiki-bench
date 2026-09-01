---
type: architecture
title: Command Framework, Plugins, and Error Handling
description: How the step CLI builds its urfave/cli application, registers command groups, discovers and runs step plugins, and surfaces errors and panics including the STEPDEBUG behavior.
tags: [cli, urfave-cli, command-registration, plugins, error-handling]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---

# Command Framework, Plugins, and Error Handling

This page describes the plumbing around the `step` command tree: how the
application is assembled, how command groups register themselves, how external
`step-<name>-plugin` executables are discovered and executed, and how errors
and panics are surfaced to the user.

## Entrypoint and application assembly

The process entrypoint is `cmd/step/main.go`. Its `init` records build-time
version metadata (injected through `-ldflags`) into the `step` package via
`step.Set("Smallstep CLI", Version, BuildTime)` and sets the step-ca HTTP user
agent from `step.Version()`; `main` then calls `cmd.Run()` from
`internal/cmd/root.go`.

`internal/cmd/root.go` is the single place where the `urfave/cli` application
is assembled:

- `run()` first initializes the step environment with `step.Init()`, creates
  the app with `newApp`, executes `app.Run(os.Args)`, and translates any
  returned error into a stderr message (see [Error handling](#error-handling)).
- `newApp()` wires default file writers and password prompters for
  `go.step.sm/crypto` (`pemutil.WriteFile`, `pemutil.PromptPassword`,
  `jose.PromptPassword`), overrides the framework's version and help printers
  with templates from `cli-utils/usage`, sets `app.Commands` to
  `command.Retrieve()`, enables bash completion, and adds a global `--config`
  flag.
- The CAS backends that step-ca offers are enabled as blank imports
  (`cloudcas`, `softcas`, `stepcas`).

## Command registration

Command groups are not wired into the root app directly. Each package under
`command/` defines a `cli.Command` and calls `command.Register(cmd)` in its
`init()` function; `internal/cmd/root.go` pulls the full tree with
`command.Retrieve()`. Enabling a command group is a matter of adding a blank
import to the `Enabled commands` block in `root.go`.

A representative example is `command/certificate/certificate.go`, whose
`init()` builds a `cli.Command` with all its subcommands and registers it.
Registration details such as `Register` and `Retrieve` live in the external
`github.com/smallstep/cli-utils/command` package.

The root app also sets `cli.VersionPrinter` to the `version` command, so
`step --version` renders through the same code path as `step version`.

## Plugins

When a user runs `step <name>` where `<name>` is not a built-in command, the
app falls through to `app.Action`:

1. `plugin.LookPath(name)` searches for an executable named
   `step-<name>-plugin` in `$STEPPATH/plugins` (i.e. `step.BasePath()` joined
   with `plugins`) and then in `$PATH` via `exec.LookPath`. On Windows it also
   iterates the `PATHEXT` extensions (defaulting to `.com`, `.exe`, `.bat`,
   `.cmd`, `.ps1`).
2. If found, `plugin.Run` executes it, inheriting stdin/stdout/stderr. On
   Windows a `.ps1` plugin is invoked through `powershell` with
   `-noprofile -nologo`.
3. If not found, `plugin.GetURL(name)` returns a download URL for a known
   plugin (currently only `step-kms-plugin`), and the CLI prints an error
   pointing at it.
4. Otherwise the subcommand help is shown.

`exec/exec.go` provides the process-spawning helpers used across commands:
`Exec` (an `execve(2)` wrapper), `Run` (spawns a child and forwards all
signals to it, exiting with the child's exit status), `RunWithPid` (writes the
child PID to a file), `OpenInBrowser` (platform-specific `open`/`xdg-open`/
`rundll32`), `Step` (re-invokes the current `step` binary and returns its
stdout), and `Command` (runs an arbitrary command capturing output).

## Error handling

`run()` reports command errors:

- If the returned error implements a `Message()` method (a "messenger"), its
  message is printed to stderr. With `STEPDEBUG=1`, the full error (via
  `%+v`) is printed followed by the message; otherwise the CLI appends
  "Re-run with STEPDEBUG=1 for more info."
- Plain errors are printed directly, and with `STEPDEBUG=1` the full wrapped
  error is shown.
- Any error path returns exit code 1.

`panicHandler` (deferred in `run`) catches panics:

- With `STEPDEBUG=1` it prints the version and release date, then re-panics.
- Otherwise it prints "Something unexpected happened.", tells the user to
  re-run with `STEPDEBUG=1` and to send the output to
  info@smallstep.com, and exits with code 2.

Note that panic recovery only wraps panics that propagate through `run()`; the
behavior of the recovery relies on `STEPDEBUG` being exactly `"1"`.

## Shell completion and the version command

- `step completion <shell>` prints a completion script. `bash` and `zsh`
  scripts are stored inline in `command/completion/completion.go` and call back
  into the CLI with `--generate-bash-completion`; `fish` completions are
  generated through `ctx.App.ToFishCompletion()`. This is backed by
  `app.EnableBashCompletion = true` in `newApp`.
- `step version` prints `step.Version()` and `step.ReleaseDate()` from
  `cli-utils/step`, which were populated at startup.
- Global commands such as `version` and `completion` declare the hidden
  `--no-context` flag (`flags.HiddenNoContext`) so that context configuration
  is not applied when they run.
