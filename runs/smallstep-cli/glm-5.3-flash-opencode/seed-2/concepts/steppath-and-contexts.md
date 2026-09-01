---
type: concept
title: STEPPATH and Contexts
description: The on-disk layout under $STEPPATH (defaults.json, contexts.json, authorities, profiles) and the context model that lets one installation switch between authorities.
tags: [steppath, contexts, configuration, filesystem]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T08:02:07.014Z
sources:
  - id: openwiki-source-c8184c164c03350d902856b6
    resource: repo://command/ca/init.go
  - id: openwiki-source-57260b234ea7f7b2e5fd2415
    resource: repo://command/completion/completion.go
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-6669e35954f940b6199385ca
    resource: repo://command/context/current.go
  - id: openwiki-source-afa1bb85ea22c4767c369398
    resource: repo://command/context/list.go
  - id: openwiki-source-046008c13a5e35bec19892a7
    resource: repo://command/context/remove.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-205ac6ecd6fdb2d722b0f08e
    resource: repo://command/ssh/config.go
  - id: openwiki-source-54f9549d0889f08d7b237f07
    resource: repo://command/version/version.go
  - id: openwiki-source-c95a6442e04cbde8ce71fd13
    resource: repo://flags/flags.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
generated: { by: "opencode", at: "2026-08-31T08:02:07.014Z" }
---

# STEPPATH and Contexts

## The step base path

All persistent CLI state lives under the *step base path*: `$HOME/.step` by
default, overridable with the `STEPPATH` environment variable. `step path`
prints the effective path, `step path --base` always prints the base, and
`step path --profile` prints the current profile's path. When a context is
current, plain `step path` returns the *authority* path
(`$STEPPATH/authorities/<name>`) instead of the base — this is why
context-sensitive defaults such as the `--ca-config` default
(`$(step path)/config/ca.json`, computed by the `flags.CaConfig` flag at
definition time) automatically follow the selected authority.

## Files and directories

| Location | Content |
| --- | --- |
| `$STEPPATH/config/defaults.json` | Base defaults for the non-context case: `ca-url`, `fingerprint`, `root`, and optionally `redirect-url`, `provisioner`, `min-password-length` (written by `step ca bootstrap`). |
| `$STEPPATH/config/ca.json` | Presence indicates a locally configured CA (`step ca init`); bootstrap uses its existence to warn users that contexts exist. |
| `$STEPPATH/current-context.json` | The current context name, e.g. `{"context": "machine.step-internal.net"}`. |
| `$STEPPATH/contexts.json` | Maps context names to their `profile` and `authority`, e.g. `{"ca.acme.net": {"profile": "example-corp", "authority": "machine.acme.net"}}`. |
| `$STEPPATH/authorities/<name>/` | Per-authority tree; `step path` resolves here when a context is current. |
| `$STEPPATH/profiles/<name>/` | Per-profile tree; `step path --profile` resolves here, and the profile's own defaults file (`step.ProfileDefaultsFile()`) is seeded with `{}` by bootstrap. |
| `$STEPPATH/plugins/` | Executables named `step-<name>-plugin` (plugin dispatch looks here first). |
| `$STEPPATH/ssh/includes/` | Per-authority SSH config include lines managed by `step ssh config` and cleaned up by `step context remove`. |

The `contexts.json` and `current-context.json` formats, the
`authorities/`/`profiles/` resolution, and the plugin directory are
documented in the commands themselves (`step context`, `step path`) and in
the code that reads and writes them.

## When contexts are active

`cautils.UseContext(ctx)` decides whether an operation should participate in
the context system: it returns true when contexts are already enabled in the
`step` runtime **or** when any of `--context`, `--authority`, or `--profile`
is set on the command line. Both `step ca init` and `step ca bootstrap` use
this predicate; when it holds, they create the context
(`step.Contexts().Add`), persist it as current (`SaveCurrent`), and activate
it (`SetCurrent`) in one go. The context name defaults to the CA hostname
(bootstrap) or the first DNS name (init) when `--context` is omitted, with
`--authority`/`--profile` defaulting to the same name.

When contexts are *not* used and the base path already contains a configured
CA (`config/ca.json`), bootstrap prints a warning suggesting contexts as the
way to manage multiple authorities.

## The `step context` group

- `step context current` prints the current context name (or a JSON object
  with `name`, `authority`, and `profile` via `--json`); errors with
  "no context selected" when none is set.
- `step context list` prints known contexts alphabetically, marking the
  current one.
- `step context select <name>` sets the default context via
  `step.Contexts().SaveCurrent`.
- `step context remove <name>` deletes the context's authority directory and
  profile directory, and removes the authority's include line from
  `$STEPPATH/ssh/includes` so generated SSH config stops referencing it.

## Interaction with other commands

`step ssh config` applies the active context explicitly
(`step.Contexts().Apply(ctx)`) and embeds the context name in the generated
SSH configuration data. Commands that must not depend on context state —
`version`, `completion`, and the `context` group itself — include the hidden
`--no-context` flag (`flags.HiddenNoContext`, a boolean-true flag) so context
application can be disabled per invocation.
