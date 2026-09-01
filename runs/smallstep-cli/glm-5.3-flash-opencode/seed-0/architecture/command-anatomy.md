---
type: architecture-concept
title: Command Implementation Anatomy
description: The uniform pattern every step CLI command follows, from registration through flag handling to output and errors.
tags: [commands, urfave-cli, flags, errs, ui, conventions]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-4695ffe2593592cc94176478
    resource: repo://command/api/api.go
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-9ca10d5f3a3bf6abbc2f7390
    resource: repo://command/ca/policy/actions/cn.go
  - id: openwiki-source-87dbe77be6b08842ccbaa5fa
    resource: repo://command/ca/policy/actions/dns.go
  - id: openwiki-source-9496e952c929014dcaef788d
    resource: repo://command/certificate/certificate.go
  - id: openwiki-source-1f5af0daf56585c9bf57c514
    resource: repo://command/certificate/create.go
  - id: openwiki-source-28ba490bc69eee1f1517a107
    resource: repo://command/crypto/jwk/create.go
  - id: openwiki-source-a148da75eb7742358a4e5571
    resource: repo://command/fileserver/fileserver.go
  - id: openwiki-source-3a651ff80c75d181314a3fee
    resource: repo://command/oauth/cmd.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7cb094ef8fab44ceb877ed7f
    resource: repo://integration/help_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
  - id: openwiki-source-df2d16b29c2bbf9191277bfd
    resource: repo://utils/read.go
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

Every `step` command is built from the same small set of primitives: a package-level
`init()` registration, a `cli.Command` constructor, an action function wrapped in
`command.ActionFunc`, guard-clause validation with `errs` helpers, shared flag
constructors from the `flags` package, and output through the `ui` package. This page
describes that pattern as the code actually implements it, because nearly all maintenance
work on this repository means touching one or more of these layers.

## Registration is side-effect driven

Each command package registers itself in `init()` by building a `cli.Command` and
passing it to `command.Register` from `github.com/smallstep/cli-utils/command`
(command/README.md:36-47). The leaf command `step base64` is a complete minimal
example of this pattern (command/base64/base64.go:18-83).

For command groups, a package-level `init()` builds a parent `cli.Command` whose
`Subcommands` slice calls one private `xxxCommand()` constructor per subcommand.
`step certificate` works this way: its group file only defines usage text and the list
of subcommand constructors (command/certificate/certificate.go:10-102), while each
subcommand lives in its own file exposing a package-private constructor such as
`createCommand()` (command/certificate/create.go:41-493).

