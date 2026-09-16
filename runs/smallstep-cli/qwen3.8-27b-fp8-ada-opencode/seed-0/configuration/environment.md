---
type: "Reference"
title: "Configuration, Contexts, and Environment"
openwiki_generated: true
verified:
  - by: openwiki/0.4.3
    at: 2026-09-14T13:44:47.469Z
---

# Configuration, Contexts, and Environment

The CLI locates its configuration through a base directory `$STEPPATH` (default `$HOME/.step`, overridable with the `STEPPATH` environment variable, per `command/path/path.go:17`), a per-environment defaults file `defaults.json`, and an optional multi-authority "contexts" system stored in `contexts.json`/`current-context.json`. Shared global flags in `flags/flags.go` let every command receive CA connection, authentication, key-material, and behavior settings, and `internal/command/inject.go` provides the middleware plumbing for command actions.

## `$STEPPATH` layout

`step.Init()` (from `github.com/smallstep/cli-utils/step`) runs before the CLI app starts (`internal/cmd/root.go:54`). `step path` prints the resolved path: the current authority path when a context is selected, otherwise the base path; `--base` prints the base path and `--profile` the current profile path (`command/path/path.go:92`).

Files and directories the CLI expects under the base path:

- `certs/root_ca.crt` — the bootstrap root certificate, written by `utils/cautils/bootstrap.go` and documented as the default in the `step ca` help (`command/ca/ca.go:36`, `utils/cautils/bootstrap.go:145`).
- `config/defaults.json` — the authority defaults `ca-url`, `fingerprint`, and `root`, plus optional `redirect-url`, `provisioner`, and `min-password-length` (`utils/cautils/bootstrap.go:89`); the example in `command/ca/ca.go:36` shows the three core fields.
- `current-context.json` — `{"context": "<name>"}` selecting the default context (`command/path/path.go:39`).
- `contexts.json` — a map of context name to `{authority, profile}` (`command/context/context.go:21`, `command/path/path.go:66`).
- `authorities/<authority>/` and `profiles/<profile>/` — per-context configuration directories (`command/path/path.go:45`, `command/path/path.go:79`).
- `plugins/` — where the plugin loader looks for `step-<name>-plugin` binaries (`internal/plugin/plugin.go:40`).
- `ssh/includes` — an include file listing SSH authorities, pruned when a context is removed (`command/context/remove.go:117`).

When contexts are enabled, `bootstrap` also creates an empty `profile defaults` file (`{}`) at `step.ProfileDefaultsFile()` (`utils/cautils/bootstrap.go:197`). The `--ca-config` flag defaults to `$(step path)/config/ca.json` for offline CA mode (`flags/flags.go:291`).

## Contexts

`step context` ("manage certificate authority contexts") registers four subcommands: `current`, `list`, `remove`, and `select` (`command/context/context.go:10`).

- `step context list` prints all context names alphabetically, marking the current one with `▶` (`command/context/list.go:37`).
- `step context current` prints the current context name, or with `--json` a `{"name","authority","profile"}` object; it errors "no context selected" when none is set (`command/context/current.go:46`).
- `step context select <name>` sets the default context via `step.Contexts().SaveCurrent(name)` (`command/context/select.go:34`).
- `step context remove <name>` removes the context plus its on-disk configuration: the authority directory is removed only if no other context shares that authority, the profile directory only if unshared, otherwise a confirmation prompt appears unless `--force` is given; it also removes the authority line from `$(step path --base)/ssh/includes` (`command/context/remove.go:47`).

All four context subcommands declare `flags.HiddenNoContext`, a hidden `--no-context` BoolT flag meaning "do not apply context specific environment for this command" (`flags/flags.go:256`), so the context commands themselves are not affected by the context environment they manage.

Contexts are created by `step ca init` (which adds a context, saves it as current, and sets it, `command/ca/init.go:544`) and by `step ca bootstrap`/`BootstrapTeamAuthority` through `UseContext` in `utils/cautils/bootstrap.go:36`, which returns true when contexts are enabled or any of `--context`, `--authority`, or `--profile` is set.

## Bootstrapping configuration

