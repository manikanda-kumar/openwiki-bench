---
type: "Reference"
title: "Change guide: adding a step command"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:41:54.605Z
sources:
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T03:41:54.605Z" }
---


# Change guide: adding a step command

This guide walks through adding a new command to the CLI. It follows the
workflow documented in `command/README.md` and the existing registration
evidence in the tree.

## 1. Pick the package layout

Commands are organized one package per command (or per subcommand group). A
top-level command lives in its own package under `command/` (for example
`command/version`, `command/base64`); a subcommand of a group lives inside that
group's package or in a nested package (for example `command/ca/provisioner`).
Any helper logic that is not command-specific belongs in a shared package such
as `flags`, `token`, `utils/cautils`, or an `internal/` package
(`command/README.md:5-17`).

## 2. Register the command

Define a `cli.Command` and register it in the package `init()` via
`command.Register` from `github.com/smallstep/cli-utils/command`:

- `command/version/version.go:14-27` — a simple leaf command with an `Action`.
- `command/base64/base64.go:18-83` — a command with custom flags.

For top-level commands, enable the package by blank-importing it in
`internal/cmd/root.go` so its `init` runs and the app picks it up through
`command.Retrieve()` (`internal/cmd/root.go:30-44`). For group subcommands,
call the command-constructor function from the parent group's `Subcommands`
list (e.g. `command/ca/ca.go:68-85`). Set `Hidden: true` on a command to keep
it out of help (e.g. for experimental/deprecated commands)
(`command/README.md:98-103`).

## 3. Reuse flags and error helpers

- **Flags**: prefer the shared flags in `flags/flags.go` (`--kty`, `--curve`,
  `--size`, `--token`, `--ca-url`, `--root`, `--offline`, `--insecure`,
  `--subtle`, `--password-file`, KMS URIs, template flags, etc.) and only add
  a new flag when it is genuinely command-specific (`command/README.md:83-85`).
- **Errors**: return errors from `cli-utils/errs` (e.g.
  `errs.NumberOfArguments`, `errs.InvalidFlagValue`,
  `errs.RequiredWithFlag`, `errs.MutuallyExclusiveFlags`) so they serialize to
  a consistent CLI error/exit behavior. Command-specific errors stay in the
  command package (`command/README.md:86-91`).
- **Prompts/UI**: use `cli-utils/ui` for input and selection prompts so the
  output styling stays consistent across commands (`command/README.md:92-96`).
- **Action**: use `command.ActionFunc(func(ctx context.Context) error)` (from
  `cli-utils/command`) or `cli.ActionFunc` as the Action, matching the
  surrounding packages.

## 4. Validate arguments and flags

Follow the existing patterns for validating positional arguments and flag
combinations. Examples:

- `errs.NumberOfArguments(ctx, n)` / `errs.MinMaxNumberOfArguments(ctx, min, max)`
  (`command/ca/token.go:283`, `command/ssh/login.go:115`).
- Incompatible flag checks like `errs.IncompatibleFlagWithFlag` and
  `errs.RequiredWithFlag` (`command/ca/token.go:303-316`).

## 5. Document the command

Provide `Usage`, `UsageText`, and a `Description` that includes the standard
ALL-CAPS sections (USAGE, POSITIONAL ARGUMENTS, EXAMPLES, SECURITY
CONSIDERATIONS where relevant, EXIT CODES). The help-quality integration test
enforces headline consistency, minimum word/line counts per section, and the
absence of TODO markers across all commands, so new help text must satisfy it
(`integration/help_test.go:43-107`).

## 6. Test the command

- Add unit tests for any non-trivial logic in the command or its helper
  package (e.g. `command/ca/init_test.go`, `flags/flags_test.go`).
- Add a `.txtar` scenario under `integration/testdata/` for end-to-end
  behavior and register a `testscript.Run` in the `integration` package; the
  harness executes the real `step` entrypoint
  (`integration/shared_test.go:11-14`, `integration/certificate_test.go:42-57`).
- Run `make test`, `make race`, and `make lint` before submitting
  (`Makefile:151-175`).