The registry is wired into the binary by blank-importing top-level command packages so
their `init()` functions run. The `command/README.md` documents this import as belonging
in `cmd/step/main.go` (command/README.md:50-62), which predates a refactor: in the
current source the blank imports live in `internal/cmd/root.go` (internal/cmd/root.go).
The registry itself (`Register`, `Retrieve`, `ActionFunc`, `IsForce`) lives in the
external `smallstep/cli-utils` module; the repository's own `internal/command` package
is a different, unrelated helper for context injection (see
[Context injection](#context-injection-for-policy-commands)).

Note the naming collision: two packages are named `command` and serve different roles —
`github.com/smallstep/cli-utils/command` is the global registry, and
`github.com/smallstep/cli/internal/command` provides context middleware for actions.

## The uniform action pattern

An action function has the signature `func(ctx *cli.Context) error` and is always
wrapped with `command.ActionFunc(...)` when assigned to `Action` (for example
command/base64/base64.go:21 and command/certificate/create.go:44). `ActionFunc` stashes
the current `*cli.Context` in a package variable, which is what makes
`command.IsForce()` work in commands that need to check the force flag outside their own
action body.

The action body is a strictly sequential guard-clause pipeline. Reading
`createAction` in command/certificate/create.go:495-771 is the best way to internalize
the order, which holds across the codebase:

1. **Argument validation first**, immediately after entry, via the `errs` package.
   `errs.MinMaxNumberOfArguments` bounds positional arguments (create.go:495-502) —
   note the minimum is computed from flags (`--key` removes the third argument at
   create.go:496-499). Equality and sanity checks between arguments use
   `errs.EqualArguments` (create.go:513-515).
2. **Flag reads into locals**, then cross-flag validation. The pattern is to read all
   flags once with `ctx.String`/`ctx.Bool`/`ctx.IsSet` (create.go:504-536) and then
   reject invalid combinations with the `errs` combinators:
   `errs.RequiredWithFlag` (create.go:506-508), `errs.InvalidFlagValue`
   (create.go:517-524), `errs.IncompatibleFlagValues` (create.go:525-527),
   `errs.IncompatibleFlagWithFlag` (create.go:538-543, 574-594), and
   `errs.IncompatibleFlagValue`/`RequiredWithFlagValue` (create.go:642-650). Parsing
   helpers in the `flags` package (below) return values plus a boolean instead of
   errors so the action controls the message.
3. **Decompose larger logic into package-private helpers** that take the context:
   `parseOrCreateKey` resolves or generates the signing key, including KMS handling
   (create.go:564, defined at create.go:773-836), `parseSigner` resolves the issuing
   CA signer (create.go:659, defined at create.go:841-909), and `savePrivateKey`
   centralizes encryption/password prompting (create.go:625, defined at
   create.go:911-934).
4. **Business logic via the smallstep crypto libraries**, not hand-rolled crypto:
   template data is built with `x509util.CreateTemplateData` and certificates through
   `x509util.NewCertificate(..., WithTemplate(...))` and `x509util.CreateCertificate`
   (create.go:692-713, 735), serialization with `pemutil.Serialize` (create.go:741),
   and file writes through `fileutil.WriteFile` with mode `0o600`
   (create.go:630, 761-763), wrapping I/O failures with `errs.FileError` so the user
   sees a file-contextual message.
5. **Output through `ui`**, which renders Go template strings with color filters.
   Success messages print the written file paths (create.go:765-768). Any returned
   error propagates to the root runner, which prints `errs.Error.Message()` — see
   the runtime dispatch page for that contract.

Every error returned from an action eventually becomes a `urfave/cli.ExitError` with a
non-zero exit code; this is the documented reason the `errs` package exists
(command/README.md:86-91). Command-specific errors stay in the command's package;
generic reusable errors belong in `errs` (command/README.md:89-91).

## The shared flags package

The top-level `flags` package (flags/flags.go) is the first place to look before
defining a new flag — the contribution convention says to reuse existing flags to
reduce duplication and to add genuinely new ones there for future reuse
(command/README.md:82-84). It provides two kinds of members:

- **Reusable flag definitions** exported as variables: key-type/curve/size flags
  (`flags.KTY` at flags/flags.go:24-25), misuse gates (`flags.Subtle` at
  flags/flags.go:72-73, `flags.InsecureHidden`), overwrite control (`flags.Force` at
  flags/flags.go:103-106), CA-flow flags (`flags.Offline` at flags/flags.go:283-288,
  `flags.X5cCert`/`X5cKey` at flags/flags.go:313-324, `flags.SSHPOPCert` at
  flags/flags.go:356-359), and `flags.CaConfig`, whose default value is computed at
  process start as `$(step path)/config/ca.json` (flags/flags.go:291-296).
- **Flag parsers** that turn raw flag strings into validated values and are used
  inside actions: `ParseTimeOrDuration` (flags/flags.go:568),
  `ParseTimeDuration` (flags/flags.go:585), fingerprint format parsing
  (`ParseFingerprintFormat` at flags/flags.go:547), template data from `--set`/
  `--set-file` (`GetTemplateData`/`ParseTemplateData` at flags/flags.go:600-613), and
  CA URL normalization/https-enforcement (`ParseCaURL`/`ParseCaURLIfExists` at
  flags/flags.go:649-663).

Actions typically pair a shared flag with a parser: for example `--not-before`/
`--not-after` are read with `flags.ParseTimeOrDuration` and rejected via
`errs.InvalidFlagValue` on failure (command/certificate/create.go:517-527).

## Help text conventions

Command help is a controlled format, not free prose:

- `UsageText` uses `**bold**` markers around flags and `<placeholder>` angle brackets
  for arguments (command/certificate/create.go:46-55). The help renderer extracts
  these placeholders for display.
- `Description` is organized with `##`-prefixed sections — `## POSITIONAL ARGUMENTS`,
  `## EXIT CODES`, `## TEMPLATES`, `## EXAMPLES` (command/certificate/create.go:63-98).
  Positional arguments are documented one per line with the `: <description>` indented
  style (command/certificate/create.go:65-72). Triple quotes `'''` inside examples are
  converted to backticks by the help printer.
- The external `usage` package extends urfave/cli templates so arguments appear in
  `step help` output; new annotation needs go into the `usage.Argument` struct rather
  than ad-hoc markup (command/README.md:76-80).

## Hiding commands and flags

Setting `Hidden: true` on a `cli.Command` removes it from the help menu, the documented
mechanism for deprecated or not-yet-ready commands (command/README.md:98-103). In
practice the codebase uses this for: entire hidden groups (`step api` in
command/api/api.go, `step fileserver` at command/fileserver/fileserver.go:30), and
individual flags that are experimental, deprecated, or not implemented — for example a
JWK create flag marked "Not currently implemented" (command/crypto/jwk/create.go:333),
JWT/JWS inspection and signing flags (command/crypto/jwt/inspect.go:34,
command/crypto/jwt/sign.go:206, command/crypto/jws/sign.go:155), KDF output variants
(command/crypto/kdf/kdf.go:241), and the OAuth implicit/browser flow flags
(command/oauth/cmd.go:293-298). One CA certificate flag is hidden at
command/ca/certificate.go:178.

## Context injection for policy commands

Most actions only need the `*cli.Context`. The `step ca policy` subtree, however, runs
under a caller-provided `context.Context` (it wraps admin-API clients that need
cancellation), so its actions use `internal/command.InjectContext` instead of
`command.ActionFunc` (internal/command/inject.go:14-23). `InjectContext` installs the
injected context as the first middleware, runs any additional middleware, stores the
`*cli.Context` inside the Go context, and calls the action; the action retrieves the
`*cli.Context` with `CLIContextFromContext`, which panics if absent
(internal/command/inject.go:28-36). Every action under command/ca/policy/actions
uses this form (command/ca/policy/actions/cn.go:54, command/ca/policy/actions/dns.go:72,
and siblings).

## Shared I/O and prompting helpers

The top-level `utils` package standardizes input handling that would otherwise
diverge between commands:

- `utils.ReadFile` treats `-` as STDIN (the de facto standard noted at
  utils/read.go:19-21) and strips UTF byte-order marks from file content while
  preserving STDIN verbatim (utils/read.go:91-107). Wrapping is with `errs.FileError`
  so failures name the file.
- `utils.ReadInput` reads piped stdin when available, otherwise prompts through
  `ui.PromptPassword` (utils/read.go:76-87). `step base64` relies on this so both
  argument input and piped/interactive input work with one code path
  (command/base64/base64.go:90-103).
- `utils.ReadPasswordFromFile`/`ReadStringPasswordFromFile` read password files and
  right-trim trailing whitespace (utils/read.go:53-72).
- `utils.FileExists` is the blanket existence probe, treating any `os.Stat` error as
  "missing" (utils/read.go:29-35).
- `utils.GetKeyDetailsFromCLI` normalizes `--kty`/`--curve`/`--size` selections and
  enforces minimum key sizes (RSA below 2048 requires insecure mode) — used by
  `parseOrCreateKey` in create.go:782.

`ReadInput`'s prompt path and the `flags` package both depend on `ui`; the wiring that
routes smallstep library prompts through this same UI (so all prompts look identical)
happens once at startup in the root runner, outside any command.

## Representative tests

Command-level behavior is exercised from two directions: package unit tests colocated
with source, and the integration suite in `integration/` that runs the real command
tree in-process. The integration suite's help-quality checks assert the conventions
above (headline consistency, thresholds, no TODOs) across the whole command tree, so a
command that deviates from the help-text format fails CI (integration/help_test.go).
See the testing strategy page for how to run these.
