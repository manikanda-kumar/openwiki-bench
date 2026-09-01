---
type: "Reference"
title: "Change Guides"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:18:29.453Z
sources:
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-a87ba2c5f23aa4825541954e
    resource: repo://command/ca/token.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-8df833e7257eb456286e631b
    resource: repo://command/certificate/needsRenewal.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-971b845de1a8e2551f6219d9
    resource: repo://token/options.go
  - id: openwiki-source-02b7382fd47f2d62a0e1dd0d
    resource: repo://token/parse.go
  - id: openwiki-source-69f71bee07f9140f91199d02
    resource: repo://token/token.go
  - id: openwiki-source-58644dc98d6344d7e64c05a6
    resource: repo://utils/cautils/certificate_flow.go
generated: { by: "opencode", at: "2026-08-31T00:18:29.453Z" }
---


# Change Guides

These guides walk through representative maintenance tasks, grounded in the
patterns the repository already uses. Always update `CHANGELOG.md` when you
change behavior (per `docs/local-development.md`).

## Adding a new command

Commands are `urfave/cli.Command` objects registered through the
`cli-utils/command` registry:

1. Create a package (or add a function to an existing package) under
   `command/`. Define a `cli.Command` with `Name`, `Usage`, `UsageText`,
   `Description`, `Flags`, and `Action` (usually `command.ActionFunc(...)` or
   `cli.ActionFunc(...)`).
2. Call `command.Register(cmd)` from the package's `init()`. For a
   subcommand, add it to the parent command's `Subcommands` slice instead
   (see `command/ca/ca.go` which composes its subcommands).
3. For a brand-new top-level group, add a blank import in
   `internal/cmd/root.go`'s "Enabled commands" block so it is included in
   `command.Retrieve()`.
4. Write a focused test. Unit tests live next to the code; end-to-end command
   behavior is tested in `integration/` with
   `github.com/rogpeppe/go-internal/testscript` (`TestMain` maps the `step`
   name to `cmd.Run`). Example: `integration/main_test.go` runs
   `testdata/version.txtar`.

Verify with `make test` and `make lint`; for a quick check,
`go test ./command/<pkg>/...` and `go build ./cmd/step`.

## Adding a new flag

1. If the flag is shared across commands, add it in `flags/flags.go` (see
   `flags.KTY`, `flags.Token`, `flags.Offline`, etc.). Command-specific flags
   are declared inline in the command (e.g. the ACME flags in
   `command/ca/ca.go`).
2. Follow the usage-text conventions: `<placeholder>` for values and
   `--long, -short` aliases. For dangerous operations, use the existing
   `--subtle`/`--insecure` gating pattern (`flags.SubtleHidden`,
   `flags.InsecureHidden`) and validate with `errs.RequiredWithFlag`,
   `errs.IncompatibleFlagWithFlag`, `errs.MutuallyExclusiveFlags`, etc.
3. Parse the value in the action via `ctx.String`/`ctx.Bool`/`ctx.StringSlice`,
   and validate early (e.g. `step ca token` validates flag combinations at the
   top of `tokenAction`).
4. If the flag feeds certificate templates, use `--set`/`--set-file` +
   `flags.GetTemplateData` rather than a bespoke flag.

## Changing token claims

Provisioning tokens are JWTs; claims are set through functional options in
`token/options.go` and consumed server-side by step-ca:

1. To add a custom claim, use `token.WithClaim(name, value)` or the typed
   helpers (`WithSANS`, `WithUserData`, `WithSSH`, ...). `Claims.Set`/`SetHeader`
   add extra claims/headers on the `token.Claims` struct.
2. If the claim must be *parsed* by the CLI, extend `token.Payload` in
   `token/parse.go` and, if it changes token classification, the `Type()`
   switch. Update the `Payload.Type()` consumers (e.g. `CreateSignRequest` in
   `utils/cautils/certificate_flow.go`).
3. Remember the validity bounds enforced by `WithValidity` in
   `token/options.go` (`MinValidity`/`MaxValidity`/`MaxValidityDelay` defined
   in `token/token.go`); new validity-affecting options must respect them.
4. Tests: `token/` has unit tests (`token_test.go`, `options_test.go`,
   `parse_test.go`); token *flows* are tested in `utils/cautils/offline_test.go`
   and `token_flow_test.go`.

## Changing how errors surface

Error reporting is centralized in `internal/cmd/root.go#run` and
`panicHandler`:

1. Plain errors print the message; with `STEPDEBUG=1` the full wrapped error
   (`%+v`) is printed. If a command wants a custom *user-facing* message, wrap
   the error in a type with a `Message()` method so `run()` uses it.
2. Exit codes: command actions return `nil` for success; returning an error
   makes `run()` exit 1. For distinct exit codes (like
   `step certificate needs-renewal`), return `errs.NewExitError(err, code)` or
   `cli.NewExitError`.
3. Panics are caught by `panicHandler` (re-panic under `STEPDEBUG=1`, otherwise
   a "Something unexpected happened" message and exit 2). Don't add recovery in
   individual commands.
4. Tests that assert on command output/exit codes belong in `integration/`
   testscript files.

## Verifying a change

- `make test` — full unit suite (or `go test ./...`).
- `make lint` — golangci-lint with the shared smallstep config + `govulncheck`.
- `go build ./cmd/step` — quick compile check.
- For CLI behavior, run the relevant testscript in `integration/` or invoke the
  built binary against an offline CA (`step ca init` then
  `step ca certificate --offline ...`).
