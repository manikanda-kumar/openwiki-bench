---
type: architecture
title: "Step Environment, Contexts, and Configuration"
description: "The on-disk step state: STEPPATH base directory, per-context authority/profile directories, contexts.json and current-context.json, defaults.json written at bootstrap, and the --context/--no-context flag surface."
tags: [architecture, steppath, contexts, configuration, persistence]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T03:10:44.156Z
---

# Step Environment, Contexts, and Configuration

The `step` CLI keeps all of its persistent state under a single base
directory. The path mechanics themselves (`step.BasePath()`, `step.Path()`,
`step.ProfilePath()`, `step.Contexts()`, `step.DefaultsFile()`, …) live in the
external `github.com/smallstep/cli-utils/step` package; this page documents the
contract as observed from this repository's code and command documentation.

## Base path and STEPPATH

`step path` (command/path/path.go:12-107) is the authoritative description and
printer of the layout:

- Default base path is `$HOME/.step`, overridable with the `STEPPATH`
  environment variable (path.go:17-23).
- With no current context, `step path` prints the base path.
- With a current context (stored at `$STEPPATH/current-context.json`, content
  shape `{"context": "<name>"}`), `step path` prints the per-authority
  directory, e.g. `/Users/max/.step/authorities/machine.step-internal.net`
  (path.go:39-46).
- `--base` always prints the un-contextualized base; `--profile` prints the
  current profile directory (`$STEPPATH/profiles/<profile>`), resolved through
  the context table (path.go:61-102).

The Action is a thin mapping: `--base` → `step.BasePath()`, `--profile` →
`step.ProfilePath()`, default → `step.Path()` (path.go:92-103).

## Contexts

A context pairs a **profile** and an **authority** name under a context key,
persisted in `$(step path --base)/contexts.json`. The example document in the
command group description shows the layout
(command/context/context.go:20-36):

```json
{ "alpha-one": { "authority": "alpha-one.ca.smallstep.com",
                 "profile": "alpha-one" }, ... }
```

The `step context` group exposes four subcommands, all of which manipulate the
cli-utils context store:

- `list` prints contexts with `▶` marking the current one, remainder
  alphabetical (command/context/list.go:37-51).
- `select <name>` persists the choice as current via
  `step.Contexts().SaveCurrent(name)` (command/context/select.go:34-43).
- `current` prints `step.Contexts().GetCurrent()` details
  (command/context/current.go:47).
- `remove <name>` errors when contexts are not enabled, refuses to remove the
  current context, and keeps shared authority/profile directories alive if
  another context references them (command/context/remove.go:47-80).

Contexts are *created* implicitly by CA setup flows: `step ca init` adds a
context and makes it current (command/ca/init.go:557-567), and the bootstrap
flow in `utils/cautils/bootstrap.go:115-141` adds `{name, profile, authority}`
(defaulting profile/authority to the context name) when `--context`,
`--authority`, or `--profile` are used or contexts are already enabled
(`UseContext`, bootstrap.go:37-42).

### Context flags

- `flags.Context` (`--context`), `flags.ContextProfile` (`--profile`), and
  `flags.ContextAuthority` (`--authority`) select/parameterize contexts per
  command; they appear on ca/admin/eab/certificate commands
  (e.g. command/ca/bootstrap.go:77-79, command/ca/certificate.go:191).
- `flags.HiddenNoContext` is a hidden `BoolT` flag `--no-context` (default
  true) that opts a command out of applying context environment; it is
  attached even to the context-management commands themselves (flags/flags.go:256-262,
  command/context/select.go:28-30).
- Where the mapping is applied explicitly in this repo, it is
  `step.Contexts().Apply(ctx)` — for example `step ssh config` refreshes
  context state before rendering (command/ssh/config.go:147) and embeds the
  current context name and `step.Path()` in template data
  (command/ssh/config.go:203-208). The global application of the current
  context to flag defaults happens inside cli-utils during app/command setup,
  which this repository does not contain.

## Configuration files under the step path

| File | Written by | Contents |
|---|---|---|
| `$STEPPATH/configs/defaults.json` per docs / `step.DefaultsFile()` | bootstrap (`utils/cautils/bootstrap.go:146-195`) | `ca-url`, `fingerprint`, `root`, optional `redirect-url`, `provisioner`, `min-password-length` |
| `$(step path)/config/ca.json` | `step ca init` | full step-ca authority config; it is also the **default value of `--ca-config`** in offline mode (flags/flags.go:290-296) |
| `current-context.json`, `contexts.json` | context flows | context selection and table (path.go:39-66) |
| `ProfileDefaultsFile()` | bootstrap, only when contexts are enabled | initialized to `{}` with mode 0600 (bootstrap.go:197-210) |
| root CA at `pki.GetRootCAPath()` | bootstrap / `step ca root` | PEM root validated by fingerprint; used as the default `--root` for online clients (utils/cautils/client.go:65-71) |

Directory creation in bootstrap uses mode 0700 for config directories and 0600
for the root certificate file (bootstrap.go:148-161). The `Identity` flag
documentation notes that flag defaults can be supplied via
`$STEPPATH/config/defaults.json` (flags/flags.go:451-457), and `step ca
health`'s help states defaults are read from that file
(command/ca/health.go:39-42).

The app-level `--config` global flag (internal/cmd/root.go:127-131) takes a
path to a CLI flags configuration file; its loading is implemented in
cli-utils, and this repository does not establish its format beyond that.

## Uncertainties

- Exact file merge precedence between `defaults.json`, profile defaults, and
  explicit flags is enforced in cli-utils and is not visible in this
  repository's source.
- `step ca init` delegating authority-file layout to `smallstep/certificates`
  (`pki` package) means on-disk PKI structure beyond ca.json/root paths is not
  specified here.

Related: clients consuming these paths are described in
[CA client integration](/openwiki/architecture/ca-client-integration.md);
environment initialization order is in
[CLI runtime](/openwiki/architecture/cli-runtime.md).
