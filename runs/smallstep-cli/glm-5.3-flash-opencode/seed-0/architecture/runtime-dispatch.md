---
type: architecture-concept
title: Runtime and Command Dispatch
description: How the step binary boots, dispatches commands and plugins, reports errors and versions, and exits.
tags: [entrypoint, urfave-cli, dispatch, errors, plugins, version, completion]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T00:32:15.007Z
sources:
  - id: openwiki-source-3c099d9af7cba6b30d6eaf07
    resource: repo://.gitattributes
  - id: openwiki-source-c24853a4005579209b2246f3
    resource: repo://autocomplete/README.md
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-771e87e77333e692962af597
    resource: repo://integration/main_test.go
  - id: openwiki-source-0427a29079df0e9dd1633bac
    resource: repo://integration/testdata/bogus.txtar
  - id: openwiki-source-2d42e139d28b99ef1065b6e9
    resource: repo://integration/testdata/version.txtar
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
  - id: openwiki-source-e7d0a4f9fa0532023b5aac61
    resource: repo://make/version.sh
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
generated: { by: "opencode", at: "2026-08-31T00:32:15.007Z" }
---

The binary entrypoint is deliberately trivial; all behavior lives in an internal
package so it can be reused by tests. This page traces what happens between
`step <anything>` and a command action, and the global contracts (error formatting,
exit codes, version reporting, plugin fallback) that every command inherits.

## Entrypoint and process initialization

`cmd/step/main.go` is 29 lines. Its `init()` performs three process-global setup
steps before anything runs (cmd/step/main.go:21-25):

- `step.Set("Smallstep CLI", Version, BuildTime)` registers the product name and the
  LDFLAG-injected `Version`/`BuildTime` variables (declared with `"N/A"` defaults at
  cmd/step/main.go:10-19). The build system injects both via `-X main.Version=...`
  and `-X main.BuildTime=...` (Makefile:64-71).
- `ca.UserAgent = step.Version()` sets the user agent that every step-ca API client
  request will send (cmd/step/main.go:23).
- `cmd.SetName(AppName)` allows the packaged binary name to differ from `step` —
  for example the nfpm build ships the binary as `step-cli` (.goreleaser.yml, build
  id `nfpm`), and the app name drives help output (internal/cmd/root.go:87-93).

`main()` only calls `cmd.Run()` (cmd/step/main.go:27-29). `Run` is `os.Exit(run())`
(internal/cmd/root.go:46-48), and `run()` is the whole process lifecycle
(internal/cmd/root.go:50-85):

1. `defer panicHandler()` installs the deferred panic recovery (root.go:51).
2. `step.Init()` initializes the `$STEPPATH` environment (contexts, defaults) from
   the external cli-utils module (root.go:54-57); a failure prints to stderr and
   returns exit code 1 before any command runs.
3. `newApp(os.Stdout, os.Stderr)` builds the urfave/cli app and `app.Run(os.Args)`
   dispatches (root.go:60-62).
4. Error handling distinguishes errors implementing `Message() string` (the
   `errs.Error` type) from plain errors: `Message()` text is printed to stderr
   with a `Re-run with STEPDEBUG=1 for more info.` hint, while with
   `STEPDEBUG=1` the full `%+v` stack is printed plus the message
   (root.go:62-82). Any error yields exit code 1; success is 0 (root.go:81, 84).

### Panic handling and exit codes

`panicHandler` recovers panics (internal/cmd/root.go:156-170). Without `STEPDEBUG=1`
it prints a friendly "Something unexpected happened." message including the exact
`STEPDEBUG=1 <command>` reproduction line and exits with code **2**. With
`STEPDEBUG=1` it prints the version and release date, then re-panics to preserve the
original stack for debugging. So the exit-code contract is: 0 success, 1 command
error, 2 panic — plus the special codes individual commands define (for example
`step certificate needs-renewal`, whose nonzero codes are part of its API, documented
in the renewal page).

## App assembly in newApp

`newApp` (internal/cmd/root.go:95-154) performs the wiring that commands depend on:

- **Library prompt routing** (root.go:96-103): the package-level function variables
  `pemutil.WriteFile`, `pemutil.PromptPassword`, and `jose.PromptPassword` in
  `go.step.sm/crypto` are overridden so file writes go through `fileutil.WriteFile`
  and password prompts render through the CLI's `ui` package. This is why prompts
  raised deep inside the crypto libraries look identical to CLI-generated ones — it
  happens once here, not per command.
