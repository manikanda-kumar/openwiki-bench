---
type: architecture
title: CLI Runtime and Command Registration
description: How the step binary boots, wires urfave/cli, self-registers command packages, injects context middleware, and handles errors and panics with STEPDEBUG diagnostics.
tags: [architecture, cli, urfave, runtime, boot, errors]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# CLI Runtime and Command Registration

`step` is a Go binary built around the `urfave/cli` framework. Command
packages in `command/` self-register with a shared registry at import time,
and `internal/cmd/root.go` assembles them into a single `cli.App`.

## Boot sequence

Execution starts in `cmd/step/main.go`. `main()` calls `cmd.Run()` from
`internal/cmd`; the `init()` function seeds the process global identity via
`step.Set("Smallstep CLI", Version, BuildTime)`, sets the CA `UserAgent`
string, and applies an overridable app name (`cmd.SetName`) that defaults to
`step`. `Version` and `BuildTime` are normally injected by the linker at build
time.

Within `run()` (root.go:50-85), the process first calls `step.Init()` to
initialize the step environment (including the STEPPATH); any failure is
printed to stderr and returns exit code 1. A panic guard (`defer
panicHandler()`) wraps the whole run. The app instance is created with
`newApp(os.Stdout, os.Stderr)`, then `app.Run(os.Args)` executes.

## cli.App wiring

`internal/cmd/root.go:95-154` (`newApp`) configures the `urfave/cli` app:

- Default file writers and password prompters for `go.step.sm/crypto` are
  assigned (`pemutil.WriteFile`, `pemutil.PromptPassword`,
  `jose.PromptPassword`), binding crypto key writing to `fileutil.WriteFile`
  and prompting to the shared `ui` package.
- The global `cli` framework components are replaced with `cli-utils/usage`
  templates and help printers, plus a custom flag stringifier.
- The app uses the shell `Usage` text "plumbing for distributed systems",
  enables bash completion, sets the copyright year, and registers all commands
  via `command.Retrieve()` (from `github.com/smallstep/cli-utils/command`).
- A global `--config` string flag is appended; it is the custom configuration
  flag used by the CLI for flags.
- `app.Action` (root.go:134-147) handles bare invocations: if the first
  argument is a plugin (`plugin.LookPath`), it runs the plugin; otherwise it
  falls back to showing command help.

Command packages are pulled into the binary through registered blank imports
in `internal/cmd/root.go:31-43`, e.g. `_ "github.com/smallstep/cli/command/ca"`
and `_ "github.com/smallstep/cli/command/crypto"`. The `command.Register(cmd)`
call in each package's `init()` links the `cli.Command` into the shared
registry that `command.Retrieve()` returns. For example, `command/ca/ca.go`
registers the `ca` command group with its subcommands, and
`command/crypto/crypto.go` registers the `crypto` group.

## Context and middleware injection

`internal/command/inject.go` provides helpers that translate a
`*cli.Context` into a `context.Context` for command action handlers:

- `InjectContext` injects an existing context as the first middleware and
  then wraps an action func with additional middleware.
- `withCLIContext` stores the `*cli.Context` under a private package key;
  `CLIContextFromContext` recovers it (panicking if absent).
- `wrap` builds a fresh `context.Background()`, applies each middleware in
  order, attaches the `cli.Context`, and runs the action function.

This lets command actions receive a `context.Context` carrying the CLI context
for services that need it (used with `command.ActionFunc`).

## Error handling and STEPDEBUG

`run()` in root.go:62-82 handles a non-nil `app.Run` return value:

- If the error implements a `Message() string` interface, with `STEPDEBUG=1`
  the full error stack is printed followed by the message; otherwise just the
  message plus "Re-run with STEPDEBUG=1 for more info."
- Any other error prints the full stack when `STEPDEBUG=1` and the plain error
  otherwise.
- Non-zero exit code 1 is always returned on error.

The global `panicHandler` (root.go:156-170) recovers panics: with
`STEPDEBUG=1` it reprints version/release date and re-panics (so the runtime
prints the full trace); otherwise it prints "Something unexpected happened."
and asks the user to re-run with `STEPDEBUG=1`, then exits with code 2.

`utils/utils.go` `Fail(err)` provides the same debug-vs-production error
printing for older entry points and exits with code 1.

## Help-quality checks

Help quality is enforced by tests, not by the runtime. `integration/help_test.go`
runs `testscript` fixtures that render generated HTML help reports and assert
headline consistency, minimum word/line thresholds per section, and that no
section text contains "TODO". These checks validate that command descriptions
remain consistent and complete.

## Related

- [Plugin System](plugin-system.md) — how `step <name>` dispatches to external plugins.
- [Configuration, Environment, and the Step Path](../configuration/env-and-step-path.md) — `STEPPATH`, contexts, and `--config`.
- [Quickstart](../quickstart.md) — building and running the CLI.
