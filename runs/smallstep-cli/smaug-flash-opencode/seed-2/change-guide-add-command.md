---
type: "Reference"
title: "Change guide add command"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Goal

This guide walks through adding a new `step` command, following the patterns the
repo documents in [`command/README.md`](../../command/README.md) and exercises in
every existing command package.

## 1. Decide where the command lives

`urfave/cli` supports N-level command hierarchies, and each level should live in
its own package when possible. For a top-level command such as `step validate`,
create a package at the top level, e.g. `command/validate/validate.go`. For a
subcommand nested under an existing group (e.g. a new `step ca foo`), put it in
a subpackage somewhere under `command/ca/`. Any package used by a command that
does not contain business logic directly related to that command belongs at the
top level of the repository — examples are `flags` (shared flags) and
`cli-utils/errs` (error helpers).

## 2. Define and register the command

Inside the new package's file, build a `cli.Command` and register it in an
`init()` function using `command.Register` from `cli-utils/command`:

```go
package validate

import (
  "github.com/urfave/cli"

  "github.com/smallstep/cli-utils/command"
  "github.com/smallstep/cli/flags"
)

func init() {
  cmd := cli.Command{
    Name: "validate",
    Usage: "Returns whether or not the provided token is valid",
    UsageText: "**step validate** <token>",
    Flags: []cli.Flag{
      flags.Provisioner,
    },
    Action: validate,
  }
  command.Register(cmd)
}
```

The exact pattern is documented in `command/README.md`. For subcommands, set the
command's `Subcommands` slice on the parent command instead.

## 3. Wire the package into the app

Top-level command packages must be imported (blank import) from
`internal/cmd/root.go` so their `init()` runs and registers them. The file
already imports every enabled command package like this:

```go
_ "github.com/smallstep/cli/command/validate"
```

`internal/cmd/root.go` builds the `cli.App` and sets
`app.Commands = command.Retrieve()`; because `command.Retrieve` returns every
command registered through `command.Register`, simply adding the blank import
makes the command appear in `step`, `step help`, and `step <command> -h`.

## 4. Reuse shared flags and helpers

Before adding a new flag, check `flags/flags.go` for an existing one — the
package is the shared catalog and duplication should be reduced. If the flag is
specific to your command, define it locally. Reappear details:

- Flags: `flags.KTY`, `flags.Size`, `flags.Curve`, `flags.Token`,
  `flags.Provisioner`, `flags.CaURL`, `flags.Root`, `flags.Offline`,
  `flags.Force`, `flags.DryRun`, `flags.PasswordFile`, etc.
- Helpers: `flags.ParseCaURL`, `flags.ParseTimeOrDuration`,
  `flags.GetTemplateData`, `flags.ParseFingerprintFormat`, `flags.FirstStringOf`.

For errors, use `cli-utils/errs` to produce a `urfave/cli.ExitError` that yields a
proper termination exit code. General errors reusable across commands belong in
the `errs` package; command-specific errors should stay in the command's package.

For documentation and argument annotations, use the `cli-utils/usage` package
(overlaid on urfave/cli by `internal/cmd/root.go`) so that `step <command> -h`
prints usage text, whether arguments are optional or required, and descriptions.

## 5. Handle hidden or beta commands

To hide a deprecated or not-yet-ready command from the help menu, set the
`Hidden` property on the `cli.Command` to `true`. Alternatively, expose
experimental commands through the `beta` group (`command/beta`), which routes to
`ca.BetaCommand()` for CA APIs.

## 6. Verify

Run the unit tests for the affected packages and, if appropriate, the
integration tests (`integration/`) which use `go-internal`'s testscript with
`txtar` fixtures (see [testing-and-integration.md](testing-and-integration.md)).
Build with `make build` (or `go build ./cmd/step`) and confirm the new command
appears in `step help`. See [quickstart.md](quickstart.md).

## Related

- [architecture.md](architecture.md) for how the dispatcher and registration work.
- [change-guide-modify-flows.md](change-guide-modify-flows.md) for modifying an
  existing CA token flow rather than adding a fresh command.
