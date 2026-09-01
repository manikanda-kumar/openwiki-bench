---
type: architecture
title: "Command Framework and Registration"
description: "How the step CLI assembles its urfave/cli v1 app: command registration via cli-utils, command-group patterns, help/flag customization, hidden and beta namespaces, plugin fallback, and error/exit-code handling."
tags: [architecture, cli, commands, plugins]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:55:55.365Z
sources:
  - id: openwiki-source-440fafd0d0b2b7667d37f1ad
    resource: repo://cmd/step/main.go
  - id: openwiki-source-4695ffe2593592cc94176478
    resource: repo://command/api/api.go
  - id: openwiki-source-2e6c694726c08169fdc82b8d
    resource: repo://command/base64/base64.go
  - id: openwiki-source-531f7a4638bb6c96bc20c64d
    resource: repo://command/beta/beta.go
  - id: openwiki-source-fcc4e7846deb1d742f2c351f
    resource: repo://command/ca/ca.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-498451c3449e575aef558e62
    resource: repo://command/crypto/crypto.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-362b503187f3ead50d917bf1
    resource: repo://internal/cmd/root_test.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-ab647e2cb1e7b3b70e7883be
    resource: repo://internal/plugin/plugin.go
generated: { by: "opencode", at: "2026-08-31T03:55:55.365Z" }
---

# Command Framework and Registration

The `step` binary is a `urfave/cli` v1 application whose command tree is assembled from independently registered packages. This page explains the registration mechanism, the conventions every command follows, and the cross-cutting customizations applied in `internal/cmd`.

## Assembly: blank imports plus a global registry

`cmd/step/main.go` does very little: it stamps version metadata via `step.Set`, sets the CA client `UserAgent`, and calls `cmd.Run()` (`cmd/step/main.go:21-29`). All command wiring lives in `internal/cmd/root.go`.

Two mechanisms combine to build the command tree:

1. **Blank imports enable commands.** `internal/cmd/root.go` imports every top-level command package purely for side effects (`_ "github.com/smallstep/cli/command/ca"` and 13 others, plus three CA `cas` backends) (`internal/cmd/root.go:25-44`).
2. **A global registry collects them.** Each package's `init()` calls `command.Register(cmd)` from `github.com/smallstep/cli-utils/command`, and `newApp` populates `app.Commands` with `command.Retrieve()` (`internal/cmd/root.go:122`). The registry itself lives in the external `cli-utils` module, not in this repository.

Consequence: enabling/disabling a whole command group is a one-line edit in `root.go`, and the `run()` entrypoint first calls `step.Init()` to initialize the `STEPPATH` environment before the app is built (`internal/cmd/root.go:53-57`).

## Command shape conventions

Every command is a `cli.Command` literal built in a package-level `init()` and registered once. Two composition styles appear:

- **Function-built subcommands** inside one package. `step ca` aggregates local constructors (`healthCommand()`, `initCommand()`, `tokenCommand()`, …) into `Subcommands` (`command/ca/ca.go:68-88`).
- **Package-aggregate subcommands** for nested groups. `step crypto` imports sibling packages and calls `jwk.Command()`, `jwt.Command()`, `kdf.Command()`, etc. (`command/crypto/crypto.go:160-176`); `step ca` does the same for `acme.Command()`, `admin.Command()`, `provisioner.Command()`, `policy.Command()` (`command/ca/ca.go:77-84`).

Actions are typically wrapped in `command.ActionFunc(...)` (e.g. `command/base64/base64.go:21`), the cli-utils middleware wrapper. Command documentation follows a strict text convention: `UsageText` with `**bold**` flags and a `Description` containing `## EXAMPLES` blocks — these strings are the source of shell help and generated docs, so integration help tests assert on them.

`internal/cmd/root_test.go` pins the exact top-level command set (`TestAppHasAllCommands` asserts the full name list), so adding or removing any command package from the blank-import list requires updating this test (`internal/cmd/root_test.go:11-27`).

## Help, flag rendering, and runtime hooks in `newApp`

`newApp` (not `main`) is where the framework is customized (`internal/cmd/root.go:95-154`):

