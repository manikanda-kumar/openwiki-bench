---
type: guide
title: "Change Guide: Adding a Command"
description: Focused, code-grounded guide for adding a new subcommand to the step CLI — registration, flags, action wiring, validation helpers, and tests.
tags: [guide, commands, cli]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-c1eccaed3802864c82f6b8dd
    resource: repo://command/ca/certificate.go
  - id: openwiki-source-27d1d3b8dd01d4218df95de4
    resource: repo://command/ca/sign_test.go
  - id: openwiki-source-ff8a7fe9f3a4815e9b6b5c30
    resource: repo://command/ca/sign.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-46510543a83ab54cc589c218
    resource: repo://internal/command/inject_test.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# Change Guide: Adding a Command

This guide walks through adding a new command to the `step` CLI, using existing
commands as the reference implementation.

## 1. Decide where the command lives

- **New top-level command** (e.g. `step base64`, `step version`): create a new
  package under `command/<name>/` whose `init()` calls `command.Register`.
- **New subcommand of an existing group** (e.g. `step ca ...`): add a
  `Command()`/`xxxCommand()` entry to the group's `Subcommands` slice and call
  `command.Register(cmd)` for the group. See `command/ca/ca.go:68-88` where the
  `ca` group wires its `Subcommands`, and `command/version/version.go:14-27`
  for the standalone pattern.

The group itself must be imported for side effects in `internal/cmd/root.go`
(see the `_ "github.com/smallstep/cli/command/..."` block at
internal/cmd/root.go:30-44). A new top-level package must be added there;
subcommands of an already-enabled group need no new import.

## 2. Define the command

Every command is a `cli.Command` (from `github.com/urfave/cli`). The canonical
shape (see `command/base64/base64.go:18-83`):

```go
func init() {
    cmd := cli.Command{
        Name:      "base64",
        Action:    command.ActionFunc(base64Action),
        Usage:     "encodes and decodes using base64 representation",
        UsageText: "**step base64** [**-d**|**--decode**] ...",
        Description: `...help text, including ## EXAMPLES...`,
        Flags: []cli.Flag{
            cli.BoolFlag{Name: "d,decode", Usage: "decode base64 input"},
            // ...
        },
    }
    command.Register(cmd)
}
```

Reusable flag definitions live in `flags/flags.go` (e.g. `flags.Force`,
`flags.CaURL`, `flags.Root`, `flags.Offline`, `flags.KTY`) — prefer those over
duplicating flag objects. `Usage` and `Description` drive both `--help` and the
auto-generated shell completion and man pages via the cli-utils `usage` package.

## 3. Write the action

Two wiring styles exist:

**Plain action** — `command.ActionFunc` wraps a `func(*cli.Context) error`:

```go
func base64Action(ctx *cli.Context) error { ... }
```

**Context-based action** — for actions that need a `context.Context` with
middleware, use `internal/command.InjectContext` (internal/command/inject.go:14-23).
The cli-utils `command.ActionFunc` can also wrap `func(context.Context) error`;
the CLI context is recovered with `CLIContextFromContext`.

Read flags with `ctx.String`, `ctx.Bool`, `ctx.Int`, `ctx.StringSlice`, `ctx.IsSet`,
`ctx.NArg`, and `ctx.Args()`. Note that positional arguments are accessed via
`ctx.Args().Get(i)`.

## 4. Validate inputs early

`github.com/smallstep/cli-utils/errs` provides the validation helpers used
throughout the codebase. Examples:

- `errs.NumberOfArguments(ctx, 2)` / `errs.MinMaxNumberOfArguments(ctx, 2, 3)` /
  `errs.TooFewArguments(ctx)` — argument counts (see command/ca/sign.go:151,
  command/ca/certificate.go:221).
- `errs.RequiredFlag(ctx, "root")` — a flag must be set.
- `errs.RequiredWithFlag(ctx, "root", "key")` / `errs.RequiredUnlessFlag(...)` —
  a flag requires/forbids another.
- `errs.IncompatibleFlagWithFlag(ctx, "offline", "token")` /
  `errs.IncompatibleFlagValue(...)` / `errs.MutuallyExclusiveFlags(...)` —
  conflicting flag combinations (command/ca/certificate.go:239-248).
- `errs.InvalidFlagValue(ctx, "kty", kty, "RSA, EC, OKP")` — bad flag value.
- `errs.FileError(err, name)` — wraps filesystem errors with the filename
  (utils/read.go:55-62).

Run these at the top of the action so the user gets a clear message before any
side effects occur. Rejecting `--token` combined with `--san` in
`step ca certificate` is a representative example of the pattern.

## 5. Handle input and output

- Reading: `utils.ReadInput(prompt)` reads stdin if piped, otherwise prompts;
  `utils.ReadFile(name)` treats `-` as stdin and strips a UTF-8 BOM
  (utils/read.go:76-107).
- Prompts: `ui.Prompt`, `ui.Select`, `ui.PromptYesNo`, `ui.PromptPassword` from
  cli-utils (e.g. `ui.PromptYesNo` in command/context/remove.go:95).
- Output: `ui.Println`, `ui.PrintSelected` for user-facing output. Return an
  `error` for failures — the framework prints it to stderr and sets the exit
  code (internal/cmd/root.go:62-82). Use `errors.Errorf`/`errors.Wrap` from
  `github.com/pkg/errors` for context.
- Files: `fileutil.WriteFile` (cli-utils) with explicit modes such as `0o600`
  for keys/tokens and `0o644` for config (utils/cautils/bootstrap.go:191).

## 6. Test the command

Add unit tests next to the package. Existing examples to mirror:

- `internal/cmd/root_test.go` — tests `SetName` behavior of the app bootstrap.
- `internal/command/inject_test.go` — tests `InjectContext` middleware wiring.
- `flags/flags_test.go` — tests flag parsing helpers such as
  `ParseFingerprintFormat` / `GetTemplateData`.
- `command/ca/sign_test.go`, `command/ca/init_test.go` — validate command-level
  flag/argument validation with a `cli.Context`.

The module's tests run via `make` / `go test ./...`; the `Makefile` also drives
linting and building. When the command is a thin wrapper over shared logic, put
the logic in a package under `internal/` or `utils/` so it can be unit-tested
without a CLI context (e.g. `internal/kdf`, `internal/crlutil`).

## 7. Wire up completion and docs

No manual completion work is needed for standard `cli.Flag`/`cli.Command`
definitions — `step completion` and the `usage`-based help render from the
command metadata. For flag help, keep `Usage` strings concise and put detailed
text (including `SECURITY CONSIDERATIONS`) in `Description`, following the
convention in `command/crypto/crypto.go`.
