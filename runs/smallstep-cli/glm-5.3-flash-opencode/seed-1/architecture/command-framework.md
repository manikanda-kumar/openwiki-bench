---
type: cli-bootstrap-and-command-framework
title: Command Framework and CLI Bootstrap
description: How the step binary boots, registers commands, handles errors and exit codes, and dispatches unknown commands to plugins.
tags: [cli, bootstrap, urfave-cli, commands, flags, errors, plugins]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-dc80b6a7fbf989ff3fc2fcb4
    resource: repo://command/README.md
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-9b39f344a653066047334c35
    resource: repo://exec/exec.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-c61677f0ce7fea23c695563c
    resource: repo://utils/cautils/token_generator.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# Command Framework and CLI Bootstrap

## Responsibility and ownership

The `step` binary is assembled in two small packages. `cmd/step/main.go` is the
Go entrypoint: it publishes build-time `Version`/`BuildTime` variables (set via
LDFLAGS at build time), registers them with `step.Set("Smallstep CLI", ...)`,
feeds the version into the CA client's `UserAgent`, and delegates everything to
`cmd.Run()` in `internal/cmd` (repo://cmd/step/main.go#L10-L29). All command
definitions live in `command/*` packages, and the shared framework glue (app
assembly, flags, error helpers, plugin dispatch) lives in `internal/cmd`,
`flags`, `exec`, and `internal/plugin` (repo://internal/cmd/root.go#L95-L154).

This repository is the CLI *client* layer; the heavy lifting (JWT/JOSE, KMS,
certificate handling, and the step-ca authority itself) is delegated to Smallstep
libraries such as `github.com/smallstep/certificates`, `go.step.sm/crypto`, and
`github.com/smallstep/cli-utils` (repo://go.mod).

## Bootstrap sequence

`run()` in `internal/cmd/root.go` performs the boot in this order:

1. Install a deferred `panicHandler()` (repo://internal/cmd/root.go#L50-L51).
2. Initialize the step environment via `step.Init()` from cli-utils, which
   establishes `$STEPPATH`-based paths; a failure prints to stderr and returns
   exit code 1 (repo://internal/cmd/root.go#L53-L57).
3. Build the `urfave/cli` app via `newApp(os.Stdout, os.Stderr)` (repo://internal/cmd/root.go#L60).
4. Run `app.Run(os.Args)`; an error result exits 1, otherwise 0 (repo://internal/cmd/root.go#L62-L84).

`newApp` wires framework components before creating the app (repo://internal/cmd/root.go#L95-L154):

- Injects default file writers and password prompters into `pemutil` and
  `jose` from `go.step.sm/crypto`, so library-level prompts route through
  cli-utils' `ui` package (repo://internal/cmd/root.go#L96-L103).
- Overrides the urfave/cli help and version printers with Smallstep's
  `usage` templates and a custom `stringifyFlag` renderer that derives
  `<placeholder>` text from flag usage strings (repo://internal/cmd/root.go#L106-L114,
  repo://internal/cmd/root.go#L180-L194).
- Sets the app name from `SetName` (defaults to `step`), enables bash
  completion, and appends a global `--config` flag (repo://internal/cmd/root.go#L116-L131).
- Populates `app.Commands` with `command.Retrieve()`, the registry filled by
  command packages (repo://internal/cmd/root.go#L122).

The full command tree is only assembled because `internal/cmd/root.go` blank-imports
every top-level command package (`api`, `base64`, `beta`, `ca`, `certificate`,
`completion`, `context`, `crl`, `crypto`, `fileserver`, `oauth`, `path`, `ssh`)
plus the enabled CAS interfaces (`cloudcas`, `softcas`, `stepcas`) from
`smallstep/certificates` (repo://internal/cmd/root.go#L25-L44). Importing a
command package runs its `init()`, which calls `command.Register` — for example
the `version` command registers itself this way (repo://command/version/version.go#L18-L32),
as does the `ca` group with its 16 subcommands (repo://command/ca/ca.go#L15-L89).

## Command registration convention

The documented convention (repo://command/README.md#L24-L62) is:

- Each command (or command group) lives in its own package under `command/`.
- The package's `init()` builds a `cli.Command` and calls `command.Register(cmd)`.
- Top-level commands must be blank-imported in `internal/cmd/root.go` so their
  `init()` runs. Subcommands are referenced by their parent group instead
  (e.g. `ca` lists `provisioner.Command()`, `acme.Command()`, `policy.Command()`,
  `admin.Command()` as subcommands, repo://command/ca/ca.go#L68-L86).

Shared flag definitions live in `flags` so commands reuse them instead of
duplicating usage text; examples include `KTY`, `Size`, `Curve`, and `Subtle`
(repo://flags/flags.go#L23-L76). The package also centralizes CA URL parsing:
`ParseCaURL` requires a non-empty `--ca-url` (unless `--offline` is set),
prepends `https` when the scheme is missing, and rejects non-https URLs (repo://flags/flags.go#L649-L674).

## Error output, exit codes, and STEPDEBUG

The app-level error contract is defined in `run()` (repo://internal/cmd/root.go#L62-L84):

- Errors implementing a `Message() string` interface print only that message to
  stderr, followed by `Re-run with STEPDEBUG=1 for more info.` unless
  `STEPDEBUG=1` is set, in which case the full `%+v` stack is printed first.
- Plain errors print `err` (or `%+v` with `STEPDEBUG=1`).
- Any error yields exit code 1.

The deferred `panicHandler` converts panics into a friendly message suggesting
`STEPDEBUG=1 <argv>` and exits with code 2; with `STEPDEBUG=1` it re-panics and
prints the version and release date (repo://internal/cmd/root.go#L156-L170).
`utils.Fail` offers the same STEPDEBUG-aware error printing with a direct
`os.Exit(1)` for early exits (repo://utils/utils.go#L14-L23).

## Unknown-command and plugin dispatch

The app-level `Action` handles bare `step` and unrecognized first arguments (repo://internal/cmd/root.go#L134-L147):

- If `plugin.LookPath(name)` finds an executable named `step-<name>-plugin`,
  it is executed with the remaining arguments via `plugin.Run`.
- Otherwise, if the name is a known plugin project (`plugin.GetURL`, currently
  `kms` → the step-kms-plugin repository), the CLI prints a not-found error
  with the download URL.
- Otherwise it shows help for that name.

Plugin discovery checks `$STEPPATH/plugins` first, then `PATH`; on Windows it
tries each `PATHEXT` extension (defaulting to `.com`, `.exe`, `.bat`, `.cmd`,
`.ps1`) under the plugins directory (repo://internal/plugin/plugin.go#L20-L52).
`plugin.Run` streams stdin/stdout/stderr to the child process and, on Windows,
invokes PowerShell for `.ps1` plugins (repo://internal/plugin/plugin.go#L56-L72).

The `exec.Step` helper is the in-process re-entry point used when a command
needs to invoke `step` itself — it re-executes `os.Args[0]` with the given
arguments, forwarding stdin/stderr and capturing stdout (repo://exec/exec.go#L130-L149).
The OIDC provisioner flow uses this to run `step oauth` from inside token
generation (see `generateOIDCToken`, repo://utils/cautils/token_generator.go#L144-L169).

## Invariants and failure behavior

- A failed `step.Init()` aborts before any command runs (exit 1), so no command
  can execute without a resolvable `$STEPPATH` environment (repo://internal/cmd/root.go#L53-L57).
- Exit codes are meaningful: 0 success, 1 command error, 2 panic (repo://internal/cmd/root.go#L46-L85, repo://internal/cmd/root.go#L168).
- Help/version output goes to stdout; all non-success output goes to stderr
  because `app.Writer`/`app.ErrWriter` are wired to the corresponding streams
  passed by `run()` (repo://internal/cmd/root.go#L60, repo://internal/cmd/root.go#L150-L151).
- The `--config` global flag exists at the app level; whether a given command
  consumes it is decided per-command, and this repository does not establish a
  global config file format for it beyond the flag definition (repo://internal/cmd/root.go#L127-L131).
