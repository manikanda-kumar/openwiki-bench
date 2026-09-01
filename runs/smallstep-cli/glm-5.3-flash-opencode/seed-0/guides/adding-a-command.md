---
type: change-guide
title: "Guide: Adding a New Command"
description: A step-by-step change guide for adding a new command to the step CLI - package placement, registration, flags, validation, tests, and changelog.
tags: [guide, commands, testing, changelog, conventions]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-ca6cb4b1a14fd7969dfae3ec
    resource: repo://CHANGELOG.md
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-2005852bcde0106ba864793f
    resource: repo://integration/certificate_test.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-928f4421e6c65f6bcc9a94b6
    resource: repo://integration/shared_test.go
  - id: openwiki-source-fa952c8392758efd9a296cbb
    resource: repo://integration/testdata/crypto/jwt-sign.txtar
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

This guide walks through the representative maintenance task of adding a new
`step` command. It compiles the repository's own documented conventions and the
patterns verified in shipped commands; the architecture pages cover each layer in
depth.

## 1. Pick the package location

The documented layout rule (command/README.md:5-16): each level of the command
hierarchy should live in its own package under `command/`, and any package used by
commands but containing no command-specific business logic belongs at the
repository top level (like `flags/` and the external `errs`). A leaf command goes
in a new package under `command/<name>/`; a subcommand joins an existing group
package (e.g. `command/certificate/`, where each subcommand is a file exposing a
package-private `xxxCommand()` constructor, command/certificate/certificate.go:10-102).

## 2. Register the command

Define the command in an `init()` and call `command.Register` — the minimal
template is in command/README.md:26-47 and a complete working example is
`step base64` (command/base64/base64.go:18-83). Then blank-import the new top-level
package so its `init()` runs. Note the drift documented earlier: the README points
at `cmd/step/main.go` for that import, but the actual import list is the
`// Enabled commands` block in `internal/cmd/root.go` (internal/cmd/root.go:30-44);
add your import there for a top-level command. Subcommands need no import — their
parent group is already imported.

Wrap the action with `command.ActionFunc` (or `command.InjectContext` if the action
needs a `context.Context`, as the `ca policy` subtree does —
internal/command/inject.go:14-23). To keep a command out of the help menu, set
`Hidden: true` (command/README.md:98-103).

## 3. Write the action in the house style

Follow the guard-clause pipeline that `createAction` exemplifies
(command/certificate/create.go:495-771):

1. Validate positional arguments first with `errs` helpers
   (`errs.MinMaxNumberOfArguments`, `errs.EqualArguments`, ...).
2. Read flags into locals once, then reject bad combinations with
   `errs.RequiredWithFlag`/`IncompatibleFlagWithFlag`/`InvalidFlagValue`.
3. Reuse the shared `flags` package definitions before defining new ones —
   this is an explicit documented convention (command/README.md:82-84) — and pair
   new flags with parser helpers (`flags.ParseTimeOrDuration`,
   `flags.ParseCaURL`, ...) rather than ad-hoc parsing.
4. Put crypto and serialization in the smallstep libraries (`pemutil`,
   `x509util`, `jose`), write files with `fileutil.WriteFile` (mode 0600 for
   anything private) and wrap I/O errors with `errs.FileError`.
5. Emit output through `ui` and return errors instead of printing them.

Before adding prompts, check the `prompts` package convention documented in
command/README.md:93-96; general errors belong in `errs`, command-specific ones
stay in the command package (command/README.md:86-91).

## 4. Write the help text

The help output is linted by CI, so the format is load-bearing: `UsageText` with
`**bold**` flags and `<placeholder>` arguments; `Description` with
`## POSITIONAL ARGUMENTS`, `## EXIT CODES`, `## EXAMPLES` sections using the
`': <description>'` argument style and `'''` fences that render as backticks
(command/certificate/create.go:46-98). The integration suite's
`checkHelpQuality`, `checkHeadlineConsistency`, `checkThresholds`, and
`checkNoTODOs` linters assert consistency across the whole command tree
(integration/help_test.go:21-99), so a nonconforming command fails `make test`.

## 5. Test it

Two layers, both run by `make test` (which passes `-short` — integration tests do
not gate on it):

- **Unit tests** colocated with the package for pure logic (parsers, helpers,
  flag validation). Existing examples: flags/flags_test.go,
  command/ssh/proxycommand_test.go.
- **Integration tests** via the `testscript` framework: `integration/main_test.go`
  registers scenarios by `.txtar` file, and `TestMain` binds the `step` name to
  `cmd.Run` so scripts drive the real command tree in-process
  (integration/shared_test.go:11-14). A scenario asserts stdout/stderr/exit codes
  against fixture files in `integration/testdata/` — for example
  `testdata/crypto/jwt-sign.txtar` matches the compact-JWT prefix on stdout and
  asserts failure stderr like `'cannot use a public key for signing'` for
  rejected inputs. If your command needs generated crypto fixtures, follow the Go
  `Setup` functions pattern in integration/certificate_test.go, which builds
  CSRs/CAs with `go.step.sm/crypto` before running scripts, and can register
  custom script commands (e.g. `check_certificate`).
- Add a `help.txtar`-style quality expectation if the command introduces a new
  group; the help linters consume the whole tree.

## 6. Housekeeping before the PR

- `make bootstrap` once (installs golangci-lint, govulncheck, gotestsum,
  GoReleaser Pro), then `make build`, `make test`, `make lint`
  (docs/local-development.md:29-61). `make lint` fetches the shared golangci
  config from the smallstep/workflows repository at runtime (Makefile:168-170).
- **CHANGELOG.md is mandatory for behavior changes**: "All changes to behavior
  *must* be documented in the CHANGELOG.md" (docs/local-development.md:10). Add
  entries under the `TEMPLATE` section's `x.y.z` heading using the Keep-a-Changelog
  categories (Added/Changed/Deprecated/Removed/Fixed/Security); do not remove the
  TEMPLATE itself (CHANGELOG.md:9-31).
- Contribution requirements (docs/CONTRIBUTING.md:60-73): have test cases, run
  `go fmt`, add documentation for new features, squash commits into one, and
  follow the commit message guidelines — imperative-mood subject, no trailing
  period, and `Fixes #NNN` in the body (docs/CONTRIBUTING.md:75-101). The CLA is
  signed through cla-assistant.io/smallstep/cli (docs/CONTRIBUTING.md:65).
- Dependencies: import then `go get <pkg>`; removal is `go mod tidy`
  (docs/local-development.md:63-72).

## Common pitfalls

- Registering a top-level command but forgetting the blank import in
  `internal/cmd/root.go` — the command simply never appears, with no error.
- Using `fmt.Println` for command output instead of `ui` — output must flow
  through the styled printer, and error text must come from returned errors
  (the root runner prints `Message()` and honors `STEPDEBUG=1`).
- Writing private key material without mode 0600 or without `fileutil.WriteFile`.
- Skipping the changelog — CI-adjacent review treats it as required for behavior
  changes per the development doc.
