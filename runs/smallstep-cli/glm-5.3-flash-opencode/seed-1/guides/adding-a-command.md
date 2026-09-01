---
type: "Reference"
title: "Guide: Adding a Command"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-dd2083e3bfe29218ac712f40
    resource: repo://command/certificate/fingerprint.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-c71b7b872620efd20398171b
    resource: repo://command/crl/crl.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---


# Guide: Adding a Command

This guide distills the conventions the codebase actually follows. Worked
references: the `crl` group (repo://command/crl/crl.go), the `fingerprint`
leaf command (repo://command/certificate/fingerprint.go), and the `ca` group
(repo://command/ca/ca.go).

## 1. Choose the package location

- A new **top-level** command gets its own package under `command/` (like
  `command/crl`). A new **subcommand** is a function in the parent group's
  package returning a `cli.Command` (like `inspectCommand()` inside
  `command/crl`, or `certificateCommand()` inside `command/ca`)
  (repo://command/crl/crl.go#L10-L30, repo://command/ca/ca.go#L68-L86).
- Code with no command-specific business logic belongs in shared packages:
  reusable flags in `flags`, error constructors in `cli-utils`' `errs`
  (repo://command/README.md#L12-L17).

## 2. Register the command

Each command package's `init()` builds a `cli.Command` and calls
`command.Register(cmd)` (repo://command/crl/crl.go#L10-L30):

```go
func init() {
	cmd := cli.Command{
		Name:        "crl",
		Usage:       "initialize and manage a certificate revocation list",
		UsageText:   "**step crl** <subcommand> [arguments] [global-flags] [subcommand-flags]",
		Description: `... ## EXAMPLES ...`,
		Subcommands: cli.Commands{inspectCommand()},
	}
	command.Register(cmd)
}
```

For a **top-level** command you must additionally blank-import the package in
`internal/cmd/root.go` so its `init()` runs — that file already lists every
enabled top-level command and CAS implementation (repo://internal/cmd/root.go#L25-L44).
Subcommands don't need this; the parent wires them directly.

Set `Hidden: true` to keep a deprecated or experimental command out of the help
menu (repo://command/README.md#L98-L103).

## 3. Write the help text

The repo's custom help printer renders `Description` as markdown-ish text.
Conventions observable in `fingerprint` (repo://command/certificate/fingerprint.go#L22-L103):

- `Usage` is one lowercase line.
- `UsageText` bolds the command path with `**` and lists flags as
  `[**--flag**=<value>]`.
- `Description` contains `## POSITIONAL ARGUMENTS` (argument, then `: `
  description line) and `## EXAMPLES` sections; code blocks use `'''` fences.
- Long flag `Usage` strings may embed `: <value>` definition lists.

## 4. Reuse shared flags where possible

Before defining a flag, check `flags` — `KTY`, `Size`, `Curve`, `Subtle`,
`ServerName`, `FingerprintFormatFlag`, `HiddenNoContext` and many more already
exist (repo://flags/flags.go#L23-L76, repo://command/certificate/fingerprint.go#L95-L96).
If the flag is genuinely new, define it in `flags` when it is reusable, or
inline a `cli.StringFlag`/`cli.BoolFlag` when it is command-specific (as
`fingerprint` does for `--roots`, `--bundle`, `--insecure`, `--sha1`).

CA-related URL validation should go through `flags.ParseCaURL` /
`flags.ParseCaURLIfExists` so https scheme enforcement stays consistent
(repo://flags/flags.go#L649-L674).

## 5. Implement the action

Leaf actions are `cli.ActionFunc` (or `command.ActionFunc`) functions that:

1. Validate argument counts with the `errs` helpers first — e.g.
   `errs.MinMaxNumberOfArguments(ctx, 0, 1)` in `fingerprint`,
   `errs.NumberOfArguments(ctx, 1)` in `step context select`
   (repo://command/certificate/fingerprint.go#L105-L108, repo://command/context/select.go#L27-L29).
2. Read flags via `ctx.String/Bool/...` and read files/stdin via `utils.ReadFile`
   (which supports `-` for stdin) (repo://command/certificate/fingerprint.go#L110-L124).
3. Return errors instead of printing/`os.Exit` — the framework's error contract
   (message-only output unless `STEPDEBUG=1`, exit code 1) applies automatically
   (repo://internal/cmd/root.go#L62-L84).
4. Cross-flag constraints use `errs` constructors, e.g. `--sha1` requires
   `--insecure` via `errs.RequiredInsecureFlag` (repo://command/certificate/fingerprint.go#L126-L128).

## 6. Verify

- Unit tests live next to the code (e.g. `command/ca/init_test.go`,
  `flags/flags_test.go`); `make test` runs the short suite via gotestsum
  (repo://Makefile#L151-L157).
- For output/behavior contracts, extend the `testscript`-based integration
  harness in `integration/` — scenarios are `.txtar` archives under
  `integration/testdata/` and are registered as `testscript.Run` functions
  (repo://integration/main_test.go#L9-L19).
- `make lint` runs golangci-lint (config fetched from the smallstep/workflows
  repo) and `govulncheck` (repo://Makefile#L166-L174).

## Checklist

1. Package under `command/`; `init()` + `command.Register`.
2. Blank-import in `internal/cmd/root.go` if top-level.
3. `Usage`/`UsageText`/`Description` with POSITIONAL ARGUMENTS and EXAMPLES.
4. Reuse or add flags in `flags`; use `ParseCaURL` for CA URLs.
5. Argument-count validation via `errs`; return errors, never `os.Exit`.
6. Tests next to the code; testscript scenario for CLI-level behavior.
7. `make test` and `make lint` green.
