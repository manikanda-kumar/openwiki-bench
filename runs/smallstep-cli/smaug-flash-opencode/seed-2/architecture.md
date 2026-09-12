---
type: "Reference"
title: "Architecture"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:47:10.546Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-a987eaa893859169969db191
    resource: repo://internal/command/inject.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:47:10.546Z" }
---


## Responsibility

`step` is an easy-to-use CLI for building, operating, and automating Public Key
Infrastructure (PKI) systems and workflows, and a client for the `step-ca`
online Certificate Authority server ([README.md](../../README.md)). This page
describes how the CLI itself is wired together: the entrypoint, how commands are
discovered and registered, how the interactive app is constructed, and the
shared supporting packages that command actions rely on.

## Runtime entrypoint

The binary entrypoint is [`cmd/step/main.go`](../../cmd/step/main.go). It does
three things:

- Declares `Version`, `BuildTime`, and `AppName` package variables that are
  intended to be set via LDFLAGS at build time (`Version = "N/A"` by default).
- In `init()`, records the Smallstep CLI identity through
  `step.Set("Smallstep CLI", Version, BuildTime)`, sets the step-ca client's
  `UserAgent` to that version string, and pushes the optional custom `AppName`
  into the internal command package.
- `main()` simply calls `cmd.Run()` from `internal/cmd`.

The `AppName` defaults to `"step"` and is used as the app and help name when
building the CLI app ([`internal/cmd/root.go`](../../internal/cmd/root.go)).

## Building the urfave/cli app

[`internal/cmd/root.go`](../../internal/cmd/root.go) is the heart of the CLI
assembly. Its `run()` function:

1. Defers a `panicHandler()`.
2. Calls `step.Init()` from `cli-utils/step` to initialize the step environment
   (e.g. the `$STEPPATH` directory). If init fails it prints the error and
   returns exit code 1.
3. Constructs a `cli.App` via `newApp(os.Stdout, os.Stderr)` and runs it with
   `app.Run(os.Args)`.
4. On error, inspects whether the error implements a `Message() string` interface
   (from `cli-utils/errs`). If so, when `STEPDEBUG=1` it prints the full
   formatted error (`%+v`) followed by the message; otherwise it prints only the
   message plus a hint to re-run with `STEPDEBUG=1`. Other errors are printed
   directly (`%+v` only in debug mode). Any error returns exit code 1.

`newApp` performs several important setup steps:

- Patches global writer/prompt hooks for the crypto libraries:
  `pemutil.WriteFile`, `pemutil.PromptPassword`, and `jose.PromptPassword` are
  replaced so key material is written through `cli-utils/fileutil` and passwords
  are prompted through `cli-utils/ui`.
- Overrides global urfave/cli rendering components with the `cli-utils/usage`
  package: `cli.VersionPrinter` (invokes the `version` command),
  `AppHelpTemplate`, `SubcommandHelpTemplate`, `CommandHelpTemplate`,
  `HelpPrinter`, and `FlagNamePrefixer`, and a custom `FlagStringer`
  (`stringifyFlag`) that renders `<placeholder>` usage tokens.
- Builds the `cli.App`: sets `Name`/`HelpName` to `stepAppName`, usage
  "plumbing for distributed systems", version, the command set from
  `command.Retrieve()`, bash completion enabled, and a copyright banner. A
  `--config` string flag is added for loading CLI flags from a config file.
- Sets `app.Action` to a fallback that: for a non-empty first argument, looks up
  a plugin via `plugin.LookPath`; if a plugin executable is found it runs it; if
  a well-known plugin URL is known (`plugin.GetURL`) it returns a useful error;
  otherwise it shows the help for that command name.
- Sets `app.Writer = stdout` and `app.ErrWriter = stderr`.

The `panicHandler()` prints a friendly "Something unexpected happened." message
and, unless `STEPDEBUG=1`, exits with code 2 (in debug mode it re-panics after
printing version and release date).

## Command registration