`bootstrap()` (`utils/cautils/bootstrap.go:98`) downloads and stores the root from the CA (`client.Root(fingerprint)`, writing it to the root CA path with mode `0600`), then writes `defaults.json` from the `bootstrapConfig` struct (`ca-url`, `fingerprint`, `root`, and optional `redirect-url`, `provisioner`, `min-password-length`, `utils/cautils/bootstrap.go:89`). It also injects the resolved `ca-url`, `fingerprint`, and `root` back into the current `cli.Context` (`utils/cautils/bootstrap.go:187`) so later commands in the same invocation see them. With `--install` it installs the root into the system truststore (`utils/cautils/bootstrap.go:212`).

The team flow, `BootstrapTeamAuthority` (`utils/cautils/bootstrap.go:226`), queries `https://api.smallstep.com/v1/teams/<team>/authorities/<authority>` (or a custom `--team-url` with `<>` replaced by the team ID), decodes the `bootstrapAPIResponse` (`url`, `fingerprint`, `redirect-url`, `provisioner`, `min-password-length`, `utils/cautils/bootstrap.go:28`), and calls `bootstrap` with the context name `<team-authority>.<team>`. `BootstrapAuthority` (`utils/cautils/bootstrap.go:297`) does the same with just a CA URL and fingerprint, using the CA host as the default context name.

When contexts are not used, `WarnContext` prints a notice suggesting contexts if a `config/ca.json` already exists (`utils/cautils/bootstrap.go:44`).

## How flags resolve to a context

The resolution chain visible in this repo:

1. Explicit command-line flags always win; `ParseCaURL` only requires `--ca-url` when `--offline` is not set (`flags/flags.go:645`).
2. `defaults.json` provides stored defaults for `ca-url`, `fingerprint`, and `root` after a bootstrap — the documented behavior is that "ca commands do not need to specify the flags --ca-url, --root or --fingerprint" after bootstrap (`command/ca/bootstrap.go:32`). `flags.Identity` exists specifically "so it can be configured in $STEPPATH/config/defaults.json" (`flags/flags.go:451`).
3. Context selection happens via `current-context.json` plus the per-context authority/profile defaults, selected at startup by `step.Init()` (`internal/cmd/root.go:54`).

The merge of the current context's defaults into flag values (context profile defaults overriding base defaults, and context paths being substituted into `step.Path()`) lives in the `github.com/smallstep/cli-utils` `step` and `command` packages, which are outside this repo; this repo only references `step.Contexts()`, `step.Path()`, `step.BasePath()`, `step.DefaultsFile()`, `step.ProfileDefaultsFile()`, and `step.Init()`, so the exact precedence rules there are not verifiable from this codebase. The `HiddenNoContext` flag and the `step context` command group are the in-repo hooks for that mechanism.

## Shared flags (`flags/flags.go`)

`flags/flags.go` defines the CLI-wide flag set in one `var` block plus small factory functions. By purpose:

- **CA connection:** `CaURL` (`ca-url`, `flags/flags.go:244`), `Root` (`root`, `flags/flags.go:250`), `Context` (`context`, `flags/flags.go:264`), `ContextProfile` (`profile`, `flags/flags.go:270`), `ContextAuthority` (`authority`, `flags/flags.go:276`), `Offline` (`offline`, `flags/flags.go:282`), `CaConfig` (`ca-config`, `flags/flags.go:290`), `HiddenNoContext` (`flags/flags.go:256`), `FingerprintFormatFlag`/`FingerprintCertificateModeFlag` (`flags/flags.go:526`).
- **Provisioner/admin auth:** `Provisioner` (`provisioner,issuer`, `flags/flags.go:193`), `AdminProvisioner` (`flags/flags.go:199`), `AdminSubject` (`flags/flags.go:205`), `AdminPasswordFile`/`AdminPasswordFileNoAlias` (`flags/flags.go:212`), `ProvisionerPasswordFile`/`ProvisionerPasswordFileWithAlias` (`flags/flags.go:228`), `AdminCert`/`AdminKey` (`flags/flags.go:298`).
- **Token headers:** `X5cCert`/`X5cKey`/`X5cChain`/`X5cInsecure` (`flags/flags.go:312`), `X5tCert`/`X5tKey` (`flags/flags.go:340`), `SSHPOPCert`/`SSHPOPKey` (`flags/flags.go:355`), `NebulaCert`/`NebulaKey` (`flags/flags.go:369`), `Confirmation` (`cnf`)/`ConfirmationFile` (`cnf-file`) (`flags/flags.go:384`), `K8sSATokenPathFlag` (`flags/flags.go:95`).
- **Key material:** `KTY` (`kty`, default `EC`), `Size` (`size`), `Curve` (`crv,curve`), `Subtle`/`SubtleHidden` (`flags/flags.go:23`).
- **Time bounds:** `NotBefore`/`NotAfter` and the SSH-only `CertNotBefore`/`CertNotAfter` (`flags/flags.go:149`), parsed by `ParseTimeOrDuration` (RFC 3339 time or duration from now) and `ParseTimeDuration` (`flags/flags.go:566`).
- **Output/behavior:** `Force` (`flags/flags.go:103`), `DryRun` (`flags/flags.go:109`), `Insecure`/`InsecureHidden` (`flags/flags.go:84`), `NoPassword` (requires `--insecure`) and `PasswordFile` (`flags/flags.go:115`), `Token` (`flags/flags.go:130`), `NoPager` (`flags/flags.go:143`), `Limit` (`flags/flags.go:137`), `Console` (`flags/flags.go:520`), `Comment` (`flags/flags.go:515`).
- **Templates:** `Template` (`template`), `TemplateSet` (`set`), `TemplateSetFile` (`set-file`) with `ParseTemplateData`/`GetTemplateData` merging `--set-file` JSON with repeated `--set key=value` pairs (`flags/flags.go:433`, `flags/flags.go:598`).
- **Teams/OAuth:** `Team` (`flags/flags.go:397`), `TeamURL` (`flags/flags.go:403`), `TeamAuthority` (`flags/flags.go:411`), `RedirectURL` (`flags/flags.go:419`), `ServerName` (`flags/flags.go:426`), `Identity` (`flags/flags.go:451`), `EABKeyID`/`EABReference` (`flags/flags.go:459`), `KMSUri` (`flags/flags.go:471`), `AttestationURI` (`flags/flags.go:510`).

