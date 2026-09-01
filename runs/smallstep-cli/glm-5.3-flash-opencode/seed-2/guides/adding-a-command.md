---
type: "Reference"
title: "Guide: Adding a Command"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-4695ffe2593592cc94176478
    resource: repo://command/api/api.go
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-b1fd6484864a367818d3ab86
    resource: repo://command/ca/health.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-82b68c6a8fd150b4ff72587b
    resource: repo://docs/local-development.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---


# Guide: Adding a Command

This guide follows the repository's own conventions, documented in
`command/README.md` and embodied by existing commands.

## 1. Choose the package location

The CLI uses `urfave/cli` with N-level command hierarchy; each hierarchy level
lives in its own package where possible. Two patterns exist:

- **Top-level group**: create `command/<name>/<name>.go` with an `init()` that
  registers the group (see `command/context/context.go` or
  `command/crl/crl.go`).
- **Subcommand of an existing group**: add a file to the existing package
  (e.g. `command/ssh/`) and append the command to the group's `Subcommands`
  list.

Packages used by a command but not containing command business logic (flag
helpers, shared flows) belong at the repository top level (`flags/`,
`utils/`, `token/`), not inside `command/`.

## 2. Define and register the command

Minimal structure (modeled on `command/base64/base64.go` and the example in
`command/README.md`):

```go
func init() {
    cmd := cli.Command{
        Name:   "mycmd",
        Action: command.ActionFunc(mycmdAction),
        Usage:  "one-line summary",
        UsageText: `**step mycmd** [options]`,
        Description: `**step mycmd** ... longer markdown help ...`,
        Flags: []cli.Flag{ /* shared flags from the flags package */ },
    }
    command.Register(cmd)
}
```

Key conventions:

- Actions are wrapped in `command.ActionFunc` (the cli-utils alias for
  `cli.ActionFunc`), or use `internal/command.InjectContext` when the
  implementation needs a `context.Context`.
- If the command must not be influenced by contexts, include
  `flags.HiddenNoContext` (as `version` and `completion` do).
- Set `Hidden: true` for commands not ready for users (this is how `api` and
  `fileserver` are registered).

For a **top-level** command, also blank-import the package in
`internal/cmd/root.go` next to the other enabled commands so its `init()` runs
— otherwise the registration never executes. Subcommands of already-imported
packages need no wiring.

## 3. Reuse shared flags

Check `flags/flags.go` before defining anything: `--force`, `--password-file`,
`--ca-url`, `--root`, `--provisioner`, key-generation flags (`KTY`, `Curve`,
`Size`), validity flags (`NotBefore`/`NotAfter`), token header flags
(`X5cCert`...), and more already exist with consistent help text. New shared
flags belong in that package. Validate key parameter combinations with
`utils.GetKeyDetailsFromCLI` rather than hand-rolling checks.

## 4. Argument checks, errors, and prompts

- Validate positional argument counts with `errs.NumberOfArguments`,
  `errs.MinMaxNumberOfArguments`, etc.; return the error, do not print it.
- Create errors with the `errs` helpers (`errs.InvalidFlagValue`,
  `errs.RequiredFlag`, `errs.IncompatibleFlagWithFlag`, ...) so they render a
  short user message plus the `STEPDEBUG=1` detail path. Command-specific
  errors stay inside the command package.
- Interactive input goes through `ui.Prompt`/`ui.Select`/`ui.PromptPassword`;
  file-or-stdin reads use `utils.ReadFile` (a lone `-` means stdin).

## 5. Help text style

`UsageText` uses `**bold**` flags and bracketed optionals; `Description` is
markdown with `## POSITIONAL ARGUMENTS` and `## EXAMPLES` sections, and
example blocks are fenced with `'''` (the usage templates translate these).
The custom flag stringifier derives `<placeholders>` from `<...>` spans in
flag usage strings.

## 6. Verify

- `go build ./...` compiles.
- `make test` runs the unit suite; `internal/cmd/root_test.go` asserts the
  exact top-level command list, so a new top-level command must be added to
  that expectation.
- Add unit tests next to the command package (see
  `command/ca/health_test.go`, `command/certificate/inspect_test.go` for
  patterns) and, for behavior spanning argument parsing and dispatch,
  consider a testscript case under `integration/`.
- Update `CHANGELOG.md` — behavior changes are required to be documented
  there per `docs/local-development.md`.

Common pitfalls: forgetting the blank import (command silently missing),
defining a new flag that duplicates one in `flags/`, printing errors instead
of returning them (bypasses exit-code handling), and registering with a bare
function instead of `command.ActionFunc`.