Commands are registered statically. Each command package (e.g.
`command/ca`, `command/cryptom `command/ssh`) declares an `init()` that builds a
`cli.Command` and registers it via `command.Register(cmd)` from
`cli-utils/command`. `internal/cmd/root.go` imports every enabled top-level
command package with a blank import (`_ "github.com/smallstep/cli/command/..."`)
so those `init()` functions run and populate the registry. The same blank-import
pattern enables the `cas/cloudcas`, `cas/softcas`, and `cas/stepcas` interfaces
from `github.com/smallstep/certificates/cas`.

Nested subcommand groups use the standard urfave/cli `Subcommands` slice (see
e.g. the `ca` group in [`command/ca/ca.go`](../../command/ca/ca.go) and the
`crypto` group in [`command/crypto/crypto.go`](../../command/crypto/crypto.go)).
The repository documents this pattern in
[`command/README.md`](../../command/README.md), which recommends that each level
of the hierarchy live in its own package.

## Context injection middleware

[`internal/command/inject.go`](../../internal/command/inject.go) provides the
`InjectContext` and `wrap` helpers used by command actions that need a
`context.Context`. `wrap` builds a fresh `context.Background()`, applies a chain
of middleware functions (each returning an updated context), attaches the
`*cli.Context` via `withCLIContext`, and finally invokes the action function
with the resulting context. `InjectContext` injects an existing context as the
first middleware and then wraps a function with additional middleware, returning
a `cli.ActionFunc`. `CLIContextFromContext` retrieves the stored `*cli.Context`;
it panics when not set.

## Shared flag catalog

[`flags/flags.go`](../../flags/flags.go) is the shared catalog of `cli.Flag`
values reused across command packages: key type/size/curve, token, provisioner,
CA URL, root file, password-file, offline, admin credentials, x5c headers, SSH
headers, fingerprint formatting, and many more. The same file also exports
helper functions used by many commands:

- `ParseCaURL` / `ParseCaURLIfExists` / `parseCaURL`: normalize a `--ca-url`
  value; require a non-empty value for the strict variant, prepend `https://` if
  no scheme is present, reject non-`https` schemes, and validate host/port
  including bare IPv6 handling.
- `ParseTimeOrDuration`, `ParseTimeDuration`: parse `--not-before`/`--not-after`
  as RFC 3339 times or Go durations.
- `ParseTemplateData` / `GetTemplateData`: build a certificate-template data map
  from `--set`/`--set-file` flags.
- `ParseFingerprintFormat`, `FingerprintFormatFlag`, `FingerprintCertificateModeFlag`.
- `FirstStringOf`: return the value and name of the first defined flag from a
  list (useful for aliased flags such as `--provisioner`/`--issuer`).

## File and key-detail helpers

The `utils` package ([`utils/utils.go`](../../utils/utils.go),
[`utils/read.go`](../../utils/read.go), [`utils/cli.go`](../../utils/cli.go)) is
a small set of helpers:

- `Fail(err)` prints the error (full struct under `STEPDEBUG=1`) and calls
  `os.Exit(1)`.
- `CompleteURL` parses and normalizes a URL, defaulting a missing scheme to
  `https`.
- `FileExists`, `ReadFile` (honors `-` as stdin and strips the UTF-8 BOM),
  `ReadInput`, `ReadPasswordFromFile`, `ReadAll`, `ReadString`.
- `GetKeyDetailsFromCLI` centralizes parsing of `--kty`/`--curve`/`--size` from
  the CLI context, enforcing that RSA keys meet a minimum size (2048 bits) unless
  `--insecure` is set, and that incompatible flag combinations are rejected.
  Defaults are EC/P-256.

## Process execution, signals, and browser

[`exec/exec.go`](../../exec/exec.go) layers process management over the standard
library:

- `LookPath` aliases `exec.LookPath`.
- `IsWSL` detects Windows Subsystem for Linux.
- `Exec` calls the `execve(2)` system call via `utils/sysutils` on non-Windows,
  or `Run` on Windows.
- `Run` starts a child process wired to the current stdin/stdout/stderr, forwards
  all signals received by `step` to the child (via a `signalHandler` goroutine),
  waits for it to finish, and exits with the child's exit status.
- `RunWithPid` is like `Run` but writes the child PID to a pid file and removes
  it after the process finishes.
- `OpenInBrowser` opens a URL in the system browser using platform-specific
  commands (`open`, `xdg-open`, `rundll32`).

## Plugin dispatch

`internal/cmd/root.go`'s fallback `app.Action` implements the plugin mechanism.
`internal/plugin/plugin.go` searches for an executable named
`step-<name>-plugin` in `$STEPPATH/plugins` (downloaded via `step path
--plugins`) or in `$PATH`. `plugin.Run` executes the plugin passing the CLI
arguments, with special handling for `.ps1` files on Windows. A few well-known
plugins (currently `kms`) have their download URLs mapped by `GetURL`.

## Upstreams and downstreams

This dispatcher feeds the command groups and flows documented in the related
pages: the CA integration ([ca-integration.md](./ca-integration.md)), the crypto
group ([crypto-command-group.md](./crypto-command-group.md)), the SSH group
([ssh-integration.md](./ssh-integration.md)), the token/claim package
([token-claim.md](./token-claim.md)), and the certificate group
([certificate-command-group.md](./certificate-command-group.md)). Adding or
modifying commands is described in [change-guide-add-command.md](./change-guide-add-command.md).
