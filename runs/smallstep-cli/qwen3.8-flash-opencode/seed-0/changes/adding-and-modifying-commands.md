---
type: "Reference"
title: "Change Guide: Adding or Modifying Commands"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T01:48:16.413Z
sources:
  - id: openwiki-source-4695ffe2593592cc94176478
    resource: repo://command/api/api.go
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-99897616537fd8ab9f3bce8c
    resource: repo://command/ssh/login.go
  - id: openwiki-source-000a7add03cfbd0ac1794f3a
    resource: repo://docs/CONTRIBUTING.md
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T01:48:16.413Z" }
---


# Change Guide: Adding or Modifying Commands

This guide walks through the repository conventions for adding a command (or
changing one) to the `step` CLI, verified against the current code.

## 1. Choose the package location

The `urfave/cli` v1 framework supports N-level command hierarchies, and the
convention is one package per level under `command/` (command/README.md:4-17).
Business logic for a command stays in its command package; anything generic
belongs in the shared layers:

- `flags/` — reusable flag definitions and parsers
- `utils/`, `utils/cautils/` — flows and CA integration
- `internal/…` — helpers not meant for import outside this module
  (`errs`/`ui`/`usage` equivalents live in the external `cli-utils`)

Top-level groups nest children by constructing them from the child packages
directly (e.g. `command/ca/ca.go` lists `provisioner.Command()`,
`policy.Command()`, etc. in `Subcommands`), while simple leaf commands are
single `cli.Command` values.

## 2. Define and register the command

Minimal shape, from `step base64` (command/base64/base64.go:18-24):

```go
func init() {
    cmd := cli.Command{
        Name:      "base64",
        Action:    command.ActionFunc(base64Action),
        Usage:     "encodes and decodes using base64 representation",
        UsageText: `**step base64** [**-d**|**--decode**] ...`,
        Description: `...`,
    }
    command.Register(cmd)
}
```

Conventions worth matching:

- **Registration:** call `command.Register` (cli-utils) in `init()`; that is
  the only way the command reaches `command.Retrieve()` in the app builder
  (command/README.md:36-47, internal/cmd/root.go:122).
- **UsageText** uses `**bold**` markers for commands/flags and a pipe-joined
  form for aliases (base64 above).
- **Description** is Markdown rendered into help: a prose intro, `## EXAMPLES`
  with `'''`-fenced invocations, and `## POSITIONAL ARGUMENTS` entries
  annotated with `:  description` lines (see `step ssh login`,
  command/ssh/login.go:34-52). This exists because the external `usage`
  package extends urfave/cli templates to print arguments as part of
  `step <command> -h` (command/README.md:74-81).
- **Errors:** return errors from the external `errs` package
  (`errs.RequiredFlag`, `errs.InvalidFlagValue`, `errs.NumberOfArguments`) so
  they surface as clean CLI exit errors; general errors go into `errs`,
  command-specific ones stay in the package (command/README.md:84-91).
- **Prompts/UI:** use `ui.Prompt`/`ui.Select`/`ui.PrintSelected` from
  cli-utils instead of hand-rolled stdin handling (see
  `utils/cautils/token_flow.go` provisioner prompt).
- **Hidden commands:** set `Hidden: true` to ship a command that is absent
  from help (deprecated or pre-release); `step api` uses this
  (command/api/api.go:11-13).

## 3. Reuse flags before inventing new ones

`flags/flags.go` is the catalog of canonical flags (`--token`, `--ca-url`,
`--root`, `--offline`, `--provisioner`, `--password-file`, `--not-before`,
`--set`, `--kms`, …). Check it first; if a flag cannot be reused, add it there
so future commands inherit it (command/README.md:82-83). Pay attention to
the parse helpers (`ParseCaURL` https-only contract, `ParseTimeDuration`,
`GetTemplateData`) rather than reimplementing validation.

For shell completion of your command, urfave/cli's `BashComplete` hook is the
pattern (see `step completion`'s shell list,
command/completion/completion.go:43-50).

## 4. Enable the command in the binary

**Top-level group:** add a blank import to the enabled-commands block in
`internal/cmd/root.go` (internal/cmd/root.go:30-43). The stale instruction in
command/README.md:50-62 says to import in `cmd/step/main.go`; current code
performs registrations in `internal/cmd/root.go` instead.

**Subcommand:** reference it from the parent group's `Subcommands` list; no
import changes elsewhere are needed.

## 5. Documentation and changelog obligations

- All behavior changes **must** be documented in `CHANGELOG.md`
  (docs/local-development.md:7-8), and command help/Description updates count
  as documentation since the public reference is generated from them.
- Contributions must include test cases for new code, follow the urfave/cli
  style guide, and use the project commit-message format (imperative subject,
  `Fixes #issue` trailer) per docs/CONTRIBUTING.md:62-95.

## 6. Validation loop

```sh
make bootstrap        # one-time: golangci-lint, govulncheck, gotestsum, goimports, goreleaser-pro
make build            # bin/step with version LDFLAGs (Makefile:123-132)
./bin/step <cmd> -h   # verify usage text renders (also `make test` covers help output integration)
make test             # gotestsum -short unit + integration testscript tests (Makefile:151-152)
make lint             # shared golangci config + govulncheck (Makefile:166-175)
```

Focused tests for command logic live next to the code (e.g.
`command/ca/init_test.go`, `command/ca/policy/actions/policy_test.go`);
end-to-end behavior is exercised by testscript `.txtar` cases under
`integration/testdata` (see [Testing and Validation](/openwiki/testing-and-validation.md)).

## Common pitfalls

- Forgetting the blank import in `internal/cmd/root.go` makes a package
  silently dead code: registration happens only at `init()` time.
- Returning `fmt.Errorf`-style errors for user mistakes bypasses the
  messenger-error formatting in `run()`; use `cli-utils` `errs` so the message
  contract holds (see [CLI Runtime and Plugin Dispatch](/openwiki/architecture/cli-runtime.md)).
- Flags whose Usage text lacks a `<placeholder>` render as `<value>` via
  `stringifyFlag`; boolean flags render bare (internal/cmd/root.go:182-194).
- `--offline`-style flags are read by `cautils`, so new CA-touching commands
  should accept `flags.Offline`, `flags.CaConfig`, `flags.CaURL`, `flags.Root`
  and `flags.Context`/`flags.HiddenNoContext` to behave consistently
  (utils/cautils/client.go:52-74).

## See also

- [Architecture Overview](/openwiki/architecture/overview.md)
- [Shared Flags and Parsing Contracts](/openwiki/core/flags-and-configuration.md)
- [Testing and Validation](/openwiki/testing-and-validation.md)