- Help output is taken from `cli-utils/usage` templates (`AppHelpTemplate`, `SubcommandHelpTemplate`, `CommandHelpTemplate`, `HelpPrinter`), and `cli.VersionPrinter` delegates to `command/version` (`internal/cmd/root.go:106-112`).
- Flag help is rendered by a custom `stringifyFlag`: it extracts a `<placeholder>` from the flag's `Usage` string with a regex, defaults to `<value>` for non-bool flags, and prefixes names via `usage.FlagNamePrefixer` (`internal/cmd/root.go:180-194`). This is why flag usages throughout the repo embed placeholders like `<kty>` (`flags/flags.go:26-43`).
- It installs file/password hooks into the external crypto library: `pemutil.WriteFile = fileutil.WriteFile`, and `pemutil.PromptPassword`/`jose.PromptPassword` route to `ui.PromptPassword` (`internal/cmd/root.go:97-103`). Without this, `go.step.sm/crypto` would not use step's terminal UI or `--force`/`--password-file` machinery.
- It appends a global `--config` flag for CLI-flag config files and enables bash completion (`internal/cmd/root.go:124-131`); the `step completion` command emits ready-made bash/zsh/fish scripts and offers shell names as bash completions (`command/completion/completion.go:35-48`).
- Stdout/stderr are injected as `app.Writer`/`app.ErrWriter`, keeping `newApp` testable with buffers (`internal/cmd/root.go:149-152`).

## Plugin fallback for unknown commands

The root `app.Action` runs when `step` is invoked bare or with a name that is not a registered command (`internal/cmd/root.go:134-147`). It resolves `step <name>` to an external executable `step-<name>-plugin` using `internal/plugin.LookPath`, which checks `$STEPPATH/plugins` first (honoring `PATHEXT` extensions on Windows) and then `PATH` (`internal/plugin/plugin.go:20-52`). If found, `plugin.Run` execs it with the remaining args (wrapping `.ps1` files in `powershell` on Windows) (`internal/plugin/plugin.go:56-72`). For the well-known `kms` plugin, a not-found error includes a download URL (`internal/plugin/plugin.go:74-82`). Anything else falls through to `cli.ShowCommandHelp`.

## Hidden namespaces and error surface

- `step api` (Smallstep hosted-API auth) is registered with `Hidden: true`, so it stays out of help output while remaining runnable (`command/api/api.go:12-24`).
- `step beta ca` exposes in-development APIs by reusing `ca.BetaCommand()`, which embeds the same `acme.Command()` object as the stable tree — beta and stable subcommands share implementation (`command/beta/beta.go:12-24`, `command/ca/ca.go:159-170`).

Error handling in `run()` defines the user-facing failure contract: a returned error that satisfies an interface with `Message() string` prints only that message plus a "Re-run with `STEPDEBUG=1`" hint; any error is printed in full detail (`%+v`) when `STEPDEBUG=1` (`internal/cmd/root.go:62-79`). Failures exit with code 1; a recovered panic prints a "report to info@smallstep.com" script and exits 2, with raw panic re-raised under `STEPDEBUG=1` (`internal/cmd/root.go:66-71`, `internal/cmd/root.go:156-170`).

## Shared flags package

`flags/` centralizes reusable `cli.Flag` definitions and parsers so commands don't redefine them: key material flags (`KTY`, `Size`, `Curve`), security gates (`Subtle`, `Insecure`, plus hidden variants used when a command wants the flag undocumented), CA targeting (`CaURLFlag`, `RootFlag`, `Offline`, `CAConfig`, `Context`, hidden `NoContext`), and provisioner auth flags (`X5CFlag`, `SSHPOPFlag`, `NebulaFlag`, admin variants) (`flags/flags.go:24-120`, `flags/flags.go:195-380`). It also implements parsing helpers — notably `ParseCaURL`/`parseCaURL`, which require an `https` scheme (prepending it when missing) and normalize bare IPv6 hosts to bracketed form (`flags/flags.go:649-705`), and `GetTemplateData`, which merges repeated `--set key=value` pairs and a `--set-file` JSON document into template data, falling back to raw strings when a value is not valid JSON (`flags/flags.go:613-642`).

## See also

- Overview of process entrypoint and module boundaries: [System Architecture Overview](/openwiki/architecture/overview.md)
- STEPPATH, contexts, and how `--ca-url`/`--root` values persist: [Configuration, STEPPATH, and Contexts](/openwiki/architecture/configuration-and-steppath.md)
- Step-by-step recipe for adding a command: [Change Guide: Add a New Command](/openwiki/guides/adding-a-command.md)