Helper functions: `ParseCaURL`/`ParseCaURLIfExists`/`parseCaURL` require a non-empty (unless offline) CA URL, prepend `https://` when no scheme is given, reject non-https schemes, and normalize bracket-less IPv6 hosts (`flags/flags.go:645`); `ParseFingerprintFormat` maps `hex`, `base64`, `base64-url`, `base64-url-raw`, `base64-raw`, and `emoji` strings to `fingerprint.Encoding` (`flags/flags.go:546`); `FirstStringOf` returns the first explicitly-set (or first non-empty default) of several aliased flags (`flags/flags.go:708`).

The app additionally defines a global `--config` flag, "path to the config file to use for CLI flags" (`internal/cmd/root.go:128`); its consumption happens in the cli-utils startup path, not in this repo.

## Action context injection

`internal/command/inject.go` provides `InjectContext`, which prepends a middleware that pins a pre-built `context.Context` so all later middlewares operate on it, and `wrap`, which runs the middleware chain over a fresh `context.Background()` and attaches the `cli.Context` under a private key (`internal/command/inject.go:14`, `internal/command/inject.go:40`). `CLIContextFromContext` recovers the `cli.Context` from the context, panicking when absent (`internal/command/inject.go:34`). Commands that need a context built before the action runs (e.g. the `step ca policy` actions in `command/ca/policy/actions/`) use `command.InjectContext` as their `Action`.

## Change guides

### Adding a shared flag in `flags/flags.go`

1. Add the flag to the `var` block in `flags/flags.go` with a documented `Usage` string; use the `<placeholder>` convention so help output picks it up (`internal/cmd/root.go:180` stringifies the first `<...>` in the usage text).
2. If the flag needs parsing (time, URL, format), add a `Parse*` helper next to the existing ones (`flags/flags.go:546`) rather than parsing inline in commands.
3. Wire the flag into each command's `Flags` list that needs it, reading it through the `cli.Context` in the action.
4. Keep hidden variants (`SubtleHidden`, `InsecureHidden`, `HiddenNoContext`) for flags that must be accepted but not shown in help.

### Wiring a new context-aware behavior

1. Gate on `cautils.UseContext(ctx)` (`utils/cautils/bootstrap.go:36`) to decide between context-based and flat `$STEPPATH` configuration.
2. Read or write contexts only through `step.Contexts()` (`Add`, `Get`, `GetCurrent`, `SaveCurrent`, `SetCurrent`, `Remove`), and store per-environment values in the authority/profile directories rather than hardcoding `~/.step`.
3. If the command should not receive the context environment (like the `step context` subcommands), add `flags.HiddenNoContext` to its flags.
