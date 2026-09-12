---
type: configuration
title: Configuration, Environment, and the Step Path
description: How step resolves the step path (STEPPATH), manages multi-CA contexts, handles the global --config flag, and resolves default key-type/curve/size flags.
tags: [configuration, environment, steppath, context, keys]
verified:
  - by: openwiki/0.4.3
    at: 2026-09-12T20:38:13.856Z
sources:
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-7a5e071b6b6192c80a6918aa
    resource: repo://internal/cmd/root.go
  - id: openwiki-source-5683f0c19a47486d96532f16
    resource: repo://utils/cli.go
generated: { by: "opencode", at: "2026-09-12T20:38:13.856Z" }
---

# Configuration, Environment, and the Step Path

`step` derives its operational roots and defaults from environment variables,
the filesystem ("step path"), and contexts describing certificate authorities.

## The step path and STEPPATH

The step path defaults to `$HOME/.step` and can be overridden with the
`STEPPATH` environment variable (`command/path/path.go`). The `step path`
subcommand prints the configured path for running commands:

- `step path --base` prints `step.BasePath()` (e.g. `/Users/max/.step`), the
  base directory that holds `config/defaults.json`, `certs/`, `secrets/`, and
  `plugins/`, and context state.
- `step path` (no flags) prints `step.Path()`, which is the *authority* path —
  a subdirectory under the base such as
  `/Users/max/.step/authorities/machine.step-internal.net` when a current
  context with an `authority` is configured, otherwise the base path itself.
- `step path --profile` prints `step.ProfilePath()` — the profile path, e.g.
  `/Users/max/.step/profiles/<profile-name>` when a current context references
  a profile of that name.

So `step.Path()` switches between CA environments based on the current context,
while `--base` always returns the static base.

## Contexts

The `step context` command group (`command/context/context.go`) manages
certificate-authority contexts. Contexts are stored in two JSON files under the
base path:

- `contexts.json` — an object mapping context names to entries with
  `"authority"` and `"profile"` fields (see the docs in `context.go:15-49` and
  `path.go:66-77`).
- `current-context.json` — `{"context": "<name>"}` records the selected default
  context.

Subcommands:

- `step context list` — lists available contexts.
- `step context select <name>` — sets `current-context.json` to the named
  context via `step.Contexts().SaveCurrent` (`select.go:34-44`).
- `step context current` — shows the current context.
- `step context remove` — removes a context.

The presence of a current context changes the effective step path (`step.Path()`
becomes the authority path) and which CA (`--authority`) and profile
(`--profile`) defaults are used.

## The global --config flag

`internal/cmd/root.go:128-131` appends a global `cli.StringFlag` named
`config` to the app, described as "path to the config file to use for CLI
flags". Each subcommand reads it via the shared `flags` package to load
additional CLI-flag defaults from a config file. (Flag parsing itself is
centralized in `flags/flags.go`.)

## Key-type default resolution

Default key algorithms are resolved in `utils/cli.go` via
`GetKeyDetailsFromCLI` (utils/cli.go:20-84):

- No `--kty` given: defaults to EC P-256 (curve `P-256`, size 0).
- `--kty RSA`: defaults size to 2048 (`DefaultRSASize`), rejects a `--curve`,
  and requires size >= 2048 unless `--insecure` is set.
- `--kty EC`: accepts `--curve` values `P-256` (default), `P-384`, or `P-521`,
  and rejects `--size`.
- `--kty OKP`: defaults the curve to `Ed25519` and rejects `--size`.
- Invalid key types/curves and `--curve`/`--size` used without `--kty` produce
  explicit errors.

These defaults flow into certificate creation, SSH login, and CSR generation
commands.

## Related

- [CLI Runtime and Command Registration](../architecture/command-runtime.md) — boot and global flags.
- [Quickstart](../quickstart.md) — first-run steps.