- **Framework overrides** (root.go:105-114): `cli.VersionPrinter` is replaced with
  `version.Command` (command/version/version.go:30-33), and the help/command
  templates, `HelpPrinter`, `FlagNamePrefixer`, and `FlagStringer` come from the
  external `usage` package plus a local `stringifyFlag`. `stringifyFlag`
  (root.go:180-194) extracts the first `<...>` placeholder from a flag's usage text
  for the help column, falling back to `<value>` for non-boolean flags — which is
  why flag usage strings are written with `<placeholder>` markup.
- **Command tree** (root.go:122): `app.Commands = command.Retrieve()` pulls every
  command registered by package `init()` side effects. The blank imports at
  root.go:25-44 are the actual wiring: the three CAS backends (cloudcas, softcas,
  stepcas) plus the 13 top-level command packages (api, base64, beta, ca,
  certificate, completion, context, crl, crypto, fileserver, oauth, path, ssh).
- **Global flags** (root.go:123-131): the built-in help flag plus a global
  `--config` flag; `app.EnableBashCompletion = true` enables urfave's
  `--generate-bash-completion` machinery app-wide (root.go:124).
- **Output streams** (root.go:149-151): `app.Writer`/`app.ErrWriter` are the real
  stdout/stderr, matching the documented rule that non-successful output goes to
  stderr.

## Fallback dispatch: plugins and help

The app-level `Action` runs when no registered command matches
(internal/cmd/root.go:133-147). For `step <unknown>`:

1. `plugin.LookPath(name)` searches for an executable named
   `step-<name>-plugin` — first in `$(step path)/plugins` (with Windows extension
   probing via `PATHEXT`), then along `$PATH` (internal/plugin/plugin.go:20-52).
   On a hit, `plugin.Run` executes it with the remaining arguments, wiring
   stdin/stdout/stderr through, and invoking PowerShell for `.ps1` files on
   Windows (plugin.go:56-72). This is the mechanism behind `step-kms-plugin`
   being invocable as `step kms ...`.
2. Otherwise, `plugin.GetURL(name)` returns a download URL for known plugins —
   currently `kms` → `https://github.com/smallstep/step-kms-plugin`
   (plugin.go:74-82) — and the CLI errors suggesting the download (root.go:140-143).
3. Otherwise `cli.ShowCommandHelp(ctx, name)` shows help for the unknown name
   (root.go:144).

With no arguments at all, the app help is shown (root.go:146). This fallback is also
why the KMS integration page's plugin model works: unknown first arguments are
delegated to external executables rather than rejected.

## Version reporting

`step version` prints `step.Version()` and `step.ReleaseDate()` from cli-utils
(command/version/version.go:30-33). The same `version.Command` is installed as the
global `cli.VersionPrinter` (root.go:106-108), so `--version` on any level uses it,
and the panic handler prints the same version string under `STEPDEBUG=1`
(root.go:158-160). In untagged test builds the version string is the
git-describe/`.VERSION`-derived slug; the integration test pins it as
`Smallstep CLI/0000000-dev` for dev builds (integration/testdata/version.txtar:2).
The `.VERSION` file is a `git archive` placeholder expanded by the `export-subst`
attribute in .gitattributes:1, with `make/version.sh` extracting the tag slug.

## Shell completion

`app.EnableBashCompletion = true` (root.go:124) turns on urfave's hidden
`--generate-bash-completion` protocol. `step completion <shell>` prints installable
scripts for bash, zsh, and fish (command/completion/completion.go:15-54): bash and
zsh are embedded script literals that call back into the binary with
`--generate-bash-completion` (completion.go:56-98; the zsh variant sets the
`_CLI_ZSH_AUTOCOMPLETE_HACK=1` environment hack), while fish is generated
programmatically via `ctx.App.ToFishCompletion()` (completion.go:112-117). The
command's own `BashComplete` suggests the three shell names (completion.go:43-50).
The deprecated `autocomplete/` directory ships the same bash/zsh scripts as files
for packaging (autocomplete/README.md).

## Path introspection

`step path` prints the resolved paths from the cli-utils `step` package: `step.Path()`
by default, `step.BasePath()` with `--base`, and `step.ProfilePath()` with
`--profile` (command/path/path.go:92-103). Its help text documents the context model:
without a current context the path is `$HOME/.step` (overridable via `STEPPATH`), and
with a current context (stored at `$STEPPATH/current-context.json`) it resolves into
`$STEPPATH/authorities/<name>` or `$STEPPATH/profiles/<name>`
(command/path/path.go:17-80). The configuration page covers that state model in
depth; the runtime contract here is that `step.Init()` (root.go:54) resolves all of
this before any command executes.

## Representative tests

The testscript integration suite runs `cmd.Run` in-process against `.txtar`
scenarios, so dispatch behavior is directly tested: `integration/testdata/version.txtar`
asserts `step version` output, and `integration/testdata/bogus.txtar` covers unknown
command handling. See the testing strategy page for how these run.
