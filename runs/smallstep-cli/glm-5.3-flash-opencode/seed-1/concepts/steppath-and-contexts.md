---
type: steppath-state-and-contexts
title: STEPPATH State and Contexts
description: Where step persists configuration on disk — the STEPPATH directory layout, defaults.json, root certificate, and the contexts feature for multi-authority setups.
tags: [state, steppath, contexts, defaults, persistence, configuration]
verified:
  - by: openwiki/0.4.3
    at: 2026-08-31T02:46:08.220Z
sources:
  - id: openwiki-source-62262d696449cb57700a9594
    resource: repo://command/context/context.go
  - id: openwiki-source-6669e35954f940b6199385ca
    resource: repo://command/context/current.go
  - id: openwiki-source-4c7d6cc08b7c0449781d3990
    resource: repo://command/context/select.go
  - id: openwiki-source-5c2db572ee0d531f072d1797
    resource: repo://command/path/path.go
  - id: openwiki-source-8d6b3696164c2c8e87b30286
    resource: repo://utils/cautils/bootstrap.go
  - id: openwiki-source-b89070a90326e73388575597
    resource: repo://utils/cautils/client.go
generated: { by: "opencode", at: "2026-08-31T02:46:08.220Z" }
---

# STEPPATH State and Contexts

## The state model

`step` keeps all persistent client state under a base directory (`$STEPPATH`,
defaulting to `$HOME/.step`; `step path --base` prints it). The directory holds
the bootstrap defaults, the trusted root certificate, context/profile
directories, and the plugins folder. There is no daemon or database — state is
plain JSON and PEM files created by commands like `step ca bootstrap` and
`step context` (repo://command/path/path.go, repo://utils/cautils/bootstrap.go#L145-L210).

## Files written by bootstrap

`bootstrap()` in `utils/cautils/bootstrap.go` creates (repo://utils/cautils/bootstrap.go#L145-L219):

- the root certificate at `pki.GetRootCAPath()` (under the active
  certs directory), serialized with permissions `0600`, with parent directories
  created `0700`;
- `step.DefaultsFile()` — `defaults.json` — written `0644` containing a
  `bootstrapConfig` with keys `ca-url`, `fingerprint`, `root`, and optionally
  `redirect-url`, `provisioner`, `min-password-length`;
- when contexts are enabled, a per-profile defaults file
  (`step.ProfileDefaultsFile()`) is created as `{}` with permissions `0600` if
  absent;
- with `--install`, the root is additionally installed into the system
  trust store via `smallstep/truststore`.

The `bootstrap` command downloads the root from the CA by fingerprint using an
insecure client (`ca.NewClient(caURL, ca.WithInsecure())` — the root itself
validates the response, per the code comment), which is why only the
fingerprint is needed as trust anchor (repo://utils/cautils/bootstrap.go#L98-L114).

## Contexts: multi-authority support

Contexts let one machine hold several CA configurations. A context has a name,
an authority, and a profile (repo://utils/cautils/bootstrap.go#L128-L141):

- `contexts.json` at the base path maps context names to
  `{authority, profile}` pairs (see the example in `step context`'s help,
  repo://command/context/context.go#L20-L36);
- `current-context.json` records the selected context, whose value routes
  `step path` to `$STEPPATH/authorities/<authority>` and `--profile` to
  `$STEPPATH/profiles/<profile>` (repo://command/path/path.go).

Context usage is enabled when `step.Contexts().Enabled()` or when any of the
`--context`, `--authority`, `--profile` flags is set — `UseContext` decides
this (repo://utils/cautils/bootstrap.go#L37-L42). During bootstrap with
contexts enabled, the context is added, saved as current, and set as current;
without contexts, bootstrap warns that an existing CA configuration exists and
suggests contexts (repo://utils/cautils/bootstrap.go#L46-L54,
repo://utils/cautils/bootstrap.go#L115-L144).

## The context command group

`step context` manages these mappings (repo://command/context/context.go#L17-L40):

- `step context select <name>` persists the default via
  `step.Contexts().SaveCurrent(name)` (repo://command/context/select.go#L27-L35);
- `step context current` prints the current context name, or with `--json`
  emits `{name, authority, profile}`; errors with "no context selected" when
  none is set (repo://command/context/current.go#L42-L62);
- `step context list` shows available contexts (with the current one marked,
  per the help text, repo://command/context/context.go#L37-L40).

## How commands resolve defaults

- `step path` prints the effective path: the authority-scoped path when a
  context is current, otherwise the base path; `--base` always prints the base
  and `--profile` the current profile's directory (repo://command/path/path.go).
- CA commands resolve the root via `pki.GetRootCAPath()` when `--root` is not
  given, and require the flag when that file is missing (repo://utils/cautils/client.go#L61-L74,
  repo://utils/cautils/client.go#L84-L95).
- The bootstrap flow writes `ca-url`/`fingerprint`/`root` back into the cli
  context (`ctx.Set(...)`) so subsequent operations in the same command can use
  them (repo://utils/cautils/bootstrap.go#L187-L189).
- Team-based bootstrap (`step ca bootstrap --team`) contacts
  `api.smallstep.com` (overridable via `--team-url`) to discover the CA URL,
  fingerprint, redirect URL, provisioner, and minimum password length, then
  delegates to the same `bootstrap()` (repo://utils/cautils/bootstrap.go#L226-L294).

## Invariants and failure behavior

- Bootstrap creates directories with restrictive permissions (`0700`) and the
  root file as `0600`; `defaults.json` is world-readable (`0644`) (repo://utils/cautils/bootstrap.go#L148-L191).
- Context selection requires exactly one argument and fails if the context does
  not exist (the error comes from `step.Contexts().SaveCurrent`)
  (repo://command/context/select.go#L27-L35).
- When contexts are enabled but a profile defaults file is missing, bootstrap
  seeds it as an empty JSON object rather than failing (repo://utils/cautils/bootstrap.go#L197-L210).

The exact schema and resolution order inside `step.Contexts()` (from
`smallstep/cli-utils`) is owned by that library; this repository establishes
the file names (`contexts.json`, `current-context.json`) only through its
documentation examples and bootstrap call sites.
