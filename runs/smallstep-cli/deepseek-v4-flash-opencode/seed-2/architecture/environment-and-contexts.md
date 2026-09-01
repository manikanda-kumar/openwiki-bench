---
type: architecture
title: STEPPATH Environment and Contexts
description: The on-disk state model for the step CLI — STEPPATH layout, defaults.json, ca.json, root_ca.crt, contexts.json, profiles, and how commands resolve flags and paths from this state.
tags: [architecture, environment, contexts, configuration]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T04:41:54.708Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-6669e35954f940b6199385ca
    resource: repo://command/context/current.go
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T04:41:54.708Z" }
---

# STEPPATH Environment and Contexts

The `step` CLI keeps all of its persistent state under a single directory tree
referred to as the **step path**. On-disk files act as the "memory" of the CLI:
they let commands resolve `--ca-url`, `--root`, and `--fingerprint` after a
one-time bootstrap, and they let users switch between multiple certificate
authorities through **contexts**.

## Base path and environment

The base directory defaults to `$HOME/.step` and can be overridden with the
`STEPPATH` environment variable. `step path --base` prints it via
`step.BasePath()` (command/path/path.go:92-104).

The `step` package from `github.com/smallstep/cli-utils` owns the environment:
`step.Init()` is called once at startup in `internal/cmd/root.go:54`, and
`cmd/step/main.go` seeds the package with the CLI name/version via
`step.Set(...)` before `cmd.Run()`.

Key files and directories produced under the base path (all grounded in code
that writes or references them):

| Path (relative to base) | Written by / referenced by | Purpose |
| --- | --- | --- |
| `certs/root_ca.crt` | `utils/cautils/bootstrap.go` (via `pki.GetRootCAPath()`), `step ca init` | Root certificate of the CA; default root used by commands when `--root` is omitted |
| `config/defaults.json` | `utils/cautils/bootstrap.go` | Default `ca-url`, `fingerprint`, `root`, optional `redirect-url`/`provisioner`/`min-password-length` |
| `config/ca.json` | `step ca init` output | The step-ca server configuration used by `--offline` mode |
| `contexts.json` | context commands via `step.Contexts()` | Map of context name -> `{authority, profile}` |
| `current-context.json` | `step.Contexts().SaveCurrent` | Stores the currently selected context name |
| `profiles/<profile>/` | context/profile resolution via `step.ProfilePath()` | Per-profile configuration directory |
| `ssh/includes` | context removal (`command/context/remove.go`) | SSH include lines associated with an authority |
| `plugins/` | `internal/plugin.LookPath` | External `step-<name>-plugin` executables |

The `path` command help describes the layouts precisely: with no current context
the path is the base; with a current context it is
`$BASE/authorities/<authority>`; with `--profile` it is
`$BASE/profiles/<profile>`.

## default contexts, defaults.json, and flag resolution

After `step ca bootstrap`, commands that take `--ca-url`, `--root`, and
`--fingerprint` no longer need them: `flags.ParseCaURL` and `flags.ParseCaURLIfExists`
in `flags/flags.go` read the `--ca-url` flag, and the `root` flags fall back to
`pki.GetRootCAPath()`. The defaults.json file written by bootstrap sets these
values for the whole environment; `utils/cautils/bootstrap.go:169-193` writes it
with `ca-url`, `fingerprint`, `root`, and optional redirect/provisioner fields.

## Contexts

A **context** is a named bundle of `authority` and `profile` names plus a
configured state directory. Context support lives in the cli-utils `step`
package (`step.Contexts()`); the CLI commands in `command/context/` expose
select, list, current, and remove operations over it.

- `step context select <name>` calls `step.Contexts().SaveCurrent(name)`, which
  persists the selection to `current-context.json` and prints the selection.
- `step context list` prints the current context prefixed with `▶`, then the
  remaining contexts alphabetically.
- `step context current` prints the current context name, or a JSON object
  `{name, authority, profile}` with `--json`.
- `step context remove <name>` deletes the context and its associated on-disk
  directories.

`UseContext` (utils/cautils/bootstrap.go:37-42) decides whether a command should
create or apply a context: it returns true when context management is enabled,
or when any of `--context`, `--authority`, or `--profile` is set. When a command
creates a context (`step ca init`, `step ca bootstrap`), it calls
`step.Contexts().Add(...)`, `SaveCurrent(name)`, and `SetCurrent(name)`.

### Remove semantics and shared directories

`remove.go` is careful about shared state. It refuses to remove the current
context and refuses to delete an `authority` or `profile` directory that is still
referenced by another context. It scans `cs.List()`, marking `saveAuthority` and
`saveProfile`, and only removes `target.Path()`/`target.ProfilePath()` when they
are not shared. Without `--force` it asks for confirmation, and it always removes
the SSH `includes` line associated with the authority afterward.

### Context creation during CA init

`step ca init` (command/ca/init.go:544-570) creates a context when `UseContext`
is true, deriving names from the `--context`, `--authority`, and `--profile`
flags, defaulting each to the first DNS name of the CA. This ties a freshly
initialized CA to a context so users can switch between multiple authorities.

## Profile defaults

When contexts are enabled, `bootstrap` also ensures a `profiles/<profile>`
defaults file exists (written as `{}` when absent) so profile-level configuration
has a stable location (utils/cautils/bootstrap.go:197-210).

## Boundaries

The `step` package (cli-utils) owns the concrete resolution of
`Path()`/`BasePath()`/`ProfilePath()`/`DefaultsFile()` and the contexts store;
this repository only consumes that API and writes the specific artifacts listed
above. The exact internal encoding of `contexts.json`/`current-context.json` is
defined by the cli-utils library, but its shape is documented in the command
help text of `step context` and `step path`.
